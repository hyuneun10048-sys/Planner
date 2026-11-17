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
 */

const TOKEN = '여기에-나만-아는-비밀번호';
const FILE_NAME = 'my-planner-data.json';

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
        return json_(saveData_(p.data, false));
      case 'replace':
        return json_(saveData_(p.data, true));
      case 'events':
        return json_({ ok: true, events: events_(Number(p.from), Number(p.to)) });
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
    cal.getEvents(start, end).forEach(function (ev) {
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
      });
    });
  });
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
