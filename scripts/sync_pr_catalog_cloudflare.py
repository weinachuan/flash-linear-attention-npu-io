#!/usr/bin/env python3
"""Sync the PR catalog snapshot into the Cloudflare D1 Worker backend."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8-sig"))


def default_worker_api() -> str:
    config_path = ROOT / "docs" / "config.js"
    if not config_path.exists():
        return ""
    match = re.search(
        r"FLASH_IO_API_BASE\s*=\s*[\"']([^\"']+)[\"']",
        config_path.read_text(encoding="utf-8-sig"),
    )
    return match.group(1).rstrip("/") if match else ""


def post_json(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url.rstrip("/") + "/api/pr-catalog/sync",
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
        raise RuntimeError(f"同步到 Cloudflare D1 失败：HTTP {exc.code} {body}") from exc


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="把 PR 候选池同步到 Cloudflare D1。")
    parser.add_argument("--api", default=os.environ.get("FLASH_IO_API_BASE") or default_worker_api())
    parser.add_argument("--token", default=os.environ.get("FLASH_IO_ADMIN_TOKEN") or os.environ.get("ADMIN_TOKEN"))
    parser.add_argument("--pr-catalog", default=str(ROOT / "data" / "pr-catalog.json"))
    args = parser.parse_args()

    if not args.api:
        print("未配置 Worker API 地址。", file=sys.stderr)
        return 1
    if not args.token:
        print("未配置 FLASH_IO_ADMIN_TOKEN，无法写入 Cloudflare D1。", file=sys.stderr)
        return 1

    catalog = read_json(Path(args.pr_catalog), {"items": []})
    if not catalog or not isinstance(catalog.get("items"), list):
        print("未找到有效 PR 候选池。", file=sys.stderr)
        return 1

    result = post_json(args.api, args.token, {"catalog": catalog})
    print(json.dumps({
        "ok": result.get("ok", False),
        "catalogTotal": result.get("catalogTotal", 0),
        "catalogChanged": result.get("catalogChanged", False),
        "changedCount": result.get("changedCount", 0),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
