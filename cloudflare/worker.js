const DEFAULT_PROJECT = {
  name: "flash-linear-attention-npu",
  repository: "https://github.com/flashserve/flash-linear-attention-npu",
  baselineDate: "2026-06-15",
  projectOwner: { name: "待填写", email: "待填写" },
};
const PL_OPTIONS = ["赵臣臣", "陈琳鑫", "唐超", "马越", "黄俊健", "龚翔宇", "周亭亭", "孙伟伟"];
const DEFAULT_PL = PL_OPTIONS[0];
const PASSWORD_HASH_ITERATIONS = 100000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return emptyResponse(request, env);
    try {
      if (url.pathname === "/api/health") {
        return jsonResponse(request, env, {
          ok: true,
          storage: "cloudflare-d1",
          database: env.DB ? "D1" : "missing",
        });
      }
      if (url.pathname === "/api/export" || url.pathname === "/api/state") {
        return jsonResponse(request, env, await exportState(env));
      }
      if (url.pathname === "/api/version") {
        return jsonResponse(request, env, { ok: true, version: await getStateVersion(env) });
      }
      if (url.pathname === "/api/audit") {
        return jsonResponse(request, env, await listAudit(env, url));
      }
      if (url.pathname === "/api/audit/export") {
        await requireAdminLike(request, env);
        return jsonResponse(request, env, await exportAudit(env));
      }
      if (url.pathname === "/api/pr-catalog") {
        return jsonResponse(request, env, await getJsonMeta(env, "prCatalog", emptyPrCatalog()));
      }
      if (url.pathname === "/api/pr-catalog/sync" && request.method === "POST") {
        await requireAdminLike(request, env);
        const payload = await readJson(request);
        return jsonResponse(request, env, await syncPrCatalog(env, payload.catalog || payload));
      }
      if (url.pathname === "/api/login" && request.method === "POST") {
        return jsonResponse(request, env, await login(request, env));
      }
      if (url.pathname === "/api/me") {
        return jsonResponse(request, env, { ok: true, user: await requireUser(request, env) });
      }
      if (url.pathname === "/api/me/password" && request.method === "POST") {
        return jsonResponse(request, env, await changePassword(request, env));
      }
      if (url.pathname === "/api/users" && request.method === "GET") {
        await requireAdminLike(request, env);
        return jsonResponse(request, env, await listUsers(env));
      }
      if (url.pathname === "/api/users" && request.method === "POST") {
        await requireAdminLike(request, env);
        return jsonResponse(request, env, await createUser(request, env), 201);
      }
      const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
      if (userMatch && request.method === "PATCH") {
        await requireAdminLike(request, env);
        return jsonResponse(request, env, await patchUser(request, env, decodeURIComponent(userMatch[1])));
      }
      if (url.pathname === "/api/tasks" && request.method === "POST") {
        return jsonResponse(request, env, await createTask(request, env), 201);
      }
      const taskPatchMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskPatchMatch && request.method === "PATCH") {
        return jsonResponse(request, env, await patchTask(request, env, decodeURIComponent(taskPatchMatch[1])));
      }
      if (taskPatchMatch && request.method === "DELETE") {
        return jsonResponse(request, env, await deleteTask(request, env, decodeURIComponent(taskPatchMatch[1])));
      }
      const entityRootMatch = url.pathname.match(/^\/api\/(groups|specials|people)$/);
      if (entityRootMatch && request.method === "POST") {
        return jsonResponse(request, env, await createEntity(request, env, entityRootMatch[1]), 201);
      }
      const entityMatch = url.pathname.match(/^\/api\/(groups|specials|people)\/([^/]+)$/);
      if (entityMatch && request.method === "PATCH") {
        return jsonResponse(request, env, await patchEntity(request, env, entityMatch[1], decodeURIComponent(entityMatch[2])));
      }
      if (entityMatch && request.method === "DELETE") {
        return jsonResponse(request, env, await deleteEntity(request, env, entityMatch[1], decodeURIComponent(entityMatch[2])));
      }
      if (url.pathname === "/api/import" && request.method === "POST") {
        await requireAdminLike(request, env);
        const payload = await readJson(request);
        await replaceState(env, payload.state || payload);
        await replaceAudit(env, payload.audit || []);
        if (payload.prCatalog) await setJsonMeta(env, "prCatalog", payload.prCatalog);
        const version = await bumpStateVersion(env);
        return jsonResponse(request, env, { ok: true, version, state: await exportState(env) });
      }
      if (url.pathname === "/api/save" && request.method === "POST") {
        const user = await requireUser(request, env);
        const payload = await readJson(request);
        if (!payload.state) return errorResponse(request, env, 400, "state is required");
        await assertExpectedVersion(env, payload.expectedVersion);
        await authorizeStateChange(env, user, payload.state);
        await replaceState(env, payload.state);
        if (payload.prCatalog && user.role === "admin") await setJsonMeta(env, "prCatalog", payload.prCatalog);
        const catalog = await getJsonMeta(env, "prCatalog", emptyPrCatalog());
        await syncTaskDeliveryRulesFromCatalog(env, catalog.items || []);
        const version = await bumpStateVersion(env);
        const entry = payload.auditEntry || {
          ts: nowIso(),
          action: "state.save",
          entity: "state",
          id: "snapshot",
          summary: "保存项目状态",
          detail: {},
          source: "cloudflare-d1",
        };
        await insertAudit(env, { ...entry, source: "cloudflare-d1" });
        return jsonResponse(request, env, {
          ok: true,
          entry,
          version,
          state: await exportState(env),
        });
      }
      return errorResponse(request, env, 404, "api not found");
    } catch (error) {
      const status = error.status || 500;
      return errorResponse(request, env, status, error.message || "internal error", error.version ? { version: error.version } : {});
    }
  },
};

async function exportState(env) {
  const meta = await allMeta(env);
  const segments = await env.DB.prepare(
    "SELECT id, task_id, start_date, end_date, reason, position FROM task_segments ORDER BY position, start_date"
  ).all();
  const segmentMap = new Map();
  for (const row of segments.results || []) {
    if (!segmentMap.has(row.task_id)) segmentMap.set(row.task_id, []);
    segmentMap.get(row.task_id).push({
      id: row.id,
      start_date: row.start_date,
      end_date: row.end_date,
      reason: row.reason || "",
      position: row.position || 0,
    });
  }
  const tasks = await env.DB.prepare("SELECT * FROM tasks ORDER BY position, start_date, title").all();
  return {
    storageVersion: 2,
    generatedAt: nowIso(),
    version: await getStateVersion(env),
    project: parseJson(meta.project, DEFAULT_PROJECT),
    repoScan: parseJson(meta.repoScan, {}),
    groups: await selectAll(env, "SELECT * FROM groups ORDER BY position, due_date"),
    specials: await selectAll(env, "SELECT * FROM specials ORDER BY position, title"),
    people: (await selectAll(env, "SELECT * FROM people ORDER BY position, name")).map((person) => ({
      ...person,
      pl: normalizePl(person.pl),
      placeholder: Boolean(person.placeholder),
    })),
    tasks: (tasks.results || []).map((task) => ({
      ...task,
      evidence: parseJson(task.evidence, []),
      dependencies: parseJson(task.dependencies, []),
      segments: segmentMap.get(task.id) || [],
    })),
  };
}

async function replaceState(env, state) {
  if (!state || !Array.isArray(state.tasks)) throw withStatus(400, "invalid state payload");
  const statements = [
    env.DB.prepare("DELETE FROM task_segments"),
    env.DB.prepare("DELETE FROM tasks"),
    env.DB.prepare("DELETE FROM people"),
    env.DB.prepare("DELETE FROM specials"),
    env.DB.prepare("DELETE FROM groups"),
    env.DB.prepare("DELETE FROM project_meta WHERE key IN ('project', 'repoScan')"),
    env.DB.prepare("INSERT OR REPLACE INTO project_meta(key, value) VALUES (?, ?)").bind("project", toJson(state.project || DEFAULT_PROJECT)),
    env.DB.prepare("INSERT OR REPLACE INTO project_meta(key, value) VALUES (?, ?)").bind("repoScan", toJson(state.repoScan || {})),
  ];

  (state.groups || []).forEach((group, index) => {
    statements.push(env.DB.prepare(
      "INSERT INTO groups(id, title, due_date, start_date, end_date, position) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      group.id,
      group.title || "未命名分组",
      group.due_date || group.end_date || "2026-06-25",
      group.start_date || group.due_date || "2026-06-25",
      group.end_date || group.due_date || "2026-06-25",
      numberOr(group.position, index),
    ));
  });

  (state.specials || []).forEach((special, index) => {
    statements.push(env.DB.prepare(
      "INSERT INTO specials(id, title, group_id, position, collapsed) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      special.id,
      special.title || "专项：未命名",
      special.group_id || null,
      numberOr(special.position, index),
      special.collapsed ? 1 : 0,
    ));
  });

  (state.people || []).forEach((person, index) => {
    statements.push(env.DB.prepare(
      "INSERT INTO people(id, name, position, placeholder, pl) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      person.id,
      person.name || "待排人力",
      numberOr(person.position, index),
      person.placeholder ? 1 : 0,
      normalizePl(person.pl),
    ));
  });

  (state.tasks || []).forEach((task, index) => {
    statements.push(env.DB.prepare(
      `INSERT INTO tasks(
        id, title, scope, target, owner, status, risk, priority, group_id, special_id,
        start_date, end_date, evidence, dependencies, pr_link, test_report, notes,
        position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      task.id,
      task.title || "未命名任务",
      task.scope || "",
      task.target || "",
      task.owner || "待排人力",
      task.status || "todo",
      task.risk || "中",
      task.priority || "P1",
      task.group_id || "",
      task.special_id || null,
      task.start_date || "2026-06-25",
      task.end_date || task.start_date || "2026-06-25",
      toJson(task.evidence || []),
      toJson(task.dependencies || []),
      task.pr_link || "",
      task.test_report || "",
      task.notes || "",
      numberOr(task.position, index),
      task.created_at || nowIso(),
      task.updated_at || nowIso(),
    ));
    const segments = Array.isArray(task.segments) && task.segments.length
      ? task.segments
      : [{ start_date: task.start_date, end_date: task.end_date, reason: task.notes || "", position: 0 }];
    segments.forEach((segment, segmentIndex) => {
      statements.push(env.DB.prepare(
        "INSERT INTO task_segments(id, task_id, start_date, end_date, reason, position) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(
        segment.id || `seg-${task.id}-${segmentIndex}`,
        task.id,
        segment.start_date || task.start_date || "2026-06-25",
        segment.end_date || task.end_date || task.start_date || "2026-06-25",
        segment.reason || "",
        numberOr(segment.position, segmentIndex),
      ));
    });
  });

  await env.DB.batch(statements);
}

async function syncPrCatalog(env, catalog) {
  const normalized = normalizePrCatalog(catalog);
  const previous = await getJsonMeta(env, "prCatalog", emptyPrCatalog());
  const catalogChanged = catalogComparable(previous) !== catalogComparable(normalized);
  await setJsonMeta(env, "prCatalog", normalized);
  const changed = await syncTaskDeliveryRulesFromCatalog(env, normalized.items);
  if (catalogChanged || changed.length) {
    await bumpStateVersion(env);
    await insertAudit(env, {
      ts: nowIso(),
      action: "pr_catalog.sync",
      entity: "project",
      id: "pr-catalog-sync",
      summary: `同步上游 PR 候选池到 D1：${normalized.items.length} 个候选，风险/状态更新 ${changed.length} 项`,
      detail: {
        sourceRepo: normalized.sourceRepo || "",
        generatedAt: normalized.generatedAt || "",
        changed,
      },
      source: "github-actions",
    });
  }
  return {
    ok: true,
    catalogTotal: normalized.items.length,
    catalogChanged,
    changedCount: changed.length,
    changed,
  };
}

async function syncTaskDeliveryRulesFromCatalog(env, catalogItems) {
  const tasks = await selectAll(env, "SELECT id, title, owner, status, risk, start_date, end_date, pr_link, test_report FROM tasks ORDER BY position, start_date, title");
  const changed = [];
  const statements = [];
  const now = nowIso();
  for (const task of tasks) {
    const next = evaluateTaskDelivery(task, catalogItems);
    const diff = {};
    if (task.risk !== next.risk) {
      diff.risk = { from: task.risk, to: next.risk };
    }
    if (task.status !== next.status) {
      diff.status = { from: task.status, to: next.status };
    }
    if (!Object.keys(diff).length) continue;
    changed.push({ id: task.id, title: task.title, changes: diff });
    statements.push(env.DB.prepare(
      "UPDATE tasks SET risk = ?, status = ?, updated_at = ? WHERE id = ?"
    ).bind(next.risk, next.status, now, task.id));
  }
  if (statements.length) await env.DB.batch(statements);
  return changed;
}

async function syncTaskDeliveryRuleForTask(env, taskId, catalogItems) {
  const task = await env.DB.prepare("SELECT id, title, owner, status, risk, start_date, end_date, pr_link, test_report FROM tasks WHERE id = ?").bind(taskId).first();
  if (!task) return null;
  const next = evaluateTaskDelivery(task, catalogItems);
  const diff = {};
  if (task.risk !== next.risk) diff.risk = { from: task.risk, to: next.risk };
  if (task.status !== next.status) diff.status = { from: task.status, to: next.status };
  if (!Object.keys(diff).length) return null;
  await env.DB.prepare(
    "UPDATE tasks SET risk = ?, status = ?, updated_at = ? WHERE id = ?"
  ).bind(next.risk, next.status, nowIso(), task.id).run();
  return { id: task.id, title: task.title, changes: diff };
}

function evaluateTaskDelivery(task, catalogItems) {
  return {
    risk: evaluateTaskRisk(task, catalogItems),
    status: evaluateTaskStatus(task, catalogItems),
  };
}

function evaluateTaskRisk(task, catalogItems) {
  const pr = prLinkSummary(task.pr_link, catalogItems);
  const daysUntilDdl = daysBetween(todayBjYmd(), taskDdl(task));
  if (taskHasWaitingOwner(task)) return "高";
  if (pr.allMerged) return "低";
  if (pr.hasOpen) return daysUntilDdl <= 5 ? "中" : "低";
  return daysUntilDdl <= 10 ? "高" : "中";
}

function evaluateTaskStatus(task, catalogItems) {
  const pr = prLinkSummary(task.pr_link, catalogItems);
  const completed = taskIsCompletionOverride(task) || (pr.allMerged && taskHasReport(task));
  if (completed) return "done";
  if (todayBjYmd() > taskDdl(task)) return "delayed";
  if (task.status === "blocked") return "blocked";
  if (taskHasWaitingOwner(task) || !taskHasClosedSchedule(task)) return "todo";
  return "doing";
}

function prLinkSummary(value, catalogItems) {
  const refs = parsePrRefs(value);
  const matches = refs.map((ref) => findPrCandidate(ref, catalogItems));
  const missing = !refs.length || matches.some((item) => !item);
  return {
    refs,
    matches: matches.filter(Boolean),
    missing,
    allMerged: refs.length > 0 && !missing && matches.every((item) => item.status === "merged"),
    hasOpen: refs.length > 0 && !missing && matches.some((item) => item.status === "open"),
  };
}

function parsePrRefs(value) {
  return String(value || "").split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter((item) => item && (/^https?:\/\//i.test(item) || /^#?\d+$/.test(item)));
}

function findPrCandidate(query, catalogItems) {
  const value = String(query || "").trim();
  if (!value) return null;
  const normalized = value.toLowerCase();
  const number = normalized.match(/^#?(\d+)$/)?.[1]
    || normalized.match(/\/pull\/(\d+)/)?.[1]
    || normalized.match(/^#?(\d+)\b/)?.[1];
  if (number) {
    const byNumber = catalogItems.find((pr) => String(pr.number) === number);
    if (byNumber) return byNumber;
  }
  return catalogItems.find((pr) => [
    pr.url,
    prOptionLabel(pr),
    pr.title,
    pr.headRef,
  ].some((field) => String(field || "").toLowerCase().includes(normalized))) || null;
}

function prOptionLabel(pr) {
  const status = pr.statusText || (pr.status === "merged" ? "已合入" : "未合入");
  return `#${pr.number} ${status} ${pr.title || ""}`.trim();
}

function taskHasReport(task) {
  return Boolean(String(task.test_report || "").trim());
}

function taskIsCompletionOverride(task) {
  return /ops\s*目录整改/i.test(String(task.title || ""));
}

function taskHasWaitingOwner(task) {
  return ownerNames(task).includes("待排人力");
}

function taskHasClosedSchedule(task) {
  return isYmd(task.start_date) && isYmd(task.end_date);
}

function ownerNames(task) {
  return normalizeOwnerName(task.owner).split(/[、/,，;；&\s]+/)
    .map(normalizeOwnerName)
    .filter(Boolean);
}

function normalizeOwnerName(name) {
  const value = String(name || "").trim();
  return !value || value === "待填写" || value === "待排人力" ? "待排人力" : value;
}

function taskDdl(task) {
  return isYmd(task.end_date) ? task.end_date : (isYmd(task.start_date) ? task.start_date : todayBjYmd());
}

function todayBjYmd() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(value));
}

function normalizePrCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.items)) throw withStatus(400, "catalog.items is required");
  const items = catalog.items
    .filter((item) => item && (item.status === "open" || item.status === "merged"))
    .map((item) => ({
      number: Number(item.number),
      title: String(item.title || ""),
      url: String(item.url || ""),
      status: item.status === "merged" ? "merged" : "open",
      statusText: item.statusText || (item.status === "merged" ? "已合入" : "未合入"),
      mergedAt: item.mergedAt || null,
      updatedAt: item.updatedAt || null,
      createdAt: item.createdAt || null,
      headRef: String(item.headRef || ""),
      labels: Array.isArray(item.labels) ? item.labels.map((label) => String(label)) : [],
    }))
    .filter((item) => Number.isFinite(item.number) && item.url);
  return {
    generatedAt: catalog.generatedAt || nowIso(),
    sourceRepo: catalog.sourceRepo || "flashserve/flash-linear-attention-npu",
    rule: catalog.rule || "仅包含已合入 PR 和仍开放 PR；关闭且未合入的 PR 不进入候选池。",
    total: items.length,
    items,
  };
}

function catalogComparable(catalog) {
  return JSON.stringify({
    sourceRepo: catalog?.sourceRepo || "",
    total: Number(catalog?.total) || 0,
    items: catalog?.items || [],
  });
}

async function listAudit(env, url) {
  const limit = clamp(Number(url.searchParams.get("limit") || 10), 1, 200);
  const q = url.searchParams.get("q") || "";
  const sql = `
    SELECT ts, action, entity, entity_id, summary, detail, source
    FROM audit_entries
    ${q ? "WHERE summary LIKE ? OR action LIKE ? OR entity_id LIKE ? OR detail LIKE ?" : ""}
    ORDER BY id DESC
    LIMIT ?
  `;
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit] : [limit];
  const result = await env.DB.prepare(sql).bind(...params).all();
  return (result.results || []).map(auditRowToEntry);
}

async function exportAudit(env) {
  const result = await env.DB.prepare(`
    SELECT ts, action, entity, entity_id, summary, detail, source
    FROM audit_entries
    ORDER BY id ASC
  `).all();
  return (result.results || []).map(auditRowToEntry);
}

async function replaceAudit(env, audit) {
  const statements = [env.DB.prepare("DELETE FROM audit_entries")];
  for (const entry of audit || []) {
    statements.push(auditInsertStatement(env, entry));
  }
  await env.DB.batch(statements);
}

async function insertAudit(env, entry) {
  await auditInsertStatement(env, entry).run();
}

function auditInsertStatement(env, entry) {
  return env.DB.prepare(
    "INSERT INTO audit_entries(ts, action, entity, entity_id, summary, detail, source) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    entry.ts || nowIso(),
    entry.action || "",
    entry.entity || "",
    entry.id || entry.entity_id || "",
    entry.summary || "",
    toJson(entry.detail || {}),
    entry.source || "cloudflare-d1",
  );
}

function auditRowToEntry(row) {
  return {
    ts: row.ts,
    action: row.action,
    entity: row.entity,
    id: row.entity_id,
    summary: row.summary,
    detail: parseJson(row.detail, {}),
    source: row.source,
  };
}

async function allMeta(env) {
  const result = await env.DB.prepare("SELECT key, value FROM project_meta").all();
  return Object.fromEntries((result.results || []).map((row) => [row.key, row.value]));
}

async function getJsonMeta(env, key, fallback) {
  const row = await env.DB.prepare("SELECT value FROM project_meta WHERE key = ?").bind(key).first();
  return row ? parseJson(row.value, fallback) : fallback;
}

async function setJsonMeta(env, key, value) {
  await env.DB.prepare("INSERT OR REPLACE INTO project_meta(key, value) VALUES (?, ?)").bind(key, toJson(value)).run();
}

async function getStateVersion(env) {
  const row = await env.DB.prepare("SELECT value FROM project_meta WHERE key = ?").bind("stateVersion").first();
  return row?.value || "0";
}

async function bumpStateVersion(env) {
  const version = nowIso();
  await env.DB.prepare("INSERT OR REPLACE INTO project_meta(key, value) VALUES (?, ?)").bind("stateVersion", version).run();
  return version;
}

async function assertExpectedVersion(env, expectedVersion) {
  if (!expectedVersion) return;
  const current = await getStateVersion(env);
  if (String(expectedVersion) !== String(current)) {
    const error = withStatus(409, "state version conflict; refresh or merge before saving");
    error.version = current;
    throw error;
  }
}

async function login(request, env) {
  const payload = await readJson(request);
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "");
  if (!username || !password) throw withStatus(400, "username and password are required");
  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ? AND active = 1").bind(username).first();
  if (!row || !(await verifyPassword(password, row.salt, row.password_hash))) {
    throw withStatus(401, "invalid username or password");
  }
  const user = publicUser(row);
  return {
    ok: true,
    user,
    token: await signToken(env, { sub: row.id, username: row.username, role: row.role, exp: Math.floor(Date.now() / 1000) + 86400 }),
  };
}

async function listUsers(env) {
  const rows = await selectAll(env, "SELECT id, username, display_name, owner_name, role, active, created_at, updated_at FROM users ORDER BY role, username");
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
}

async function createUser(request, env) {
  const payload = await readJson(request);
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "");
  if (!username || !password) throw withStatus(400, "username and password are required");
  const existing = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (existing && payload.resetPassword !== true && payload.confirmReset !== true) {
    throw withStatus(409, "user already exists; resetPassword=true is required to reset password");
  }
  const role = payload.role === "admin" ? "admin" : "developer";
  const salt = randomToken(18);
  const passwordHash = await hashPassword(password, salt);
  const id = payload.id || `user-${crypto.randomUUID().slice(0, 10)}`;
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO users(id, username, display_name, owner_name, role, password_hash, salt, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       display_name = excluded.display_name,
       owner_name = excluded.owner_name,
       role = excluded.role,
       password_hash = excluded.password_hash,
       salt = excluded.salt,
       active = excluded.active,
       updated_at = excluded.updated_at`
  ).bind(
    id,
    username,
    String(payload.displayName || payload.display_name || username).trim(),
    String(payload.ownerName || payload.owner_name || payload.displayName || payload.display_name || username).trim(),
    role,
    passwordHash,
    salt,
    payload.active === false ? 0 : 1,
    now,
    now,
  ).run();
  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  await insertAudit(env, {
    ts: now,
    action: existing ? "user.password_reset" : "user.create",
    entity: "user",
    id: row.id,
    summary: existing ? `重置账号密码：${username}` : `创建账号：${username}`,
    detail: { username, role },
    source: "cloudflare-d1",
  });
  return { ok: true, user: publicUser(row) };
}

async function patchUser(request, env, userId) {
  const payload = await readJson(request);
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ? OR username = ?").bind(userId, userId).first();
  if (!row) throw withStatus(404, "user not found");
  const fields = normalizeUserPatchFields(payload.fields || payload);
  const changedFields = Object.keys(fields).filter((field) => !sameJson(row[field], fields[field]));
  if (!changedFields.length) return { ok: true, user: publicUser(row), entry: null };
  const assignments = changedFields.map((field) => `${field} = ?`).join(", ");
  const values = changedFields.map((field) => fields[field]);
  await env.DB.prepare(`UPDATE users SET ${assignments}, updated_at = ? WHERE id = ?`)
    .bind(...values, nowIso(), row.id)
    .run();
  const next = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(row.id).first();
  const entry = payload.auditEntry || {
    ts: nowIso(),
    action: "user.patch",
    entity: "user",
    id: row.id,
    summary: `更新账号：${next.username}`,
    detail: { fields: changedFields },
    source: "cloudflare-d1",
  };
  await insertAudit(env, { ...entry, source: "cloudflare-d1" });
  return { ok: true, user: publicUser(next), entry };
}

function normalizeUserPatchFields(fields) {
  const next = {};
  for (const [rawField, value] of Object.entries(fields || {})) {
    const field = rawField === "displayName" ? "display_name"
      : rawField === "ownerName" ? "owner_name"
        : rawField;
    if (field === "role") {
      next.role = value === "admin" ? "admin" : "developer";
    } else if (field === "active") {
      next.active = value === false || value === 0 || value === "0" ? 0 : 1;
    } else if (field === "display_name" || field === "owner_name") {
      next[field] = String(value || "").trim();
    } else {
      throw withStatus(400, `unsupported user field: ${rawField}`);
    }
  }
  return next;
}

async function createTask(request, env) {
  await requireAdminLike(request, env);
  const payload = await readJson(request);
  const task = normalizeTaskForInsert(payload.task || payload);
  await insertTask(env, task);
  const catalog = await getJsonMeta(env, "prCatalog", emptyPrCatalog());
  await syncTaskDeliveryRuleForTask(env, task.id, catalog.items || []);
  const version = await bumpStateVersion(env);
  const entry = payload.auditEntry || {
    ts: nowIso(),
    action: "task.create",
    entity: "task",
    id: task.id,
    summary: `新增任务：${task.title}`,
    detail: { title: task.title },
    source: "cloudflare-d1",
  };
  await insertAudit(env, { ...entry, source: "cloudflare-d1" });
  return { ok: true, version, entry, task: await getTaskById(env, task.id) };
}

async function deleteTask(request, env, taskId) {
  await requireAdminLike(request, env);
  const payload = await readJson(request);
  const task = await getTaskById(env, taskId);
  if (!task) throw withStatus(404, "task not found");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM task_segments WHERE task_id = ?").bind(taskId),
    env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(taskId),
  ]);
  const version = await bumpStateVersion(env);
  const entry = payload.auditEntry || {
    ts: nowIso(),
    action: "task.delete",
    entity: "task",
    id: taskId,
    summary: `删除任务：${task.title || taskId}`,
    detail: { title: task.title || "" },
    source: "cloudflare-d1",
  };
  await insertAudit(env, { ...entry, source: "cloudflare-d1" });
  return { ok: true, version, entry, deletedId: taskId };
}

async function createEntity(request, env, type) {
  await requireAdminLike(request, env);
  const payload = await readJson(request);
  const singular = entitySingular(type);
  const item = normalizeEntityForInsert(type, payload.item || payload.entity || payload[singular] || payload);
  await insertEntity(env, type, item);
  const version = await bumpStateVersion(env);
  const entry = payload.auditEntry || {
    ts: nowIso(),
    action: `${entitySingular(type)}.create`,
    entity: entitySingular(type),
    id: item.id,
    summary: `新增${entityLabel(type)}：${entityDisplayName(type, item)}`,
    detail: { id: item.id },
    source: "cloudflare-d1",
  };
  await insertAudit(env, { ...entry, source: "cloudflare-d1" });
  return { ok: true, version, entry, [entitySingular(type)]: await getEntityById(env, type, item.id) };
}

async function patchEntity(request, env, type, id) {
  await requireAdminLike(request, env);
  const payload = await readJson(request);
  const oldItem = await getEntityById(env, type, id);
  if (!oldItem) throw withStatus(404, `${entitySingular(type)} not found`);
  const fields = normalizeEntityPatchFields(type, payload.fields || {});
  const changedFields = Object.keys(fields).filter((field) => !sameJson(oldItem[field], fields[field]));
  if (!changedFields.length) {
    return { ok: true, version: await getStateVersion(env), [entitySingular(type)]: oldItem, entry: null };
  }
  await applyEntityPatch(env, type, id, oldItem, fields, changedFields);
  const version = await bumpStateVersion(env);
  const nextItem = await getEntityById(env, type, id);
  const entry = payload.auditEntry || {
    ts: nowIso(),
    action: `${entitySingular(type)}.patch`,
    entity: entitySingular(type),
    id,
    summary: `更新${entityLabel(type)}：${entityDisplayName(type, nextItem || oldItem)}`,
    detail: { fields: changedFields },
    source: "cloudflare-d1",
  };
  await insertAudit(env, { ...entry, source: "cloudflare-d1" });
  return { ok: true, version, entry, [entitySingular(type)]: nextItem };
}

async function deleteEntity(request, env, type, id) {
  await requireAdminLike(request, env);
  const payload = await readJson(request);
  const item = await getEntityById(env, type, id);
  if (!item) throw withStatus(404, `${entitySingular(type)} not found`);
  const detail = await applyEntityDelete(env, type, id, payload);
  const version = await bumpStateVersion(env);
  const entry = payload.auditEntry || {
    ts: nowIso(),
    action: `${entitySingular(type)}.delete`,
    entity: entitySingular(type),
    id,
    summary: `删除${entityLabel(type)}：${entityDisplayName(type, item)}`,
    detail,
    source: "cloudflare-d1",
  };
  await insertAudit(env, { ...entry, source: "cloudflare-d1" });
  return { ok: true, version, entry, deletedId: id, detail };
}

async function changePassword(request, env) {
  const user = await requireUser(request, env);
  const payload = await readJson(request);
  const oldPassword = String(payload.oldPassword || "");
  const newPassword = String(payload.newPassword || "");
  if (!oldPassword || !newPassword) throw withStatus(400, "oldPassword and newPassword are required");
  if (newPassword.length < 8) throw withStatus(400, "new password must be at least 8 characters");
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND active = 1").bind(user.id).first();
  if (!row || !(await verifyPassword(oldPassword, row.salt, row.password_hash))) {
    throw withStatus(401, "old password is incorrect");
  }
  const salt = randomToken(18);
  const passwordHash = await hashPassword(newPassword, salt);
  await env.DB.prepare("UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?")
    .bind(passwordHash, salt, nowIso(), user.id)
    .run();
  await insertAudit(env, {
    ts: nowIso(),
    action: "user.password_change",
    entity: "user",
    id: user.id,
    summary: `修改账号密码：${user.username}`,
    detail: { username: user.username },
    source: "cloudflare-d1",
  });
  return { ok: true };
}

const TASK_PATCH_FIELDS = new Set([
  "title", "scope", "target", "owner", "status", "risk", "priority", "group_id", "special_id",
  "start_date", "end_date", "evidence", "dependencies", "pr_link", "test_report", "notes",
  "position", "segments",
]);
const TASK_JSON_PATCH_FIELDS = new Set(["evidence", "dependencies"]);

async function patchTask(request, env, taskId) {
  const user = await requireUser(request, env);
  const payload = await readJson(request);
  await assertExpectedVersion(env, payload.expectedVersion);
  const oldTask = await getTaskById(env, taskId);
  if (!oldTask) throw withStatus(404, "task not found");
  const fields = normalizeTaskPatchFields(payload.fields || {});
  const changedFields = Object.keys(fields).filter((field) => {
    if (field === "segments") return !sameJson(oldTask.segments || [], fields.segments || []);
    return !sameJson(oldTask[field], fields[field]);
  });
  if (!changedFields.length) {
    return { ok: true, version: await getStateVersion(env), task: oldTask, entry: null };
  }
  if (user.role !== "admin") {
    if (!taskBelongsToUser(oldTask, user)) throw withStatus(403, `no permission to update task: ${oldTask.title || taskId}`);
    const forbiddenFields = changedFields.filter((field) => !DEVELOPER_DELIVERY_FIELDS.has(field));
    if (forbiddenFields.length) {
      throw withStatus(403, `developer can only update PR/test report fields: ${forbiddenFields.join(", ")}`);
    }
  }
  assertSchedulePatchHasReason(oldTask, fields, changedFields);

  const now = nowIso();
  const taskUpdates = {};
  let nextSegments = null;
  for (const field of changedFields) {
    if (field === "segments") {
      nextSegments = normalizePatchSegments(fields.segments, oldTask);
      if (nextSegments.length) {
        taskUpdates.start_date = nextSegments[0].start_date;
        taskUpdates.end_date = nextSegments[nextSegments.length - 1].end_date;
      }
      continue;
    }
    taskUpdates[field] = normalizePatchValue(field, fields[field]);
  }
  if (Object.keys(taskUpdates).length) {
    taskUpdates.updated_at = now;
    await updateTaskColumns(env, taskId, taskUpdates);
  }
  if (nextSegments) await replaceTaskSegments(env, taskId, nextSegments);

  const catalog = await getJsonMeta(env, "prCatalog", emptyPrCatalog());
  await syncTaskDeliveryRuleForTask(env, taskId, catalog.items || []);
  const version = await bumpStateVersion(env);
  const entry = payload.auditEntry || {
    ts: now,
    action: "task.patch",
    entity: "task",
    id: taskId,
    summary: `更新任务：${oldTask.title || taskId}`,
    detail: { fields: changedFields },
    source: "cloudflare-d1",
  };
  await insertAudit(env, { ...entry, source: "cloudflare-d1" });
  return { ok: true, version, entry, task: await getTaskById(env, taskId) };
}

function assertSchedulePatchHasReason(oldTask, fields, changedFields) {
  if (!changedFields.some((field) => field === "start_date" || field === "end_date" || field === "segments")) return;
  const noteReason = Object.prototype.hasOwnProperty.call(fields, "notes") && String(fields.notes || "").trim();
  const segmentReason = Array.isArray(fields.segments) && fields.segments.some((segment) => String(segment.reason || "").trim());
  if (noteReason || segmentReason) return;
  throw withStatus(400, `schedule change reason is required for task: ${oldTask.title || oldTask.id}`);
}

function normalizeTaskPatchFields(fields) {
  const next = {};
  for (const [field, value] of Object.entries(fields || {})) {
    if (!TASK_PATCH_FIELDS.has(field)) throw withStatus(400, `unsupported task field: ${field}`);
    next[field] = value;
  }
  return next;
}

function normalizePatchValue(field, value) {
  if (TASK_JSON_PATCH_FIELDS.has(field)) return Array.isArray(value) ? value : [];
  if (field === "special_id") return value || null;
  if (field === "position") return numberOr(value, 0);
  return String(value ?? "").trim();
}

function normalizePatchSegments(value, task) {
  const raw = Array.isArray(value) && value.length
    ? value
    : [{ start_date: task.start_date, end_date: task.end_date, reason: task.notes || "", position: 0 }];
  return raw
    .map((segment, index) => {
      const start = isYmd(segment.start_date) ? segment.start_date : task.start_date;
      const end = isYmd(segment.end_date) ? segment.end_date : start;
      return {
        id: String(segment.id || `seg-${task.id}-${index}`),
        start_date: start,
        end_date: end < start ? start : end,
        reason: String(segment.reason || ""),
        position: numberOr(segment.position, index),
      };
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((segment, index) => ({ ...segment, position: index }));
}

async function updateTaskColumns(env, taskId, updates) {
  const fields = Object.keys(updates);
  if (!fields.length) return;
  const assignments = fields.map((field) => `${field} = ?`).join(", ");
  const values = fields.map((field) => TASK_JSON_PATCH_FIELDS.has(field) ? toJson(updates[field]) : updates[field]);
  await env.DB.prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`).bind(...values, taskId).run();
}

async function replaceTaskSegments(env, taskId, segments) {
  const statements = [env.DB.prepare("DELETE FROM task_segments WHERE task_id = ?").bind(taskId)];
  segments.forEach((segment, index) => {
    statements.push(env.DB.prepare(
      "INSERT INTO task_segments(id, task_id, start_date, end_date, reason, position) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      segment.id || `seg-${taskId}-${index}`,
      taskId,
      segment.start_date,
      segment.end_date,
      segment.reason || "",
      numberOr(segment.position, index),
    ));
  });
  await env.DB.batch(statements);
}

async function getTaskById(env, taskId) {
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first();
  if (!task) return null;
  const segments = await selectAll(env, "SELECT id, task_id, start_date, end_date, reason, position FROM task_segments WHERE task_id = ? ORDER BY position, start_date", taskId);
  return {
    ...task,
    evidence: parseJson(task.evidence, []),
    dependencies: parseJson(task.dependencies, []),
    segments: segments.map((segment) => ({
      id: segment.id,
      start_date: segment.start_date,
      end_date: segment.end_date,
      reason: segment.reason || "",
      position: segment.position || 0,
    })),
  };
}

function normalizeTaskForInsert(task) {
  const now = nowIso();
  const startDate = isYmd(task.start_date) ? task.start_date : "2026-06-25";
  const endDate = isYmd(task.end_date) ? task.end_date : startDate;
  const next = {
    id: String(task.id || `task-${crypto.randomUUID().slice(0, 10)}`),
    title: String(task.title || "未命名任务").trim(),
    scope: String(task.scope || ""),
    target: String(task.target || ""),
    owner: String(task.owner || "待排人力"),
    status: String(task.status || "todo"),
    risk: String(task.risk || "中"),
    priority: String(task.priority || "P1"),
    group_id: String(task.group_id || ""),
    special_id: task.special_id || null,
    start_date: startDate,
    end_date: endDate < startDate ? startDate : endDate,
    evidence: Array.isArray(task.evidence) ? task.evidence : [],
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    pr_link: String(task.pr_link || ""),
    test_report: String(task.test_report || ""),
    notes: String(task.notes || ""),
    position: numberOr(task.position, 0),
    created_at: task.created_at || now,
    updated_at: task.updated_at || now,
  };
  next.segments = normalizePatchSegments(task.segments, next);
  return next;
}

async function insertTask(env, task) {
  await env.DB.prepare(
    `INSERT INTO tasks(
      id, title, scope, target, owner, status, risk, priority, group_id, special_id,
      start_date, end_date, evidence, dependencies, pr_link, test_report, notes,
      position, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    task.id,
    task.title,
    task.scope,
    task.target,
    task.owner,
    task.status,
    task.risk,
    task.priority,
    task.group_id,
    task.special_id,
    task.start_date,
    task.end_date,
    toJson(task.evidence),
    toJson(task.dependencies),
    task.pr_link,
    task.test_report,
    task.notes,
    task.position,
    task.created_at,
    task.updated_at,
  ).run();
  await replaceTaskSegments(env, task.id, task.segments);
}

const ENTITY_CONFIG = {
  groups: {
    singular: "group",
    table: "groups",
    label: "分组",
    fields: new Set(["title", "due_date", "start_date", "end_date", "position"]),
    select: "SELECT id, title, due_date, start_date, end_date, position FROM groups WHERE id = ?",
  },
  specials: {
    singular: "special",
    table: "specials",
    label: "专项",
    fields: new Set(["title", "group_id", "position", "collapsed"]),
    select: "SELECT id, title, group_id, position, collapsed FROM specials WHERE id = ?",
  },
  people: {
    singular: "person",
    table: "people",
    label: "人员",
    fields: new Set(["name", "position", "placeholder", "pl"]),
    select: "SELECT id, name, position, placeholder, pl FROM people WHERE id = ?",
  },
};

function entityConfig(type) {
  const config = ENTITY_CONFIG[type];
  if (!config) throw withStatus(404, "unsupported entity");
  return config;
}

function entitySingular(type) {
  return entityConfig(type).singular;
}

function entityLabel(type) {
  return entityConfig(type).label;
}

function entityDisplayName(type, item) {
  if (!item) return "";
  return type === "people" ? item.name : item.title;
}

function normalizeEntityForInsert(type, item) {
  if (type === "groups") {
    const due = isYmd(item.due_date) ? item.due_date : (isYmd(item.end_date) ? item.end_date : "2026-06-25");
    return {
      id: String(item.id || `group-${crypto.randomUUID().slice(0, 10)}`),
      title: String(item.title || "未命名分组").trim(),
      due_date: due,
      start_date: isYmd(item.start_date) ? item.start_date : due,
      end_date: isYmd(item.end_date) ? item.end_date : due,
      position: numberOr(item.position, 0),
    };
  }
  if (type === "specials") {
    return {
      id: String(item.id || `special-${crypto.randomUUID().slice(0, 10)}`),
      title: String(item.title || "专项：未命名").trim(),
      group_id: item.group_id || null,
      position: numberOr(item.position, 0),
      collapsed: item.collapsed ? 1 : 0,
    };
  }
  if (type === "people") {
    const name = String(item.name || "").trim();
    if (!name) throw withStatus(400, "person name is required");
    return {
      id: String(item.id || `person-${crypto.randomUUID().slice(0, 10)}`),
      name,
      position: numberOr(item.position, 0),
      placeholder: item.placeholder ? 1 : 0,
      pl: normalizePl(item.pl),
    };
  }
  throw withStatus(404, "unsupported entity");
}

function normalizeEntityPatchFields(type, fields) {
  const config = entityConfig(type);
  const next = {};
  for (const [field, value] of Object.entries(fields || {})) {
    if (!config.fields.has(field)) throw withStatus(400, `unsupported ${config.singular} field: ${field}`);
    next[field] = normalizeEntityValue(type, field, value);
  }
  return next;
}

function normalizeEntityValue(type, field, value) {
  if (field === "position") return numberOr(value, 0);
  if (field === "collapsed" || field === "placeholder") return value ? 1 : 0;
  if (field === "pl") return normalizePl(value);
  if (field === "group_id") return value || null;
  if (field === "due_date" || field === "start_date" || field === "end_date") {
    if (!isYmd(value)) throw withStatus(400, `${field} must be YYYY-MM-DD`);
    return value;
  }
  return String(value ?? "").trim();
}

async function insertEntity(env, type, item) {
  if (type === "groups") {
    await env.DB.prepare("INSERT INTO groups(id, title, due_date, start_date, end_date, position) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(item.id, item.title, item.due_date, item.start_date, item.end_date, item.position)
      .run();
    return;
  }
  if (type === "specials") {
    await env.DB.prepare("INSERT INTO specials(id, title, group_id, position, collapsed) VALUES (?, ?, ?, ?, ?)")
      .bind(item.id, item.title, item.group_id, item.position, item.collapsed ? 1 : 0)
      .run();
    return;
  }
  if (type === "people") {
    const duplicate = await env.DB.prepare("SELECT id FROM people WHERE name = ?").bind(item.name).first();
    if (duplicate) throw withStatus(409, "person already exists");
    await env.DB.prepare("INSERT INTO people(id, name, position, placeholder, pl) VALUES (?, ?, ?, ?, ?)")
      .bind(item.id, item.name, item.position, item.placeholder ? 1 : 0, normalizePl(item.pl))
      .run();
  }
}

async function getEntityById(env, type, id) {
  const row = await env.DB.prepare(entityConfig(type).select).bind(id).first();
  if (!row) return null;
  if (type === "people") return { ...row, pl: normalizePl(row.pl), placeholder: Boolean(row.placeholder) };
  if (type === "specials") return { ...row, collapsed: Boolean(row.collapsed) };
  return row;
}

async function applyEntityPatch(env, type, id, oldItem, fields, changedFields) {
  const updates = Object.fromEntries(changedFields.map((field) => [field, fields[field]]));
  if (type === "people" && changedFields.includes("name")) {
    const duplicate = await env.DB.prepare("SELECT id FROM people WHERE name = ? AND id <> ?").bind(fields.name, id).first();
    if (duplicate) throw withStatus(409, "person already exists");
    const statements = [entityUpdateStatement(env, type, id, updates)];
    const rows = await selectAll(env, "SELECT id, owner FROM tasks WHERE owner LIKE ?", `%${oldItem.name}%`);
    for (const row of rows) {
      const nextOwner = replaceOwnerName(row.owner, oldItem.name, fields.name);
      if (nextOwner !== row.owner) {
        statements.push(env.DB.prepare("UPDATE tasks SET owner = ?, updated_at = ? WHERE id = ?").bind(nextOwner, nowIso(), row.id));
      }
    }
    await env.DB.batch(statements);
    return;
  }
  await updateEntityColumns(env, type, id, updates);
}

async function updateEntityColumns(env, type, id, updates) {
  await entityUpdateStatement(env, type, id, updates).run();
}

function entityUpdateStatement(env, type, id, updates) {
  const config = entityConfig(type);
  const fields = Object.keys(updates);
  if (!fields.length) throw withStatus(400, "no fields to update");
  fields.forEach((field) => {
    if (!config.fields.has(field)) throw withStatus(400, `unsupported ${config.singular} field: ${field}`);
  });
  const assignments = fields.map((field) => `${field} = ?`).join(", ");
  const values = fields.map((field) => updates[field]);
  return env.DB.prepare(`UPDATE ${config.table} SET ${assignments} WHERE id = ?`).bind(...values, id);
}

async function applyEntityDelete(env, type, id, payload) {
  if (type === "groups") {
    const groups = await selectAll(env, "SELECT id FROM groups ORDER BY position, due_date");
    if (groups.length <= 1) throw withStatus(400, "at least one group is required");
    const fallbackId = payload.fallback_group_id || payload.detail?.fallback_group_id || groups.find((group) => group.id !== id)?.id;
    if (!fallbackId || fallbackId === id) throw withStatus(400, "fallback_group_id is required");
    await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET group_id = ? WHERE group_id = ?").bind(fallbackId, id),
      env.DB.prepare("UPDATE specials SET group_id = ? WHERE group_id = ?").bind(fallbackId, id),
      env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(id),
    ]);
    return { fallback_group_id: fallbackId };
  }
  if (type === "specials") {
    await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET special_id = NULL WHERE special_id = ?").bind(id),
      env.DB.prepare("DELETE FROM specials WHERE id = ?").bind(id),
    ]);
    return {};
  }
  if (type === "people") {
    const person = await getEntityById(env, type, id);
    const tasks = await selectAll(env, "SELECT id, title, owner FROM tasks WHERE owner LIKE ?", `%${person.name}%`);
    const linkedTasks = tasks.filter((task) => ownerStringContainsName(task.owner, person.name));
    if (linkedTasks.length) {
      throw withStatus(409, `person still owns ${linkedTasks.length} task(s)`);
    }
    await env.DB.prepare("DELETE FROM people WHERE id = ?").bind(id).run();
    return { name: person.name };
  }
  throw withStatus(404, "unsupported entity");
}

function replaceOwnerName(owner, oldName, newName) {
  return String(owner || "").split(/([、/,，;；&]+)/)
    .map((part) => part.trim() === oldName ? newName : part)
    .join("");
}

function ownerStringContainsName(owner, name) {
  return String(owner || "").split(/[、/,，;；&\s]+/).map((item) => item.trim()).includes(name);
}

async function requireAdminLike(request, env) {
  const adminToken = adminTokenFromRequest(request);
  if (adminToken && env.ADMIN_TOKEN && adminToken === env.ADMIN_TOKEN) {
    return { id: "admin-token", username: "admin-token", role: "admin", ownerName: "" };
  }
  const user = await requireUser(request, env);
  if (user.role !== "admin") throw withStatus(403, "admin permission required");
  return user;
}

async function requireUser(request, env) {
  const adminToken = adminTokenFromRequest(request);
  if (adminToken && env.ADMIN_TOKEN && adminToken === env.ADMIN_TOKEN) {
    return { id: "admin-token", username: "admin-token", role: "admin", ownerName: "" };
  }
  const token = bearerToken(request);
  if (!token) throw withStatus(401, "login required");
  const claims = await verifyToken(env, token);
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND active = 1").bind(claims.sub).first();
  if (!row) throw withStatus(401, "user disabled or not found");
  return publicUser(row);
}

async function authorizeStateChange(env, user, nextState) {
  if (user.role === "admin") return;
  const current = await exportState(env);
  const currentTasks = new Map((current.tasks || []).map((task) => [task.id, task]));
  const nextTasks = new Map((nextState.tasks || []).map((task) => [task.id, task]));
  assertSameDeveloperReadonlyCollection("project", current.project || DEFAULT_PROJECT, nextState.project || DEFAULT_PROJECT);
  assertSameDeveloperReadonlyCollection("repoScan", current.repoScan || {}, nextState.repoScan || {});
  assertSameDeveloperReadonlyCollection("groups", current.groups || [], nextState.groups || []);
  assertSameDeveloperReadonlyCollection("specials", current.specials || [], nextState.specials || []);
  assertSameDeveloperReadonlyCollection("people", current.people || [], nextState.people || []);
  if (currentTasks.size !== nextTasks.size) {
    throw withStatus(403, "developer can only update existing own tasks");
  }
  for (const [id, nextTask] of nextTasks.entries()) {
    const oldTask = currentTasks.get(id);
    if (!oldTask) throw withStatus(403, "developer can only update existing own tasks");
    const changedFields = developerChangedTaskFields(oldTask, nextTask);
    if (!changedFields.length) continue;
    if (!taskBelongsToUser(oldTask, user) && !taskBelongsToUser(nextTask, user)) {
      throw withStatus(403, `no permission to update task: ${nextTask.title || id}`);
    }
    const forbiddenFields = changedFields.filter((field) => !DEVELOPER_DELIVERY_FIELDS.has(field));
    if (forbiddenFields.length) {
      throw withStatus(403, `developer can only update PR/test report fields: ${forbiddenFields.join(", ")}`);
    }
  }
}

const DEVELOPER_DELIVERY_FIELDS = new Set(["pr_link", "test_report"]);
const DEVELOPER_DERIVED_FIELDS = new Set(["risk", "status", "updated_at"]);

function assertSameDeveloperReadonlyCollection(name, current, next) {
  if (!sameJson(current, next)) throw withStatus(403, `developer cannot update ${name}`);
}

function developerChangedTaskFields(oldTask, nextTask) {
  const fields = new Set([...Object.keys(oldTask || {}), ...Object.keys(nextTask || {})]);
  return [...fields].filter((field) => {
    if (DEVELOPER_DERIVED_FIELDS.has(field)) return false;
    return !sameJson(oldTask?.[field], nextTask?.[field]);
  });
}

function sameJson(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

function taskBelongsToUser(task, user) {
  const owner = String(task.owner || "");
  const ownerName = String(user.ownerName || user.displayName || user.username || "");
  return ownerName && owner.split(/[、/,，;；&\s]+/).map((item) => item.trim()).includes(ownerName);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    ownerName: row.owner_name || row.display_name || row.username,
    role: row.role || "developer",
    active: Boolean(row.active),
  };
}

async function selectAll(env, sql, ...params) {
  const statement = env.DB.prepare(sql);
  const result = params.length ? await statement.bind(...params).all() : await statement.all();
  return result.results || [];
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw withStatus(400, "invalid json");
  }
}

function jsonResponse(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
    },
  });
}

function errorResponse(request, env, status, message, extra = {}) {
  return jsonResponse(request, env, { ok: false, error: message, ...extra }, status);
}

function emptyResponse(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : (allowed.includes("*") ? "*" : allowed[0] || "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Admin-Token",
    "Vary": "Origin",
  };
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: encoder.encode(salt),
    iterations: PASSWORD_HASH_ITERATIONS,
    hash: "SHA-256",
  }, material, 256);
  return base64Url(new Uint8Array(bits));
}

async function verifyPassword(password, salt, expected) {
  return timingSafeEqual(await hashPassword(password, salt), expected);
}

async function signToken(env, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = base64UrlJson(payload);
  const head = base64UrlJson(header);
  const signature = await hmac(env, `${head}.${body}`);
  return `${head}.${body}.${signature}`;
}

async function verifyToken(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw withStatus(401, "invalid token");
  const expected = await hmac(env, `${parts[0]}.${parts[1]}`);
  if (!timingSafeEqual(expected, parts[2])) throw withStatus(401, "invalid token");
  const payload = JSON.parse(textFromBase64Url(parts[1]));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw withStatus(401, "token expired");
  return payload;
}

async function hmac(env, value) {
  const secret = env.AUTH_SECRET || env.ADMIN_TOKEN;
  if (!secret) throw withStatus(500, "AUTH_SECRET or ADMIN_TOKEN is not configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

function bearerToken(request) {
  return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
}

function adminTokenFromRequest(request) {
  return bearerToken(request) || request.headers.get("X-Admin-Token") || "";
}

function randomToken(bytes) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64Url(buffer);
}

function base64UrlJson(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textFromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function emptyPrCatalog() {
  return { generatedAt: "", sourceRepo: "flashserve/flash-linear-attention-npu", total: 0, items: [] };
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function nowIso() {
  return new Date().toISOString();
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePl(value) {
  const text = String(value || "").trim();
  return PL_OPTIONS.includes(text) ? text : DEFAULT_PL;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function withStatus(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
