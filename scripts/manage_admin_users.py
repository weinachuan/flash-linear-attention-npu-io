#!/usr/bin/env python3
"""Create admin accounts and promote existing users without resetting passwords."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def default_worker_api() -> str:
    config_path = ROOT / "docs" / "config.js"
    if not config_path.exists():
        return ""
    match = re.search(
        r"FLASH_IO_API_BASE\s*=\s*[\"']([^\"']+)[\"']",
        config_path.read_text(encoding="utf-8-sig"),
    )
    return match.group(1).rstrip("/") if match else ""


def request_json(
    api: str,
    path: str,
    token: str,
    payload: dict[str, Any] | None = None,
    method: str | None = None,
) -> Any:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "flash-linear-attention-npu-io-admin-users",
    }
    data = None
    request_method = method or ("POST" if payload is not None else "GET")
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    request = urllib.request.Request(api.rstrip("/") + path, data=data, method=request_method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{request_method} {path} failed: HTTP {exc.code} {body}") from exc


def normalize_name(value: str) -> str:
    return str(value or "").strip()


def initial_password() -> str:
    return secrets.token_urlsafe(16)


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["username", "password", "display_name", "owner_name", "role", "status"])
        writer.writeheader()
        writer.writerows(rows)


def find_user(users: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    target = normalize_name(name)
    for user in users:
        if normalize_name(user.get("username")) == target:
            return user
    for user in users:
        if normalize_name(user.get("display_name")) == target:
            return user
        if normalize_name(user.get("displayName")) == target:
            return user
        if normalize_name(user.get("owner_name")) == target:
            return user
        if normalize_name(user.get("ownerName")) == target:
            return user
    return None


def promote_user(api: str, token: str, user: dict[str, Any], name: str) -> None:
    user_id = user.get("id") or user.get("username") or name
    request_json(api, f"/api/users/{urllib.parse.quote(str(user_id), safe='')}", token, {
        "fields": {
            "role": "admin",
            "active": True,
            "displayName": user.get("displayName") or user.get("display_name") or name,
            "ownerName": user.get("ownerName") or user.get("owner_name") or name,
        },
    }, method="PATCH")


def create_admin(api: str, token: str, name: str, password: str) -> None:
    request_json(api, "/api/users", token, {
        "username": name,
        "password": password,
        "role": "admin",
        "displayName": name,
        "ownerName": name,
        "active": True,
    })


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Create/promote Cloudflare app admin users.")
    parser.add_argument("--api", default=os.environ.get("FLASH_IO_API_BASE") or default_worker_api())
    parser.add_argument("--token", default=os.environ.get("FLASH_IO_ADMIN_TOKEN") or os.environ.get("ADMIN_TOKEN"))
    parser.add_argument("--admin", action="append", default=[], help="账号不存在则创建为管理员；存在则只升级角色。")
    parser.add_argument("--promote", action="append", default=[], help="仅升级已有账号为管理员，不重置密码。")
    parser.add_argument("--out", default=str(ROOT / "generated" / "initial-accounts.csv"))
    args = parser.parse_args()

    if not args.api:
        print("Worker API URL is not configured.", file=sys.stderr)
        return 1
    if not args.token:
        print("FLASH_IO_ADMIN_TOKEN is required.", file=sys.stderr)
        return 1

    users = request_json(args.api, "/api/users", args.token)
    rows: list[dict[str, str]] = []
    created = 0
    promoted = 0
    missing = 0

    for name in [normalize_name(item) for item in args.admin if normalize_name(item)]:
        user = find_user(users, name)
        if user:
            promote_user(args.api, args.token, user, name)
            rows.append({
                "username": name,
                "password": "",
                "display_name": user.get("displayName") or user.get("display_name") or name,
                "owner_name": user.get("ownerName") or user.get("owner_name") or name,
                "role": "admin",
                "status": "promoted-existing",
            })
            promoted += 1
        else:
            password = initial_password()
            create_admin(args.api, args.token, name, password)
            rows.append({
                "username": name,
                "password": password,
                "display_name": name,
                "owner_name": name,
                "role": "admin",
                "status": "created",
            })
            created += 1

    users = request_json(args.api, "/api/users", args.token)
    for name in [normalize_name(item) for item in args.promote if normalize_name(item)]:
        user = find_user(users, name)
        if not user:
            rows.append({
                "username": name,
                "password": "",
                "display_name": name,
                "owner_name": name,
                "role": "admin",
                "status": "missing",
            })
            missing += 1
            continue
        promote_user(args.api, args.token, user, name)
        rows.append({
            "username": name,
            "password": "",
            "display_name": user.get("displayName") or user.get("display_name") or name,
            "owner_name": user.get("ownerName") or user.get("owner_name") or name,
            "role": "admin",
            "status": "promoted-existing",
        })
        promoted += 1

    out_path = Path(args.out)
    write_csv(out_path, rows)
    print(json.dumps({
        "created": created,
        "promoted": promoted,
        "missing": missing,
        "rows": len(rows),
        "out": str(out_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
