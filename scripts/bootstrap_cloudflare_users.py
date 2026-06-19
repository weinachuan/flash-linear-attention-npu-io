#!/usr/bin/env python3
"""Create developer accounts for people in the Cloudflare D1 project."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SKIP_NAMES = {"", "待填写", "待排人力", "对应算子责任人"}


def default_worker_api() -> str:
    config_path = ROOT / "docs" / "config.js"
    if not config_path.exists():
        return ""
    match = re.search(
        r"FLASH_IO_API_BASE\s*=\s*[\"']([^\"']+)[\"']",
        config_path.read_text(encoding="utf-8-sig"),
    )
    return match.group(1).rstrip("/") if match else ""


def request_json(api: str, path: str, token: str | None = None, payload: dict[str, Any] | None = None) -> Any:
    headers = {
        "Accept": "application/json",
        "User-Agent": "flash-linear-attention-npu-io-user-bootstrap",
    }
    data = None
    method = "GET"
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
        method = "POST"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(api.rstrip("/") + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed: HTTP {exc.code} {body}") from exc


def normalize_name(value: str) -> str:
    return str(value or "").strip()


def initial_password() -> str:
    return secrets.token_urlsafe(14)


def people_from_state(state: dict[str, Any]) -> list[str]:
    names = []
    seen = set()
    for person in sorted(state.get("people", []), key=lambda item: (item.get("position", 0), item.get("name", ""))):
        name = normalize_name(person.get("name", ""))
        if person.get("placeholder") or name in SKIP_NAMES or name in seen:
            continue
        seen.add(name)
        names.append(name)
    return names


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["username", "password", "display_name", "owner_name", "role", "status"])
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Create one developer account per project person.")
    parser.add_argument("--api", default=os.environ.get("FLASH_IO_API_BASE") or default_worker_api())
    parser.add_argument("--token", default=os.environ.get("FLASH_IO_ADMIN_TOKEN") or os.environ.get("ADMIN_TOKEN"))
    parser.add_argument("--out", default=str(ROOT / "generated" / "initial-accounts.csv"))
    parser.add_argument("--reset-existing", action="store_true", help="Reset passwords for existing person accounts too.")
    args = parser.parse_args()

    if not args.api:
        print("Worker API URL is not configured.", file=sys.stderr)
        return 1
    if not args.token:
        print("FLASH_IO_ADMIN_TOKEN is required.", file=sys.stderr)
        return 1

    state = request_json(args.api, "/api/export")
    users = request_json(args.api, "/api/users", args.token)
    existing = {normalize_name(user.get("username", "")): user for user in users}
    rows = []
    created = 0
    skipped = 0
    reset = 0
    for name in people_from_state(state):
        username = name
        if username in existing and not args.reset_existing:
            rows.append({
                "username": username,
                "password": "",
                "display_name": name,
                "owner_name": name,
                "role": "developer",
                "status": "existing-not-reset",
            })
            skipped += 1
            continue
        password = initial_password()
        request_json(args.api, "/api/users", args.token, {
            "username": username,
            "password": password,
            "role": "developer",
            "displayName": name,
            "ownerName": name,
            "active": True,
            "resetPassword": username in existing,
        })
        rows.append({
            "username": username,
            "password": password,
            "display_name": name,
            "owner_name": name,
            "role": "developer",
            "status": "reset" if username in existing else "created",
        })
        if username in existing:
            reset += 1
        else:
            created += 1

    out_path = Path(args.out)
    write_csv(out_path, rows)
    print(json.dumps({
        "created": created,
        "reset": reset,
        "existingNotReset": skipped,
        "accounts": len(rows),
        "out": str(out_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
