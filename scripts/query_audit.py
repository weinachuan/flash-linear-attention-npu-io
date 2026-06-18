#!/usr/bin/env python3
"""Search project audit logs and print task-level field diffs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


FIELD_LABELS = {
    "title": "事项",
    "owner": "责任人",
    "risk": "风险",
    "priority": "优先级",
    "status": "状态",
    "group_id": "分组",
    "special_id": "专项",
    "start_date": "开始日期",
    "end_date": "结束日期",
    "pr_link": "PR 链接",
    "test_report": "转测报告",
    "notes": "备注",
    "segments": "甘特分段",
}


def load_audit(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


def matches(entry: dict[str, Any], keyword: str) -> bool:
    if not keyword:
        return True
    text = json.dumps(entry, ensure_ascii=False).lower()
    return keyword.lower() in text


def format_value(field: str, value: Any) -> str:
    if value is None or value == "":
        return "空"
    if field == "segments":
        return format_segments(str(value))
    return str(value)


def format_segments(value: str) -> str:
    try:
        segments = json.loads(value)
    except json.JSONDecodeError:
        return value or "空"
    if not segments:
        return "空"
    parts = []
    for segment in segments:
        start = segment.get("start_date") or "?"
        end = segment.get("end_date") or "?"
        reason = segment.get("reason") or ""
        parts.append(f"{start} ~ {end}（{reason}）" if reason else f"{start} ~ {end}")
    return "；".join(parts)


def print_entry(entry: dict[str, Any]) -> None:
    print(f"{entry.get('ts', '未知时间')}  {entry.get('summary') or entry.get('action')}")
    detail = entry.get("detail") or {}
    changes = detail.get("changes") or []
    if changes:
        for change in changes:
            print(f"  - {change.get('title') or change.get('id')} ({change.get('id')})")
            for field, diff in (change.get("changes") or {}).items():
                label = FIELD_LABELS.get(field, field)
                before = format_value(field, diff.get("from"))
                after = format_value(field, diff.get("to"))
                print(f"    {label}: {before} -> {after}")
    elif detail.get("ids"):
        print(f"  记录到的任务 ID: {', '.join(map(str, detail['ids']))}")
    print()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="检索项目审计日志，输出批量更新的字段级明细。")
    parser.add_argument("keyword", nargs="?", default="", help="按任务名、任务 ID、责任人、PR 链接等关键词检索。")
    parser.add_argument("--path", default="data/audit-log.jsonl", help="审计日志文件，默认 data/audit-log.jsonl。")
    parser.add_argument("--limit", type=int, default=20, help="最多展示多少条，默认 20。")
    parser.add_argument("--json", action="store_true", help="输出匹配到的原始 JSON。")
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        print("未找到审计日志文件。", file=sys.stderr)
        return 1

    entries = [entry for entry in reversed(load_audit(path)) if matches(entry, args.keyword)]
    entries = entries[: max(args.limit, 0)]
    if args.json:
        print(json.dumps(entries, ensure_ascii=False, indent=2))
        return 0
    if not entries:
        print("没有匹配到日志。")
        return 0
    for entry in entries:
        print_entry(entry)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
