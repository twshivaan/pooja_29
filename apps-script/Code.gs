/**
 * Back end for the birthday surprise.
 *
 * Paste this whole file into the Sheet's script editor (Extensions → Apps Script) and
 * deploy it as a web app (Execute as: Me, Who has access: Anyone). See SETUP.md.
 *
 * Script Properties (Project Settings → Script Properties):
 *   ACCESS_KEY        the key in the shared link (?k=...)
 *   PHOTOS_FOLDER_ID  the Drive folder that receives photos
 *   DEADLINE_ISO      e.g. 2026-12-05T23:59:00+05:30 (leave empty for no deadline)
 *
 * Write-only by design: no action ever returns stored answers, names or file links.
 */

const TZ = 'Asia/Kolkata';
const RESPONSES = 'Responses';
const PHOTOS = 'Photos';

const META = ['response_id', 'started_at', 'updated_at', 'completed', 'is_test'];
const FIELDS = [
  'name', 'relation', 'known_for', 'how_met', 'nickname',
  'family_kid', 'family_dream', 'school_3words', 'school_type',
  'college_hostel_moment', 'college_snack', 'work_meeting_line', 'spicy_unlocked',
  'meter_omw', 'meter_trip', 'meter_lost', 'meter_sleep', 'meter_joke', 'meter_overthink', 'meter_argue',
  'ever_bunk', 'ever_sleep_class', 'ever_insta_like', 'ever_cry_movie', 'ever_trouble', 'ever_crush', 'ever_sing',
  'ever_vidaai', 'ever_sangeet', 'ever_wrong_chat', 'ever_mute', 'ever_nod', 'ever_shopping', 'ever_auto', 'ever_maggi',
  'emoji', 'song', 'song_why', 'character', 'character_why', 'cafe_order', 'bag', 'hidden_talent', 'salary', 'career',
  'dict_word', 'dict_meaning', 'roast', 'villain_origin', 'lie_pick', 'ask_her',
  'spicy_movie', 'spicy_marriage', 'spicy_kids_count', 'spicy_kids_age',
  'memory_fav', 'memory_funny', 'first_impression', 'now_i_know',
  'funny_upi', 'wish_short', 'wish_letter',
];
const HEADERS = META.concat(FIELDS);
const PHOTO_HEADERS = ['uploaded_at', 'response_id', 'name', 'slot', 'caption', 'file_name', 'file_url', 'is_test'];
const SLOTS = ['funny', 'aesthetic', 'together', 'candid', 'childhood'];

const MAX_VALUE = 5000;
const MAX_PHOTOS = 15;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/* ================= entry points ================= */

function doGet() {
  return out_({ ok: true });
}

function doPost(e) {
  let res;
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    let p;
    try { p = JSON.parse(raw); } catch (err) { fail_('bad_request'); }
    if (!p || typeof p !== 'object') fail_('bad_request');
    res = route_(p);
  } catch (err) {
    if (err && err.code) res = { ok: false, error: err.code };
    else {
      console.error(err && err.stack ? err.stack : err);
      res = { ok: false, error: 'server_error' };
    }
  }
  return out_(res);
}

function route_(p) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ACCESS_KEY');
  if (!key || typeof p.key !== 'string' || p.key !== key) fail_('bad_key');

  const deadline = props.getProperty('DEADLINE_ISO');
  if (deadline) {
    const t = new Date(deadline).getTime();
    if (!isNaN(t) && Date.now() > t) fail_('closed');
  }

  switch (p.action) {
    case 'save': return save_(p);
    case 'photo': return photo_(p, props);
    case 'photo_caption': return photoCaption_(p, props);
    case 'photo_remove': return photoRemove_(p, props);
    case 'count': return count_();
    default: fail_('bad_action');
  }
}

/* ================= actions ================= */

/** Upserts one row per response_id. */
function save_(p) {
  const rid = rid_(p.response_id);
  const answers = p.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail_('bad_request');

  const clean = {};
  Object.keys(answers).forEach(function (k) {
    if (FIELDS.indexOf(k) < 0) fail_('unknown_field');
    clean[k] = text_(answers[k]);
  });

  return withLock_(function () {
    const sh = sheet_(RESPONSES, HEADERS);
    const row = findRow_(sh, 1, rid);
    const now = stamp_();
    let values;
    if (row) {
      values = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    } else {
      values = HEADERS.map(function () { return ''; });
      values[0] = rid;
      values[1] = now;
    }
    values[2] = now;
    values[3] = values[3] === true || p.completed === true;
    values[4] = values[4] === true || p.is_test === true;
    FIELDS.forEach(function (f, i) {
      const col = META.length + i;
      if (Object.prototype.hasOwnProperty.call(clean, f)) values[col] = clean[f];
      values[col] = safe_(values[col]);   // re-guard anything read back from the sheet
    });
    const target = row || Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(target, 1, 1, HEADERS.length).setValues([values]);
    return { ok: true };
  });
}

/** Saves one photo into PHOTOS_FOLDER_ID/<name>_<rid6>/<slot>_<n>.jpg and logs it. */
function photo_(p, props) {
  const rid = rid_(p.response_id);
  const pid = pid_(p.photo_id);
  const slot = String(p.slot || '');
  if (SLOTS.indexOf(slot) < 0) fail_('bad_slot');
  const mime = String(p.mime || '').toLowerCase();
  if (!/^image\/[a-z0-9.+-]+$/.test(mime)) fail_('bad_mime');
  const caption = text_(p.caption);
  if (typeof p.data_base64 !== 'string' || !p.data_base64) fail_('bad_request');
  if (p.data_base64.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 16) fail_('too_big');
  let bytes;
  try { bytes = Utilities.base64Decode(p.data_base64); } catch (err) { fail_('bad_request'); }
  if (!bytes.length) fail_('bad_request');
  if (bytes.length > MAX_PHOTO_BYTES) fail_('too_big');
  const name = text_(p.name);

  return withLock_(function () {
    const folder = respFolder_(props, rid, name, true);
    if (findFile_(folder, pid)) return { ok: true };   // a retry of a photo that already arrived

    const sh = sheet_(PHOTOS, PHOTO_HEADERS);
    if (photoRows_(sh, rid).length >= MAX_PHOTOS) fail_('limit');

    const ext = mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'img').replace(/[^a-z0-9]/g, '');
    const taken = {};
    const it = folder.getFiles();
    while (it.hasNext()) taken[it.next().getName().replace(/\.[^.]*$/, '')] = true;
    let n = 1;
    while (taken[slot + '_' + n]) n++;
    const fileName = slot + '_' + n + '.' + ext;

    const file = folder.createFile(Utilities.newBlob(bytes, mime, fileName));
    file.setDescription(pid);

    const target = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(target, 1, 1, PHOTO_HEADERS.length).setValues([[
      stamp_(), rid, safe_(name), slot, safe_(caption), fileName, file.getUrl(), p.is_test === true,
    ]]);
    return { ok: true };
  });
}

/** Updates the caption of a photo that was already uploaded. */
function photoCaption_(p, props) {
  const rid = rid_(p.response_id);
  const pid = pid_(p.photo_id);
  const caption = text_(p.caption);
  return withLock_(function () {
    const folder = respFolder_(props, rid, text_(p.name), false);
    const file = folder && findFile_(folder, pid);
    if (!file) fail_('not_found');
    const sh = sheet_(PHOTOS, PHOTO_HEADERS);
    const url = file.getUrl();
    photoRows_(sh, rid).forEach(function (r) {
      if (r.url === url) sh.getRange(r.row, 5).setValue(safe_(caption));
    });
    return { ok: true };
  });
}

/** Removes a photo the person took back out. */
function photoRemove_(p, props) {
  const rid = rid_(p.response_id);
  const pid = pid_(p.photo_id);
  return withLock_(function () {
    const folder = respFolder_(props, rid, text_(p.name), false);
    const file = folder && findFile_(folder, pid);
    if (!file) return { ok: true };
    const sh = sheet_(PHOTOS, PHOTO_HEADERS);
    const url = file.getUrl();
    file.setTrashed(true);
    photoRows_(sh, rid).reverse().forEach(function (r) {
      if (r.url === url) sh.deleteRow(r.row);
    });
    return { ok: true };
  });
}

/** Number of finished, non-test responses. The only number ever returned. */
function count_() {
  const sh = sheet_(RESPONSES, HEADERS);
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, count: 0 };
  const rows = sh.getRange(2, 4, last - 1, 2).getValues();
  let n = 0;
  rows.forEach(function (r) {
    if (bool_(r[0]) && !bool_(r[1])) n++;
  });
  return { ok: true, count: n };
}

/* ================= helpers ================= */

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code) {
  const e = new Error(code);
  e.code = code;
  throw e;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) fail_('busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

function rid_(v) {
  const s = String(v || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(s)) fail_('bad_request');
  return s;
}

function pid_(v) {
  const s = String(v || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(s)) fail_('bad_request');
  return s;
}

/** Any answer as a string, capped at 5,000 characters. */
function text_(v) {
  if (v == null) return '';
  if (typeof v === 'object') fail_('bad_request');
  const s = String(v);
  if (s.length > MAX_VALUE) fail_('too_long');
  return s;
}

/** Stops formula injection: values starting with = + - @ are stored as plain text. */
function safe_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function bool_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function stamp_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

/** Gets a tab, creating it and its header row if missing. */
function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function findRow_(sh, col, value) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const vals = sh.getRange(2, col, last - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (vals[i][0] === value) return i + 2;
  return 0;
}

/** Rows in the Photos tab for one response: [{ row, url }]. */
function photoRows_(sh, rid) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, PHOTO_HEADERS.length).getValues();
  const out = [];
  vals.forEach(function (r, i) { if (r[1] === rid) out.push({ row: i + 2, url: r[6] }); });
  return out;
}

/** The person's photo folder: <name>_<first 6 of response_id>. Found by suffix if the name changed. */
function respFolder_(props, rid, name, create) {
  const rootId = props.getProperty('PHOTOS_FOLDER_ID');
  if (!rootId) fail_('not_set_up');
  const root = DriveApp.getFolderById(rootId);
  const suffix = '_' + rid.slice(0, 6);
  const clean = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'someone';
  const exact = root.getFoldersByName(clean + suffix);
  if (exact.hasNext()) return exact.next();
  const all = root.getFolders();
  while (all.hasNext()) {
    const f = all.next();
    const n = f.getName();
    if (n.length >= suffix.length && n.slice(-suffix.length) === suffix) return f;
  }
  return create ? root.createFolder(clean + suffix) : null;
}

/** Finds a photo by the id stored in its description. */
function findFile_(folder, pid) {
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getDescription() === pid) return f;
  }
  return null;
}
