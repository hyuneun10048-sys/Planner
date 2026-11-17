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

const PALETTE = ["#a24bd1", "#f07d12", "#14a5b5", "#e8467c", "#4a7cf0", "#2fb36b", "#e3b021", "#8a5a3c", "#6b5cc4", "#7b8794"];

const EMOJI_CHOICES = [
  "📚", "💼", "🏠", "💪", "🎯", "📝", "💻", "📖",
  "🏃", "🍽️", "☕", "😴", "🎮", "🧹", "🛒", "💊",
  "🎨", "🎵", "✈️", "💰", "❤️", "🌱", "🔥", "⭐",
  "📞", "📧", "🧘", "🚗", "🐶", "🎬", "⚖️", "🚓",
];

const CHECK_SVG = `<svg viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
      { id: uid(), emoji: "📚", name: "공부", color: PALETTE[0] },
      { id: uid(), emoji: "💼", name: "업무", color: PALETTE[2] },
      { id: uid(), emoji: "🏃", name: "운동", color: PALETTE[1] },
      { id: uid(), emoji: "🏠", name: "개인", color: PALETTE[3] },
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
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} };
save();

let current = todayKey();
let viewMonth = fromKey(current); viewMonth.setDate(1);
let editing = false;
let openAdd = null;          // 할 일 입력창이 열린 섹션 id
let newSectionEmoji = "🎯";

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
  $("#brand").innerHTML = `${emo("🗓️")} My Planner`;
  $("#calToggle").innerHTML = emo(state.calOpen ? "📅" : "🗓️");
  $("#calCard").classList.toggle("hidden", !state.calOpen);
}

function renderCalendar() {
  if (!state.calOpen) return;
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  $("#calTitle").textContent = `${months[m]} ${y}`;

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

    // 완료한 할 일의 섹션 색으로 동그라미를 채움
    let bg = "", inner = "";
    if (done.length) {
      const colors = done.map((t) => secById(t.sectionId).color);
      const step = 100 / colors.length;
      bg = `background:conic-gradient(${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(",")})`;
    }
    if (list.length && !left) inner = CHECK_SVG;
    else if (left) inner = String(left);

    html += `
      <button class="cal-day ${dow === 0 ? "sun" : dow === 6 ? "sat" : ""} ${k === tk ? "today" : ""} ${k === current ? "selected" : ""}" data-k="${k}">
        <span class="mark" style="${bg}">${inner}</span>
        <span class="num">${d}</span>
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

function renderNowBar() {
  const bar = $("#nowBar");
  const r = state.running;
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
            <button class="tool" data-act="emoji" title="아이콘 바꾸기">${emo(sec.emoji)}</button>
            <button class="tool" data-act="color" title="색 바꾸기"><span class="swatch"></span></button>
            <button class="tool" data-act="rename" title="이름 바꾸기">${emo("✏️")}</button>
            <button class="tool" data-act="delsec" title="섹션 삭제">${emo("🗑️")}</button>
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
      if (editing) return;
      toggleTimer(secId);
      return;
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
    case "emoji":
      openPicker(btn, (c) => { sec.emoji = c; save(); renderDay(); });
      return;
    case "color": {
      const i = PALETTE.indexOf(sec.color);
      sec.color = PALETTE[(i + 1) % PALETTE.length];
      break;
    }
    case "rename": {
      const name = prompt("섹션 이름", sec.name);
      if (name && name.trim()) sec.name = name.trim().slice(0, 20);
      break;
    }
    case "delsec":
      if (!confirm(`'${sec.name}' 섹션을 삭제할까요?\n모든 날짜의 이 섹션 할 일도 함께 지워져요. (시간 기록은 남아요)`)) return;
      if (state.running?.sectionId === secId) stopTimer();
      state.sections = state.sections.filter((s) => s.id !== secId);
      for (const k in state.todos) state.todos[k] = state.todos[k].filter((t) => t.sectionId !== secId);
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

/* 섹션 추가 / 편집 모드 */
$("#showAddSection").onclick = () => {
  const f = $("#addSectionForm");
  f.classList.toggle("hidden");
  if (!f.classList.contains("hidden")) $("#sectionName").focus();
};
$("#sectionEmojiBtn").onclick = (e) => openPicker(e.currentTarget, (c) => { newSectionEmoji = c; paintPicker(); });
function paintPicker() { $("#sectionEmojiBtn").innerHTML = emo(newSectionEmoji); }
$("#addSectionForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#sectionName").value.trim();
  if (!name) return;
  const used = new Set(state.sections.map((s) => s.color));
  const color = PALETTE.find((c) => !used.has(c)) || PALETTE[state.sections.length % PALETTE.length];
  state.sections.push({ id: uid(), emoji: newSectionEmoji, name, color });
  $("#sectionName").value = "";
  $("#addSectionForm").classList.add("hidden");
  save();
  renderDay();
});
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
  renderDayHead(entries);
  renderNowBar();
  renderSections(entries);
  renderTimetable(entries);
  renderLogs(entries);
}

/* ===========================================================
   이모지 선택 팝오버
   =========================================================== */
let pickerCb = null;
const pop = $("#emojiPopover");
pop.innerHTML = EMOJI_CHOICES.map((c) => `<button type="button" data-e="${c}">${emo(c)}</button>`).join("");
function openPicker(anchor, cb) {
  pickerCb = cb;
  pop.classList.remove("hidden");
  const r = anchor.getBoundingClientRect();
  const maxLeft = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12;
  pop.style.left = `${Math.max(12, Math.min(r.left + window.scrollX, maxLeft))}px`;
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
}
pop.addEventListener("click", (e) => {
  const b = e.target.closest("[data-e]");
  if (!b) return;
  pickerCb?.(b.dataset.e);
  pop.classList.add("hidden");
});
document.addEventListener("click", (e) => {
  if (!pop.contains(e.target) && !e.target.closest(".emoji-pick, [data-act='emoji']")) pop.classList.add("hidden");
});

/* ===========================================================
   시작 & 실시간 갱신
   =========================================================== */
renderTop();
renderCalendar();
paintPicker();
renderDay();

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
