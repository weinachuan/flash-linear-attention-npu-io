#!/usr/bin/env python3
"""Send local account notification files by email without committing addresses."""

from __future__ import annotations

import argparse
import csv
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAPPING = ROOT / ".local-secrets" / "people-emails.csv"
DEFAULT_NOTICES = ROOT / "generated" / "admin-notifications"
DEFAULT_ENV = ROOT / ".local-secrets" / "smtp.env"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def read_mapping(path: Path) -> dict[str, str]:
    if not path.exists():
        raise FileNotFoundError(f"邮箱映射文件不存在：{path}")
    mapping: dict[str, str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"name", "email"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise ValueError("邮箱映射 CSV 必须包含 name,email 列")
        for row in reader:
            name = str(row.get("name") or "").strip()
            email = str(row.get("email") or "").strip()
            enabled = str(row.get("enabled") or "1").strip()
            if not name or not email or enabled in {"0", "false", "False", "否", "no"}:
                continue
            mapping[name] = email
    return mapping


def collect_notices(notice_dir: Path) -> dict[str, Path]:
    if not notice_dir.exists():
        raise FileNotFoundError(f"通知目录不存在：{notice_dir}")
    return {path.stem: path for path in sorted(notice_dir.glob("*.txt"))}


def smtp_config() -> dict[str, object]:
    host = os.environ.get("SMTP_HOST", "").strip()
    username = os.environ.get("SMTP_USERNAME", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("SMTP_FROM", username).strip()
    if not host:
      raise ValueError("缺少 SMTP_HOST")
    if not sender:
      raise ValueError("缺少 SMTP_FROM 或 SMTP_USERNAME")
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


def send_messages(messages: list[EmailMessage], config: dict[str, object]) -> None:
    host = str(config["host"])
    port = int(config["port"])
    context = ssl.create_default_context()
    if config["use_ssl"]:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=60) as smtp:
            login_if_needed(smtp, config)
            for msg in messages:
                smtp.send_message(msg)
        return
    with smtplib.SMTP(host, port, timeout=60) as smtp:
        if config["use_tls"]:
            smtp.starttls(context=context)
        login_if_needed(smtp, config)
        for msg in messages:
            smtp.send_message(msg)


def login_if_needed(smtp: smtplib.SMTP, config: dict[str, object]) -> None:
    username = str(config["username"])
    password = str(config["password"])
    if username or password:
        smtp.login(username, password)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="按本地姓名-邮箱映射发送账号通知。默认 dry-run，不会发邮件。")
    parser.add_argument("--mapping", default=str(DEFAULT_MAPPING), help="本地姓名邮箱映射 CSV，必须包含 name,email 列。")
    parser.add_argument("--notices", default=str(DEFAULT_NOTICES), help="每人通知文本目录，文件名格式为 姓名.txt。")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV), help="本地 SMTP 配置文件。")
    parser.add_argument("--subject", default="flash-linear-attention-npu 项目看板账号通知")
    parser.add_argument("--send", action="store_true", help="实际发送邮件；不加该参数只检查收件人和通知文件。")
    args = parser.parse_args()

    load_env_file(Path(args.env_file))
    mapping = read_mapping(Path(args.mapping))
    notices = collect_notices(Path(args.notices))
    missing_email = sorted(set(notices) - set(mapping))
    missing_notice = sorted(set(mapping) - set(notices))

    messages = []
    for name, notice_path in notices.items():
        recipient = mapping.get(name)
        if not recipient:
            continue
        body = notice_path.read_text(encoding="utf-8-sig")
        sender = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USERNAME") or "unset@example.invalid"
        messages.append(make_message(sender, recipient, args.subject, body))

    print(f"通知文件：{len(notices)} 份")
    print(f"可发送：{len(messages)} 份")
    if missing_email:
        print("缺少邮箱：" + "、".join(missing_email))
    if missing_notice:
        print("缺少通知文本：" + "、".join(missing_notice))
    if not args.send:
        print("dry-run 完成；如确认无误，追加 --send 才会实际发送。")
        return 0

    config = smtp_config()
    messages = [
        make_message(str(config["sender"]), msg["To"], args.subject, msg.get_content())
        for msg in messages
    ]
    send_messages(messages, config)
    print(f"已发送：{len(messages)} 份")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
