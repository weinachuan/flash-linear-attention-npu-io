import json
import os
import re
import sys
import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
STATE_PATHS = [ROOT / "data" / "project-state.json", ROOT / "docs" / "project-state.json"]
AUDIT_PATHS = [ROOT / "data" / "audit-log.jsonl", ROOT / "docs" / "audit-log.jsonl"]
SOURCE_REPO = "flashserve/flash-linear-attention-npu"
API_ROOT = "https://api.github.com"
BJ_TZ = timezone(timedelta(hours=8))

OPERATOR_RULES = [
    ("chunk_gated_delta_rule_fwd_h", ["chunk_gated_delta_rule_fwd_h", "fwd_h"]),
    ("chunk_fwd_o", ["chunk_fwd_o", "fwd_o"]),
    ("recompute_wu_fwd", ["recompute_wu_fwd", "recompute_w_u", "recompute_wu", "recompute"]),
    ("chunk_bwd_dv_local", ["chunk_bwd_dv_local", "chunk_dv_local", "dv_local"]),
    ("chunk_bwd_dqkwg", ["chunk_bwd_dqkwg", "dqkwg"]),
    ("chunk_gated_delta_rule_bwd_dhu", ["chunk_gated_delta_rule_bwd_dhu", "dhu"]),
    ("prepare_wy_repr_bwd_da", ["prepare_wy_repr_bwd_da", "prepare_wy_bwd_da"]),
    ("prepare_wy_repr_bwd_full", ["prepare_wy_repr_bwd_full", "prepare_wy_bwd_full"]),
    ("causal_conv1d_fwd", ["causal_conv1d_fwd", "causal_conv1d tnd", "tnd 转 ntd", "tnd", "ntd"]),
    ("causal_conv1d_bwd", ["causal_conv1d_bwd", "causal_conv1d bwd"]),
    ("solve_tril_npu", ["solve_tril_npu", "solve_tril", "solve_tri"]),
    ("kimi_delta_attention_triton", ["kimi_delta_attention", "kda triton", "kda"]),
]

FEATURE_PATTERNS = [
    ("gva", ["gva"]),
    ("vdim256", ["vdim", "v dim", "v=256", "256"]),
    ("deep_fusion", ["深融合", "fusion", "fuse", "性能", "优化"]),
    ("regbase", ["regbase", "rebase"]),
    ("launch", ["<<<>>>", "launch", "调用"]),
    ("docs", ["文档", "doc", "docs", "readme"]),
    ("gk", ["gk"]),
    ("causal", ["causal", "conv1d"]),
    ("layout", ["tnd", "ntd", "transpose", "layout"]),
    ("solve", ["solve", "tri", "tril"]),
    ("ops", ["ops"]),
    ("package", ["一键编包", "package", "build"]),
    ("perf", ["性能", "performance", "perf"]),
]


def now_bj():
    return datetime.now(BJ_TZ).replace(microsecond=0).isoformat()


def normalize(text):
    return re.sub(r"\s+", " ", str(text or "").lower()).strip()


def github_get(path):
    token = os.environ.get("GITHUB_TOKEN", "")
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "flash-linear-attention-npu-io-pr-sync",
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


def pull_request_index(pull_requests):
    by_key = {}
    for pr in pull_requests:
        url = pr.get("html_url") or ""
        number = str(pr.get("number") or "")
        if url:
            by_key[url.rstrip("/")] = pr
        if number:
            by_key[number] = pr
    return by_key


def explicit_task_prs(task, pr_index):
    links = str(task.get("pr_link") or "")
    if not links:
        return []
    matches = []
    for token in re.split(r"[\s,，;；]+", links):
        token = token.strip().rstrip("/")
        if not token:
            continue
        if token in pr_index:
            if pr_is_acceptable_for_task(task, pr_index[token]):
                matches.append(pr_index[token])
            continue
        number_match = re.search(r"/pull/(\d+)$", token)
        if number_match and number_match.group(1) in pr_index and pr_is_acceptable_for_task(task, pr_index[number_match.group(1)]):
            matches.append(pr_index[number_match.group(1)])
    return list({pr.get("html_url"): pr for pr in matches if pr.get("html_url")}.values())


def pr_is_trackable(pr):
    return pr.get("state") != "closed" or bool(pr.get("merged_at"))


def pr_is_acceptable_for_task(task, pr):
    return pr_is_trackable(pr) and score_pr(task, pr) >= 8


def task_operator_ids(title):
    title_l = normalize(title)
    if title_l.startswith("多算子"):
        return [
            "chunk_fwd_o",
            "chunk_gated_delta_rule_fwd_h",
            "chunk_gated_delta_rule_bwd_dhu",
            "recompute_wu_fwd",
            "chunk_bwd_dv_local",
            "chunk_bwd_dqkwg",
        ]
    matched = []
    for op_id, aliases in OPERATOR_RULES:
        if any(normalize(alias) in title_l for alias in aliases):
            matched.append(op_id)
    return list(dict.fromkeys(matched))


def task_feature_keys(title):
    title_l = normalize(title)
    return [key for key, patterns in FEATURE_PATTERNS if any(normalize(pattern) in title_l for pattern in patterns)]


def pr_signal_text(pr):
    return normalize(" ".join([pr.get("title") or "", pr.get("head", {}).get("ref") or ""]))


def operator_matches(op_id, text):
    aliases = dict(OPERATOR_RULES).get(op_id, [])
    return any(normalize(alias) in text for alias in aliases)


def feature_matches(feature_key, text):
    patterns = dict(FEATURE_PATTERNS).get(feature_key, [])
    return any(normalize(pattern) in text for pattern in patterns)


def score_pr(task, pr):
    title = task.get("title", "")
    signal = pr_signal_text(pr)
    op_ids = task_operator_ids(title)
    features = task_feature_keys(title)
    score = 0

    normalized_title = normalize(title)
    if normalized_title and normalized_title in signal:
        score += 12

    op_hit = False
    for op_id in op_ids:
        if operator_matches(op_id, signal):
            score += 6
            op_hit = True

    feature_hit_count = 0
    for feature in features:
        if feature_matches(feature, signal):
            score += 3
            feature_hit_count += 1

    if op_ids and not op_hit:
        return 0
    if op_ids and features and not feature_hit_count:
        return 0

    tokens = [token for token in re.split(r"[^a-z0-9_]+", normalize(title)) if len(token) >= 3]
    score += min(4, sum(1 for token in set(tokens) if token in signal))
    return score


def matched_prs(task, pull_requests, pr_index):
    explicit = explicit_task_prs(task, pr_index)
    scored = []
    for pr in pull_requests:
        if not pr_is_trackable(pr):
            continue
        score = score_pr(task, pr)
        if score >= 8:
            scored.append((score, pr))
    scored.sort(key=lambda item: (item[0], item[1].get("merged_at") or "", item[1].get("updated_at") or ""), reverse=True)
    heuristic = [pr for _, pr in scored[:3]]
    return list({pr.get("html_url"): pr for pr in explicit + heuristic if pr.get("html_url")}.values())


def risk_for_matches(task, matches):
    if task.get("status") == "done":
        return "低"
    if not matches:
        return "高"
    if any(pr.get("merged_at") for pr in matches):
        return "低"
    return "中"


def collect_changes(data, pull_requests):
    pr_index = pull_request_index(pull_requests)
    changed = []
    for task in data.get("tasks", []):
        matches = matched_prs(task, pull_requests, pr_index)
        matched_links = " ".join(dict.fromkeys(pr.get("html_url", "") for pr in matches if pr.get("html_url")))
        next_links = matched_links or task.get("pr_link", "")
        next_risk = risk_for_matches(task, matches)
        old_links = task.get("pr_link", "")
        old_risk = task.get("risk", "")
        if old_links != next_links or old_risk != next_risk:
            changed.append({
                "id": task.get("id"),
                "title": task.get("title"),
                "old_pr_link": old_links,
                "pr_link": next_links,
                "old_risk": old_risk,
                "risk": next_risk,
                "prs": [
                    {
                        "number": pr.get("number"),
                        "title": pr.get("title"),
                        "state": pr.get("state"),
                        "merged_at": pr.get("merged_at"),
                        "url": pr.get("html_url"),
                    }
                    for pr in matches
                ],
            })
    return changed


def update_state(path, pull_requests, timestamp):
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = collect_changes(data, pull_requests)
    changed_by_id = {item["id"]: item for item in changed}
    for task in data.get("tasks", []):
        change = changed_by_id.get(task.get("id"))
        if not change:
            continue
        task["pr_link"] = change["pr_link"]
        task["risk"] = change["risk"]
        task["updated_at"] = timestamp
    if changed:
        data["generatedAt"] = timestamp
        data.setdefault("repoScan", {})["scanDate"] = timestamp[:10]
        data.setdefault("repoScan", {})["rule"] = "已合入 PR 标低风险；未合入但匹配到 PR 标中风险；未匹配到 PR 标高风险。"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed


def append_audit(path, timestamp, changed):
    if not changed:
        return
    entry = {
        "ts": timestamp,
        "action": "pr_scan.update",
        "entity": "project",
        "id": "flashserve-pr-scan",
        "summary": f"自动扫描上游 PR 并更新 {len(changed)} 项 PR 链接/风险",
        "detail": {"changed_ids": [item["id"] for item in changed]},
        "source": "github-actions",
    }
    with path.open("a", encoding="utf-8", newline="") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def print_markdown(changed):
    print("| 任务ID | 事项 | 风险变化 | PR链接变化 | 候选PR |")
    print("| --- | --- | --- | --- | --- |")
    if not changed:
        print("| - | 暂无建议变更 | - | - | - |")
        return
    for item in changed:
        risk = f"{item.get('old_risk') or '-'} -> {item.get('risk') or '-'}"
        link = f"{short_links(item.get('old_pr_link'))} -> {short_links(item.get('pr_link'))}"
        prs = "<br>".join(format_pr(pr) for pr in item.get("prs", [])) or "-"
        print(f"| {item.get('id') or ''} | {safe_cell(item.get('title') or '')} | {safe_cell(risk)} | {safe_cell(link)} | {safe_cell(prs)} |")


def short_links(value):
    links = str(value or "").split()
    if not links:
        return "-"
    return " ".join(short_link(link) for link in links)


def short_link(link):
    match = re.search(r"/pull/(\d+)", str(link))
    return f"#{match.group(1)}" if match else str(link)


def format_pr(pr):
    state = "已合入" if pr.get("merged_at") else "开放" if pr.get("state") == "open" else "已关闭"
    return f"#{pr.get('number')} {state} {pr.get('title') or ''}"


def safe_cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write confirmed PR links and risks to project data")
    parser.add_argument("--format", choices=["json", "markdown"], default="json", help="output format when not applying")
    args = parser.parse_args()
    timestamp = now_bj()
    pull_requests = fetch_pull_requests()
    if not args.apply:
        data = json.loads(STATE_PATHS[0].read_text(encoding="utf-8"))
        changed = collect_changes(data, pull_requests)
        if args.format == "markdown":
            print_markdown(changed)
        else:
            print(json.dumps({"pull_requests": len(pull_requests), "candidates": len(changed), "changes": changed}, ensure_ascii=False, indent=2))
        return
    first_changed = None
    for path in STATE_PATHS:
        changed = update_state(path, pull_requests, timestamp)
        if first_changed is None:
            first_changed = changed
    if first_changed:
        for audit_path in AUDIT_PATHS:
            append_audit(audit_path, timestamp, first_changed)
    print(json.dumps({"pull_requests": len(pull_requests), "changed": len(first_changed or [])}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
