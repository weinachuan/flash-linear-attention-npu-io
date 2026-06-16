const REPO = { owner: "weinachuan", name: "flash-linear-attention-npu-io", branch: "main" };
const API_ROOT = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;
const DATA_PATHS = {
  state: "data/project-state.json",
  audit: "data/audit-log.jsonl",
  pageState: "docs/project-state.json",
  pageAudit: "docs/audit-log.jsonl",
};

const OPERATOR_RULES = [
  { id: "chunk_gated_delta_rule_fwd_h", label: "chunk_gated_delta_rule_fwd_h", aliases: ["chunk_gated_delta_rule_fwd_h", "fwd_h"] },
  { id: "chunk_fwd_o", label: "chunk_fwd_o", aliases: ["chunk_fwd_o", "fwd_o"] },
  { id: "recompute_wu_fwd", label: "recompute_wu_fwd", aliases: ["recompute_wu_fwd", "recompute_w_u", "recompute_wu", "recompute"] },
  { id: "chunk_bwd_dv_local", label: "chunk_bwd_dv_local", aliases: ["chunk_bwd_dv_local", "chunk_dv_local", "dv_local"] },
  { id: "chunk_bwd_dqkwg", label: "chunk_bwd_dqkwg", aliases: ["chunk_bwd_dqkwg", "dqkwg"] },
  { id: "chunk_gated_delta_rule_bwd_dhu", label: "chunk_gated_delta_rule_bwd_dhu", aliases: ["chunk_gated_delta_rule_bwd_dhu", "dhu"] },
  { id: "prepare_wy_repr_bwd_da", label: "prepare_wy_repr_bwd_da", aliases: ["prepare_wy_repr_bwd_da", "prepare_wy_bwd_da"] },
  { id: "prepare_wy_repr_bwd_full", label: "prepare_wy_repr_bwd_full", aliases: ["prepare_wy_repr_bwd_full", "prepare_wy_bwd_full"] },
  { id: "causal_conv1d_fwd", label: "causal_conv1d_fwd", aliases: ["causal_conv1d_fwd", "causal_conv1d TND", "TND 转 NTD"] },
  { id: "causal_conv1d_bwd", label: "causal_conv1d_bwd", aliases: ["causal_conv1d_bwd", "causal_conv1d bwd"] },
  { id: "solve_tril_npu", label: "solve_tril_npu", aliases: ["solve_tril_npu", "solve_tril", "solve_tri"] },
  { id: "kimi_delta_attention_triton", label: "kimi_delta_attention_triton", aliases: ["kimi_delta_attention", "KDA triton", "KDA"] },
];

const OPERATOR_OWNER_RULES = {
  chunk_fwd_o: [{ owner: "吴雨舒" }],
  chunk_gated_delta_rule_fwd_h: [{ owner: "方梓阳" }],
  recompute_wu_fwd: [{ until: "2026-06-30", owner: "方梓阳" }, { owner: "周云飞" }],
  chunk_bwd_dv_local: [{ until: "2026-06-18", owner: "陈琳鑫" }, { owner: "叶倩雯" }],
  chunk_bwd_dqkwg: [{ until: "2026-06-30", owner: "黄浚哲" }, { owner: "李佳敏" }],
  chunk_gated_delta_rule_bwd_dhu: [{ owner: "方梓阳" }],
  prepare_wy_repr_bwd_da: [{ owner: "杨子奇" }],
  prepare_wy_repr_bwd_full: [{ until: "2026-06-30", owner: "张硕累" }, { owner: "周云飞" }],
};

const state = {
  data: null,
  audit: [],
  token: sessionStorage.getItem("flashPagesToken") || "",
  dirtyTaskIds: new Set(),
  baseTimeline: { start: "", end: "", total: 1 },
  view: { start: "", end: "", total: 1 },
  timeline: { start: "", end: "", total: 1 },
  activePlanView: "timeline",
  filters: { q: "", risk: "", priority: "", owner: "", group_id: "", special_id: "", status: "" },
};

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
  ensurePeopleCatalog();
  render();
}

function parseAudit(text) {
  return text.trim().split(/\n+/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function filteredTasks() {
  const tasks = state.data?.tasks || [];
  return tasks.filter((task) => {
    const q = state.filters.q.toLowerCase();
    const ownerNames = taskOwnerNames(task);
    return (!q || [task.title, task.owner, task.scope, ownerNames.join(" ")].some((value) => String(value || "").toLowerCase().includes(q)))
      && (!state.filters.risk || task.risk === state.filters.risk)
      && (!state.filters.priority || task.priority === state.filters.priority)
      && (!state.filters.owner || ownerNames.includes(state.filters.owner))
      && (!state.filters.group_id || task.group_id === state.filters.group_id)
      && (!state.filters.special_id || (state.filters.special_id === "__none__" ? !task.special_id : task.special_id === state.filters.special_id))
      && (!state.filters.status || task.status === state.filters.status);
  });
}

function render() {
  const filtered = filteredTasks();
  const all = state.data.tasks || [];
  state.baseTimeline = computeTimelineRange();
  ensureTimelineView();
  const tasks = filtered.filter(taskIntersectsView);
  const high = all.filter((task) => task.risk === "高").length;
  const medium = all.filter((task) => task.risk === "中").length;
  const done = all.filter((task) => task.status === "done").length;
  $("#meta").textContent = `仓库数据更新时间：${state.data.generatedAt || "未知"} · 窗口 ${state.view.start} ~ ${state.view.end} · 当前显示 ${tasks.length}/${filtered.length}/${all.length} 项`;
  $("#summary").innerHTML = [
    ["总任务", all.length],
    ["高风险", high],
    ["中风险", medium],
    ["已完成", done],
  ].map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join("");
  document.body.classList.toggle("editing", Boolean(state.token));
  $("#token").value = state.token ? "********" : "";
  $("#logout").classList.toggle("hidden", !state.token);
  $("#editMode").classList.toggle("hidden", Boolean(state.token));
  updateEditStatus();
  renderPlanTabs();
  renderTimeAxis();
  renderGantt(tasks);
  renderPeopleView(tasks);
  renderOperatorView(tasks);
  renderTableFilters();
  renderRows(tasks);
  renderAdmin();
  renderAudit();
}

function renderPlanTabs() {
  document.querySelectorAll("[data-plan-tab]").forEach((button) => {
    const active = button.dataset.planTab === state.activePlanView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.onclick = () => {
      state.activePlanView = button.dataset.planTab;
      renderPlanTabs();
    };
  });
  document.querySelectorAll("[data-plan-view]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.planView === state.activePlanView);
  });
}

function renderTableFilters() {
  const columns = [
    tableFilterSelect("risk", [["", "全部"], ["高", "高"], ["中", "中"], ["低", "低"]]),
    tableFilterSelect("priority", [["", "全部"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"]]),
    `<th><input data-table-filter="q" type="search" placeholder="筛事项" value="${escapeAttr(state.filters.q)}"></th>`,
    tableFilterSelect("owner", [["", "全部"], ...ownerFilterOptions()]),
    tableFilterSelect("group_id", [["", "全部"], ...state.data.groups.map((group) => [group.id, group.title])]),
    tableFilterSelect("special_id", [["", "全部"], ["__none__", "普通事项"], ...state.data.specials.map((special) => [special.id, special.title])]),
    `<th></th>`,
    `<th></th>`,
    `<th></th>`,
    tableFilterSelect("status", [["", "全部"], ["todo", "todo"], ["doing", "doing"], ["blocked", "blocked"], ["done", "done"]]),
    `<th class="edit-only"><button type="button" data-clear-filters>清空</button></th>`,
  ];
  $("#tableFilters").innerHTML = columns.join("");
  document.querySelectorAll("[data-table-filter]").forEach((control) => {
    control.addEventListener("input", updateTableFilter);
    control.addEventListener("change", updateTableFilter);
  });
  document.querySelector("[data-clear-filters]")?.addEventListener("click", clearFilters);
}

function tableFilterSelect(field, options) {
  const seen = new Set();
  const normalized = options.filter(([id]) => {
    const key = String(id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return `<th><select data-table-filter="${field}">${normalized.map(([id, label]) => `<option value="${escapeAttr(id)}" ${state.filters[field] === id ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></th>`;
}

function uniqueTaskValues(field) {
  return [...new Set((state.data.tasks || []).map((task) => task[field]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
}

function ownerFilterOptions() {
  return uniqueStrings([
    ...(state.data.tasks || []).flatMap((task) => taskOwnerNames(task)),
    ...operatorOwnerRuleNames(),
  ])
    .filter(isSelectableOwnerName)
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => [name, name]);
}

function operatorOwnerRuleNames() {
  return uniqueStrings(Object.values(OPERATOR_OWNER_RULES).flat().map((rule) => rule.owner));
}

function isSelectableOwnerName(name) {
  return Boolean(name && !/[、/,，;；&]/.test(name) && !isPlaceholderOwner(name));
}

function updateTableFilter(event) {
  state.filters[event.target.dataset.tableFilter] = event.target.value.trim();
  syncToolbarFilters();
  render();
}

function clearFilters() {
  Object.keys(state.filters).forEach((key) => { state.filters[key] = ""; });
  syncToolbarFilters();
  render();
}

function syncToolbarFilters() {
  ["q", "risk", "priority", "status"].forEach((id) => {
    const control = $(`#${id}`);
    if (control) control.value = state.filters[id] || "";
  });
}

function computeTimelineRange() {
  const dates = [];
  (state.data?.tasks || []).forEach((task) => {
    taskSegments(task).forEach((segment) => {
      if (segment.start_date) dates.push(segment.start_date);
      if (segment.end_date) dates.push(segment.end_date);
    });
  });
  (state.data?.groups || []).forEach((group) => {
    [group.start_date, group.end_date, group.due_date].forEach((date) => {
      if (date) dates.push(date);
    });
  });
  [state.view.start, state.view.end].forEach((date) => {
    if (date) dates.push(date);
  });
  const parsed = dates.map(Date.parse).filter(Number.isFinite);
  if (!parsed.length) {
    const today = toDay(Date.now());
    return { start: today, end: today, total: 1 };
  }
  const start = toDay(Math.min(...parsed));
  const end = toDay(Math.max(...parsed));
  return { start, end, total: Math.max(1, daysBetween(start, end) + 1) };
}

function computeDataTimelineRange() {
  const dates = [];
  (state.data?.tasks || []).forEach((task) => {
    taskSegments(task).forEach((segment) => {
      if (segment.start_date) dates.push(segment.start_date);
      if (segment.end_date) dates.push(segment.end_date);
    });
  });
  (state.data?.groups || []).forEach((group) => {
    [group.start_date, group.end_date, group.due_date].forEach((date) => {
      if (date) dates.push(date);
    });
  });
  const parsed = dates.map(Date.parse).filter(Number.isFinite);
  if (!parsed.length) {
    const today = toDay(Date.now());
    return { start: today, end: today, total: 1 };
  }
  const start = toDay(Math.min(...parsed));
  const end = toDay(Math.max(...parsed));
  return { start, end, total: Math.max(1, daysBetween(start, end) + 1) };
}

function ensureTimelineView() {
  const full = state.baseTimeline;
  if (!state.view.start || !state.view.end) {
    setTimelineView(0, full.total - 1);
    return;
  }
  const rawStart = daysBetween(full.start, state.view.start);
  const rawEnd = daysBetween(full.start, state.view.end);
  const startOffset = Number.isFinite(rawStart) ? rawStart : 0;
  const endOffset = Number.isFinite(rawEnd) ? rawEnd : full.total - 1;
  setTimelineView(startOffset, endOffset);
}

function setTimelineView(startOffset, endOffset) {
  const full = state.baseTimeline;
  const safeStart = clamp(Math.round(startOffset), 0, Math.max(0, full.total - 1));
  const safeEnd = clamp(Math.round(endOffset), safeStart, Math.max(safeStart, full.total - 1));
  const start = addDays(full.start, safeStart);
  const end = addDays(full.start, safeEnd);
  state.view = { start, end, total: safeEnd - safeStart + 1 };
  state.timeline = { ...state.view };
}

function taskSegments(task) {
  return task.segments?.length ? task.segments : [{ start_date: task.start_date, end_date: task.end_date, reason: task.notes || "", position: 0 }];
}

function taskIntersectsView(task) {
  return taskSegments(task).some((segment) => datesOverlap(segment.start_date, segment.end_date, state.view.start, state.view.end));
}

function datesOverlap(startA, endA, startB, endB) {
  return Boolean(startA && endA && startB && endB && startA <= endB && endA >= startB);
}

function renderTimeAxis() {
  const full = state.baseTimeline;
  const milestones = timelineMilestones();
  const ticks = timelineTicks(milestones);
  $("#timeAxis").innerHTML = `
    <div class="timeline-head">
      <div>
        <strong>DDL 与时间窗口</strong>
        <span>拖动绿色窗口条可平移，拖动两端可缩放；也可以直接输入更长日期范围</span>
      </div>
      <div class="timeline-actions">
        <label>开始 <input id="viewStartDate" type="date" value="${escapeAttr(state.view.start)}"></label>
        <label>结束 <input id="viewEndDate" type="date" value="${escapeAttr(state.view.end)}"></label>
        <button id="expandStart" type="button">前扩 7 天</button>
        <button id="expandEnd" type="button">后扩 7 天</button>
        <button id="resetTimeline" type="button">显示全量</button>
      </div>
    </div>
    <div id="timelineScale" class="timeline-scale">
      <div class="axis-line"></div>
      ${ticks.map((offset) => `
        <span class="axis-tick" style="left:${slotCenterPct(offset, full.total)}%">
          <i></i><em>${formatMonthDay(addDays(full.start, offset))}</em>
        </span>
      `).join("")}
      ${milestones.map((item) => `
        <span class="ddl-marker" style="left:${slotCenterPct(item.offset, full.total)}%" title="${escapeAttr(item.title)}：${escapeAttr(item.date)}">
          <i></i>
          <b>DDL</b>
          <em>${escapeHtml(formatMonthDay(item.date))}</em>
          <small>${escapeHtml(item.title)}</small>
        </span>
      `).join("")}
      <div class="timeline-window" data-axis-mode="move">
        <span class="timeline-window-edge" data-axis-mode="start"></span>
        <span class="timeline-window-label" data-axis-mode="move" id="viewText"></span>
        <span class="timeline-window-edge" data-axis-mode="end"></span>
      </div>
    </div>
  `;
  paintTimelineWindow();
  attachTimelineDrag();
  $("#viewStartDate").addEventListener("change", applyTimelineDateInputs);
  $("#viewEndDate").addEventListener("change", applyTimelineDateInputs);
  $("#expandStart").addEventListener("click", () => setAbsoluteTimelineView(addDays(state.view.start, -7), state.view.end));
  $("#expandEnd").addEventListener("click", () => setAbsoluteTimelineView(state.view.start, addDays(state.view.end, 7)));
  $("#resetTimeline").addEventListener("click", () => {
    const dataRange = computeDataTimelineRange();
    state.baseTimeline = dataRange;
    state.view = { start: "", end: "", total: 1 };
    setTimelineView(0, dataRange.total - 1);
    render();
  });
}

function applyTimelineDateInputs() {
  const start = $("#viewStartDate").value;
  const end = $("#viewEndDate").value;
  setAbsoluteTimelineView(start, end);
}

function setAbsoluteTimelineView(start, end) {
  if (!isYmd(start) || !isYmd(end)) {
    alert("请输入有效日期。");
    return;
  }
  const nextStart = minDate(start, end);
  const nextEnd = maxDate(start, end);
  state.view = { start: nextStart, end: nextEnd, total: Math.max(1, daysBetween(nextStart, nextEnd) + 1) };
  state.baseTimeline = computeTimelineRange();
  ensureTimelineView();
  render();
}

function timelineMilestones() {
  const full = state.baseTimeline;
  return (state.data?.groups || []).map((group) => {
    const date = group.due_date || group.end_date || group.start_date;
    const offset = date ? daysBetween(full.start, date) : NaN;
    return { title: group.title, date, offset };
  }).filter((item) => item.date && Number.isFinite(item.offset) && item.offset >= 0 && item.offset < full.total)
    .sort((a, b) => a.offset - b.offset || a.title.localeCompare(b.title, "zh-CN"));
}

function timelineTicks(milestones) {
  const full = state.baseTimeline;
  const step = full.total <= 18 ? 1 : Math.ceil(full.total / 16);
  const offsets = new Set([0, Math.max(0, full.total - 1), ...milestones.map((item) => item.offset)]);
  for (let offset = 0; offset < full.total; offset += step) offsets.add(offset);
  return [...offsets].filter((offset) => offset >= 0 && offset < full.total).sort((a, b) => a - b);
}

function attachTimelineDrag() {
  const scale = $("#timelineScale");
  if (!scale) return;
  scale.addEventListener("pointerdown", (event) => {
    const target = event.target.closest("[data-axis-mode]");
    const mode = target?.dataset.axisMode || "jump";
    const full = state.baseTimeline;
    const startOffset = daysBetween(full.start, state.view.start);
    const endOffset = daysBetween(full.start, state.view.end);
    const span = endOffset - startOffset + 1;
    const firstOffset = pointerToTimelineOffset(event, scale);
    const grabOffset = firstOffset - startOffset;
    event.preventDefault();

    if (mode === "jump") {
      const nextStart = clamp(firstOffset - Math.floor(span / 2), 0, Math.max(0, full.total - span));
      setTimelineView(nextStart, nextStart + span - 1);
      render();
      return;
    }

    scale.setPointerCapture(event.pointerId);
    scale.classList.add("dragging");
    const move = (moveEvent) => {
      const offset = pointerToTimelineOffset(moveEvent, scale);
      let nextStart = startOffset;
      let nextEnd = endOffset;
      if (mode === "move") {
        nextStart = clamp(offset - grabOffset, 0, Math.max(0, full.total - span));
        nextEnd = nextStart + span - 1;
      } else if (mode === "start") {
        nextStart = clamp(offset, 0, endOffset);
      } else {
        nextEnd = clamp(offset, startOffset, full.total - 1);
      }
      setTimelineView(nextStart, nextEnd);
      paintTimelineWindow();
    };
    const finish = () => {
      scale.removeEventListener("pointermove", move);
      scale.removeEventListener("pointerup", finish);
      scale.removeEventListener("pointercancel", finish);
      scale.classList.remove("dragging");
      render();
    };
    scale.addEventListener("pointermove", move);
    scale.addEventListener("pointerup", finish);
    scale.addEventListener("pointercancel", finish);
  });
}

function pointerToTimelineOffset(event, scale) {
  const rect = scale.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  return clamp(Math.floor(ratio * state.baseTimeline.total), 0, state.baseTimeline.total - 1);
}

function paintTimelineWindow() {
  const full = state.baseTimeline;
  const startOffset = daysBetween(full.start, state.view.start);
  const endOffset = daysBetween(full.start, state.view.end);
  const left = slotStartPct(startOffset, full.total);
  const width = Math.max(1.5, (endOffset - startOffset + 1) / Math.max(1, full.total) * 100);
  const windowEl = document.querySelector(".timeline-window");
  const label = document.querySelector(".timeline-window-label");
  if (windowEl) {
    windowEl.style.left = `${left}%`;
    windowEl.style.width = `${width}%`;
  }
  if (label) label.textContent = `${formatMonthDay(state.view.start)} ~ ${formatMonthDay(state.view.end)}`;
  const viewText = $("#viewText");
  if (viewText) viewText.textContent = `窗口：${state.view.start} ~ ${state.view.end}（${state.view.total} 天）`;
}

function slotCenterPct(offset, total) {
  return ((offset + 0.5) / Math.max(1, total)) * 100;
}

function slotStartPct(offset, total) {
  return (offset / Math.max(1, total)) * 100;
}

function renderGantt(tasks) {
  if (!tasks.length) {
    $("#gantt").innerHTML = `<p class="empty">当前时间窗口内没有符合筛选条件的任务。</p>`;
    return;
  }
  const { start, end, total } = state.timeline;
  $("#gantt").innerHTML = tasks.map((task) => {
    const bars = taskSegments(task).map((segment, index) => {
      if (!datesOverlap(segment.start_date, segment.end_date, start, end)) return "";
      const clippedStart = maxDate(segment.start_date, start);
      const clippedEnd = minDate(segment.end_date, end);
      const left = daysBetween(start, clippedStart) / total * 100;
      const width = Math.max(1.2, (daysBetween(clippedStart, clippedEnd) + 1) / total * 100);
      return `<span class="bar" data-risk="${task.risk}" data-task-id="${escapeAttr(task.id)}" data-segment-index="${index}" style="left:${left}%;width:${width}%" title="${escapeHtml(displayTaskTitle(task))}：${escapeHtml(segment.start_date)} ~ ${escapeHtml(segment.end_date)}；编辑模式下拖动移动，边缘拉伸"></span>`;
    }).join("");
    return `<div class="gantt-row"><div class="gantt-title">${escapeHtml(displayTaskTitle(task))}</div><div class="track">${bars}</div></div>`;
  }).join("");
  document.querySelectorAll(".bar").forEach((bar) => {
    bar.addEventListener("dblclick", () => {
      if (state.token) splitTask(bar.dataset.taskId);
    });
    attachGanttDrag(bar);
  });
}

function renderPeopleView(tasks) {
  const days = dateList(state.view.start, state.view.end);
  const people = peopleForTasks(tasks);
  if (!tasks.length) {
    $("#peopleView").innerHTML = `<p class="empty">当前时间窗口内没有符合筛选条件的人力安排。</p>`;
    return;
  }
  $("#peopleView").innerHTML = `
    <div class="view-note">按当前时间窗口展示每日人力占用；同一天多个事项会叠放显示。</div>
    <div class="people-grid-wrap">
      <table class="people-grid">
        <thead>
          <tr>
            <th class="people-owner-head">人员</th>
            ${days.map((day) => `<th><strong>${formatMonthDay(day)}</strong><small>${weekdayName(day)}</small></th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${people.map((person) => `
            <tr>
              <th class="people-owner">${personChipHtml(person)}</th>
              ${days.map((day) => `<td>${tasksForPersonOnDay(tasks, person, day).map(taskChipHtml).join("")}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderOperatorView(tasks) {
  const rows = operatorRows(tasks);
  if (!rows.length) {
    $("#operatorView").innerHTML = `<p class="empty">当前时间窗口内没有符合筛选条件的算子事项。</p>`;
    return;
  }
  const { start, end, total } = state.timeline;
  $("#operatorView").innerHTML = `
    <div class="view-note">按源仓算子全名聚合；每个算子一行，行内展示该算子的多个特性交付条。</div>
    <div class="operator-gantt">
      ${rows.map((row) => {
        const bars = row.items.map((item, index) => {
          const clippedStart = maxDate(item.task.start_date, start);
          const clippedEnd = minDate(item.task.end_date, end);
          const left = daysBetween(start, clippedStart) / total * 100;
          const width = Math.max(2, (daysBetween(clippedStart, clippedEnd) + 1) / total * 100);
          return `
            <span class="operator-bar ${riskClass(item.task.risk)}" style="left:${left}%;width:${width}%;top:${index * 26 + 6}px" title="${escapeAttr(displayTaskTitle(item.task))} · ${escapeAttr(item.task.start_date)} ~ ${escapeAttr(item.task.end_date)}">
              <b>${escapeHtml(featureTitle(item.task, item.operator))}</b>
              <small>${escapeHtml(formatMonthDay(item.task.end_date))}</small>
            </span>
          `;
        }).join("");
        return `
          <div class="operator-gantt-row" style="--lane-count:${Math.max(1, row.items.length)}">
            <div class="operator-name">
              <strong>${escapeHtml(row.operator.label)}</strong>
              <span>${row.items.length} 项</span>
            </div>
            <div class="operator-track">${bars}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function operatorRows(tasks) {
  const rows = new Map();
  tasks.forEach((task) => {
    taskOperators(task).forEach((operator) => {
      if (!rows.has(operator.id)) rows.set(operator.id, { operator, items: [] });
      rows.get(operator.id).items.push({ task, operator });
    });
  });
  return [...rows.values()].sort((a, b) => a.operator.label.localeCompare(b.operator.label, "zh-CN"))
    .map((row) => ({
      ...row,
      items: [...row.items].sort((a, b) => a.task.end_date.localeCompare(b.task.end_date) || displayTaskTitle(a.task).localeCompare(displayTaskTitle(b.task), "zh-CN")),
    }));
}

function tasksForPersonOnDay(tasks, person, day) {
  return tasks.filter((task) => taskPeople(task, day).some((item) => item.id === person.id) && taskSegments(task).some((segment) => segment.start_date <= day && segment.end_date >= day));
}

function taskChipHtml(task) {
  return `<span class="work-chip ${riskClass(task.risk)}" title="${escapeAttr(displayTaskTitle(task))}">${escapeHtml(compactTaskTitle(task))}</span>`;
}

function featureTitle(task, operator = taskOperators(task)[0]) {
  let title = task.title || "";
  if (title.includes("fwd_h 与 fwd_o")) title = title.replace("fwd_h 与 fwd_o", "");
  if (title.startsWith("多算子")) return title;
  const aliases = operator?.aliases || [];
  const matched = aliases.find((alias) => title.toLowerCase().startsWith(alias.toLowerCase()));
  if (matched) title = title.slice(matched.length);
  title = title.replace(/^新增\s*/, "").replace(/^算子\s*/, "").trim();
  return title || displayTaskTitle(task);
}

function taskOperators(task) {
  const title = task.title || "";
  if (/性能看板|一键编报|一键编包|ops\s*目录整改/i.test(title)) return [];
  if (title.startsWith("多算子")) {
    return ["chunk_fwd_o", "chunk_gated_delta_rule_fwd_h", "chunk_gated_delta_rule_bwd_dhu", "recompute_wu_fwd", "chunk_bwd_dv_local", "chunk_bwd_dqkwg"].map(operatorById).filter(Boolean);
  }
  const lower = title.toLowerCase();
  const matched = [];
  OPERATOR_RULES.forEach((operator) => {
    if (operator.aliases.some((alias) => lower.includes(alias.toLowerCase()))) matched.push(operator);
  });
  return uniqueBy(matched, "id");
}

function operatorById(id) {
  return OPERATOR_RULES.find((operator) => operator.id === id);
}

function operatorOwnerName(operatorId, referenceDate) {
  const rules = OPERATOR_OWNER_RULES[operatorId] || [];
  if (!rules.length) return "";
  return (rules.find((rule) => !rule.until || !referenceDate || referenceDate <= rule.until) || rules[rules.length - 1]).owner || "";
}

function operatorOwnerNamesForTask(task, referenceDate = "") {
  const operators = task ? taskOperators(task) : [];
  if (!operators.length) return [];
  const dates = referenceDate ? [referenceDate] : ownerReferenceDates(task);
  return uniqueStrings(operators.flatMap((operator) => dates.map((date) => operatorOwnerName(operator.id, date))));
}

function ownerReferenceDates(task) {
  const dates = [];
  taskSegments(task).forEach((segment) => {
    if (segment.start_date) dates.push(segment.start_date);
    if (segment.end_date) dates.push(segment.end_date);
    Object.values(OPERATOR_OWNER_RULES).flat().forEach((rule) => {
      if (rule.until && segment.start_date <= rule.until && segment.end_date > rule.until) dates.push(addDays(rule.until, 1));
    });
  });
  return uniqueStrings(dates.length ? dates : [task?.start_date || state.view.start]).filter(Boolean).sort();
}

function displayTaskTitle(task) {
  const operators = taskOperators(task);
  if (!operators.length) return task.title || "";
  let title = task.title || "";
  const placeholders = [];
  operators.forEach((operator) => {
    operator.aliases
      .slice()
      .sort((a, b) => b.length - a.length)
      .forEach((alias) => {
        title = title.replace(new RegExp(escapeRegExp(alias), "ig"), () => {
          const key = `__OP_${placeholders.length}__`;
          placeholders.push([key, operator.label]);
          return key;
        });
      });
  });
  placeholders.forEach(([key, label]) => { title = title.replaceAll(key, label); });
  title = title.replace(/prepare_wy_repr_bwd_full\s+prepare_wy_repr_bwd_full/ig, "prepare_wy_repr_bwd_full");
  return title;
}

function compactTaskTitle(task) {
  const operators = taskOperators(task);
  if (!operators.length) return task.title || "";
  if (operators.length > 1) return featureTitle(task, operators[0]);
  return featureTitle(task, operators[0]);
}

function ensurePeopleCatalog() {
  const existing = new Map((state.data.people || []).map((person) => [person.name, person]));
  const names = [];
  (state.data.tasks || []).forEach((task) => taskOwnerNames(task).forEach((name) => {
    if (!names.includes(name)) names.push(name);
  }));
  const people = [];
  names.forEach((name, index) => {
    const current = existing.get(name);
    people.push({
      id: current?.id || `P${String(index + 1).padStart(2, "0")}`,
      name,
      position: Number.isFinite(current?.position) ? current.position : index,
      placeholder: isPlaceholderOwner(name),
    });
  });
  state.data.people = people.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

function normalizeOwnerName(name) {
  const value = String(name || "").trim();
  return !value || value === "待填写" || value === "待排人力" ? "待排人力" : value;
}

function splitOwnerNames(owner, task = null, referenceDate = "") {
  const raw = normalizeOwnerName(owner);
  return uniqueStrings(raw.split(/[、/,，;；&]+/).flatMap((name) => {
    const normalized = normalizeOwnerName(name);
    if (normalized !== "对应算子责任人") return [normalized];
    const owners = operatorOwnerNamesForTask(task, referenceDate);
    return owners.length ? owners : [normalized];
  }).filter(Boolean));
}

function taskOwnerNames(task, referenceDate = "") {
  return splitOwnerNames(task?.owner, task, referenceDate);
}

function taskPeople(task, referenceDate = "") {
  const byName = new Map((state.data.people || []).map((person) => [person.name, person]));
  return taskOwnerNames(task, referenceDate).map((name) => byName.get(name) || { id: "P??", name, position: 9999, placeholder: isPlaceholderOwner(name) });
}

function peopleForTasks(tasks) {
  return uniqueBy(tasks.flatMap(taskPeople), "id").sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

function personChipHtml(person) {
  const klass = person.placeholder ? " placeholder" : "";
  return `<span class="person-chip${klass}"><em>${escapeHtml(person.name)}</em></span>`;
}

function ownerChipsHtml(task) {
  return taskPeople(task).map(personChipHtml).join("");
}

function isPlaceholderOwner(name) {
  return /待填|待排|对应/.test(name);
}

function uniqueBy(items, field) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item[field];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function dateList(start, end) {
  const result = [];
  for (let day = start; day <= end; day = addDays(day, 1)) result.push(day);
  return result;
}

function weekdayName(value) {
  return ["日", "一", "二", "三", "四", "五", "六"][dateFromYmd(value).getUTCDay()];
}

function linkListHtml(value, label) {
  const links = parseLinks(value);
  if (!links.length) return `<span class="muted-cell">-</span>`;
  return links.map((link, index) => `<a class="link-pill" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}${links.length > 1 ? index + 1 : ""}</a>`).join("");
}

function parseLinks(value) {
  return String(value || "").split(/[\s,，;；]+/).map((item) => item.trim()).filter((item) => /^https?:\/\//i.test(item));
}

function renderRows(tasks) {
  $("#rows").innerHTML = tasks.map((task) => {
    if (!state.token) {
      return `
        <tr>
          <td><span class="tag ${riskClass(task.risk)}">${escapeHtml(task.risk)}</span></td>
          <td><span class="tag ${String(task.priority).toLowerCase()}">${escapeHtml(task.priority)}</span></td>
          <td>${escapeHtml(displayTaskTitle(task))}</td>
          <td>${ownerChipsHtml(task)}</td>
          <td>${escapeHtml(groupTitle(task.group_id))}</td>
          <td>${escapeHtml(specialTitle(task.special_id))}</td>
          <td>${escapeHtml(task.start_date)} ~ ${escapeHtml(task.end_date)}</td>
          <td>${linkListHtml(task.pr_link, "PR")}</td>
          <td>${linkListHtml(task.test_report, "报告")}</td>
          <td>${escapeHtml(task.status)}</td>
          <td class="edit-only"></td>
        </tr>
      `;
    }
    return `
      <tr data-task-id="${escapeAttr(task.id)}" class="${state.dirtyTaskIds.has(task.id) ? "dirty" : ""}">
        <td>${selectHtml("risk", [["高","高"],["中","中"],["低","低"]], task.risk)}</td>
        <td>${selectHtml("priority", [["P0","P0"],["P1","P1"],["P2","P2"]], task.priority)}</td>
        <td><input class="title-input" data-field="title" value="${escapeAttr(task.title)}"></td>
        <td><input data-field="owner" value="${escapeAttr(task.owner)}"><div class="owner-preview">${ownerChipsHtml(task)}</div></td>
        <td>${selectHtml("group_id", state.data.groups.map((g) => [g.id, g.title]), task.group_id)}</td>
        <td>${selectHtml("special_id", [["","普通事项"], ...state.data.specials.map((s) => [s.id, s.title])], task.special_id || "")}</td>
        <td><input type="date" data-field="start_date" value="${escapeAttr(task.start_date)}"> ~ <input type="date" data-field="end_date" value="${escapeAttr(task.end_date)}"></td>
        <td><input class="link-input" data-field="pr_link" placeholder="PR URL" value="${escapeAttr(task.pr_link || "")}"></td>
        <td><input class="link-input" data-field="test_report" placeholder="报告 URL" value="${escapeAttr(task.test_report || "")}"></td>
        <td>${selectHtml("status", [["todo","todo"],["doing","doing"],["blocked","blocked"],["done","done"]], task.status)}</td>
        <td class="edit-only"><span class="ops"><button data-action="save">保存</button><button data-action="split">切分</button><button class="danger" data-action="delete">删除</button></span></td>
      </tr>
    `;
  }).join("");
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleTaskAction(button).catch(showError)));
  document.querySelectorAll("#rows [data-field]").forEach((control) => control.addEventListener("change", () => markTaskDirty(control)));
}

function attachGanttDrag(bar) {
  bar.addEventListener("mousemove", (event) => {
    if (!state.token || bar.classList.contains("dragging")) return;
    bar.style.cursor = event.offsetX <= 8 || bar.offsetWidth - event.offsetX <= 8 ? "ew-resize" : "grab";
  });
  bar.addEventListener("pointerdown", (event) => {
    if (!state.token) return;
    event.preventDefault();
    const task = state.data.tasks.find((item) => item.id === bar.dataset.taskId);
    if (!task) return;
    const segments = task.segments?.length ? task.segments : [{ id: `seg-${crypto.randomUUID().slice(0, 10)}`, start_date: task.start_date, end_date: task.end_date, reason: "", position: 0 }];
    task.segments = segments;
    const segment = segments[Number(bar.dataset.segmentIndex || 0)];
    if (!segment) return;
    const track = bar.parentElement;
    const rect = track.getBoundingClientRect();
    const unit = rect.width / state.timeline.total;
    const startX = event.clientX;
    const edge = event.offsetX <= 8 ? "start" : (bar.offsetWidth - event.offsetX <= 8 ? "end" : "move");
    const original = { start: segment.start_date, end: segment.end_date };
    const originalStartOffset = clamp(daysBetween(state.timeline.start, segment.start_date), 0, state.timeline.total - 1);
    const originalEndOffset = clamp(daysBetween(state.timeline.start, segment.end_date), originalStartOffset, state.timeline.total - 1);
    const originalSpan = originalEndOffset - originalStartOffset + 1;
    bar.setPointerCapture(event.pointerId);
    bar.classList.add("dragging");

    const move = (moveEvent) => {
      const deltaDays = Math.round((moveEvent.clientX - startX) / unit);
      let nextStart = originalStartOffset;
      let nextEnd = originalEndOffset;
      if (edge === "move") {
        nextStart = clamp(originalStartOffset + deltaDays, 0, Math.max(0, state.timeline.total - originalSpan));
        nextEnd = nextStart + originalSpan - 1;
      } else if (edge === "start") {
        nextStart = clamp(originalStartOffset + deltaDays, 0, originalEndOffset);
      } else {
        nextEnd = clamp(originalEndOffset + deltaDays, originalStartOffset, state.timeline.total - 1);
      }
      segment.start_date = addDays(state.timeline.start, nextStart);
      segment.end_date = addDays(state.timeline.start, nextEnd);
      paintBar(bar, nextStart, nextEnd);
    };

    const finish = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", finish);
      bar.removeEventListener("pointercancel", cancel);
      bar.classList.remove("dragging");
      if (segment.start_date === original.start && segment.end_date === original.end) return;
      syncTaskDatesFromSegments(task);
      markTaskDirtyById(task.id);
      render();
    };

    const cancel = () => {
      segment.start_date = original.start;
      segment.end_date = original.end;
      bar.classList.remove("dragging");
      render();
    };

    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", finish);
    bar.addEventListener("pointercancel", cancel);
  });
}

function paintBar(bar, startOffset, endOffset) {
  const width = Math.max(1.2, (endOffset - startOffset + 1) / state.timeline.total * 100);
  const left = startOffset / state.timeline.total * 100;
  bar.style.left = `${left}%`;
  bar.style.width = `${width}%`;
}

function renderAdmin() {
  if (!state.token) return;
  $("#groupAdmin").innerHTML = state.data.groups.map((group) => `
    <div class="admin-item" data-group-id="${escapeAttr(group.id)}">
      <div><strong>${escapeHtml(group.title)}</strong><small>${escapeHtml(group.start_date)} ~ ${escapeHtml(group.end_date)}</small></div>
      <span class="ops"><button data-admin="edit-group">编辑</button><button class="danger" data-admin="delete-group">删除</button></span>
    </div>
  `).join("");
  $("#specialAdmin").innerHTML = state.data.specials.map((special) => `
    <div class="admin-item" data-special-id="${escapeAttr(special.id)}">
      <div><strong>${escapeHtml(special.title)}</strong><small>${escapeHtml(groupTitle(special.group_id))} · ${taskCountForSpecial(special.id)} 项</small></div>
      <span class="ops"><button data-admin="edit-special">编辑</button><button class="danger" data-admin="delete-special">删除</button></span>
    </div>
  `).join("");
  document.querySelectorAll("[data-admin]").forEach((button) => button.addEventListener("click", () => handleAdminAction(button).catch(showError)));
}

function renderAudit() {
  const recent = state.audit.slice(-20).reverse();
  $("#audit").innerHTML = recent.length
    ? recent.map((item) => `<div class="audit-item"><time>${escapeHtml(item.ts)}</time><div>${escapeHtml(item.summary || item.action)}</div></div>`).join("")
    : `<p class="empty">暂无变更日志。</p>`;
}

async function handleTaskAction(button) {
  const row = button.closest("tr");
  const taskId = row.dataset.taskId;
  const task = state.data.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const action = button.dataset.action;
  if (action === "save") {
    applyRowToTask(row);
    await saveRepository(`更新任务：${task.title}`, "task.update", "task", task.id, { title: task.title });
  }
  if (action === "split") {
    await splitTask(task.id);
  }
  if (action === "delete") {
    if (!confirm(`确认删除任务：${task.title}？`)) return;
    state.data.tasks = state.data.tasks.filter((item) => item.id !== task.id);
    await saveRepository(`删除任务：${task.title}`, "task.delete", "task", task.id, { title: task.title });
  }
}

function markTaskDirty(control) {
  const row = control.closest("tr");
  if (!row?.dataset.taskId) return;
  applyRowToTask(row, false);
  row.classList.add("dirty");
  state.dirtyTaskIds.add(row.dataset.taskId);
  updateEditStatus();
}

function markTaskDirtyById(taskId) {
  state.dirtyTaskIds.add(taskId);
  updateEditStatus();
}

function applyRowToTask(row, normalizeSegments = true) {
  const task = state.data.tasks.find((item) => item.id === row.dataset.taskId);
  if (!task) return null;
  row.querySelectorAll("[data-field]").forEach((input) => {
    task[input.dataset.field] = input.value.trim();
  });
  task.updated_at = nowIso();
  if (normalizeSegments && (!task.segments?.length || task.segments.length <= 1)) normalizeTaskSegments(task);
  return task;
}

function syncTaskDatesFromSegments(task) {
  const segments = [...(task.segments || [])].sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (!segments.length) return;
  task.segments = segments.map((segment, index) => ({ ...segment, position: index }));
  task.start_date = segments[0].start_date;
  task.end_date = segments[segments.length - 1].end_date;
  task.updated_at = nowIso();
}

async function saveAllTasks() {
  if (!state.dirtyTaskIds.size) {
    alert("没有待保存的任务变更。");
    return;
  }
  document.querySelectorAll("#rows tr.dirty").forEach((row) => applyRowToTask(row));
  const ids = [...state.dirtyTaskIds];
  await saveRepository(`批量更新任务：${ids.length}项`, "task.batch_update", "task", "batch", { ids });
}

async function addTask() {
  const title = prompt("任务名称：", "新任务");
  if (!title) return;
  const firstGroup = state.data.groups[0];
  const task = {
    id: `task-${crypto.randomUUID().slice(0, 10)}`,
    title,
    scope: "",
    target: "",
    owner: "待排人力",
    status: "todo",
    risk: "中",
    priority: "P1",
    group_id: firstGroup?.id || "",
    special_id: null,
    start_date: firstGroup?.due_date || "2026-06-25",
    end_date: firstGroup?.due_date || "2026-06-25",
    evidence: [],
    dependencies: [],
    pr_link: "",
    test_report: "",
    notes: "",
    position: state.data.tasks.length,
    created_at: nowIso(),
    updated_at: nowIso(),
    segments: [],
  };
  normalizeTaskSegments(task);
  state.data.tasks.push(task);
  await saveRepository(`新增任务：${title}`, "task.create", "task", task.id, { title });
}

async function splitTask(taskId) {
  const task = state.data.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const breakStart = prompt("中断开始日期 YYYY-MM-DD：", task.start_date);
  if (!breakStart) return;
  const breakEnd = prompt("中断结束日期 YYYY-MM-DD：", breakStart);
  if (!breakEnd) return;
  const reason = prompt("中断原因：", "临时插入其它任务");
  if (!reason) return;
  const segments = task.segments?.length ? task.segments : [{ id: `seg-${crypto.randomUUID().slice(0, 10)}`, start_date: task.start_date, end_date: task.end_date, reason: "", position: 0 }];
  const next = [];
  for (const segment of segments) {
    if (breakEnd < segment.start_date || breakStart > segment.end_date) {
      next.push(segment);
      continue;
    }
    if (breakStart > segment.start_date) next.push({ ...segment, id: `seg-${crypto.randomUUID().slice(0, 10)}`, end_date: prevDay(breakStart) });
    if (breakEnd < segment.end_date) next.push({ ...segment, id: `seg-${crypto.randomUUID().slice(0, 10)}`, start_date: nextDay(breakEnd) });
  }
  if (!next.length) {
    alert("中断时间覆盖了整个任务，无法切分。");
    return;
  }
  task.segments = next.map((segment, index) => ({ ...segment, reason: segment.reason || reason, position: index }));
  task.notes = reason;
  task.updated_at = nowIso();
  await saveRepository(`切分任务：${task.title}`, "task.split", "task", task.id, { break_start: breakStart, break_end: breakEnd, reason });
}

async function addGroup() {
  const title = prompt("分组名称：", "新转测分组");
  if (!title) return;
  const due = prompt("截止日期 YYYY-MM-DD：", "2026-06-25");
  if (!due) return;
  const group = { id: `group-${crypto.randomUUID().slice(0, 10)}`, title, due_date: due, start_date: due, end_date: due, position: state.data.groups.length };
  state.data.groups.push(group);
  await saveRepository(`新增分组：${title}`, "group.create", "group", group.id, { title });
}

async function addSpecial() {
  const title = prompt("专项名称：", "专项：新专项");
  if (!title) return;
  const special = { id: `special-${crypto.randomUUID().slice(0, 10)}`, title, group_id: state.data.groups[0]?.id || "", position: state.data.specials.length, collapsed: 0 };
  state.data.specials.push(special);
  await saveRepository(`新增专项：${title}`, "special.create", "special", special.id, { title });
}

async function handleAdminAction(button) {
  const action = button.dataset.admin;
  const groupId = button.closest("[data-group-id]")?.dataset.groupId;
  const specialId = button.closest("[data-special-id]")?.dataset.specialId;
  if (action === "edit-group") {
    const group = state.data.groups.find((item) => item.id === groupId);
    const title = prompt("分组名称：", group.title);
    if (!title) return;
    const due = prompt("截止日期 YYYY-MM-DD：", group.due_date);
    if (!due) return;
    Object.assign(group, { title, due_date: due, end_date: due });
    await saveRepository(`更新分组：${title}`, "group.update", "group", group.id, { title });
  }
  if (action === "delete-group") {
    const group = state.data.groups.find((item) => item.id === groupId);
    if (!group || state.data.groups.length <= 1) return alert("至少保留一个分组。");
    if (!confirm(`确认删除分组：${group.title}？任务会转入第一个其它分组。`)) return;
    const fallback = state.data.groups.find((item) => item.id !== group.id);
    state.data.tasks.forEach((task) => { if (task.group_id === group.id) task.group_id = fallback.id; });
    state.data.specials.forEach((special) => { if (special.group_id === group.id) special.group_id = fallback.id; });
    state.data.groups = state.data.groups.filter((item) => item.id !== group.id);
    await saveRepository(`删除分组：${group.title}`, "group.delete", "group", group.id, { fallback_group_id: fallback.id });
  }
  if (action === "edit-special") {
    const special = state.data.specials.find((item) => item.id === specialId);
    const title = prompt("专项名称：", special.title);
    if (!title) return;
    special.title = title;
    await saveRepository(`更新专项：${title}`, "special.update", "special", special.id, { title });
  }
  if (action === "delete-special") {
    const special = state.data.specials.find((item) => item.id === specialId);
    if (!special || !confirm(`确认删除专项：${special.title}？专项下任务会转为普通事项。`)) return;
    state.data.tasks.forEach((task) => { if (task.special_id === special.id) task.special_id = null; });
    state.data.specials = state.data.specials.filter((item) => item.id !== special.id);
    await saveRepository(`删除专项：${special.title}`, "special.delete", "special", special.id, { title: special.title });
  }
}

async function saveRepository(summary, action, entity, id, detail = {}) {
  requireToken();
  ensurePeopleCatalog();
  state.data.generatedAt = nowIso();
  const entry = { ts: nowIso(), action, entity, id, summary, detail, source: "github-pages" };
  state.audit.push(entry);
  const stateText = JSON.stringify(state.data, null, 2) + "\n";
  const auditText = state.audit.map((item) => JSON.stringify(item)).join("\n") + "\n";
  $("#editStatus").textContent = "正在写入 GitHub 仓库...";
  await commitFiles({
    [DATA_PATHS.state]: stateText,
    [DATA_PATHS.pageState]: stateText,
    [DATA_PATHS.audit]: auditText,
    [DATA_PATHS.pageAudit]: auditText,
  }, `记录数据变更: ${summary}`);
  state.dirtyTaskIds.clear();
  $("#editStatus").textContent = "已写入 GitHub 仓库，Pages 稍后刷新";
  render();
}

function updateEditStatus() {
  if (!state.token) {
    $("#editStatus").textContent = "只读模式";
    return;
  }
  const dirtyCount = state.dirtyTaskIds.size;
  $("#editStatus").textContent = dirtyCount ? `编辑模式：${dirtyCount} 项待保存` : "编辑模式：甘特条可拖动，边缘可拉伸；保存会写入 GitHub 仓库";
}

async function commitFiles(files, message) {
  const ref = await gh(`/git/ref/heads/${REPO.branch}`);
  const commit = await gh(`/git/commits/${ref.object.sha}`);
  const treeItems = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await gh("/git/blobs", {
      method: "POST",
      body: { content, encoding: "utf-8" },
    });
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await gh("/git/trees", {
    method: "POST",
    body: { base_tree: commit.tree.sha, tree: treeItems },
  });
  const nextCommit = await gh("/git/commits", {
    method: "POST",
    body: { message, tree: tree.sha, parents: [ref.object.sha] },
  });
  await gh(`/git/refs/heads/${REPO.branch}`, {
    method: "PATCH",
    body: { sha: nextCommit.sha },
  });
}

async function gh(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method: options.method || "GET",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${state.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub API ${response.status}`);
  return data;
}

function requireToken() {
  if (!state.token) throw new Error("请先启用编辑模式并输入 GitHub token。");
}

function enableEditMode() {
  const token = $("#token").value.trim();
  if (!token || token === "********") return alert("请输入 GitHub fine-grained token。");
  state.token = token;
  sessionStorage.setItem("flashPagesToken", token);
  render();
}

function logout() {
  state.token = "";
  sessionStorage.removeItem("flashPagesToken");
  render();
}

function normalizeTaskSegments(task) {
  task.segments = [{ id: task.segments?.[0]?.id || `seg-${crypto.randomUUID().slice(0, 10)}`, start_date: task.start_date, end_date: task.end_date, reason: task.notes || "", position: 0 }];
}

function selectHtml(field, options, value) {
  return `<select data-field="${field}">${options.map(([id, label]) => `<option value="${escapeAttr(id)}" ${id === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function groupTitle(id) {
  return state.data.groups.find((group) => group.id === id)?.title || "";
}

function specialTitle(id) {
  return id ? state.data.specials.find((special) => special.id === id)?.title || id : "普通事项";
}

function taskCountForSpecial(id) {
  return state.data.tasks.filter((task) => task.special_id === id).length;
}

function riskClass(value) {
  return ({ "高": "high", "中": "medium", "低": "low" })[value] || "medium";
}

function nowIso() {
  const date = new Date();
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  return date.toISOString().replace(/\.\d{3}Z$/, `${sign}${hh}:${mm}`);
}

function toDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function addDays(value, days) {
  const date = dateFromYmd(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function prevDay(value) {
  return addDays(value, -1);
}

function nextDay(value) {
  return addDays(value, 1);
}

function dateFromYmd(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function maxDate(a, b) {
  return a > b ? a : b;
}

function minDate(a, b) {
  return a < b ? a : b;
}

function formatMonthDay(value) {
  const [, month, day] = String(value || "").split("-");
  return month && day ? `${month}-${day}` : String(value || "");
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

["q", "risk", "priority", "status"].forEach((id) => {
  $(`#${id}`).addEventListener(id === "q" ? "input" : "change", (event) => {
    state.filters[id] = event.target.value.trim();
    render();
  });
});
$("#refresh").addEventListener("click", load);
$("#clearFilters").addEventListener("click", clearFilters);
$("#editMode").addEventListener("click", enableEditMode);
$("#logout").addEventListener("click", logout);
$("#addTask").addEventListener("click", () => addTask().catch(showError));
$("#saveAll").addEventListener("click", () => saveAllTasks().catch(showError));
$("#addGroup").addEventListener("click", () => addGroup().catch(showError));
$("#addSpecial").addEventListener("click", () => addSpecial().catch(showError));

function showError(error) {
  $("#editStatus").textContent = `写入失败：${error.message}`;
  alert(error.message);
}

load().catch((error) => {
  $("#meta").textContent = `读取失败：${error.message}`;
});
