/* ===========================================================
   My Planner — 섹션별 할 일 + 10분 단위 타임테이블 + 월간 달력
   데이터는 브라우저 localStorage 에 저장됩니다.
   =========================================================== */

const EMOJI_CDN = "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/";
const STORE_KEY = "planner.v2";
const OLD_KEY = "planner.v1";
const DAY_START_HOUR = 5; // 하루는 새벽 5시에 시작 (밤샘 공부도 같은 날로 기록)
const HOUR = 3600000;
const SLOT = 10 * 60000;   // 타임테이블 한 칸 = 10분

const PALETTE = [
  "#a24bd1", "#6b5cc4", "#4a7cf0", "#14a5b5", "#2fb36b", "#8bbf3f",
  "#e3b021", "#f07d12", "#e85d3f", "#e8467c", "#d77fb4", "#8a5a3c",
  "#c8a27a", "#7b8794", "#3d4451", "#191919",
];

const EMOJI_CHOICES = [
  "📚", "📖", "📝", "✏️", "💻", "💼", "⚖️", "🚓",
  "🧮", "🔬", "🌏", "🗣️", "🎯", "🔥", "⭐", "💡",
  "🏃", "💪", "🧘", "🚴", "🍽️", "☕", "😴", "💊",
  "🏠", "🧹", "🛒", "💰", "📞", "📧", "🚗", "✈️",
  "🎨", "🎵", "🎮", "🎬", "📷", "🐶", "🌱", "❤️",
];

const CHECK_SVG = `<svg viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- 🍀 네잎클로버 표시 ----------
   완료한 할 일의 섹션 색으로 잎을 칠하고, 다 끝내면 체크 / 남으면 남은 개수 */
function clover(colors, content) {
  const lobes = [[11, 11], [21, 11], [21, 21], [11, 21]]; // 왼위, 오위, 오아래, 왼아래
  const n = colors.length;
  const fill = (i) => (n ? colors[Math.floor((i * n) / 4)] : "#d6d7db");
  let svg = `<svg class="clover" viewBox="0 0 32 32" aria-hidden="true">`;
  lobes.forEach(([x, y], i) => { svg += `<circle cx="${x}" cy="${y}" r="9" fill="${fill(i)}"/>`; });
  if (content === "check") {
    svg += `<path d="M10.5 16.3l3.8 3.8 7.4-7.6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (content) {
    svg += `<text x="16" y="16" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="12" font-weight="800" font-family="Pretendard, -apple-system, sans-serif">${content}</text>`;
  }
  return svg + `</svg>`;
}

/* ---------- 이모지 → 애플 이모지 이미지 ---------- */
function emo(ch) {
  const code = [...ch].map((c) => c.codePointAt(0).toString(16)).join("-");
  return `<img class="emo" src="${EMOJI_CDN}${code}.png" alt="${ch}" draggable="false" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
}

/* ---------- 유틸 ---------- */
const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const todayKey = () => dateKey(new Date(Date.now() - DAY_START_HOUR * HOUR));
const dayWindow = (k) => { const s = fromKey(k).getTime() + DAY_START_HOUR * HOUR; return [s, s + 24 * HOUR]; };
const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const hmShort = (ms) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}H ${pad(m % 60)}M`; };
const korDur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); const h = Math.floor(m / 60); return h ? `${h}시간 ${m % 60}분` : `${m}분`; };
const soft = (hex, a = 0.14) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/* ---------- 상태 ---------- */
function defaultState() {
  return {
    sections: [
      { id: uid(), emoji: "📚", name: "공부", color: "#a24bd1" },
      { id: uid(), emoji: "💼", name: "업무", color: "#14a5b5" },
      { id: uid(), emoji: "🏃", name: "운동", color: "#f07d12" },
      { id: uid(), emoji: "🏠", name: "개인", color: "#e8467c" },
    ],
    todos: {},     // { "YYYY-MM-DD": [{ id, sectionId, text, done }] }
    logs: [],      // [{ id, sectionId, start, end }]
    running: null, // { sectionId, start }
    calOpen: true,
  };
}

function load() {
  try {
    const v2 = JSON.parse(localStorage.getItem(STORE_KEY));
    if (v2) return v2;
    const v1 = JSON.parse(localStorage.getItem(OLD_KEY));
    if (v1) { // 이전 버전 데이터 옮기기 (섹션·할 일 유지, 같은 이름의 활동 기록은 섹션으로 연결)
      const s = defaultState();
      s.sections = v1.sections.map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] }));
      s.todos = v1.todos || {};
      const byName = Object.fromEntries(s.sections.map((x) => [x.name, x.id]));
      for (const list of Object.values(v1.logs || {})) {
        for (const l of list) {
          const act = (v1.activities || []).find((a) => a.id === l.activityId);
          if (act && byName[act.name]) s.logs.push({ id: l.id, sectionId: byName[act.name], start: l.start, end: l.end });
        }
      }
      return s;
    }
  } catch {}
  return defaultState();
}

let state = load();
function save(touch = true) {
  if (touch) state.updatedAt = Date.now();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  if (touch && typeof schedulePush === "function") schedulePush();
}
save(false);

let current = todayKey();
let viewMonth = fromKey(current); viewMonth.setDate(1);
let editing = false;
let openAdd = null;          // 할 일 입력창이 열린 섹션 id

const todosOf = (k) => (state.todos[k] ||= []);
const secById = (id) => state.sections.find((s) => s.id === id) || { id, emoji: "❓", name: "삭제된 섹션", color: "#b8b8b8" };

/** 선택한 날의 기록(진행 중 포함), 하루 범위로 잘라서 */
function entriesFor(k) {
  const [ws, we] = dayWindow(k);
  const list = state.logs.slice();
  if (state.running) list.push({ id: "live", sectionId: state.running.sectionId, start: state.running.start, end: Date.now(), live: true });
  return list
    .filter((e) => overlap(e.start, e.end, ws, we) > 0)
    .map((e) => ({ ...e, s: Math.max(e.start, ws), e: Math.min(e.end, we) }))
    .sort((a, b) => a.s - b.s);
}

/* ===========================================================
   타이머
   =========================================================== */
function toggleTimer(sectionId) {
  const now = Date.now();
  const r = state.running;
  if (r) {
    stopTimer(now);
    if (r.sectionId === sectionId) { save(); renderDay(); return; } // 같은 섹션 → 종료
  }
  state.running = { sectionId, start: now };                       // 다른 섹션 → 전환
  save();
  renderDay();
}
function stopTimer(end = Date.now()) {
  const r = state.running;
  if (!r) return;
  state.running = null;
  if (end - r.start >= 1000) state.logs.push({ id: uid(), sectionId: r.sectionId, start: r.start, end });
}

/* ===========================================================
   상단 / 달력
   =========================================================== */
function renderTop() {
  $("#brand").innerHTML = `<span class="logo-b">MY</span><span class="logo-l">PLANNER</span>`;
  $("#calToggle").innerHTML = `${emo("📅")}<span class="lbl">${state.calOpen ? "달력 접기" : "달력"}</span>`;
  $("#calCard").classList.toggle("hidden", !state.calOpen);
}

function renderCalendar() {
  if (!state.calOpen) return;
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  $("#calTitle").textContent = `${months[m]} ${y}`;
  loadMonthEvents(viewMonth);

  const wds = ["S", "M", "T", "W", "T", "F", "S"];
  let html = wds.map((w, i) => `<div class="cal-wd ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("");

  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  for (let i = 0; i < first; i++) html += `<div class="cal-day other"></div>`;

  const tk = todayKey();
  for (let d = 1; d <= days; d++) {
    const k = dateKey(new Date(y, m, d));
    const dow = (first + d - 1) % 7;
    const list = state.todos[k] || [];
    const done = list.filter((t) => t.done);
    const left = list.length - done.length;

    const colors = [...new Set(done.map((t) => secById(t.sectionId).color))];
    const content = list.length && !left ? "check" : left ? String(left) : "";
    const hasEv = eventsOn(k).length > 0;

    html += `
      <button class="cal-day ${dow === 0 ? "sun" : dow === 6 ? "sat" : ""} ${k === tk ? "today" : ""} ${k === current ? "selected" : ""}" data-k="${k}">
        ${clover(colors, content)}
        <span class="num">${d}</span>
        <span class="ev-dot ${hasEv ? "" : "off"}"></span>
      </button>`;
  }
  $("#calGrid").innerHTML = html;
}

$("#calGrid").addEventListener("click", (e) => {
  const b = e.target.closest(".cal-day[data-k]");
  if (!b) return;
  current = b.dataset.k;
  renderCalendar();
  renderDay();
});
$("#prevMonth").onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); renderCalendar(); };
$("#nextMonth").onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); renderCalendar(); };
$("#calToggle").onclick = () => { state.calOpen = !state.calOpen; save(); renderTop(); renderCalendar(); };
$("#todayBtn").onclick = () => goTo(todayKey());

function goTo(k) {
  current = k;
  viewMonth = fromKey(k); viewMonth.setDate(1);
  openAdd = null;
  renderCalendar();
  renderDay();
}
function shiftDay(n) { const d = fromKey(current); d.setDate(d.getDate() + n); goTo(dateKey(d)); }
$("#prevDay").onclick = () => shiftDay(-1);
$("#nextDay").onclick = () => shiftDay(1);

/* ===========================================================
   하루 카드
   =========================================================== */
function renderDayHead(entries) {
  const d = fromKey(current);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  $("#dayDate").textContent = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${days[d.getDay()]})`;
  const total = entries.reduce((s, e) => s + (e.e - e.s), 0);
  $("#dayTotal").textContent = hmShort(total);
}

function renderFab() {
  const fab = $("#fab");
  const r = state.running;
  if (r) {
    const sec = secById(r.sectionId);
    fab.classList.add("running");
    fab.style.setProperty("--c", sec.color);
    fab.innerHTML = emo(sec.emoji);
    fab.title = `${sec.name} 기록 중`;
  } else {
    fab.classList.remove("running");
    fab.innerHTML = `<span class="fab-logo">MY</span>`;
    fab.title = "오늘로 이동";
  }
}
$("#fab").onclick = () => {
  if (current !== todayKey()) goTo(todayKey());
  document.querySelector(".day-card").scrollIntoView({ behavior: "smooth", block: "start" });
};

function renderNowBar() {
  const bar = $("#nowBar");
  const r = state.running;
  renderFab();
  if (!r) { bar.classList.add("hidden"); return; }
  const sec = secById(r.sectionId);
  bar.classList.remove("hidden");
  bar.style.setProperty("--c", sec.color);
  bar.style.setProperty("--cbg", soft(sec.color));
  bar.innerHTML = `
    <span class="dot"></span>
    <span class="what">${emo(sec.emoji)} ${esc(sec.name)}<span class="since">${hm(r.start)}부터</span></span>
    <span class="clock" id="nowClock">${clock(Date.now() - r.start)}</span>
    <button class="stop" id="stopBtn">종료</button>`;
  $("#stopBtn").onclick = () => { stopTimer(); save(); renderDay(); };
}

function sectionTotals(entries) {
  const t = {};
  for (const e of entries) t[e.sectionId] = (t[e.sectionId] || 0) + (e.e - e.s);
  return t;
}

function renderSections(entries) {
  const totals = sectionTotals(entries);
  const list = todosOf(current);
  const wrap = $("#sections");
  wrap.parentElement.classList.toggle("editing", editing);
  $("#editToggle").classList.toggle("on", editing);
  $("#editToggle").textContent = editing ? "완료" : "편집";

  if (!state.sections.length) {
    wrap.innerHTML = `<p class="empty-sec">${emo("🌱")} ＋ 섹션으로 시작해 보세요</p>`;
    return;
  }

  wrap.innerHTML = state.sections.map((sec) => {
    const items = list.filter((t) => t.sectionId === sec.id);
    const running = state.running?.sectionId === sec.id;
    return `
      <div class="section ${running ? "running" : ""}" data-sec="${sec.id}" style="--c:${sec.color}">
        <div class="sec-head">
          <button class="sec-main" data-act="timer" title="눌러서 시간 기록 시작/종료">
            <span class="sec-bar"></span>
            ${emo(sec.emoji)}
            <span class="sec-name">${esc(sec.name)}</span>
            <span class="sec-time" data-time="${sec.id}">${clock(totals[sec.id] || 0)}</span>
          </button>
          <button class="sec-add" data-act="open-add" aria-label="할 일 추가">＋</button>
          <span class="sec-tools">
            <button class="tool arrow-tool" data-act="up" title="위로">↑</button>
            <button class="tool arrow-tool" data-act="down" title="아래로">↓</button>
            <button class="tool" data-act="settings" title="섹션 설정">${emo("⚙️")}</button>
          </span>
        </div>
        <ul class="todo-list">
          ${items.map((t) => `
            <li class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
              <button class="check" data-act="toggle" aria-label="완료">${CHECK_SVG}</button>
              <span class="todo-text">${esc(t.text)}</span>
              <button class="del" data-act="deltodo" aria-label="삭제">${emo("❌")}</button>
            </li>`).join("")}
        </ul>
        ${openAdd === sec.id ? `
          <form class="add-todo" autocomplete="off">
            <input name="text" placeholder="할 일 입력 후 Enter" maxlength="120" />
          </form>` : ""}
      </div>`;
  }).join("");

  if (openAdd) wrap.querySelector(`.section[data-sec="${openAdd}"] .add-todo input`)?.focus();
}

$("#sections").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const secId = btn.closest(".section")?.dataset.sec;
  const sec = state.sections.find((s) => s.id === secId);
  const todoId = btn.closest(".todo")?.dataset.id;
  const list = todosOf(current);

  switch (btn.dataset.act) {
    case "timer":
      if (editing) { openSheet(secId); return; }
      toggleTimer(secId);
      return;
    case "settings":
      openSheet(secId);
      return;
    case "up":
    case "down": {
      const i = state.sections.indexOf(sec);
      const j = btn.dataset.act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= state.sections.length) return;
      [state.sections[i], state.sections[j]] = [state.sections[j], state.sections[i]];
      break;
    }
    case "open-add":
      openAdd = openAdd === secId ? null : secId;
      break;
    case "toggle": {
      const t = list.find((x) => x.id === todoId);
      if (t) t.done = !t.done;
      break;
    }
    case "deltodo":
      state.todos[current] = list.filter((x) => x.id !== todoId);
      break;
    default:
      return;
  }
  save();
  renderCalendar();
  renderDay();
});

$("#sections").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = e.target.elements.text;
  const text = input.value.trim();
  if (!text) { openAdd = null; renderDay(); return; }
  todosOf(current).push({ id: uid(), sectionId: openAdd, text, done: false });
  save();
  renderCalendar();
  renderDay(); // 입력창은 열린 채로 다시 포커스
});
$("#sections").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && e.target.closest(".add-todo")) { openAdd = null; renderDay(); }
});

/* ===========================================================
   섹션 설정 시트 (추가 / 수정)
   =========================================================== */
let sheetFor = null;               // 수정 중인 섹션 id (null 이면 새 섹션)
let draft = { emoji: "📚", color: PALETTE[0] };

function openSheet(secId = null) {
  sheetFor = secId;
  const sec = secId && state.sections.find((s) => s.id === secId);
  if (sec) {
    draft = { emoji: sec.emoji, color: sec.color };
    $("#sheetName").value = sec.name;
  } else {
    const used = new Set(state.sections.map((s) => s.color));
    draft = { emoji: "📚", color: PALETTE.find((c) => !used.has(c)) || PALETTE[0] };
    $("#sheetName").value = "";
  }
  $("#sheetTitle").textContent = sec ? "섹션 설정" : "새 섹션";
  $("#sheetDelete").classList.toggle("hidden", !sec);
  paintSheet();
  $("#sheet").classList.remove("hidden");
  requestAnimationFrame(() => $("#sheet").classList.add("show"));
  if (!sec) setTimeout(() => $("#sheetName").focus(), 150);
}
function closeSheet() {
  $("#sheet").classList.remove("show");
  setTimeout(() => $("#sheet").classList.add("hidden"), 200);
}

function paintSheet() {
  const name = $("#sheetName").value.trim() || "섹션 이름";
  const sheet = $("#sheetForm");
  sheet.style.setProperty("--c", draft.color);
  sheet.style.setProperty("--cbg", soft(draft.color, 0.12));
  $("#sheetPreview").innerHTML = `
    <span class="sec-bar"></span>${emo(draft.emoji)}
    <span class="pv-name">${esc(name)}</span>
    <span class="pv-time">0:00:00</span>
    <span class="pv-check"></span>`;
  $("#sheetEmojis").innerHTML = EMOJI_CHOICES.map((c) =>
    `<button type="button" class="${c === draft.emoji ? "on" : ""}" data-e="${c}">${emo(c)}</button>`).join("");
  const custom = !PALETTE.includes(draft.color);
  $("#sheetColors").innerHTML = PALETTE.map((c) =>
    `<button type="button" class="sw ${c === draft.color ? "on" : ""}" data-c="${c}" style="--sw:${c}" aria-label="${c}"></button>`).join("") +
    `<label class="sw custom ${custom ? "on" : ""}" style="--sw:${custom ? draft.color : "#ffffff"}" title="직접 고르기">
       <input type="color" id="customColor" value="${draft.color}" />
       <span>${custom ? "" : "＋"}</span>
     </label>`;
}

$("#sheetName").addEventListener("input", () => {
  $("#sheetPreview .pv-name").textContent = $("#sheetName").value.trim() || "섹션 이름";
});
$("#sheetEmojis").addEventListener("click", (e) => {
  const b = e.target.closest("[data-e]");
  if (b) { draft.emoji = b.dataset.e; paintSheet(); }
});
$("#sheetColors").addEventListener("click", (e) => {
  const b = e.target.closest("[data-c]");
  if (b) { draft.color = b.dataset.c; paintSheet(); }
});
$("#sheetColors").addEventListener("input", (e) => {
  if (e.target.id !== "customColor") return;
  draft.color = e.target.value;
  const sheet = $("#sheetForm");
  sheet.style.setProperty("--c", draft.color);
  sheet.style.setProperty("--cbg", soft(draft.color, 0.12));
  const lab = e.target.closest(".custom");
  lab.style.setProperty("--sw", draft.color);
  lab.querySelector("span").textContent = "";
  $("#sheetColors").querySelectorAll(".sw").forEach((x) => x.classList.toggle("on", x === lab));
});

$("#sheetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#sheetName").value.trim();
  if (!name) { $("#sheetName").focus(); return; }
  const sec = sheetFor && state.sections.find((s) => s.id === sheetFor);
  if (sec) Object.assign(sec, { name, emoji: draft.emoji, color: draft.color });
  else state.sections.push({ id: uid(), name, emoji: draft.emoji, color: draft.color });
  save();
  closeSheet();
  renderCalendar();
  renderDay();
});
$("#sheetDelete").onclick = () => {
  const sec = state.sections.find((s) => s.id === sheetFor);
  if (!sec || !confirm(`'${sec.name}' 섹션을 삭제할까요?\n모든 날짜의 이 섹션 할 일도 함께 지워져요. (시간 기록은 남아요)`)) return;
  if (state.running?.sectionId === sec.id) stopTimer();
  state.sections = state.sections.filter((s) => s.id !== sec.id);
  for (const k in state.todos) state.todos[k] = state.todos[k].filter((t) => t.sectionId !== sec.id);
  save();
  closeSheet();
  renderCalendar();
  renderDay();
};
$("#sheetCancel").onclick = closeSheet;
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").classList.contains("hidden")) closeSheet(); });
$("#showAddSection").onclick = () => openSheet();

$("#editToggle").onclick = () => { editing = !editing; openAdd = null; renderDay(); };

/* ===========================================================
   10분 단위 타임테이블
   =========================================================== */
function renderTimetable(entries) {
  const [ws] = dayWindow(current);
  const now = Date.now();
  let html = "";
  for (let h = 0; h < 24; h++) {
    const hour = (DAY_START_HOUR + h) % 24;
    const label = hour % 12 === 0 ? 12 : hour % 12;
    const first = h === 0 ? "first" : "";
    html += `<div class="tt-h ${first}">${label}</div>`;
    for (let s = 0; s < 6; s++) {
      const a = ws + (h * 6 + s) * SLOT, b = a + SLOT;
      let best = null, bestMs = 0, filled = 0, live = false;
      for (const e of entries) {
        const o = overlap(e.s, e.e, a, b);
        if (!o) continue;
        filled += o;
        if (o > bestMs) { bestMs = o; best = e; }
        if (e.live) live = true;
      }
      const isNow = now >= a && now < b;
      let inner = "";
      if (best) {
        const sec = secById(best.sectionId);
        const startPct = Math.max(0, (Math.min(...entries.filter((e) => overlap(e.s, e.e, a, b)).map((e) => e.s)) - a) / SLOT * 100);
        const w = Math.min(100 - startPct, (filled / SLOT) * 100);
        inner = `<i style="--c:${sec.color};left:${startPct}%;width:${Math.max(w, 6)}%"></i>`;
      }
      html += `<div class="tt-c ${first} ${isNow ? "now" : ""} ${live && isNow ? "live" : ""}" ${best ? `title="${esc(secById(best.sectionId).name)}"` : ""}>${inner}</div>`;
    }
  }
  $("#timetable").innerHTML = html;
}

/* ===========================================================
   기록 목록
   =========================================================== */
function renderLogs(entries) {
  $("#logsSummary").textContent = entries.length ? `기록 ${entries.length}개 보기` : "아직 기록이 없어요";
  $("#logList").innerHTML = entries.slice().reverse().map((e) => {
    const sec = secById(e.sectionId);
    return `
      <li class="log" style="--c:${sec.color}" data-id="${e.id}">
        <span class="bar"></span>
        <span class="n">${emo(sec.emoji)} ${esc(sec.name)}</span>
        <span class="t">${hm(e.start)} – ${e.live ? "진행 중" : hm(e.end)}</span>
        <span class="d">${korDur(e.e - e.s)}</span>
        ${e.live ? "" : `<button class="del" aria-label="삭제">${emo("🗑️")}</button>`}
      </li>`;
  }).join("");
}
$("#logList").addEventListener("click", (e) => {
  const b = e.target.closest(".del");
  if (!b) return;
  const id = b.closest(".log").dataset.id;
  if (!confirm("이 기록을 삭제할까요?")) return;
  state.logs = state.logs.filter((l) => l.id !== id);
  save();
  renderDay();
});

function renderDay() {
  const entries = entriesFor(current);
  renderEvents();
  renderDayHead(entries);
  renderNowBar();
  renderSections(entries);
  renderTimetable(entries);
  renderLogs(entries);
}

/* ===========================================================
   구글 캘린더 일정
   =========================================================== */
const evCache = {};   // "YYYY-MM" → { t, list }
const evLoading = {};
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

function eventsOn(k) {
  const c = evCache[k.slice(0, 7)];
  if (!c) return [];
  const ds = fromKey(k).getTime(), de = ds + 24 * HOUR;
  return c.list
    .filter((e) => (e.allDay ? e.startDate <= k && k < e.endDate : overlap(e.start, e.end, ds, de) > 0))
    .sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
}

async function loadMonthEvents(d, force = false) {
  if (!calendarOn()) return;
  const mk = monthKey(d);
  const c = evCache[mk];
  if (evLoading[mk] || (!force && c && Date.now() - c.t < 5 * 60000)) return;
  evLoading[mk] = true;
  try {
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const res = await api("events", { from, to });
    if (!res.ok) throw new Error(res.error);
    evCache[mk] = { t: Date.now(), list: res.events };
    renderCalendar();
    renderEvents();
  } catch (e) {
    console.warn("캘린더 불러오기 실패", e);
  } finally {
    evLoading[mk] = false;
  }
}

function renderEvents() {
  const box = $("#events");
  if (!calendarOn()) { box.classList.add("hidden"); return; }
  loadMonthEvents(fromKey(current));
  const list = eventsOn(current);
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="ev-head">${emo("📅")} <span>오늘 일정</span><span class="ev-count">${list.length || ""}</span></div>
    ${list.length ? `<ul class="ev-list">${list.map((e) => `
      <li class="ev" style="--c:${e.color || "#4a7cf0"}">
        <span class="ev-time">${e.allDay ? "종일" : hm(e.start)}</span>
        <span class="ev-title">${esc(e.title || "(제목 없음)")}</span>
      </li>`).join("")}</ul>` : `<p class="ev-empty">일정이 없어요</p>`}`;
}

/* ===========================================================
   여러 기기 동기화 (Google Apps Script + 구글 드라이브)
   =========================================================== */
const SYNC_KEY = "planner.sync";
let sync = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { return {}; } })();
let pushTimer = null;
let pendingPush = false;

const syncOn = () => !!(sync.url && sync.token);
const calendarOn = () => syncOn() && sync.calendar !== false;
const saveSync = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch {} };

async function api(action, extra = {}, method = "GET", cfg = sync) {
  let r;
  if (method === "GET") {
    r = await fetch(`${cfg.url}?${new URLSearchParams({ action, token: cfg.token, ...extra })}`);
  } else {
    // text/plain 으로 보내야 Apps Script 가 CORS 사전요청 없이 받아요
    r = await fetch(cfg.url, { method: "POST", body: JSON.stringify({ action, token: cfg.token, ...extra }) });
  }
  return r.json();
}

function setStatus(st, msg = "") {
  const b = $("#syncBtn");
  b.dataset.status = syncOn() ? st : "off";
  b.title = { off: "동기화 설정", ok: "동기화됨", syncing: "저장 중…", error: `동기화 오류: ${msg}` }[b.dataset.status];
  const el = $("#syncState");
  if (el) el.textContent = syncOn() ? { ok: "✓ 연결됨", syncing: "저장 중…", error: `오류: ${msg}` }[st] || "" : "연결 안 됨";
}

function schedulePush() {
  if (!syncOn()) return;
  pendingPush = true;
  setStatus("syncing");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1200);
}
async function push() {
  try {
    const res = await api("save", { data: state }, "POST");
    if (!res.ok) throw new Error(res.error);
    pendingPush = false;
    if (res.data && (res.data.updatedAt || 0) > (state.updatedAt || 0)) applyRemote(res.data);
    setStatus("ok");
  } catch (e) {
    setStatus("error", e.message);
    pushTimer = setTimeout(push, 10000); // 잠시 후 다시 시도
  }
}
async function pull() {
  if (!syncOn() || pendingPush) return;
  try {
    const res = await api("load");
    if (!res.ok) throw new Error(res.error);
    if (res.data && (res.data.updatedAt || 0) > (state.updatedAt || 0)) applyRemote(res.data);
    setStatus("ok");
  } catch (e) {
    setStatus("error", e.message);
  }
}
function applyRemote(data) {
  state = data;
  save(false);
  renderTop();
  renderCalendar();
  renderDay();
}

/* ---------- 설정 창 ---------- */
function openSyncSheet() {
  $("#syncUrl").value = sync.url || "";
  $("#syncToken").value = sync.token || "";
  $("#syncCal").checked = sync.calendar !== false;
  $("#syncDisconnect").classList.toggle("hidden", !syncOn());
  $("#syncLinkBtn").classList.toggle("hidden", !syncOn());
  setStatus(syncOn() ? "ok" : "off");
  $("#syncSheet").classList.remove("hidden");
  requestAnimationFrame(() => $("#syncSheet").classList.add("show"));
}
function closeSyncSheet() {
  $("#syncSheet").classList.remove("show");
  setTimeout(() => $("#syncSheet").classList.add("hidden"), 200);
}

async function connect(cfg, { askConflict = true } = {}) {
  const ping = await api("ping", {}, "GET", cfg);
  if (!ping.ok) throw new Error(ping.error === "unauthorized" ? "비밀번호가 맞지 않아요" : ping.error);
  const res = await api("load", {}, "GET", cfg);
  if (!res.ok) throw new Error(res.error);
  sync = cfg;
  saveSync();
  const remote = res.data;
  const localUsed = !!state.updatedAt;
  if (remote && localUsed && askConflict) {
    const useRemote = confirm(
      "구글 드라이브에 이미 저장된 플래너 데이터가 있어요.\n\n" +
      "[확인] 드라이브 데이터 불러오기 (이 기기 데이터는 덮어써져요)\n" +
      "[취소] 이 기기 데이터를 드라이브에 올리기"
    );
    if (useRemote) applyRemote(remote);
    else { state.updatedAt = Date.now(); save(false); await push(); }
  } else if (remote) {
    applyRemote(remote);
  } else {
    state.updatedAt = state.updatedAt || Date.now();
    save(false);
    await push();
  }
  for (const k in evCache) delete evCache[k];
  setStatus("ok");
  renderCalendar();
  renderDay();
}

$("#syncForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cfg = {
    url: $("#syncUrl").value.trim(),
    token: $("#syncToken").value.trim(),
    calendar: $("#syncCal").checked,
  };
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(cfg.url)) {
    $("#syncState").textContent = "웹 앱 URL 은 https://script.google.com/macros/s/…/exec 형식이에요";
    return;
  }
  if (!cfg.token) { $("#syncToken").focus(); return; }
  $("#syncState").textContent = "연결 확인 중…";
  try {
    await connect(cfg);
    closeSyncSheet();
  } catch (err) {
    $("#syncState").textContent = `연결 실패: ${err.message}`;
  }
});
$("#syncDisconnect").onclick = () => {
  if (!confirm("이 기기에서 동기화를 끌까요? (드라이브 데이터는 그대로 남아요)")) return;
  sync = {};
  saveSync();
  for (const k in evCache) delete evCache[k];
  setStatus("off");
  closeSyncSheet();
  renderCalendar();
  renderDay();
};
$("#syncLinkBtn").onclick = async () => {
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(sync))));
  const link = `${location.origin}${location.pathname}#connect=${code}`;
  try { await navigator.clipboard.writeText(link); $("#syncState").textContent = "✓ 링크를 복사했어요. 다른 기기 브라우저에서 열면 바로 연결돼요"; }
  catch { prompt("이 링크를 다른 기기에서 열어 주세요", link); }
};
$("#syncBtn").onclick = openSyncSheet;
$("#syncCancel").onclick = closeSyncSheet;
$("#syncSheet").addEventListener("click", (e) => { if (e.target.id === "syncSheet") closeSyncSheet(); });

/** 다른 기기 연결 링크(#connect=...)로 들어온 경우 */
async function handleConnectLink() {
  const m = location.hash.match(/^#connect=(.+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const cfg = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    await connect(cfg, { askConflict: !!state.updatedAt });
  } catch (err) {
    alert(`동기화 연결 실패: ${err.message}`);
  }
}

async function initSync() {
  $("#syncBtn").innerHTML = `${emo("☁️")}<span class="lbl">동기화</span><span class="sync-dot"></span>`;
  await handleConnectLink();
  window.addEventListener("hashchange", handleConnectLink);
  setStatus(syncOn() ? "ok" : "off");
  if (!syncOn()) return;
  pull();
  setInterval(() => { if (document.visibilityState === "visible") pull(); }, 20000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    pull();
    loadMonthEvents(fromKey(current), true);
  });
}

/* ===========================================================
   시작 & 실시간 갱신
   =========================================================== */
renderTop();
renderCalendar();
renderDay();
initSync();

let tick = 0;
setInterval(() => {
  tick++;
  if (!state.running) return;
  const entries = entriesFor(current);
  const c = document.getElementById("nowClock");
  if (c) c.textContent = clock(Date.now() - state.running.start);
  const el = document.querySelector(`[data-time="${state.running.sectionId}"]`);
  if (el) el.textContent = clock(sectionTotals(entries)[state.running.sectionId] || 0);
  renderDayHead(entries);
  if (tick % 15 === 0) renderTimetable(entries);
}, 1000);

// 다른 탭에서 바뀐 내용 반영
window.addEventListener("storage", (e) => {
  if (e.key !== STORE_KEY || !e.newValue) return;
  try { state = JSON.parse(e.newValue); } catch { return; }
  renderTop(); renderCalendar(); renderDay();
});
