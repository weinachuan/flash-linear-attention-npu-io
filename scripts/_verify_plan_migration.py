from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
import subprocess
import tempfile
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLAN_MIGRATION = "0010_close_legacy_and_add_2026_09_plan.sql"
CORRECTION_MIGRATION = "0011_separate_gdn2_status.sql"
PLAN_TS = "2026-09-10T08:30:00.000Z"
CORRECTION_TS = "2026-09-10T11:56:00.000Z"
SNAPSHOT_PATHS = [ROOT / "data" / "project-state.json", ROOT / "docs" / "project-state.json"]
NEW_GROUP_IDS = [
    "group-2026-09-15", "group-2026-09-22", "group-2026-10-30",
    "group-2026-11-15", "group-2026-11-30", "group-unscheduled",
]
NEW_PERSON_IDS = ["person-chen-haowen", "person-li-zhuo", "person-liu-jie"]
NEW_OPERATOR_IDS = [
    "pre_process_fwd_kernel_merged", "merge_fwd_bwd_kernel", "pre_process_bwd_kernel_merged",
    "chunk_fwd_h", "chunk_gdn2_fwd", "chunk_gdn2_bwd", "fused_recurrent_gdn2",
]
LEGACY_GDN_ALIASES = {
    "chunk_gdr_fwd": '["chunk_gdr_fwd","gdr_fwd","gdn_fwd"]',
    "chunk_gdr_bwd": '["chunk_gdr_bwd","gdr_bwd","gdn_bwd"]',
}
PLANNED_GDN_ALIASES = {
    "chunk_gdr_fwd": ["chunk_gdr_fwd", "gdr_fwd", "gdn_fwd", "chunk_gated_delta_rule_fwd"],
    "chunk_gdr_bwd": ["chunk_gdr_bwd", "gdr_bwd", "gdn_bwd", "chunk_gated_delta_rule_bwd"],
}
PRE_CORRECTION_GDN_TASKS = {
    "task-1a90ffa7-3": ("GDN正向大融合算子", "unclassified", ""),
    "task-37e61f4f-4": ("GDN2正向大融合算子", "unclassified", ""),
    "task-1c185a99-5": ("GDN2反向大融合算子", "unclassified", ""),
}

EXPECTED_NEW_TASKS = {
    "plan-20260915-gdn-fwd-a23": ("GDN正向大融合算子 A2/A3", "陈昊文", "2026-09-15", "operator", "chunk_gdr_fwd"),
    "plan-20260915-gdn-fwd-a5": ("GDN正向大融合算子 A5", "李卓", "2026-09-15", "operator", "chunk_gdr_fwd"),
    "plan-20260915-gdn-bwd-a5": ("GDN反向大融合算子 A5", "张硕累", "2026-09-15", "operator", "chunk_gdr_bwd"),
    "plan-20260922-kda-fwd-a5": ("KDA正向大融合算子 A5", "魏纳川", "2026-09-22", "operator", "chunk_kda_fwd"),
    "plan-20260922-kda-bwd-a5": ("KDA反向大融合算子 A5", "吴雨舒", "2026-09-22", "operator", "chunk_kda_bwd"),
    "plan-unscheduled-atk-cases": ("ATK用例整改", "黄浚哲", "", "engineering", ""),
    "plan-unscheduled-ci": ("CI整改", "黄浚哲", "", "engineering", ""),
    "plan-unscheduled-readme": ("readme引导整改", "方梓阳", "", "engineering", ""),
    "plan-unscheduled-ctypes": ("ctypes性能优化", "方梓阳", "", "engineering", ""),
    "plan-unscheduled-release": ("release出包", "方梓阳", "", "engineering", ""),
    "plan-20260930-cp-sharding": (
        "CP切分",
        "魏纳川/张硕累",
        "2026-09-30",
        "operator",
        "pre_process_fwd_kernel_merged/merge_fwd_bwd_kernel/pre_process_bwd_kernel_merged",
    ),
    "plan-20261030-gdn-fwd-perf-a23": ("GDN正向大融合算子性能优化 A2/A3", "刘杰", "2026-10-30", "operator", "chunk_gdr_fwd"),
    "plan-20261115-gdn-bwd-perf-a23": ("GDN反向大融合算子性能优化 A2/A3", "刘杰", "2026-11-15", "operator", "chunk_gdr_bwd"),
    "plan-20260930-solve-tril-a23": ("A2/A3 solve_tril性能优化", "陈昊文", "2026-09-30", "operator", "solve_tril"),
    "plan-20261030-chunk-fwd-h-cp-a23": ("A2/A3 chunk_fwd_h 核内CP切分方案", "待排人力", "2026-10-30", "operator", "chunk_fwd_h"),
    "plan-20261130-chunk-fwd-h-cp-a5": ("A5 chunk_fwd_h 核内CP切分方案", "待排人力", "2026-11-30", "operator", "chunk_fwd_h"),
    "plan-unscheduled-gdn2-all": (
        "GDN-2正反向 + recurrent A2/A3/A5",
        "待排人力",
        "",
        "operator",
        "chunk_gdn2_fwd/chunk_gdn2_bwd/fused_recurrent_gdn2",
    ),
}


def load_seed_module():
    path = ROOT / "scripts" / "generate_d1_seed_sql.py"
    spec = importlib.util.spec_from_file_location("generate_d1_seed_sql", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def load_sync_module():
    path = ROOT / "scripts" / "sync_pr_catalog.py"
    spec = importlib.util.spec_from_file_location("sync_pr_catalog", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def apply_migrations(connection: sqlite3.Connection, *, include_plan: bool) -> None:
    for migration in sorted((ROOT / "migrations").glob("*.sql")):
        if not include_plan and migration.name >= "0010_":
            continue
        connection.executescript(migration.read_text(encoding="utf-8-sig"))


def verify_task_type_backfill() -> None:
    with tempfile.TemporaryDirectory(prefix="flash-io-task-type-") as temp_dir:
        connection = sqlite3.connect(Path(temp_dir) / "task-type.sqlite")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            if migration.name >= "0009_":
                continue
            connection.executescript(migration.read_text(encoding="utf-8-sig"))
        connection.execute(
            """INSERT INTO groups(id, title, due_date, start_date, end_date, position)
               VALUES ('fixture-group', 'fixture', '2026-09-10', '2026-09-10', '2026-09-10', 0)"""
        )
        for task_id, title, operator_ids in [
            ("fixture-operator", "算子任务", "solve_tril"),
            ("t12", "ops 目录整改", ""),
            ("fixture-unclassified", "普通任务", ""),
        ]:
            connection.execute(
                """INSERT INTO tasks(id, title, group_id, start_date, end_date, operator_ids, created_at, updated_at)
                   VALUES (?, ?, 'fixture-group', '2026-09-10', '2026-09-10', ?, ?, ?)""",
                (task_id, title, operator_ids, PLAN_TS, PLAN_TS),
            )
        connection.executescript((ROOT / "migrations" / "0009_add_task_type.sql").read_text(encoding="utf-8-sig"))
        actual = dict(connection.execute("SELECT id, task_type FROM tasks").fetchall())
        assert actual == {
            "fixture-operator": "operator",
            "t12": "engineering",
            "fixture-unclassified": "unclassified",
        }
        connection.close()


def extract_js_function(path: Path, name: str) -> str:
    source = path.read_text(encoding="utf-8")
    start = source.index(f"function {name}(")
    opening = source.index("{", start)
    depth = 0
    for index in range(opening, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise AssertionError(f"Unclosed JavaScript function: {name} in {path}")


def verify_js_done_date_rules() -> None:
    worker_path = ROOT / "cloudflare" / "worker.js"
    frontend_path = ROOT / "docs" / "app.js"
    worker_helper = extract_js_function(worker_path, "taskNextDoneDate")
    frontend_helper = extract_js_function(frontend_path, "taskNextDoneDate")
    assert worker_helper == frontend_helper
    frontend_sync = extract_js_function(frontend_path, "syncTaskDeliveryRules")
    assert "const nextDoneDate = taskNextDoneDate(task, next.status);" in frontend_sync
    assert worker_path.read_text(encoding="utf-8").count(
        "taskNextDoneDate(task, next.status)"
    ) == 2

    script = """
const isYmd = (value) => /^\\d{4}-\\d{2}-\\d{2}$/.test(String(value || ""));
const todayBjYmd = () => "2026-12-01";
""" + worker_helper + "\n" + """
const cases = [
  [{ status: "done", done_date: "2026-09-15" }, "done", "2026-09-15"],
  [{ status: "done", done_date: "2027-01-31" }, "done", ""],
  [{ status: "doing", done_date: "2027-01-31" }, "done", "2026-12-01"],
  [{ status: "done", done_date: "invalid" }, "done", ""],
  [{ status: "doing", done_date: "" }, "done", "2026-12-01"],
  [{ status: "done", done_date: "2026-09-15" }, "doing", ""],
];
for (const [task, nextStatus, expected] of cases) {
  const actual = taskNextDoneDate(task, nextStatus);
  if (actual !== expected) throw new Error(`${JSON.stringify(task)}: ${actual} !== ${expected}`);
}
"""
    subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)


def seed_database(connection: sqlite3.Connection, seed: Any, state: dict[str, Any], catalog: dict[str, Any], audit: list[dict[str, Any]]) -> None:
    lines: list[str] = []
    seed.emit_state(lines, state, catalog)
    seed.emit_audit(lines, audit)
    connection.executescript("\n".join(lines))


def assert_plan(connection: sqlite3.Connection, legacy_ids: list[str], *, total: int = 78) -> None:
    placeholders = ",".join("?" for _ in legacy_ids)
    old_done = connection.execute(
        f"""SELECT COUNT(*) FROM tasks
            WHERE id IN ({placeholders})
              AND status = 'done'
              AND risk = '低'
              AND done_date = CASE WHEN TRIM(recommit_date) <> '' THEN recommit_date ELSE end_date END""",
        legacy_ids,
    ).fetchone()[0]
    assert old_done == 60
    assert connection.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == total
    assert connection.execute("SELECT COUNT(*) FROM operators").fetchone()[0] == 23
    assert connection.execute("SELECT COUNT(*) FROM people").fetchone()[0] == 26
    assert connection.execute("SELECT COUNT(*) FROM groups").fetchone()[0] == 13
    assert connection.execute("SELECT COUNT(*) FROM tasks WHERE task_type = 'engineering'").fetchone()[0] == 8
    assert connection.execute("SELECT COUNT(*) FROM tasks WHERE task_type = 'operator'").fetchone()[0] == 68
    assert connection.execute("SELECT COUNT(*) FROM tasks WHERE task_type = 'unclassified'").fetchone()[0] == 2
    assert connection.execute("SELECT COUNT(*) FROM tasks WHERE task_type <> 'operator' AND operator_ids <> ''").fetchone()[0] == 0
    assert connection.execute("SELECT COUNT(*) FROM tasks WHERE id LIKE 'plan-%' AND end_date = ''").fetchone()[0] == 6
    unscheduled_group = connection.execute(
        "SELECT due_date, start_date, end_date FROM groups WHERE id = 'group-unscheduled'"
    ).fetchone()
    assert tuple(unscheduled_group) == ("", "", "")
    for operator_id, expected_aliases in PLANNED_GDN_ALIASES.items():
        aliases = connection.execute("SELECT aliases FROM operators WHERE id = ?", (operator_id,)).fetchone()[0]
        assert json.loads(aliases) == expected_aliases

    expected_legacy_gdn = {
        "task-1a90ffa7-3": ("GDN正向大融合算子", "done", "低", "2026-08-31", "operator", "chunk_gdr_fwd"),
        "task-51c759bd-0": ("GDN反向大融合算子", "done", "低", "2026-08-31", "operator", "chunk_gdr_bwd"),
        "task-37e61f4f-4": ("GDN-2正向大融合算子", "done", "低", "2026-08-31", "operator", "chunk_gdn2_fwd"),
        "task-1c185a99-5": ("GDN-2反向大融合算子", "todo", "高", "", "operator", "chunk_gdn2_bwd"),
    }
    for task_id, expected in expected_legacy_gdn.items():
        actual = connection.execute(
            "SELECT title, status, risk, done_date, task_type, operator_ids FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        assert tuple(actual) == expected, (task_id, tuple(actual), expected)
    assert connection.execute(
        "SELECT COUNT(*) FROM tasks WHERE done_date > '2026-09-10'"
    ).fetchone()[0] == 0

    for task_id, expected in EXPECTED_NEW_TASKS.items():
        actual = connection.execute(
            "SELECT title, owner, end_date, task_type, operator_ids FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        assert tuple(actual) == expected, (task_id, tuple(actual), expected)

    assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def json_value(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    return json.loads(value)


def rows(connection: sqlite3.Connection, query: str) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(query).fetchall()]


def export_state(connection: sqlite3.Connection) -> dict[str, Any]:
    meta = {row["key"]: row["value"] for row in connection.execute("SELECT key, value FROM project_meta")}
    segment_map: dict[str, list[dict[str, Any]]] = {}
    for segment in rows(connection, "SELECT id, task_id, start_date, end_date, reason, position FROM task_segments ORDER BY position, start_date"):
        task_id = segment.pop("task_id")
        segment_map.setdefault(task_id, []).append(segment)

    operators = rows(connection, "SELECT * FROM operators ORDER BY position, label")
    for operator in operators:
        operator["aliases"] = json_value(operator["aliases"], [])
        operator["owner_rules"] = json_value(operator["owner_rules"], [])
        operator["active"] = bool(operator["active"])

    people = rows(connection, "SELECT * FROM people ORDER BY position, name")
    for person in people:
        person["placeholder"] = bool(person["placeholder"])

    tasks = rows(connection, "SELECT * FROM tasks ORDER BY position, start_date, title")
    for task in tasks:
        task["evidence"] = json_value(task["evidence"], [])
        task["dependencies"] = json_value(task["dependencies"], [])
        task["segments"] = segment_map.get(task["id"], [])

    state_version = meta.get("stateVersion", CORRECTION_TS)
    return {
        "storageVersion": 2,
        "generatedAt": state_version,
        "version": state_version,
        "project": json_value(meta.get("project"), {}),
        "repoScan": json_value(meta.get("repoScan"), {}),
        "groups": rows(connection, "SELECT * FROM groups ORDER BY position, due_date"),
        "specials": rows(connection, "SELECT * FROM specials ORDER BY position, title"),
        "operators": operators,
        "people": people,
        "tasks": tasks,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-snapshots", action="store_true")
    args = parser.parse_args()

    seed = load_seed_module()
    sync = load_sync_module()
    state = seed.read_json(ROOT / "data" / "project-state.json")
    catalog = seed.read_json(ROOT / "data" / "pr-catalog.json", {})
    audit = seed.read_jsonl(ROOT / "data" / "audit-log.jsonl")
    legacy_ids = [task["id"] for task in state["tasks"] if not task["id"].startswith("plan-")]
    assert len(legacy_ids) == 61
    verify_task_type_backfill()
    verify_js_done_date_rules()

    sync.today_bj = lambda: date(2026, 12, 1)
    manual_done = sync.evaluate_task_delivery({
        "title": "人工结项任务",
        "owner": "陈昊文",
        "start_date": "2026-09-10",
        "end_date": "2026-09-15",
        "done_date": "2026-09-15",
        "status": "done",
        "pr_required": 1,
    }, [])
    assert manual_done == {"risk": "低", "status": "done", "done_date": "2026-09-15"}
    future_done = sync.evaluate_task_delivery({
        "title": "未来完成日期任务",
        "owner": "陈昊文",
        "start_date": "2026-12-02",
        "end_date": "2027-01-31",
        "done_date": "2027-01-31",
        "status": "done",
        "pr_required": 1,
    }, [])
    assert future_done["status"] == "doing"
    assert future_done["done_date"] == ""
    completed_with_future_date = [
        ({
            "title": "仅报告任务",
            "owner": "陈昊文",
            "start_date": "2026-09-10",
            "end_date": "2027-01-31",
            "done_date": "2027-01-31",
            "status": "done",
            "pr_required": 0,
            "test_report": "已提供转测报告",
        }, []),
        ({
            "title": "PR 和报告均完成任务",
            "owner": "陈昊文",
            "start_date": "2026-09-10",
            "end_date": "2027-01-31",
            "done_date": "2027-01-31",
            "status": "done",
            "pr_required": 1,
            "pr_link": "#1",
            "test_report": "已提供转测报告",
        }, [{"number": 1, "url": "https://example.invalid/pull/1", "status": "merged"}]),
        ({
            "title": "ops 目录整改",
            "owner": "陈昊文",
            "start_date": "2026-09-10",
            "end_date": "2027-01-31",
            "done_date": "2027-01-31",
            "status": "done",
            "pr_required": 1,
        }, []),
    ]
    for task, catalog_items in completed_with_future_date:
        normalized = sync.evaluate_task_delivery(task, catalog_items)
        assert normalized["status"] == "done"
        assert normalized["done_date"] == ""
    transitioned_with_future_date = sync.evaluate_task_delivery({
        "title": "本次由报告结项任务",
        "owner": "陈昊文",
        "start_date": "2026-09-10",
        "end_date": "2027-01-31",
        "done_date": "2027-01-31",
        "status": "doing",
        "pr_required": 0,
        "test_report": "已提供转测报告",
    }, [])
    assert transitioned_with_future_date == {
        "risk": "低", "status": "done", "done_date": "2026-12-01"
    }
    unscheduled = sync.evaluate_task_delivery({
        "title": "待排期任务",
        "owner": "黄浚哲",
        "start_date": "2026-09-10",
        "end_date": "",
        "done_date": "",
        "status": "doing",
        "pr_required": 1,
    }, [])
    assert unscheduled == {"risk": "高", "status": "todo", "done_date": ""}
    waiting_past_ddl = sync.evaluate_task_delivery({
        "title": "待排人力任务",
        "owner": "待排人力",
        "start_date": "2026-09-10",
        "end_date": "2026-11-30",
        "status": "todo",
        "pr_required": 1,
    }, [])
    assert waiting_past_ddl["status"] == "todo"
    blocked_past_ddl = sync.evaluate_task_delivery({
        "title": "挂起任务",
        "owner": "陈昊文",
        "start_date": "2026-09-10",
        "end_date": "2026-11-30",
        "status": "blocked",
        "pr_required": 1,
    }, [])
    assert blocked_past_ddl["status"] == "blocked"
    future_todo = sync.evaluate_task_delivery({
        "title": "未来任务",
        "owner": "陈昊文",
        "start_date": "2026-12-02",
        "end_date": "2026-12-31",
        "status": "todo",
        "pr_required": 1,
    }, [])
    assert future_todo["status"] == "doing"

    with tempfile.TemporaryDirectory(prefix="flash-io-plan-") as temp_dir:
        connection = sqlite3.connect(Path(temp_dir) / "plan.sqlite")
        connection.row_factory = sqlite3.Row
        apply_migrations(connection, include_plan=False)
        seed_database(connection, seed, state, catalog, audit)
        connection.execute("DELETE FROM task_segments WHERE task_id LIKE 'plan-%'")
        connection.execute("DELETE FROM tasks WHERE id LIKE 'plan-%'")
        connection.execute(
            f"DELETE FROM groups WHERE id IN ({','.join('?' for _ in NEW_GROUP_IDS)})",
            NEW_GROUP_IDS,
        )
        connection.execute(
            f"DELETE FROM people WHERE id IN ({','.join('?' for _ in NEW_PERSON_IDS)})",
            NEW_PERSON_IDS,
        )
        connection.execute(
            f"DELETE FROM operators WHERE id IN ({','.join('?' for _ in NEW_OPERATOR_IDS)})",
            NEW_OPERATOR_IDS,
        )
        for operator_id, aliases in LEGACY_GDN_ALIASES.items():
            connection.execute("UPDATE operators SET aliases = ? WHERE id = ?", (aliases, operator_id))
        connection.execute(
            """DELETE FROM audit_entries
               WHERE entity = 'project'
                 AND ((entity_id = 'plan-2026-09-10' AND action = 'project.plan_refresh')
                   OR (entity_id = 'gdn2-separation-2026-09-10'
                       AND action = 'project.gdn2_correction'))"""
        )
        placeholders = ",".join("?" for _ in legacy_ids)
        connection.execute(
            f"UPDATE tasks SET status = 'todo', risk = '高', done_date = '' WHERE id IN ({placeholders})",
            legacy_ids,
        )
        for task_id, (title, task_type, operator_ids) in PRE_CORRECTION_GDN_TASKS.items():
            connection.execute(
                "UPDATE tasks SET title = ?, task_type = ?, operator_ids = ? WHERE id = ?",
                (title, task_type, operator_ids, task_id),
            )
        assert connection.execute("SELECT COUNT(*) FROM groups").fetchone()[0] == 7
        assert connection.execute("SELECT COUNT(*) FROM people").fetchone()[0] == 23
        assert connection.execute("SELECT COUNT(*) FROM operators").fetchone()[0] == 16
        assert connection.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 61
        connection.execute(
            """INSERT INTO tasks(
                 id, title, owner, status, risk, group_id, start_date, end_date,
                 created_at, updated_at, task_type
               ) VALUES ('unrelated-preexisting', '不属于原计划', '待排人力', 'todo', '高', ?,
                         '2026-09-10', '2026-12-31', ?, ?, 'engineering')""",
            (state["groups"][0]["id"], PLAN_TS, PLAN_TS),
        )
        connection.executescript((ROOT / "migrations" / PLAN_MIGRATION).read_text(encoding="utf-8-sig"))
        old_done_before_correction = connection.execute(
            f"""SELECT COUNT(*) FROM tasks
                WHERE id IN ({placeholders}) AND status = 'done' AND risk = '低'
                  AND done_date = CASE WHEN TRIM(recommit_date) <> '' THEN recommit_date ELSE end_date END""",
            legacy_ids,
        ).fetchone()[0]
        assert old_done_before_correction == 61
        for task_id, expected in PRE_CORRECTION_GDN_TASKS.items():
            actual = connection.execute(
                "SELECT title, task_type, operator_ids FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
            assert tuple(actual) == expected
        connection.executescript((ROOT / "migrations" / CORRECTION_MIGRATION).read_text(encoding="utf-8-sig"))
        unrelated = connection.execute(
            "SELECT status, risk, done_date FROM tasks WHERE id = 'unrelated-preexisting'"
        ).fetchone()
        assert tuple(unrelated) == ("todo", "高", "")
        connection.execute("DELETE FROM tasks WHERE id = 'unrelated-preexisting'")
        assert_plan(connection, legacy_ids)
        legacy_state = tuple(connection.execute(
            "SELECT status, risk, done_date, updated_at FROM tasks WHERE id = ?", (legacy_ids[0],)
        ).fetchone())
        later_version = "2026-12-01T00:00:00.000Z"
        connection.execute(
            "INSERT OR REPLACE INTO project_meta(key, value) VALUES ('stateVersion', ?)",
            (later_version,),
        )
        connection.execute("UPDATE tasks SET status = 'blocked', risk = '高' WHERE id = ?", (legacy_ids[0],))
        connection.execute(
            "UPDATE tasks SET status = 'blocked' WHERE id = 'task-1c185a99-5'"
        )
        custom_aliases = '["chunk_gdr_fwd","custom_after_migration"]'
        connection.execute("UPDATE operators SET aliases = ? WHERE id = 'chunk_gdr_fwd'", (custom_aliases,))
        connection.executescript((ROOT / "migrations" / PLAN_MIGRATION).read_text(encoding="utf-8-sig"))
        connection.executescript((ROOT / "migrations" / CORRECTION_MIGRATION).read_text(encoding="utf-8-sig"))
        preserved = connection.execute("SELECT status, risk FROM tasks WHERE id = ?", (legacy_ids[0],)).fetchone()
        assert tuple(preserved) == ("blocked", "高")
        assert connection.execute(
            "SELECT value FROM project_meta WHERE key = 'stateVersion'"
        ).fetchone()[0] == later_version
        assert connection.execute(
            "SELECT aliases FROM operators WHERE id = 'chunk_gdr_fwd'"
        ).fetchone()[0] == custom_aliases
        assert connection.execute(
            "SELECT status FROM tasks WHERE id = 'task-1c185a99-5'"
        ).fetchone()[0] == "blocked"
        connection.execute(
            "UPDATE tasks SET status = ?, risk = ?, done_date = ?, updated_at = ? WHERE id = ?",
            (*legacy_state, legacy_ids[0]),
        )
        connection.execute(
            "UPDATE project_meta SET value = ? WHERE key = 'stateVersion'",
            (CORRECTION_TS,),
        )
        connection.execute(
            """UPDATE tasks
               SET title = 'GDN-2反向大融合算子', status = 'todo', risk = '高', done_date = '',
                   task_type = 'operator', operator_ids = 'chunk_gdn2_bwd', updated_at = ?
               WHERE id = 'task-1c185a99-5'""",
            (CORRECTION_TS,),
        )
        connection.execute(
            "UPDATE operators SET aliases = ? WHERE id = 'chunk_gdr_fwd'",
            (json.dumps(PLANNED_GDN_ALIASES["chunk_gdr_fwd"], ensure_ascii=False, separators=(",", ":")),),
        )
        assert connection.execute(
            """SELECT COUNT(*) FROM audit_entries
               WHERE entity = 'project' AND entity_id = 'plan-2026-09-10'
                 AND action = 'project.plan_refresh'"""
        ).fetchone()[0] == 1
        assert connection.execute(
            """SELECT COUNT(*) FROM audit_entries
               WHERE entity = 'project' AND entity_id = 'gdn2-separation-2026-09-10'
                 AND action = 'project.gdn2_correction'"""
        ).fetchone()[0] == 1
        assert_plan(connection, legacy_ids)
        snapshot = export_state(connection)
        connection.close()

        recovery = sqlite3.connect(Path(temp_dir) / "recovery.sqlite")
        recovery.row_factory = sqlite3.Row
        apply_migrations(recovery, include_plan=True)
        seed_database(recovery, seed, snapshot, catalog, audit)
        assert_plan(recovery, legacy_ids)
        recovery.close()

    if args.write_snapshots:
        text = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
        for path in SNAPSHOT_PATHS:
            path.write_text(text, encoding="utf-8")

    print(json.dumps({
        "legacyCompleted": 60,
        "tasks": 78,
        "newTasks": len(EXPECTED_NEW_TASKS),
        "operators": 23,
        "people": 26,
        "groups": 13,
        "unscheduledNewTasks": 6,
        "recoveryVerified": True,
        "snapshotsWritten": args.write_snapshots,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
