import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATHS = [ROOT / "data" / "pr-catalog.json", ROOT / "docs" / "pr-catalog.json"]
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


def main():
    catalog = build_catalog()
    text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    for path in CATALOG_PATHS:
        path.write_text(text, encoding="utf-8")
    print(json.dumps({"sourceRepo": SOURCE_REPO, "items": catalog["total"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
