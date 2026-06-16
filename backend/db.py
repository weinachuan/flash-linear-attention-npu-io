from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "project.sqlite3"
PROJECT_DATA_CANDIDATES = [
    ROOT / "data" / "seed-project-data.json",
    ROOT.parent / "flash-linear-attention-npu-project" / "project-data.json",
]
GANTT_HTML_CANDIDATES = [
    ROOT / "data" / "seed-gantt-view.html",
    ROOT.parent / "flash-linear-attention-npu-project" / "gantt-view.html",
]
BASE_DATE = datetime(2026, 6, 15, tzinfo=timezone(timedelta(hours=8))).date()

RISK_TO_PRIORITY = {"高": "P0", "中": "P1", "低": "P2"}
DEFAULT_PROJECT = {
    "name": "flash-linear-attention-npu",
    "repository": "https://github.com/flashserve/flash-linear-attention-npu",
    "baselineDate": "2026-06-15",
    "projectOwner": {"name": "待填写", "email": "待填写"},
}


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def now_iso() -> str:
    return datetime.now(timezone(timedelta(hours=8))).replace(microsecond=0).isoformat()


def make_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def as_json(value: Any) -> str:
    return json.dumps(value if value is not None else [], ensure_ascii=False)


def parse_json(value: str | None, fallback: Any = None) -> Any:
    if value in (None, ""):
        return [] if fallback is None else fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback if fallback is not None else value


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS project_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          due_date TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS specials (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          group_id TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          collapsed INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT '',
          target TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '待填写',
          status TEXT NOT NULL DEFAULT 'todo',
          risk TEXT NOT NULL DEFAULT '中',
          priority TEXT NOT NULL DEFAULT 'P1',
          group_id TEXT NOT NULL,
          special_id TEXT,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          evidence TEXT NOT NULL DEFAULT '[]',
          dependencies TEXT NOT NULL DEFAULT '[]',
          notes TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(group_id) REFERENCES groups(id) ON UPDATE CASCADE,
          FOREIGN KEY(special_id) REFERENCES specials(id) ON UPDATE CASCADE ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS task_segments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        """
    )
    conn.commit()


def seed_if_empty(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    if count:
        return
    import_project_data(conn, first_existing(PROJECT_DATA_CANDIDATES))
    gantt_html = first_existing(GANTT_HTML_CANDIDATES)
    if gantt_html:
        import_gantt_html_overlay(conn, gantt_html)
    conn.commit()


def first_existing(paths: list[Path]) -> Path | None:
    return next((path for path in paths if path.exists()), None)


def import_project_data(conn: sqlite3.Connection, path: Path | None) -> None:
    data = DEFAULT_PROJECT
    if path and path.exists():
        data = json.loads(path.read_text(encoding="utf-8-sig"))

    project = data.get("project", DEFAULT_PROJECT)
    conn.execute(
        "INSERT OR REPLACE INTO project_meta(key, value) VALUES (?, ?)",
        ("project", as_json(project)),
    )

    repo_risk = {
        item.get("id"): item
        for item in data.get("repoScan", {}).get("items", [])
        if item.get("id")
    }
    repo_status = data.get("repoScan", {})
    conn.execute(
        "INSERT OR REPLACE INTO project_meta(key, value) VALUES (?, ?)",
        ("repoScan", as_json(repo_status)),
    )

    milestones = data.get("milestones") or [
        {"id": "M-2026-06-18", "title": "06-18 转测", "dueDate": "2026-06-18", "items": []},
        {"id": "M-2026-06-25", "title": "06-25 转测", "dueDate": "2026-06-25", "items": []},
        {"id": "M-2026-07-15", "title": "07-15 转测", "dueDate": "2026-07-15", "items": []},
    ]

    for group_pos, milestone in enumerate(milestones):
        group_id = milestone.get("id") or make_id("group")
        title = milestone.get("title") or group_id
        due_date = milestone.get("dueDate") or "2026-06-25"
        conn.execute(
            """
            INSERT OR REPLACE INTO groups(id, title, due_date, start_date, end_date, position)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (group_id, title, due_date, due_date, due_date, group_pos),
        )

    default_specials = [
        ("docs", "专项：对应场景文档更新", "M-2026-06-25", 90),
        ("launch", "专项：<<<>>> 调用示例", "M-2026-06-25", 91),
    ]
    for row in default_specials:
        conn.execute(
            "INSERT OR REPLACE INTO specials(id, title, group_id, position) VALUES (?, ?, ?, ?)",
            row,
        )

    for milestone in milestones:
        group_id = milestone.get("id")
        due_date = milestone.get("dueDate") or "2026-06-25"
        for pos, item in enumerate(milestone.get("items", [])):
            task_id = item.get("id") or make_id("task")
            scan = repo_risk.get(task_id, {})
            risk = scan.get("repoRisk") or item.get("risk") or "中"
            priority = item.get("priority") or RISK_TO_PRIORITY.get(risk, "P1")
            title = item.get("title") or task_id
            special_id = infer_special_id(title)
            evidence = item.get("evidence", [])
            if isinstance(evidence, str):
                evidence = [evidence]
            if scan.get("evidence"):
                evidence.append(scan["evidence"])
            upsert_task(
                conn,
                {
                    "id": task_id,
                    "title": title,
                    "scope": item.get("scope", ""),
                    "target": item.get("target", ""),
                    "owner": item.get("owner") or "待填写",
                    "status": item.get("status") or "todo",
                    "risk": risk,
                    "priority": priority,
                    "group_id": group_id,
                    "special_id": special_id,
                    "start_date": due_date,
                    "end_date": due_date,
                    "evidence": evidence,
                    "dependencies": item.get("dependencies", []),
                    "notes": "",
                    "position": pos,
                },
            )


def infer_special_id(title: str) -> str | None:
    if "对应场景" in title or "文档更新" in title:
        return "docs"
    if "<<<>>>" in title or "调用示例" in title or "方式调用" in title:
        return "launch"
    return None


def import_gantt_html_overlay(conn: sqlite3.Connection, path: Path) -> None:
    html = path.read_text(encoding="utf-8")
    match = re.search(r'<script type="application/json" id="initialTasks">(.+?)</script>', html, re.S)
    if not match:
        return
    tasks = json.loads(match.group(1))
    conn.execute("DELETE FROM task_segments")
    conn.execute("DELETE FROM tasks")
    group_by_title = {
        row["title"]: row["id"]
        for row in conn.execute("SELECT id, title FROM groups").fetchall()
    }
    for pos, task in enumerate(tasks):
        group_title = task.get("group") or "06-25 转测"
        group_id = group_by_title.get(group_title)
        if not group_id:
            group_id = make_id("group")
            group_by_title[group_title] = group_id
            due = date_from_index(task.get("start", 0) + task.get("span", 1) - 1)
            conn.execute(
                """
                INSERT INTO groups(id, title, due_date, start_date, end_date, position)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (group_id, group_title, due, due, due, len(group_by_title)),
            )
        start = date_from_index(int(task.get("start", 0)))
        end = date_from_index(int(task.get("start", 0)) + int(task.get("span", 1)) - 1)
        payload = {
            "id": task["id"],
            "title": task.get("title", ""),
            "owner": task.get("owner", "待填写"),
            "risk": task.get("risk", "中"),
            "priority": task.get("priority", RISK_TO_PRIORITY.get(task.get("risk", "中"), "P1")),
            "group_id": group_id,
            "special_id": task.get("special"),
            "start_date": start,
            "end_date": end,
            "position": pos,
        }
        existing = conn.execute("SELECT * FROM tasks WHERE id = ?", (task["id"],)).fetchone()
        if existing:
            update_task(conn, task["id"], payload)
        else:
            payload.update({"scope": "", "target": "", "status": "todo", "evidence": [], "dependencies": [], "notes": ""})
            upsert_task(conn, payload)

        conn.execute("DELETE FROM task_segments WHERE task_id = ?", (task["id"],))
        for seg_pos, segment in enumerate(task.get("segments") or [{"start": task.get("start", 0), "span": task.get("span", 1)}]):
            seg_start = int(segment.get("start", task.get("start", 0)))
            seg_end = seg_start + int(segment.get("span", 1)) - 1
            conn.execute(
                """
                INSERT INTO task_segments(id, task_id, start_date, end_date, position)
                VALUES (?, ?, ?, ?, ?)
                """,
                (make_id("seg"), task["id"], date_from_index(seg_start), date_from_index(seg_end), seg_pos),
            )


def date_from_index(index: int) -> str:
    return (BASE_DATE + timedelta(days=index)).isoformat()


def upsert_task(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    timestamp = now_iso()
    conn.execute(
        """
        INSERT OR REPLACE INTO tasks(
          id, title, scope, target, owner, status, risk, priority, group_id, special_id,
          start_date, end_date, evidence, dependencies, notes, position, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM tasks WHERE id = ?), ?), ?)
        """,
        (
            payload["id"],
            payload.get("title", ""),
            payload.get("scope", ""),
            payload.get("target", ""),
            payload.get("owner", "待填写"),
            payload.get("status", "todo"),
            payload.get("risk", "中"),
            payload.get("priority", "P1"),
            payload.get("group_id"),
            payload.get("special_id"),
            payload.get("start_date"),
            payload.get("end_date"),
            as_json(payload.get("evidence", [])),
            as_json(payload.get("dependencies", [])),
            payload.get("notes", ""),
            int(payload.get("position", 0)),
            payload["id"],
            timestamp,
            timestamp,
        ),
    )
    if not conn.execute("SELECT 1 FROM task_segments WHERE task_id = ?", (payload["id"],)).fetchone():
        conn.execute(
            "INSERT INTO task_segments(id, task_id, start_date, end_date, position) VALUES (?, ?, ?, ?, 0)",
            (make_id("seg"), payload["id"], payload.get("start_date"), payload.get("end_date")),
        )


def update_task(conn: sqlite3.Connection, task_id: str, changes: dict[str, Any]) -> bool:
    allowed = {
        "title",
        "scope",
        "target",
        "owner",
        "status",
        "risk",
        "priority",
        "group_id",
        "special_id",
        "start_date",
        "end_date",
        "evidence",
        "dependencies",
        "notes",
        "position",
    }
    fields = []
    values = []
    for key, value in changes.items():
        if key not in allowed:
            continue
        if key in {"evidence", "dependencies"}:
            value = as_json(value)
        fields.append(f"{key} = ?")
        values.append(value)
    if not fields:
        return False
    fields.append("updated_at = ?")
    values.append(now_iso())
    values.append(task_id)
    cur = conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)
    return cur.rowcount > 0


def task_to_dict(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    task = dict(row)
    task["evidence"] = parse_json(task.get("evidence"), [])
    task["dependencies"] = parse_json(task.get("dependencies"), [])
    task["segments"] = [
        dict(seg)
        for seg in conn.execute(
            "SELECT id, start_date, end_date, reason, position FROM task_segments WHERE task_id = ? ORDER BY position, start_date",
            (task["id"],),
        ).fetchall()
    ]
    return task


def export_all(conn: sqlite3.Connection) -> dict[str, Any]:
    return {
        "project": parse_json(conn.execute("SELECT value FROM project_meta WHERE key = 'project'").fetchone()["value"], {}),
        "repoScan": parse_json(conn.execute("SELECT value FROM project_meta WHERE key = 'repoScan'").fetchone()["value"], {}),
        "groups": [dict(row) for row in conn.execute("SELECT * FROM groups ORDER BY position, due_date").fetchall()],
        "specials": [dict(row) for row in conn.execute("SELECT * FROM specials ORDER BY position, title").fetchall()],
        "tasks": [
            task_to_dict(conn, row)
            for row in conn.execute("SELECT * FROM tasks ORDER BY position, start_date, title").fetchall()
        ],
    }
