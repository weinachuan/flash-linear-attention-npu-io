#!/usr/bin/env python3
"""Generate D1 seed SQL from repository snapshots."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PASSWORD_HASH_ITERATIONS = 100000


def read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries


def read_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value
    return result


def sql_string(value: Any) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def sql_int(value: Any, default: int = 0) -> str:
    try:
        return str(int(value))
    except (TypeError, ValueError):
        return str(default)


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def insert(table: str, columns: list[str], values: list[Any]) -> str:
    quoted = ", ".join(sql_string(value) if not isinstance(value, RawSql) else value.value for value in values)
    return f"INSERT INTO {table}({', '.join(columns)}) VALUES ({quoted});"


class RawSql:
    def __init__(self, value: str) -> None:
        self.value = value


def password_hash(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PASSWORD_HASH_ITERATIONS, dklen=32)
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def emit_state(lines: list[str], state: dict[str, Any], pr_catalog: dict[str, Any]) -> None:
    lines.extend([
        "DELETE FROM task_segments;",
        "DELETE FROM tasks;",
        "DELETE FROM people;",
        "DELETE FROM specials;",
        "DELETE FROM groups;",
        "DELETE FROM project_meta WHERE key IN ('project', 'repoScan', 'prCatalog');",
    ])
    lines.append(insert("project_meta", ["key", "value"], ["project", json_text(state.get("project", {}))]))
    lines.append(insert("project_meta", ["key", "value"], ["repoScan", json_text(state.get("repoScan", {}))]))
    lines.append(insert("project_meta", ["key", "value"], ["prCatalog", json_text(pr_catalog)]))

    for index, group in enumerate(state.get("groups", [])):
        lines.append(insert("groups", ["id", "title", "due_date", "start_date", "end_date", "position"], [
            group.get("id"),
            group.get("title") or "未命名分组",
            group.get("due_date") or group.get("end_date") or "2026-06-25",
            group.get("start_date") or group.get("due_date") or "2026-06-25",
            group.get("end_date") or group.get("due_date") or "2026-06-25",
            RawSql(sql_int(group.get("position"), index)),
        ]))

    for index, special in enumerate(state.get("specials", [])):
        lines.append(insert("specials", ["id", "title", "group_id", "position", "collapsed"], [
            special.get("id"),
            special.get("title") or "专项：未命名",
            special.get("group_id"),
            RawSql(sql_int(special.get("position"), index)),
            RawSql("1" if special.get("collapsed") else "0"),
        ]))

    for index, person in enumerate(state.get("people", [])):
        lines.append(insert("people", ["id", "name", "position", "placeholder", "pl"], [
            person.get("id"),
            person.get("name") or "待排人力",
            RawSql(sql_int(person.get("position"), index)),
            RawSql("1" if person.get("placeholder") else "0"),
            person.get("pl") or "赵臣臣",
        ]))

    for index, task in enumerate(state.get("tasks", [])):
        lines.append(insert("tasks", [
            "id", "title", "scope", "target", "owner", "status", "risk", "priority",
            "group_id", "special_id", "start_date", "end_date", "evidence", "dependencies",
            "pr_link", "test_report", "notes", "recommit_date", "done_date", "position", "created_at", "updated_at",
        ], [
            task.get("id"),
            task.get("title") or "未命名任务",
            task.get("scope") or "",
            task.get("target") or "",
            task.get("owner") or "待排人力",
            task.get("status") or "todo",
            task.get("risk") or "中",
            task.get("priority") or "P1",
            task.get("group_id") or "",
            task.get("special_id"),
            task.get("start_date") or "2026-06-25",
            task.get("end_date") or task.get("start_date") or "2026-06-25",
            json_text(task.get("evidence") or []),
            json_text(task.get("dependencies") or []),
            task.get("pr_link") or "",
            task.get("test_report") or "",
            task.get("notes") or "",
            task.get("recommit_date") or "",
            task.get("done_date") or "",
            RawSql(sql_int(task.get("position"), index)),
            task.get("created_at") or now_iso(),
            task.get("updated_at") or now_iso(),
        ]))
        segments = task.get("segments") or [{
            "start_date": task.get("start_date"),
            "end_date": task.get("end_date") or task.get("start_date"),
            "reason": task.get("notes") or "",
            "position": 0,
        }]
        for segment_index, segment in enumerate(segments):
            lines.append(insert("task_segments", ["id", "task_id", "start_date", "end_date", "reason", "position"], [
                segment.get("id") or f"seg-{task.get('id')}-{segment_index}",
                task.get("id"),
                segment.get("start_date") or task.get("start_date") or "2026-06-25",
                segment.get("end_date") or task.get("end_date") or task.get("start_date") or "2026-06-25",
                segment.get("reason") or "",
                RawSql(sql_int(segment.get("position"), segment_index)),
            ]))


def emit_audit(lines: list[str], audit: list[dict[str, Any]]) -> None:
    lines.append("DELETE FROM audit_entries;")
    for entry in audit:
        lines.append(insert("audit_entries", ["ts", "action", "entity", "entity_id", "summary", "detail", "source"], [
            entry.get("ts") or now_iso(),
            entry.get("action") or "",
            entry.get("entity") or "",
            entry.get("id") or entry.get("entity_id") or "",
            entry.get("summary") or "",
            json_text(entry.get("detail") or {}),
            entry.get("source") or "d1-seed",
        ]))


def emit_admin(lines: list[str], env: dict[str, str]) -> None:
    username = env.get("ADMIN_USERNAME", "").strip()
    password = env.get("ADMIN_PASSWORD", "")
    if not username or not password:
        return
    salt = secrets.token_urlsafe(18)
    now = now_iso()
    lines.append(insert("users", [
        "id", "username", "display_name", "owner_name", "role", "password_hash",
        "salt", "active", "created_at", "updated_at",
    ], [
        f"user-{username}",
        username,
        "管理员",
        "管理员",
        "admin",
        password_hash(password, salt),
        salt,
        RawSql("1"),
        now,
        now,
    ]).replace("INSERT INTO users", "INSERT OR REPLACE INTO users"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate D1 SQL seed file.")
    parser.add_argument("--state", default=str(ROOT / "data" / "project-state.json"))
    parser.add_argument("--audit", default=str(ROOT / "data" / "audit-log.jsonl"))
    parser.add_argument("--pr-catalog", default=str(ROOT / "data" / "pr-catalog.json"))
    parser.add_argument("--admin-env", default=str(ROOT / ".local-secrets" / "cloudflare.env"))
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    state = read_json(Path(args.state))
    if not state:
        raise SystemExit("state snapshot not found")
    pr_catalog = read_json(Path(args.pr_catalog), {"generatedAt": "", "sourceRepo": "", "total": 0, "items": []})
    audit = read_jsonl(Path(args.audit))
    env = read_env(Path(args.admin_env))

    lines: list[str] = []
    emit_state(lines, state, pr_catalog)
    emit_audit(lines, audit)
    emit_admin(lines, env)
    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"generated {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
