from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

try:
    from .db import AUDIT_LOG_PATH, ROOT, STATE_PATH, now_iso, write_state_snapshot
except ImportError:
    from db import AUDIT_LOG_PATH, ROOT, STATE_PATH, now_iso, write_state_snapshot  # type: ignore


PAGES_STATE_PATH = ROOT / "docs" / "project-state.json"
PAGES_AUDIT_LOG_PATH = ROOT / "docs" / "audit-log.jsonl"
TRACKED_DATA_FILES = [
    "data/project-state.json",
    "data/audit-log.jsonl",
    "docs/project-state.json",
    "docs/audit-log.jsonl",
]


def persist_change(conn, action: str, entity: str, entity_id: str, summary: str, detail: dict[str, Any] | None = None) -> dict[str, Any]:
    write_state_snapshot(conn)
    entry = {
        "ts": now_iso(),
        "action": action,
        "entity": entity,
        "id": entity_id,
        "summary": summary,
        "detail": detail or {},
        "source": "web",
    }
    append_audit_log(entry)
    mirror_pages_data()
    if os.environ.get("FLASH_IO_DISABLE_GIT_SYNC") == "1":
        return {"ok": True, "mode": "disabled", "entry": entry}
    result = commit_and_push(f"{summary} ({entity_id})")
    result["entry"] = entry
    return result


def append_audit_log(entry: dict[str, Any]) -> None:
    AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")


def mirror_pages_data() -> None:
    PAGES_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PAGES_STATE_PATH.write_text(STATE_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    PAGES_AUDIT_LOG_PATH.write_text(AUDIT_LOG_PATH.read_text(encoding="utf-8"), encoding="utf-8")


def commit_and_push(summary: str) -> dict[str, Any]:
    run_git(["add", *TRACKED_DATA_FILES])
    diff = subprocess.run(["git", "diff", "--cached", "--quiet", "--", *TRACKED_DATA_FILES], cwd=ROOT)
    if diff.returncode == 0:
        return {"ok": True, "mode": "no-change"}

    message = "记录数据变更: " + sanitize_commit_text(summary)
    run_git(["commit", "-m", message, "--", *TRACKED_DATA_FILES])
    run_git(["push"])
    return {"ok": True, "mode": "pushed", "commitMessage": message}


def run_git(args: list[str]) -> subprocess.CompletedProcess[str]:
    env = git_env()
    completed = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout or "git command failed").strip()
        raise RuntimeError(sanitize_error(message))
    return completed


def git_env() -> dict[str, str]:
    env = os.environ.copy()
    if not env.get("HTTP_PROXY") and not env.get("HTTPS_PROXY"):
        proxy = windows_proxy()
        if proxy:
            env["HTTP_PROXY"] = proxy
            env["HTTPS_PROXY"] = proxy
    return env


def windows_proxy() -> str | None:
    if os.name != "nt":
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as key:
            enabled = winreg.QueryValueEx(key, "ProxyEnable")[0]
            server = winreg.QueryValueEx(key, "ProxyServer")[0]
        if not enabled or not server:
            return None
        first = str(server).split(";")[0]
        if "=" in first:
            first = first.split("=", 1)[1]
        if not first.startswith(("http://", "https://")):
            first = "http://" + first
        return first
    except OSError:
        return None


def sanitize_commit_text(value: str) -> str:
    text = " ".join(str(value).split())
    return text[:120] or "更新项目数据"


def sanitize_error(value: str) -> str:
    text = value.replace(str(Path.home()), "<home>")
    return text[:800]
