/* ===========================================================
   My Planner — 할 일(섹션별) + 하루 시간 기록
   데이터는 브라우저 localStorage 에 저장됩니다.
   =========================================================== */

const EMOJI_CDN = "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/";
const STORE_KEY = "planner.v1";

const EMOJI_CHOICES = [
  "📚", "💼", "🏠", "💪", "🎯", "📝", "💻", "📖",
  "🏃", "🍽️", "☕", "😴", "🎮", "🧹", "🛒", "💊",
  "🎨", "🎵", "✈️", "💰", "❤️", "🌱", "🔥", "⭐",
  "📞", "📧", "🧘", "🚗", "🐶", "🎬", "✏️", "📌",
];

const COLORS = ["#a8d5ba", "#f7c5a8", "#b5c8f2", "#f5d98b", "#d6b8f0", "#f2b5c4", "#9fd9e0", "#c9d6a3", "#e8c4a0", "#c4c4f5"];

/* ---------- 이모지 → 애플 이모지 이미지 ---------- */
function emo(ch, cls = "") {
  const code = [...ch].map((c) => c.codePointAt(0).toString(16)).join("-");
  return `<img class="emo ${cls}" src="${EMOJI_CDN}${code}.png" alt="${ch}" draggable="false" loading="lazy" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
}

/* ---------- 유틸 ---------- */
const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function dur(ms, withSec = false) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (withSec) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}
function hexToSoft(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},0.22)`;
}

/* ---------- 상태 ---------- */
function defaultState() {
  return {
    sections: [
      { id: uid(), emoji: "📚", name: "공부" },
      { id: uid(), emoji: "💼", name: "업무" },
      { id: uid(), emoji: "🏠", name: "개인" },
    ],
    todos: {},      // { "YYYY-MM-DD": [{id, sectionId, text, done}] }
    activities: [
      { id: uid(), emoji: "📚", name: "공부", color: COLORS[0] },
      { id: uid(), emoji: "💻", name: "작업", color: COLORS[2] },
      { id: uid(), emoji: "🍽️", name: "식사", color: COLORS[1] },
      { id: uid(), emoji: "🏃", name: "운동", color: COLORS[3] },
      { id: uid(), emoji: "🎮", name: "휴식", color: COLORS[4] },
      { id: uid(), emoji: "😴", name: "수면", color: COLORS[6] },
    ],
    logs: {},       // { "YYYY-MM-DD": [{id, activityId, start, end}] }
    running: null,  // { activityId, start }
  };
}

let state;
try {
  state = JSON.parse(localStorage.getItem(STORE_KEY)) || defaultState();
} catch {
  state = defaultState();
}
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} };

let current = dateKey(new Date());
let editingActs = false;
let sectionEmoji = "🎯";
let actEmoji = "⭐";

const todosOf = (k) => (state.todos[k] ||= []);
const logsOf = (k) => (state.logs[k] ||= []);
const actById = (id) => state.activities.find((a) => a.id === id) || { emoji: "❓", name: "삭제된 활동", color: "#ddd" };

/* ===========================================================
   헤더
   =========================================================== */
function renderHeader() {
  $("#brand").innerHTML = `${emo("🗓️")} My Planner`;
  $("#prevDay").innerHTML = emo("👈");
  $("#nextDay").innerHTML = emo("👉");
  const d = fromKey(current);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const isToday = current === dateKey(new Date());
  $("#dateLabel").textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})${isToday ? " · 오늘" : ""}`;
  $("#todoTitle").innerHTML = `${emo("✅")} 할 일`;
  $("#timeTitle").innerHTML = `${emo("⏱️")} 시간 기록`;
}

function shiftDay(n) {
  const d = fromKey(current);
  d.setDate(d.getDate() + n);
  current = dateKey(d);
  renderAll();
}
$("#prevDay").onclick = () => shiftDay(-1);
$("#nextDay").onclick = () => shiftDay(1);
$("#dateLabel").onclick = () => { current = dateKey(new Date()); renderAll(); };

/* ===========================================================
   할 일 (왼쪽)
   =========================================================== */
function renderTodos() {
  const list = todosOf(current);
  const done = list.filter((t) => t.done).length;
  $("#todoProgress").textContent = list.length ? `${done} / ${list.length} 완료` : "";

  const wrap = $("#sections");
  if (!state.sections.length) {
    wrap.innerHTML = `<p class="empty">아래에서 섹션을 먼저 추가해 주세요.</p>`;
    return;
  }

  wrap.innerHTML = state.sections.map((sec) => {
    const items = list.filter((t) => t.sectionId === sec.id);
    const left = items.filter((t) => !t.done).length;
    return `
      <div class="section" data-sec="${sec.id}">
        <div class="section-head">
          <div class="section-title">${emo(sec.emoji)} ${esc(sec.name)} <span class="count">${items.length ? left : ""}</span></div>
          <button class="mini" data-act="rename" title="이름 바꾸기">${emo("✏️")}</button>
          <button class="mini" data-act="delsec" title="섹션 삭제">${emo("🗑️")}</button>
        </div>
        <ul class="todo-list">
          ${items.map((t) => `
            <li class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
              <button class="check" data-act="toggle" aria-label="완료">${t.done ? emo("✅") : ""}</button>
              <span class="todo-text">${esc(t.text)}</span>
              <button class="del" data-act="deltodo" aria-label="삭제">${emo("❌")}</button>
            </li>`).join("")}
        </ul>
        <form class="add-todo" data-act="add" autocomplete="off">
          <input name="text" placeholder="+ 할 일 추가" maxlength="120" />
        </form>
      </div>`;
  }).join("");
}

$("#sections").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn || btn.tagName === "FORM") return;
  const secEl = btn.closest(".section");
  const secId = secEl?.dataset.sec;
  const todoId = btn.closest(".todo")?.dataset.id;
  const list = todosOf(current);

  switch (btn.dataset.act) {
    case "toggle": {
      const t = list.find((x) => x.id === todoId);
      if (t) t.done = !t.done;
      break;
    }
    case "deltodo":
      state.todos[current] = list.filter((x) => x.id !== todoId);
      break;
    case "rename": {
      const sec = state.sections.find((s) => s.id === secId);
      const name = prompt("섹션 이름", sec.name);
      if (name && name.trim()) sec.name = name.trim().slice(0, 30);
      break;
    }
    case "delsec": {
      const sec = state.sections.find((s) => s.id === secId);
      if (!confirm(`'${sec.name}' 섹션을 삭제할까요?\n(모든 날짜의 이 섹션 할 일도 함께 지워져요)`)) return;
      state.sections = state.sections.filter((s) => s.id !== secId);
      for (const k in state.todos) state.todos[k] = state.todos[k].filter((t) => t.sectionId !== secId);
      break;
    }
    default: return;
  }
  save();
  renderTodos();
});

$("#sections").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const input = form.elements.text;
  const text = input.value.trim();
  if (!text) return;
  const secId = form.closest(".section").dataset.sec;
  todosOf(current).push({ id: uid(), sectionId: secId, text, done: false });
  save();
  renderTodos();
  // 같은 섹션 입력창에 계속 입력할 수 있게 포커스 유지
  document.querySelector(`.section[data-sec="${secId}"] .add-todo input`)?.focus();
});

$("#addSectionForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#sectionName").value.trim();
  if (!name) return;
  state.sections.push({ id: uid(), emoji: sectionEmoji, name });
  $("#sectionName").value = "";
  save();
  renderTodos();
});

/* ===========================================================
   시간 기록 (오른쪽)
   =========================================================== */
function startActivity(id) {
  const now = Date.now();
  if (state.running) {
    const wasSame = state.running.activityId === id;
    stopRunning(now);
    if (wasSame) { save(); renderTime(); return; }  // 같은 걸 다시 누르면 종료
  }
  state.running = { activityId: id, start: now };
  save();
  renderTime();
}

function stopRunning(end = Date.now()) {
  const r = state.running;
  if (!r) return;
  state.running = null;
  if (end - r.start < 1000) return; // 실수로 누른 1초 미만 기록은 무시
  logsOf(dateKey(new Date(r.start))).push({ id: uid(), activityId: r.activityId, start: r.start, end });
}

function renderNowCard() {
  const card = $("#nowCard");
  const r = state.running;
  if (!r) {
    card.className = "now-card";
    card.style.removeProperty("--run-bg");
    card.innerHTML = `
      <div class="big-emo">${emo("⏰")}</div>
      <div class="info">
        <div class="label">지금은 기록 중이 아니에요</div>
        <div class="name">아래 활동을 눌러 시작하세요</div>
      </div>`;
    return;
  }
  const a = actById(r.activityId);
  card.className = "now-card running";
  card.style.setProperty("--run-bg", hexToSoft(a.color));
  card.innerHTML = `
    <div class="big-emo">${emo(a.emoji)}</div>
    <div class="info">
      <div class="label">${hm(r.start)}부터 기록 중</div>
      <div class="name">${esc(a.name)}</div>
    </div>
    <div class="timer" id="timer">${dur(Date.now() - r.start, true)}</div>
    <button class="stop-btn" id="stopBtn">${emo("⏹️")} 종료</button>`;
  $("#stopBtn").onclick = () => { stopRunning(); save(); renderTime(); };
}

function renderActs() {
  const box = $("#acts");
  box.classList.toggle("editing", editingActs);
  $("#addActForm").classList.toggle("hidden", !editingActs);
  $("#editActs").textContent = editingActs ? "완료" : "편집";
  $("#editActs").classList.toggle("on", editingActs);
  box.innerHTML = state.activities.map((a) => `
    <button class="act ${state.running?.activityId === a.id ? "active" : ""}" data-id="${a.id}"
            style="--c:${a.color};--cbg:${hexToSoft(a.color)}">
      ${emo(a.emoji)}
      <span>${esc(a.name)}</span>
      <span class="x" data-del="1">×</span>
    </button>`).join("");
}

$("#acts").addEventListener("click", (e) => {
  const btn = e.target.closest(".act");
  if (!btn) return;
  const id = btn.dataset.id;
  if (editingActs) {
    if (!e.target.closest("[data-del]")) return;
    const a = actById(id);
    if (!confirm(`'${a.name}' 활동을 삭제할까요? (기존 기록은 남아요)`)) return;
    if (state.running?.activityId === id) stopRunning();
    state.activities = state.activities.filter((x) => x.id !== id);
    save();
    renderTime();
    return;
  }
  startActivity(id);
});

$("#editActs").onclick = () => { editingActs = !editingActs; renderActs(); };

$("#addActForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#actName").value.trim();
  if (!name) return;
  const color = COLORS[state.activities.length % COLORS.length];
  state.activities.push({ id: uid(), emoji: actEmoji, name, color });
  $("#actName").value = "";
  save();
  renderActs();
});

/** 선택한 날짜의 기록 (진행 중 포함) */
function dayEntries() {
  const entries = logsOf(current).map((l) => ({ ...l }));
  const r = state.running;
  if (r && dateKey(new Date(r.start)) === current) {
    entries.push({ id: "live", activityId: r.activityId, start: r.start, end: Date.now(), live: true });
  }
  return entries.sort((a, b) => a.start - b.start);
}

function renderSummary(entries) {
  const totals = new Map();
  let all = 0;
  for (const e of entries) {
    const ms = e.end - e.start;
    totals.set(e.activityId, (totals.get(e.activityId) || 0) + ms);
    all += ms;
  }
  if (!entries.length) { $("#summary").innerHTML = ""; return; }
  const chips = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id, ms]) => {
    const a = actById(id);
    return `<span class="chip"><span class="dot" style="background:${a.color}"></span>${esc(a.name)} ${dur(ms)}</span>`;
  });
  $("#summary").innerHTML = `<span class="chip total">총 ${dur(all)}</span>${chips.join("")}`;
}

const HOUR_PX = 40;
function renderTimeline(entries) {
  const tl = $("#timeline");
  const dayStart = fromKey(current).getTime();
  const dayEnd = dayStart + 86400000;
  const toPx = (ts) => ((Math.min(Math.max(ts, dayStart), dayEnd) - dayStart) / 3600000) * HOUR_PX;

  let html = "";
  for (let h = 0; h < 24; h++) html += `<div class="hour" style="top:${h * HOUR_PX}px">${pad(h)}</div>`;
  for (const e of entries) {
    const a = actById(e.activityId);
    const top = toPx(e.start);
    const height = Math.max(3, toPx(e.end) - top);
    const label = height >= 16 ? `${emo(a.emoji)}<span>${esc(a.name)}</span>` : "";
    html += `<div class="block ${e.live ? "live" : ""}" style="top:${top}px;height:${height}px;--c:${a.color}" title="${esc(a.name)} ${hm(e.start)}–${hm(e.end)}">${label}</div>`;
  }
  const now = Date.now();
  if (now >= dayStart && now < dayEnd) html += `<div class="now-line" style="top:${toPx(now)}px"></div>`;
  tl.innerHTML = html;
}

function renderLogList(entries) {
  const ul = $("#logList");
  if (!entries.length) {
    ul.innerHTML = `<li class="empty">${emo("🌱")} 아직 기록이 없어요.<br>활동을 눌러 하루를 기록해 보세요.</li>`;
    return;
  }
  ul.innerHTML = entries.slice().reverse().map((e) => {
    const a = actById(e.activityId);
    return `
      <li class="log" style="--c:${a.color}" data-id="${e.id}">
        <span class="bar"></span>
        <div class="meta">
          <div class="n">${emo(a.emoji)} ${esc(a.name)}</div>
          <div class="t">${hm(e.start)} – ${e.live ? "진행 중" : hm(e.end)}</div>
        </div>
        <span class="d">${dur(e.end - e.start)}</span>
        ${e.live ? "" : `<button class="del" aria-label="삭제">${emo("🗑️")}</button>`}
      </li>`;
  }).join("");
}

$("#logList").addEventListener("click", (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;
  const id = btn.closest(".log").dataset.id;
  if (!confirm("이 기록을 삭제할까요?")) return;
  state.logs[current] = logsOf(current).filter((l) => l.id !== id);
  save();
  renderTime();
});

function renderTime() {
  renderNowCard();
  renderActs();
  const entries = dayEntries();
  renderSummary(entries);
  renderTimeline(entries);
  renderLogList(entries);
}

/* ===========================================================
   이모지 선택 팝오버
   =========================================================== */
let pickerCallback = null;
const pop = $("#emojiPopover");
pop.innerHTML = EMOJI_CHOICES.map((c) => `<button type="button" data-e="${c}">${emo(c)}</button>`).join("");

function openPicker(anchor, cb) {
  pickerCallback = cb;
  pop.classList.remove("hidden");
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - w - 12);
  pop.style.left = `${Math.max(12, left)}px`;
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
}
pop.addEventListener("click", (e) => {
  const b = e.target.closest("[data-e]");
  if (!b) return;
  pickerCallback?.(b.dataset.e);
  pop.classList.add("hidden");
});
document.addEventListener("click", (e) => {
  if (!pop.contains(e.target) && !e.target.closest(".emoji-pick")) pop.classList.add("hidden");
});

function paintPickers() {
  $("#sectionEmojiBtn").innerHTML = emo(sectionEmoji);
  $("#actEmojiBtn").innerHTML = emo(actEmoji);
}
$("#sectionEmojiBtn").onclick = (e) => openPicker(e.currentTarget, (c) => { sectionEmoji = c; paintPickers(); });
$("#actEmojiBtn").onclick = (e) => openPicker(e.currentTarget, (c) => { actEmoji = c; paintPickers(); });

/* ===========================================================
   시작
   =========================================================== */
function scrollTimelineToNow() {
  const wrap = $("#timelineWrap");
  const target = current === dateKey(new Date()) ? new Date().getHours() - 3 : 7;
  wrap.scrollTop = Math.max(0, target * HOUR_PX);
}

function renderAll() {
  renderHeader();
  renderTodos();
  renderTime();
  paintPickers();
  scrollTimelineToNow();
}

renderAll();

// 매초 타이머 갱신, 30초마다 타임라인 갱신
let tick = 0;
setInterval(() => {
  tick++;
  const t = document.getElementById("timer");
  if (t && state.running) t.textContent = dur(Date.now() - state.running.start, true);
  if (tick % 30 === 0) {
    const entries = dayEntries();
    renderSummary(entries);
    renderTimeline(entries);
    renderLogList(entries);
  }
}, 1000);

// 다른 탭에서 바뀐 내용 반영
window.addEventListener("storage", (e) => {
  if (e.key !== STORE_KEY) return;
  try { state = JSON.parse(e.newValue) || state; } catch {}
  renderTodos();
  renderTime();
});
