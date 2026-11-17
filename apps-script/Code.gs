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
        return json_(saveData_(p.data));
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

function saveData_(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'no data' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const current = readData_();
    // 서버에 더 최신 데이터가 있으면 덮어쓰지 않고 돌려줌 (다른 기기에서 먼저 저장한 경우)
    if (current && (current.updatedAt || 0) > (data.updatedAt || 0)) {
      return { ok: true, data: current };
    }
    file_(true).setContent(JSON.stringify(data));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
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
