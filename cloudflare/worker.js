const DEFAULT_PROJECT = {
  name: "flash-linear-attention-npu",
  repository: "https://github.com/flashserve/flash-linear-attention-npu",
  baselineDate: "2026-06-15",
  projectOwner: { name: "待填写", email: "待填写" },
};

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
      if (url.pathname === "/api/audit") {
        return jsonResponse(request, env, await listAudit(env, url));
      }
      if (url.pathname === "/api/pr-catalog") {
        return jsonResponse(request, env, await getJsonMeta(env, "prCatalog", emptyPrCatalog()));
      }
      if (url.pathname === "/api/login" && request.method === "POST") {
        return jsonResponse(request, env, await login(request, env));
      }
      if (url.pathname === "/api/me") {
        return jsonResponse(request, env, { ok: true, user: await requireUser(request, env) });
      }
      if (url.pathname === "/api/users" && request.method === "GET") {
        await requireAdminLike(request, env);
        return jsonResponse(request, env, await listUsers(env));
      }
      if (url.pathname === "/api/users" && request.method === "POST") {
        await requireAdminLike(request, env);
        return jsonResponse(request, env, await createUser(request, env), 201);
      }
      if (url.pathname === "/api/import" && request.method === "POST") {
        await requireAdminLike(request, env);
        const payload = await readJson(request);
        await replaceState(env, payload.state || payload);
        await replaceAudit(env, payload.audit || []);
        if (payload.prCatalog) await setJsonMeta(env, "prCatalog", payload.prCatalog);
        return jsonResponse(request, env, { ok: true, state: await exportState(env) });
      }
      if (url.pathname === "/api/save" && request.method === "POST") {
        const user = await requireUser(request, env);
        const payload = await readJson(request);
        if (!payload.state) return errorResponse(request, env, 400, "state is required");
        await authorizeStateChange(env, user, payload.state);
        await replaceState(env, payload.state);
        if (payload.prCatalog) await setJsonMeta(env, "prCatalog", payload.prCatalog);
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
          state: await exportState(env),
        });
      }
      return errorResponse(request, env, 404, "api not found");
    } catch (error) {
      const status = error.status || 500;
      return errorResponse(request, env, status, error.message || "internal error");
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
    project: parseJson(meta.project, DEFAULT_PROJECT),
    repoScan: parseJson(meta.repoScan, {}),
    groups: await selectAll(env, "SELECT * FROM groups ORDER BY position, due_date"),
    specials: await selectAll(env, "SELECT * FROM specials ORDER BY position, title"),
    people: (await selectAll(env, "SELECT * FROM people ORDER BY position, name")).map((person) => ({
      ...person,
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
      "INSERT INTO people(id, name, position, placeholder) VALUES (?, ?, ?, ?)"
    ).bind(
      person.id,
      person.name || "待排人力",
      numberOr(person.position, index),
      person.placeholder ? 1 : 0,
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
  const role = payload.role === "admin" ? "admin" : "developer";
  const salt = randomToken(18);
  const passwordHash = await hashPassword(password, salt);
  const id = payload.id || `user-${crypto.randomUUID().slice(0, 10)}`;
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO users(id, username, display_name, owner_name, role, password_hash, salt, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return { ok: true, user: publicUser(row) };
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
  if ((current.groups || []).length !== (nextState.groups || []).length
    || (current.specials || []).length !== (nextState.specials || []).length
    || (current.people || []).length !== (nextState.people || []).length
    || currentTasks.size !== nextTasks.size) {
    throw withStatus(403, "developer can only update existing own tasks");
  }
  for (const [id, nextTask] of nextTasks.entries()) {
    const oldTask = currentTasks.get(id);
    if (!oldTask) throw withStatus(403, "developer can only update existing own tasks");
    if (JSON.stringify(normalizeTaskForCompare(oldTask)) === JSON.stringify(normalizeTaskForCompare(nextTask))) continue;
    if (!taskBelongsToUser(oldTask, user) && !taskBelongsToUser(nextTask, user)) {
      throw withStatus(403, `no permission to update task: ${nextTask.title || id}`);
    }
  }
}

function normalizeTaskForCompare(task) {
  const { updated_at, ...rest } = task;
  return rest;
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

async function selectAll(env, sql) {
  const result = await env.DB.prepare(sql).all();
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

function errorResponse(request, env, status, message) {
  return jsonResponse(request, env, { ok: false, error: message }, status);
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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
    iterations: 120000,
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function withStatus(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
