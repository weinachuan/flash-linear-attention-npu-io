const state = {
  tasks: [],
  groups: [],
  specials: [],
  filters: { q: "", risk: "", priority: "", status: "" },
};

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function qs(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function loadAll() {
  $("#health").textContent = "读取中";
  const [groups, specials, tasks] = await Promise.all([
    api("/api/groups"),
    api("/api/specials"),
    api(`/api/tasks${qs({
      q: state.filters.q,
      risk: state.filters.risk,
      priority: state.filters.priority,
      status: state.filters.status,
    })}`),
  ]);
  state.groups = groups;
  state.specials = specials;
  state.tasks = tasks;
  $("#health").textContent = "已连接";
  $("#taskCount").textContent = `${tasks.length} 项`;
  render();
}

function render() {
  renderSide();
  renderGantt();
  renderTable();
  fillDialogOptions();
}

function renderSide() {
  $("#groupList").innerHTML = state.groups.map((group) => `
    <div class="pill" data-group="${group.id}">
      <strong>${escapeHtml(group.title)}</strong>
      <small>${group.start_date} 至 ${group.end_date}</small>
    </div>
  `).join("");
  $("#specialList").innerHTML = state.specials.map((special) => `
    <div class="pill" data-special="${special.id}">
      <strong>${escapeHtml(special.title)}</strong>
      <small>${groupTitle(special.group_id)} · ${taskCountForSpecial(special.id)} 项</small>
    </div>
  `).join("");
}

function renderGantt() {
  if (!state.tasks.length) {
    $("#gantt").innerHTML = "<p>暂无任务</p>";
    return;
  }
  const dates = state.tasks.flatMap((task) => task.segments?.length
    ? task.segments.flatMap((seg) => [seg.start_date, seg.end_date])
    : [task.start_date, task.end_date]);
  const min = toDay(Math.min(...dates.map(Date.parse)));
  const max = toDay(Math.max(...dates.map(Date.parse)));
  const total = Math.max(1, daysBetween(min, max) + 1);
  $("#gantt").innerHTML = state.tasks.map((task) => {
    const segments = task.segments?.length ? task.segments : [{ start_date: task.start_date, end_date: task.end_date }];
    const bars = segments.map((seg) => {
      const left = daysBetween(min, seg.start_date) / total * 100;
      const width = Math.max(1.2, (daysBetween(seg.start_date, seg.end_date) + 1) / total * 100);
      return `<span class="gantt-bar" data-risk="${task.risk}" data-task="${task.id}" style="left:${left}%;width:${width}%" title="双击切分：${escapeHtml(task.title)}"></span>`;
    }).join("");
    return `<div class="gantt-row"><div class="gantt-title">${escapeHtml(task.title)}</div><div class="gantt-track">${bars}</div></div>`;
  }).join("");
  document.querySelectorAll(".gantt-bar").forEach((bar) => {
    bar.addEventListener("dblclick", () => openSplit(bar.dataset.task));
  });
}

function renderTable() {
  $("#taskRows").innerHTML = state.tasks.map((task) => `
    <tr data-task="${task.id}">
      <td><span class="risk risk-${riskClass(task.risk)}">${task.risk}</span></td>
      <td><span class="priority priority-${task.priority.toLowerCase()}">${task.priority}</span></td>
      <td class="title-cell"><input data-field="title" value="${escapeAttr(task.title)}"></td>
      <td><input data-field="owner" value="${escapeAttr(task.owner)}"></td>
      <td>${selectHtml("group_id", state.groups.map((g) => [g.id, g.title]), task.group_id)}</td>
      <td>${selectHtml("special_id", [["", "普通事项"], ...state.specials.map((s) => [s.id, s.title])], task.special_id || "")}</td>
      <td class="date-cell"><input type="date" data-field="start_date" value="${task.start_date}"> 至 <input type="date" data-field="end_date" value="${task.end_date}"></td>
      <td>${selectHtml("status", [["todo", "todo"], ["doing", "doing"], ["blocked", "blocked"], ["done", "done"]], task.status)}</td>
      <td><span class="ops"><button data-action="edit">详情</button><button data-action="save">保存</button><button class="danger" data-action="delete">删除</button></span></td>
    </tr>
  `).join("");

  document.querySelectorAll("#taskRows input,#taskRows select").forEach((control) => {
    control.addEventListener("change", () => control.closest("tr").classList.add("dirty"));
  });
  document.querySelectorAll("#taskRows button").forEach((button) => {
    button.addEventListener("click", () => handleRowAction(button));
  });
}

function handleRowAction(button) {
  const row = button.closest("tr");
  const task = state.tasks.find((item) => item.id === row.dataset.task);
  const action = button.dataset.action;
  if (action === "edit") openTaskDialog(task);
  if (action === "save") saveRow(row);
  if (action === "delete") deleteTask(task.id);
}

async function saveRow(row) {
  const payload = {};
  row.querySelectorAll("[data-field]").forEach((input) => {
    payload[input.dataset.field] = input.value.trim();
  });
  await api(`/api/tasks/${row.dataset.task}`, { method: "PATCH", body: JSON.stringify(payload) });
  await loadAll();
}

async function deleteTask(id) {
  if (!confirm("确认删除这个任务？")) return;
  await api(`/api/tasks/${id}`, { method: "DELETE" });
  await loadAll();
}

function openTaskDialog(task = null) {
  const form = $("#taskForm");
  form.reset();
  $("#dialogTitle").textContent = task ? "编辑任务" : "新增任务";
  form.id.value = task?.id || "";
  form.title.value = task?.title || "";
  form.risk.value = task?.risk || "中";
  form.priority.value = task?.priority || "P1";
  form.owner.value = task?.owner || "待填写";
  form.status.value = task?.status || "todo";
  form.group_id.value = task?.group_id || state.groups[0]?.id || "";
  form.special_id.value = task?.special_id || "";
  form.start_date.value = task?.start_date || state.groups[0]?.due_date || "2026-06-25";
  form.end_date.value = task?.end_date || form.start_date.value;
  form.scope.value = task?.scope || "";
  form.notes.value = task?.notes || "";
  $("#taskDialog").showModal();
}

async function saveDialog(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const id = payload.id;
  delete payload.id;
  const method = id ? "PATCH" : "POST";
  const path = id ? `/api/tasks/${id}` : "/api/tasks";
  await api(path, { method, body: JSON.stringify(payload) });
  $("#taskDialog").close();
  await loadAll();
}

function openSplit(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const form = $("#splitForm");
  form.reset();
  form.task_id.value = task.id;
  form.break_start.value = task.start_date;
  form.break_end.value = task.start_date;
  $("#splitDialog").showModal();
}

async function saveSplit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const taskId = payload.task_id;
  delete payload.task_id;
  await api(`/api/tasks/${taskId}/split`, { method: "POST", body: JSON.stringify(payload) });
  $("#splitDialog").close();
  await loadAll();
}

function fillDialogOptions() {
  const groupOptions = state.groups.map((group) => `<option value="${group.id}">${escapeHtml(group.title)}</option>`).join("");
  const specialOptions = `<option value="">普通事项</option>` + state.specials.map((special) => `<option value="${special.id}">${escapeHtml(special.title)}</option>`).join("");
  $("#taskForm select[name='group_id']").innerHTML = groupOptions;
  $("#taskForm select[name='special_id']").innerHTML = specialOptions;
}

async function createGroup() {
  const title = prompt("分组名称：", "新转测分组");
  if (!title) return;
  const due = prompt("截止日期 YYYY-MM-DD：", "2026-06-25");
  if (!due) return;
  await api("/api/groups", { method: "POST", body: JSON.stringify({ title, due_date: due, start_date: due, end_date: due }) });
  await loadAll();
}

async function createSpecial() {
  const title = prompt("专项名称：", "专项：新专项");
  if (!title) return;
  await api("/api/specials", { method: "POST", body: JSON.stringify({ title, group_id: state.groups[0]?.id }) });
  await loadAll();
}

async function exportJson() {
  const data = await api("/api/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "flash-gantt-export.json";
  link.click();
  URL.revokeObjectURL(url);
}

function selectHtml(field, options, value) {
  return `<select data-field="${field}">${options.map(([id, label]) => `<option value="${escapeAttr(id)}" ${id === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function groupTitle(id) {
  return state.groups.find((group) => group.id === id)?.title || "未分组";
}

function taskCountForSpecial(id) {
  return state.tasks.filter((task) => task.special_id === id).length;
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

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

$("#reloadBtn").addEventListener("click", loadAll);
$("#addBtn").addEventListener("click", () => openTaskDialog());
$("#addGroupBtn").addEventListener("click", createGroup);
$("#addSpecialBtn").addEventListener("click", createSpecial);
$("#exportBtn").addEventListener("click", exportJson);
$("#taskForm").addEventListener("submit", saveDialog);
$("#splitForm").addEventListener("submit", saveSplit);
$("#cancelTask").addEventListener("click", () => $("#taskDialog").close());
$("#cancelSplit").addEventListener("click", () => $("#splitDialog").close());
$("#searchInput").addEventListener("input", (event) => { state.filters.q = event.target.value.trim(); loadAll(); });
$("#riskFilter").addEventListener("change", (event) => { state.filters.risk = event.target.value; loadAll(); });
$("#priorityFilter").addEventListener("change", (event) => { state.filters.priority = event.target.value; loadAll(); });
$("#statusFilter").addEventListener("change", (event) => { state.filters.status = event.target.value; loadAll(); });

loadAll().catch((error) => {
  $("#health").textContent = "连接失败";
  alert(error.message);
});
