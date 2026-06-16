import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import re


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATHS = [ROOT / "data" / "pr-catalog.json", ROOT / "docs" / "pr-catalog.json"]
STATE_PATHS = [ROOT / "data" / "project-state.json", ROOT / "docs" / "project-state.json"]
AUDIT_PATHS = [ROOT / "data" / "audit-log.jsonl", ROOT / "docs" / "audit-log.jsonl"]
SOURCE_REPO = "flashserve/flash-linear-attention-npu"
API_ROOT = "https://api.github.com"
BJ_TZ = timezone(timedelta(hours=8))


def now_bj():
    return datetime.now(BJ_TZ).replace(microsecond=0).isoformat()


def today_bj():
    return datetime.now(BJ_TZ).date()


def github_get(path):
    token = os.environ.get("GITHUB_TOKEN", "")
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "flash-linear-attention-npu-io-pr-catalog",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{API_ROOT}{path}", headers=headers)
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API failed {error.code}: {body}") from error


def fetch_pull_requests():
    pulls = []
    page = 1
    while True:
        batch = github_get(f"/repos/{SOURCE_REPO}/pulls?state=all&per_page=100&page={page}")
        if not batch:
            break
        pulls.extend(batch)
        page += 1
    return pulls


def is_candidate(pr):
    return pr.get("state") == "open" or bool(pr.get("merged_at"))


def catalog_item(pr):
    merged = bool(pr.get("merged_at"))
    return {
        "number": pr.get("number"),
        "title": pr.get("title") or "",
        "url": pr.get("html_url") or "",
        "status": "merged" if merged else "open",
        "statusText": "已合入" if merged else "未合入",
        "mergedAt": pr.get("merged_at"),
        "updatedAt": pr.get("updated_at"),
        "createdAt": pr.get("created_at"),
        "headRef": (pr.get("head") or {}).get("ref") or "",
        "labels": [label.get("name") for label in pr.get("labels", []) if label.get("name")],
    }


def build_catalog():
    pulls = fetch_pull_requests()
    items = [catalog_item(pr) for pr in pulls if is_candidate(pr)]
    items.sort(key=lambda item: (item["status"] != "open", -(item["number"] or 0)))
    return {
        "generatedAt": now_bj(),
        "sourceRepo": SOURCE_REPO,
        "rule": "仅包含已合入 PR 和仍开放 PR；关闭且未合入的 PR 不进入候选池。",
        "total": len(items),
        "items": items,
    }


def parse_pr_refs(value):
    refs = []
    for token in re.split(r"[\s,，;；]+", str(value or "")):
        token = token.strip()
        if not token:
            continue
        if re.match(r"^https?://", token, re.I) or re.match(r"^#?\d+$", token):
            refs.append(token)
    return refs


def pr_number(ref):
    match = re.search(r"/pull/(\d+)", ref)
    if match:
        return int(match.group(1))
    match = re.match(r"^#?(\d+)$", ref)
    if match:
        return int(match.group(1))
    return None


def evaluate_pr_links(value, catalog_items):
    refs = parse_pr_refs(value)
    by_number = {item["number"]: item for item in catalog_items}
    by_url = {str(item["url"]).rstrip("/"): item for item in catalog_items}
    matches = []
    for ref in refs:
        number = pr_number(ref)
        item = by_number.get(number) if number is not None else by_url.get(ref.rstrip("/"))
        matches.append(item)
    missing = not refs or any(item is None for item in matches)
    return {
        "refs": refs,
        "matches": [item for item in matches if item is not None],
        "missing": missing,
        "allMerged": bool(refs) and not missing and all(item["status"] == "merged" for item in matches),
        "hasOpen": bool(refs) and not missing and any(item["status"] == "open" for item in matches),
        "risk": None,
    }


def normalize_owner_name(name):
    value = str(name or "").strip()
    return "待排人力" if not value or value in ("待填写", "待排人力") else value


def owner_names(task):
    raw = normalize_owner_name(task.get("owner"))
    return [normalize_owner_name(item) for item in re.split(r"[、/,，;；&]+", raw) if normalize_owner_name(item)]


def has_waiting_owner(task):
    return "待排人力" in owner_names(task)


def has_report(task):
    return bool(str(task.get("test_report") or "").strip())


def completion_override(task):
    return bool(re.search(r"ops\s*目录整改", str(task.get("title") or ""), re.I))


def task_ddl(task):
    value = task.get("end_date") or task.get("start_date")
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return today_bj()


def evaluate_task_delivery(task, catalog_items):
    pr = evaluate_pr_links(task.get("pr_link", ""), catalog_items)
    ddl = task_ddl(task)
    days_until_ddl = (ddl - today_bj()).days
    report = has_report(task)
    completed = completion_override(task) or (pr["allMerged"] and report)
    delayed = not completed and today_bj() > ddl

    if has_waiting_owner(task):
        risk = "高"
    elif pr["allMerged"]:
        risk = "低"
    elif pr["hasOpen"]:
        risk = "中" if days_until_ddl <= 5 else "低"
    else:
        risk = "高" if days_until_ddl <= 10 else "中"

    status = task.get("status") or "todo"
    if completed:
        status = "done"
    elif delayed:
        status = "delayed"
    elif status in ("done", "delayed"):
        status = "todo"

    return {"risk": risk, "status": status}


def sync_state_delivery(catalog):
    state_path = STATE_PATHS[0]
    if not state_path.exists():
        return []
    state = json.loads(state_path.read_text(encoding="utf-8"))
    changed = []
    for task in state.get("tasks", []):
        next_values = evaluate_task_delivery(task, catalog["items"])
        diff = {}
        if task.get("risk") != next_values["risk"]:
            diff["risk"] = {"from": task.get("risk"), "to": next_values["risk"]}
            task["risk"] = next_values["risk"]
        if task.get("status") != next_values["status"]:
            diff["status"] = {"from": task.get("status"), "to": next_values["status"]}
            task["status"] = next_values["status"]
        if not diff:
            continue
        changed.append({
            "id": task.get("id"),
            "title": task.get("title"),
            "changes": diff,
        })
        task["updated_at"] = now_bj()
    if not changed:
        return []

    state["generatedAt"] = now_bj()
    state_text = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    for path in STATE_PATHS:
        path.write_text(state_text, encoding="utf-8")

    entry = {
        "ts": now_bj(),
        "action": "delivery.rule_sync",
        "entity": "project",
        "id": "delivery-rule-sync",
        "summary": f"根据 PR / 报告 / DDL 规则同步风险状态：{len(changed)} 项",
        "detail": {"changed": changed},
        "source": "github-actions",
    }
    for path in AUDIT_PATHS:
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        suffix = "" if not text or text.endswith("\n") else "\n"
        path.write_text(text + suffix + json.dumps(entry, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed


def main():
    catalog = build_catalog()
    text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    for path in CATALOG_PATHS:
        path.write_text(text, encoding="utf-8")
    changed = sync_state_delivery(catalog)
    print(json.dumps({"sourceRepo": SOURCE_REPO, "items": catalog["total"], "deliveryChanges": len(changed)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
