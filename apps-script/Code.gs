/**
 * My Planner – 동기화 & 구글 캘린더 서버 (Google Apps Script)
 *
 * 1) 아래 TOKEN 을 나만 아는 비밀번호로 바꾸세요.
 * 2) 배포 → 새 배포 → 유형: 웹 앱
 *      - 다음 사용자 인증 정보로 실행: 나
 *      - 액세스 권한이 있는 사용자: 모든 사용자
 * 3) 나온 웹 앱 URL(…/exec)과 TOKEN 을 플래너의 ☁️ 설정에 입력하세요.
 *
 * 플래너 데이터는 내 구글 드라이브의 'my-planner-data.json' 파일에 저장돼요.
 * 시간 기록은 섹션마다 고른 구글 캘린더에 일정으로도 저장돼요.
 */

const TOKEN = '여기에-나만-아는-비밀번호';
const FILE_NAME = 'my-planner-data.json';
const MAP_FILE = 'my-planner-calendar-map.json'; // 기록 id ↔ 캘린더 일정 id
const LOG_TAG = 'myPlannerLog';                   // 플래너가 만든 기록 일정 표시

function doGet(e) {
  return handle_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle_(body);
}

function handle_(p) {
  if (!p.token || p.token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });
  try {
    switch (p.action) {
      case 'ping':
        return json_({ ok: true });
      case 'load':
        return json_({ ok: true, data: readData_() });
      case 'save':
      case 'replace': {
        const r = saveData_(p.data, p.action === 'replace');
        if (r.ok && p.logsToCalendar) {
          try { r.calendar = syncLogs_(r.data); }
          catch (err) { r.calendarError = String(err && err.message || err); }
        }
        return json_(r);
      }
      case 'events':
        return json_({ ok: true, events: events_(Number(p.from), Number(p.to)) });
      case 'calendars':
        return json_({ ok: true, calendars: calendars_() });
      case 'createCalendar':
        return json_({ ok: true, calendar: createCalendar_(p.name) });
      case 'addEvent':
        return json_({ ok: true, event: saveEvent_(p, null) });
      case 'updateEvent':
        return json_({ ok: true, event: saveEvent_(p, findEvent_(p.calendarId, p.id)) });
      case 'deleteEvent':
        findEvent_(p.calendarId, p.id).deleteEvent();
        return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- 데이터 저장 (구글 드라이브 파일) ---------- */
function file_(create) {
  const it = DriveApp.getFilesByName(FILE_NAME);
  if (it.hasNext()) return it.next();
  return create ? DriveApp.createFile(FILE_NAME, 'null', 'application/json') : null;
}

function readData_() {
  const f = file_(false);
  if (!f) return null;
  const text = f.getBlob().getDataAsString();
  return text ? JSON.parse(text) : null;
}

function saveData_(data, replace) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'no data' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // 여러 기기에서 동시에 고쳐도 항목별로 합쳐서 저장 (replace 면 통째로 교체)
    const merged = replace ? data : mergeStates(readData_(), data);
    file_(true).setContent(JSON.stringify(merged));
    return { ok: true, data: merged };
  } finally {
    lock.releaseLock();
  }
}

/* ---- 두 기기의 데이터를 항목별로 합치기 (Code.gs 와 같은 코드) ----
   - 항목마다 u(수정 시각)가 있고, 같은 id 면 더 최근 것을 사용
   - 지운 항목은 del[id] = 지운 시각 으로 기억해서 다시 살아나지 않게 함 */
function mergeStates(a, b) {
  if (!a) return b;
  if (!b) return a;
  var del = {}, k;
  [a.del || {}, b.del || {}].forEach(function (d) {
    for (k in d) del[k] = Math.max(del[k] || 0, d[k]);
  });
  var cutoff = Date.now() - 90 * 86400000; // 오래된 삭제 기록은 정리
  for (k in del) if (del[k] < cutoff) delete del[k];
  function alive(x) { return !(del[x.id] >= (x.u || 0)); }
  function pick(xs, ys) {
    var m = {}, order = [];
    (xs || []).concat(ys || []).forEach(function (x) {
      if (!x || !x.id) return;
      if (!m[x.id]) order.push(x.id);
      if (!m[x.id] || (x.u || 0) > (m[x.id].u || 0)) m[x.id] = x;
    });
    return order.map(function (id) { return m[id]; }).filter(alive);
  }
  var newer = (a.orderU || 0) >= (b.orderU || 0) ? a : b;
  var rank = {};
  (newer.sections || []).forEach(function (s, i) { rank[s.id] = i; });
  var sections = pick(a.sections, b.sections).sort(function (x, y) {
    var rx = x.id in rank ? rank[x.id] : 1e9, ry = y.id in rank ? rank[y.id] : 1e9;
    return rx - ry;
  });
  var todos = {};
  Object.keys(a.todos || {}).concat(Object.keys(b.todos || {})).forEach(function (day) {
    if (todos[day]) return;
    var list = pick((a.todos || {})[day], (b.todos || {})[day]);
    if (list.length) todos[day] = list;
  });
  var logs = pick(a.logs, b.logs).sort(function (x, y) { return x.start - y.start; });
  var runA = a.runningU || 0, runB = b.runningU || 0;
  return {
    v: 3,
    sections: sections,
    todos: todos,
    logs: logs,
    running: runA >= runB ? (a.running || null) : (b.running || null),
    runningU: Math.max(runA, runB),
    orderU: Math.max(a.orderU || 0, b.orderU || 0),
    del: del,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

/* ---------- 구글 캘린더 일정 ---------- */
function events_(from, to) {
  if (!from || !to) throw new Error('from/to required');
  const start = new Date(from), end = new Date(to);
  const tz = Session.getScriptTimeZone();
  const out = [];
  CalendarApp.getAllCalendars().forEach(function (cal) {
    if (cal.isHidden() || !cal.isSelected()) return; // 캘린더 앱에서 체크해 둔 캘린더만
    const color = cal.getColor();
    const editable = cal.isOwnedByMe();
    cal.getEvents(start, end).forEach(function (ev) {
      if (ev.getTag(LOG_TAG)) return; // 플래너 시간 기록은 일정으로 다시 읽지 않음
      const allDay = ev.isAllDayEvent();
      out.push({
        id: ev.getId(),
        title: ev.getTitle(),
        allDay: allDay,
        start: ev.getStartTime().getTime(),
        end: ev.getEndTime().getTime(),
        startDate: allDay ? Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd') : null,
        endDate: allDay ? Utilities.formatDate(ev.getAllDayEndDate(), tz, 'yyyy-MM-dd') : null,
        color: color,
        calendar: cal.getName(),
        calendarId: cal.getId(),
        editable: editable,
        recurring: ev.isRecurringEvent(),
      });
    });
  });
  return out;
}

/* ---------- 내가 쓸 수 있는 캘린더 목록 ---------- */
function calendars_() {
  const def = CalendarApp.getDefaultCalendar().getId();
  return CalendarApp.getAllOwnedCalendars().map(function (cal) {
    return { id: cal.getId(), name: cal.getName(), color: cal.getColor(), primary: cal.getId() === def };
  });
}

/** 같은 이름의 캘린더가 없을 때만 새로 만듦 */
function createCalendar_(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('캘린더 이름이 필요해요');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found = CalendarApp.getOwnedCalendarsByName(name);
    const cal = found.length ? found[0] : CalendarApp.createCalendar(name, { timeZone: Session.getScriptTimeZone() });
    return { id: cal.getId(), name: cal.getName(), color: cal.getColor(), primary: false };
  } finally {
    lock.releaseLock();
  }
}

function calendarOrDefault_(id) {
  const cal = id ? CalendarApp.getCalendarById(id) : null;
  return cal || CalendarApp.getDefaultCalendar();
}

function findEvent_(calendarId, id) {
  const ev = calendarOrDefault_(calendarId).getEventById(id);
  if (!ev) throw new Error('일정을 찾을 수 없어요');
  return ev;
}

/* ---------- 플래너에서 일정 추가 / 수정 ---------- */
function saveEvent_(p, ev) {
  const title = String(p.title || '').trim() || '(제목 없음)';
  const tz = Session.getScriptTimeZone();
  const allDay = p.allDay === true || p.allDay === 'true';
  if (!ev) {
    const cal = calendarOrDefault_(p.calendarId);
    ev = allDay
      ? cal.createAllDayEvent(title, Utilities.parseDate(p.date, tz, 'yyyy-MM-dd'))
      : cal.createEvent(title, new Date(Number(p.start)), new Date(Number(p.end)));
  } else {
    ev.setTitle(title);
    if (allDay) ev.setAllDayDate(Utilities.parseDate(p.date, tz, 'yyyy-MM-dd'));
    else ev.setTime(new Date(Number(p.start)), new Date(Number(p.end)));
  }
  return { id: ev.getId() };
}

/* ---------- 시간 기록 → 구글 캘린더 일정 ---------- */
function readMap_() {
  const it = DriveApp.getFilesByName(MAP_FILE);
  if (!it.hasNext()) return {};
  try { return JSON.parse(it.next().getBlob().getDataAsString()) || {}; } catch (e) { return {}; }
}
function writeMap_(map) {
  const it = DriveApp.getFilesByName(MAP_FILE);
  const text = JSON.stringify(map);
  if (it.hasNext()) it.next().setContent(text);
  else DriveApp.createFile(MAP_FILE, text, 'application/json');
}

// 섹션 색과 가장 가까운 구글 캘린더 일정 색
const EVENT_COLORS_ = {
  PALE_BLUE: '#a4bdfc', PALE_GREEN: '#7ae7bf', MAUVE: '#dbadff', PALE_RED: '#ff887c',
  YELLOW: '#fbd75b', ORANGE: '#ffb878', CYAN: '#46d6db', GRAY: '#e1e1e1',
  BLUE: '#5484ed', GREEN: '#51b749', RED: '#dc2127',
};
function nearestEventColor_(hex) {
  const rgb = function (h) { const n = parseInt(String(h).replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const c = rgb(hex || '#9aa5b1');
  let best = 'GRAY', bestD = Infinity;
  Object.keys(EVENT_COLORS_).forEach(function (k) {
    const e = rgb(EVENT_COLORS_[k]);
    const d = Math.pow(c[0] - e[0], 2) + Math.pow(c[1] - e[1], 2) + Math.pow(c[2] - e[2], 2);
    if (d < bestD) { bestD = d; best = k; }
  });
  return CalendarApp.EventColor[best];
}

function getEventSafe_(calId, eventId) {
  try { const cal = CalendarApp.getCalendarById(calId); return cal ? cal.getEventById(eventId) : null; }
  catch (e) { return null; }
}

/** 시간 기록을 섹션마다 연결한 캘린더에 일정으로 맞춰 둠 (연결 안 한 섹션은 넣지 않음) */
function syncLogs_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const map = readMap_();
    const secs = {}, cals = {};
    (data.sections || []).forEach(function (s) { secs[s.id] = s; });
    const calOf = function (id) {
      if (!id) return null;
      if (!(id in cals)) { try { cals[id] = CalendarApp.getCalendarById(id); } catch (e) { cals[id] = null; } }
      return cals[id];
    };
    const cutoff = Date.now() - 60 * 86400000; // 최근 60일 기록만 새로 넣거나 고침
    const keep = {};
    let changed = 0;
    (data.logs || []).forEach(function (l) {
      const sec = secs[l.sectionId];
      const cal = sec && calOf(sec.calId);
      const m = map[l.id];
      if (!cal) return; // 캘린더 연결 안 한 섹션 → 아래에서 기존 일정 정리
      keep[l.id] = true;
      const calId = cal.getId();
      const title = ((sec.emoji || '') + ' ' + sec.name).trim();
      const sig = [calId, l.start, l.end, title, sec.color].join('|');
      if (m && m.sig === sig) return;
      if (l.end < cutoff) { if (m) keep[l.id] = true; return; }
      let ev = m ? getEventSafe_(m.calId, m.eventId) : null;
      if (ev && m.calId !== calId) { ev.deleteEvent(); ev = null; } // 다른 캘린더로 바꾼 경우
      if (ev) {
        ev.setTitle(title);
        ev.setTime(new Date(l.start), new Date(l.end));
      } else {
        ev = cal.createEvent(title, new Date(l.start), new Date(l.end), { description: 'My Planner 시간 기록' });
        ev.setTag(LOG_TAG, String(l.id));
      }
      try { ev.setColor(nearestEventColor_(sec.color)); } catch (e) {}
      map[l.id] = { eventId: ev.getId(), calId: calId, sig: sig };
      changed++;
    });
    // 지운 기록 / 캘린더 연결을 끊은 섹션의 기록은 캘린더에서도 지움
    Object.keys(map).forEach(function (id) {
      if (keep[id]) return;
      const ev = getEventSafe_(map[id].calId, map[id].eventId);
      if (ev) ev.deleteEvent();
      delete map[id];
      changed++;
    });
    if (changed) writeMap_(map);
    return { changed: changed };
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
