#!/usr/bin/env python3
"""Create or update a Cloudflare Worker application user."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def post_json(url: str, token: str, payload: dict) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url.rstrip("/") + "/api/users",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"创建用户失败：HTTP {exc.code} {body}") from exc


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="创建或更新 Cloudflare Worker 登录用户。")
    parser.add_argument("--api", required=True, help="Worker URL，例如 https://xxx.workers.dev")
    parser.add_argument("--admin-token", required=True, help="Wrangler secret ADMIN_TOKEN 的值")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--role", choices=["admin", "developer"], default="developer")
    parser.add_argument("--display-name", default="")
    parser.add_argument("--owner-name", default="", help="对应任务责任人姓名；开发账号只能改该责任人名下任务。")
    args = parser.parse_args()

    result = post_json(args.api, args.admin_token, {
        "username": args.username,
        "password": args.password,
        "role": args.role,
        "displayName": args.display_name or args.username,
        "ownerName": args.owner_name or args.display_name or args.username,
    })
    user = result.get("user", {})
    print(f"创建/更新完成：{user.get('username')} / {user.get('role')} / {user.get('ownerName')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
