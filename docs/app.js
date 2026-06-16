const state = { data: null, audit: [], filters: { q: "", risk: "", priority: "", status: "" } };

const $ = (selector) => document.querySelector(selector);

async function load() {
  const stamp = Date.now();
  const [dataRes, auditRes] = await Promise.all([
    fetch(`./project-state.json?v=${stamp}`),
    fetch(`./audit-log.jsonl?v=${stamp}`).catch(() => null),
  ]);
  if (!dataRes.ok) throw new Error("未读取到 project-state.json");
  state.data = await dataRes.json();
  state.audit = auditRes && auditRes.ok ? parseAudit(await auditRes.text()) : [];
  render();
}

function parseAudit(text) {
  return text.trim().split(/\n+/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean).slice(-20).reverse();
}

function filteredTasks() {
  const tasks = state.data?.tasks || [];
  return tasks.filter((task) => {
    const q = state.filters.q.toLowerCase();
    return (!q || [task.title, task.owner, task.scope].some((value) => String(value || "").toLowerCase().includes(q)))
      && (!state.filters.risk || task.risk === state.filters.risk)
      && (!state.filters.priority || task.priority === state.filters.priority)
      && (!state.filters.status || task.status === state.filters.status);
  });
}

function render() {
  const tasks = filteredTasks();
  const all = state.data.tasks || [];
  const high = all.filter((task) => task.risk === "高").length;
  const medium = all.filter((task) => task.risk === "中").length;
  const done = all.filter((task) => task.status === "done").length;
  $("#meta").textContent = `仓库数据更新时间：${state.data.generatedAt || "未知"} · 当前显示 ${tasks.length}/${all.length} 项`;
  $("#summary").innerHTML = [
    ["总任务", all.length],
    ["高风险", high],
    ["中风险", medium],
    ["已完成", done],
  ].map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join("");
  renderGantt(tasks);
  renderRows(tasks);
  renderAudit();
}

function renderGantt(tasks) {
  if (!tasks.length) {
    $("#gantt").innerHTML = `<p class="empty">没有符合筛选条件的任务。</p>`;
    return;
  }
  const dates = tasks.flatMap((task) => task.segments?.length
    ? task.segments.flatMap((segment) => [segment.start_date, segment.end_date])
    : [task.start_date, task.end_date]);
  const start = toDay(Math.min(...dates.map(Date.parse)));
  const end = toDay(Math.max(...dates.map(Date.parse)));
  const total = Math.max(1, daysBetween(start, end) + 1);
  $("#gantt").innerHTML = tasks.map((task) => {
    const bars = (task.segments?.length ? task.segments : [{ start_date: task.start_date, end_date: task.end_date }]).map((segment) => {
      const left = daysBetween(start, segment.start_date) / total * 100;
      const width = Math.max(1.2, (daysBetween(segment.start_date, segment.end_date) + 1) / total * 100);
      return `<span class="bar" data-risk="${task.risk}" style="left:${left}%;width:${width}%" title="${escapeHtml(segment.start_date)} ~ ${escapeHtml(segment.end_date)}"></span>`;
    }).join("");
    return `<div class="gantt-row"><div class="gantt-title">${escapeHtml(task.title)}</div><div class="track">${bars}</div></div>`;
  }).join("");
}

function renderRows(tasks) {
  $("#rows").innerHTML = tasks.map((task) => `
    <tr>
      <td><span class="tag ${riskClass(task.risk)}">${escapeHtml(task.risk)}</span></td>
      <td><span class="tag ${String(task.priority).toLowerCase()}">${escapeHtml(task.priority)}</span></td>
      <td>${escapeHtml(task.title)}</td>
      <td>${escapeHtml(task.owner)}</td>
      <td>${escapeHtml(groupTitle(task.group_id))}</td>
      <td>${escapeHtml(specialTitle(task.special_id))}</td>
      <td>${escapeHtml(task.start_date)} ~ ${escapeHtml(task.end_date)}</td>
      <td>${escapeHtml(task.status)}</td>
    </tr>
  `).join("");
}

function renderAudit() {
  $("#audit").innerHTML = state.audit.length
    ? state.audit.map((item) => `<div class="audit-item"><time>${escapeHtml(item.ts)}</time><div>${escapeHtml(item.summary || item.action)}</div></div>`).join("")
    : `<p class="empty">暂无变更日志。</p>`;
}

function groupTitle(id) {
  return state.data.groups.find((group) => group.id === id)?.title || "";
}

function specialTitle(id) {
  return id ? state.data.specials.find((special) => special.id === id)?.title || id : "普通事项";
}

function riskClass(value) {
  return ({ "高": "high", "中": "medium", "低": "low" })[value] || "medium";
}

function toDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

["q", "risk", "priority", "status"].forEach((id) => {
  $(`#${id}`).addEventListener(id === "q" ? "input" : "change", (event) => {
    state.filters[id] = event.target.value.trim();
    render();
  });
});
$("#refresh").addEventListener("click", load);

load().catch((error) => {
  $("#meta").textContent = `读取失败：${error.message}`;
});
