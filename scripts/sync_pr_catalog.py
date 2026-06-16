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


def risk_from_pr_links(value, catalog_items):
    refs = parse_pr_refs(value)
    if not refs:
        return None
    by_number = {item["number"]: item for item in catalog_items}
    by_url = {str(item["url"]).rstrip("/"): item for item in catalog_items}
    matches = []
    for ref in refs:
        number = pr_number(ref)
        item = by_number.get(number) if number is not None else by_url.get(ref.rstrip("/"))
        matches.append(item)
    if any(item is None for item in matches):
        return "高"
    if any(item["status"] == "open" for item in matches):
        return "中"
    if all(item["status"] == "merged" for item in matches):
        return "低"
    return "高"


def sync_state_risks(catalog):
    state_path = STATE_PATHS[0]
    if not state_path.exists():
        return []
    state = json.loads(state_path.read_text(encoding="utf-8"))
    changed = []
    for task in state.get("tasks", []):
        next_risk = risk_from_pr_links(task.get("pr_link", ""), catalog["items"])
        if not next_risk or task.get("risk") == next_risk:
            continue
        changed.append({
            "id": task.get("id"),
            "title": task.get("title"),
            "from": task.get("risk"),
            "to": next_risk,
        })
        task["risk"] = next_risk
        task["updated_at"] = now_bj()
    if not changed:
        return []

    state["generatedAt"] = now_bj()
    state_text = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    for path in STATE_PATHS:
        path.write_text(state_text, encoding="utf-8")

    entry = {
        "ts": now_bj(),
        "action": "risk.pr_link_sync",
        "entity": "project",
        "id": "risk-pr-link-sync",
        "summary": f"根据已关联 PR 状态同步风险：{len(changed)} 项",
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
    changed = sync_state_risks(catalog)
    print(json.dumps({"sourceRepo": SOURCE_REPO, "items": catalog["total"], "riskChanges": len(changed)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
