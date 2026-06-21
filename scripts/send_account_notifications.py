#!/usr/bin/env python3
"""Send local account notification files by email without committing addresses."""

from __future__ import annotations

import argparse
import csv
import io
import os
import smtplib
import ssl
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAPPING = ROOT / ".local-secrets" / "people-emails.csv"
DEFAULT_NOTICES = ROOT / "generated" / "admin-notifications"
DEFAULT_ENV = ROOT / ".local-secrets" / "smtp.env"
DEFAULT_LOG = ROOT / ".local-secrets" / "email-send-log.csv"


@dataclass(frozen=True)
class SendItem:
    name: str
    recipient: str
    notice_path: Path


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def open_text_with_fallback(path: Path) -> io.StringIO:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return io.StringIO(path.read_text(encoding=encoding))
        except UnicodeDecodeError:
            continue
    return io.StringIO(path.read_text(encoding="utf-8-sig"))


def pick(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None:
            return str(value).strip()
    return ""


def read_mapping(path: Path) -> dict[str, str]:
    if not path.exists():
        raise FileNotFoundError(f"email mapping file not found: {path}")
    mapping: dict[str, str] = {}
    with open_text_with_fallback(path) as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("email mapping CSV has no header")
        for row in reader:
            name = pick(row, "name", "姓名")
            email = pick(row, "email", "邮箱")
            enabled = pick(row, "enabled", "启用") or "1"
            if not name or not email:
                continue
            if enabled.lower() in {"0", "false", "no", "n", "off", "否"}:
                continue
            mapping[name] = email
    return mapping


def collect_notices(notice_dir: Path) -> dict[str, Path]:
    if not notice_dir.exists():
        raise FileNotFoundError(f"notice directory not found: {notice_dir}")
    return {path.stem: path for path in sorted(notice_dir.glob("*.txt"))}


def parse_name_filter(values: list[str] | None) -> set[str]:
    names: set[str] = set()
    for value in values or []:
        for part in value.replace("\n", ",").split(","):
            name = part.strip()
            if name:
                names.add(name)
    return names


def smtp_config() -> dict[str, object]:
    host = os.environ.get("SMTP_HOST", "").strip()
    username = os.environ.get("SMTP_USERNAME", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("SMTP_FROM", username).strip()
    if not host:
        raise ValueError("missing SMTP_HOST")
    if not sender:
        raise ValueError("missing SMTP_FROM or SMTP_USERNAME")
    return {
        "host": host,
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "username": username,
        "password": password,
        "sender": sender,
        "use_tls": truthy(os.environ.get("SMTP_TLS"), True),
        "use_ssl": truthy(os.environ.get("SMTP_SSL"), False),
    }


def make_message(sender: str, recipient: str, subject: str, body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.set_content(body)
    return msg


def login_if_needed(smtp: smtplib.SMTP, config: dict[str, object]) -> None:
    username = str(config["username"])
    password = str(config["password"])
    if username or password:
        smtp.login(username, password)


def append_log(log_path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    exists = log_path.exists()
    with log_path.open("a", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["time", "name", "status", "detail"])
        if not exists:
            writer.writeheader()
        writer.writerows(rows)


def send_items(
    items: list[SendItem],
    config: dict[str, object],
    subject: str,
    log_path: Path,
    sleep_seconds: float,
) -> int:
    host = str(config["host"])
    port = int(config["port"])
    sender = str(config["sender"])
    context = ssl.create_default_context()
    sent = 0
    failed = 0
    logs: list[dict[str, str]] = []
    timestamp = lambda: datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    def send_with(smtp: smtplib.SMTP) -> None:
        nonlocal sent, failed
        for item in items:
            body = item.notice_path.read_text(encoding="utf-8-sig")
            message = make_message(sender, item.recipient, subject, body)
            try:
                smtp.send_message(message)
                sent += 1
                logs.append({"time": timestamp(), "name": item.name, "status": "sent", "detail": ""})
                print(f"sent: {item.name}")
            except Exception as exc:  # noqa: BLE001 - keep sending the remaining notices when possible.
                failed += 1
                logs.append({
                    "time": timestamp(),
                    "name": item.name,
                    "status": "failed",
                    "detail": exc.__class__.__name__,
                })
                print(f"failed: {item.name} ({exc.__class__.__name__})")
            append_log(log_path, logs)
            logs.clear()
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

    if config["use_ssl"]:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=60) as smtp:
            login_if_needed(smtp, config)
            send_with(smtp)
    else:
        with smtplib.SMTP(host, port, timeout=60) as smtp:
            if config["use_tls"]:
                smtp.starttls(context=context)
            login_if_needed(smtp, config)
            send_with(smtp)

    print(f"sent total: {sent}")
    if failed:
        print(f"failed total: {failed}")
    return 1 if failed else 0


def build_items(mapping: dict[str, str], notices: dict[str, Path], only: set[str], exclude: set[str]) -> list[SendItem]:
    items: list[SendItem] = []
    for name, notice_path in notices.items():
        if only and name not in only:
            continue
        if name in exclude:
            continue
        recipient = mapping.get(name)
        if recipient:
            items.append(SendItem(name=name, recipient=recipient, notice_path=notice_path))
    return items


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="Send account notification emails. Dry-run by default; add --send to actually send."
    )
    parser.add_argument("--mapping", default=str(DEFAULT_MAPPING), help="Local CSV mapping with name,email columns.")
    parser.add_argument("--notices", default=str(DEFAULT_NOTICES), help="Directory containing notice files named NAME.txt.")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV), help="Local SMTP env file.")
    parser.add_argument("--subject", default="flash-linear-attention-npu 项目看板账号通知")
    parser.add_argument("--send", action="store_true", help="Actually send emails.")
    parser.add_argument("--only", action="append", help="Only send these names. Supports comma-separated names.")
    parser.add_argument("--exclude", action="append", help="Exclude these names. Supports comma-separated names.")
    parser.add_argument("--log", default=str(DEFAULT_LOG), help="Local send log CSV path.")
    parser.add_argument("--sleep-seconds", type=float, default=1.0, help="Delay between messages.")
    args = parser.parse_args()

    load_env_file(Path(args.env_file))
    mapping = read_mapping(Path(args.mapping))
    notices = collect_notices(Path(args.notices))
    only = parse_name_filter(args.only)
    exclude = parse_name_filter(args.exclude)
    items = build_items(mapping, notices, only, exclude)

    missing_email = sorted((only or set(notices)) - set(mapping))
    missing_notice = sorted((only or set(mapping)) - set(notices))

    print(f"notice files: {len(notices)}")
    print(f"sendable: {len(items)}")
    if only:
        print("only: " + ", ".join(sorted(only)))
    if exclude:
        print("exclude: " + ", ".join(sorted(exclude)))
    if missing_email:
        print("missing email: " + ", ".join(missing_email))
    if missing_notice:
        print("missing notice: " + ", ".join(missing_notice))
    if not args.send:
        print("dry-run done; add --send to actually send.")
        return 0

    config = smtp_config()
    return send_items(items, config, args.subject, Path(args.log), args.sleep_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
