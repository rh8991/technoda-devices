'use strict';

/* ---------- Constants & state ---------- */
const KINDS = {
  laptops: { one: 'מחשב', many: 'מחשבים', icon: '💻' },
  tablets: { one: 'טאבלט', many: 'טאבלטים', icon: '📱' },
};
const STATUS = {
  ok: { label: 'תקין', icon: '✅', cls: 'ok' },
  faulty: { label: 'תקול', icon: '❌', cls: 'bad' },
  repair: { label: 'בתיקון', icon: '🔧', cls: 'warn' },
};
const STATUS_CYCLE = ['ok', 'faulty', 'repair'];
const UPDATE = {
  ok: { label: '✓ מעודכן', cls: 'ok' },
  needed: { label: '⚠ צריך עדכון', cls: 'warn' },
  '': { label: 'לא נבדק', cls: 'info' },
};

const state = {
  config: {},
  devices: { laptops: [], tablets: [] },
  tab: 'laptops',
  search: '',
  filter: 'all',
  editing: null, // { kind, id } while editing, null when adding
};

const $ = (sel) => document.querySelector(sel);

/* ---------- Utils ---------- */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const normSerial = (s) => String(s ?? '').trim().toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 6000 : 3000);
}

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, val) { try { localStorage.setItem(key, val); } catch { /* ignore */ } }

/* ---------- Save API (Google Apps Script that holds the GitHub token) ---------- */
async function api(body) {
  if (!state.config.apiUrl) throw new Error('לא הוגדר apiUrl בקובץ data/config.json');
  // text/plain body = no CORS preflight, which Apps Script can't answer.
  const res = await fetch(state.config.apiUrl, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
  if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
  const out = await res.json();
  if (!out.ok) {
    const err = new Error(out.error || `GitHub ${out.status}`);
    err.status = out.status;
    throw err;
  }
  return out;
}

const readDevices = () => api({ action: 'read' });

/** Read devices.json fresh, apply `mutate`, write it back. Retries on concurrent edits. */
async function mutateDevices(mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await readDevices();
    data.laptops ??= [];
    data.tablets ??= [];
    mutate(data);
    try {
      await api({ action: 'write', data, sha, message });
      state.devices = data;
      render();
      return;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
    }
  }
  throw new Error('השמירה נכשלה אחרי כמה ניסיונות');
}

/* ---------- Loading ---------- */
async function fetchJson(file, fallback) {
  try {
    const res = await fetch(`${file}?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? await res.json() : fallback;
  } catch {
    return fallback;
  }
}

async function loadAll() {
  state.config = await fetchJson('data/config.json', {});
  $('#orgName').textContent = state.config.orgName || 'טכנודע';
  $('#setupWarn').hidden = !!state.config.apiUrl;

  state.devices = null;
  if (state.config.apiUrl) {
    // Read through the API: the GitHub Pages copy can lag a minute or two after a save.
    try { state.devices = (await readDevices()).data; } catch (e) { toast(`טעינה עדכנית נכשלה (${e.message})`, true); }
  }
  state.devices ??= await fetchJson('data/devices.json', {});
  state.devices.laptops ??= [];
  state.devices.tablets ??= [];
  render();
}

/* ---------- Helpers ---------- */
function nextId(kind) {
  return state.devices[kind].reduce((m, d) => Math.max(m, Number(d.id) || 0), 0) + 1;
}

function findSerial(serial, except) {
  const key = normSerial(serial);
  for (const k of Object.keys(KINDS)) {
    const hit = state.devices[k].find((x) => normSerial(x.serial) === key && !(except && except.kind === k && except.id === x.id));
    if (hit) return { kind: k, ...hit };
  }
  return null;
}

/* ---------- Render ---------- */
function render() {
  renderSummary();
  renderTable();
  const repo = state.config.repo;
  $('#foot').innerHTML = `עודכן ${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
    + (repo ? ` · <a href="https://github.com/${esc(repo)}/commits/${esc(state.config.branch || 'main')}/data" target="_blank" rel="noopener">היסטוריית שינויים</a>` : '');
}

function renderSummary() {
  const all = ['laptops', 'tablets'].flatMap((k) => state.devices[k].map((d) => ({ ...d, kind: k }))).filter((d) => !d.retired);
  const by = (fn) => {
    const l = all.filter((d) => d.kind === 'laptops' && fn(d)).length;
    const t = all.filter((d) => d.kind === 'tablets' && fn(d)).length;
    return { value: l + t, split: `${l} מחשבים · ${t} טאבלטים` };
  };
  const cards = [
    { label: '💻 מחשבים', value: all.filter((d) => d.kind === 'laptops').length, tab: 'laptops', filter: 'all' },
    { label: '📱 טאבלטים', value: all.filter((d) => d.kind === 'tablets').length, tab: 'tablets', filter: 'all' },
    { label: '✅ תקינים', ...by((d) => (d.status || 'ok') === 'ok'), cls: 'ok', filter: 'ok' },
    { label: '❌ תקולים / בתיקון', ...by((d) => d.status === 'faulty' || d.status === 'repair'), cls: 'bad', filter: 'broken' },
    { label: '⚠ צריכים עדכון', ...by((d) => d.update === 'needed'), cls: 'warn', filter: 'update' },
  ];
  $('#summary').innerHTML = cards.map((c, i) => `
    <button class="stat ${c.cls || ''}" data-i="${i}">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      ${c.split ? `<div class="split">${c.split}</div>` : ''}
    </button>`).join('');
  $('#summary').querySelectorAll('.stat').forEach((el) => {
    el.onclick = () => {
      const c = cards[el.dataset.i];
      if (c.tab) setTab(c.tab);
      setFilter(c.filter);
    };
  });
  $('#countLaptops').textContent = state.devices.laptops.filter((d) => !d.retired).length;
  $('#countTablets').textContent = state.devices.tablets.filter((d) => !d.retired).length;
}

function matches(d) {
  const f = state.filter;
  if (f === 'retired') { if (!d.retired) return false; } else if (d.retired) return false;
  const status = d.status || 'ok';
  if (f === 'ok' && status !== 'ok') return false;
  if (f === 'faulty' && status !== 'faulty') return false;
  if (f === 'repair' && status !== 'repair') return false;
  if (f === 'broken' && status === 'ok') return false;
  if (f === 'update' && d.update !== 'needed') return false;
  const q = state.search.trim().toLowerCase();
  if (!q) return true;
  if (/^#?\d+$/.test(q)) return String(d.id) === q.replace('#', '') || String(d.serial).toLowerCase().includes(q);
  return [d.serial, d.manufacturer, d.model, d.location, d.notes, d.os]
    .some((v) => String(v ?? '').toLowerCase().includes(q));
}

function visibleRows(kind) {
  return state.devices[kind].filter(matches).sort((a, b) => a.id - b.id);
}

function renderTable() {
  const kind = state.tab;
  const rows = visibleRows(kind);
  $('#tbody').innerHTML = rows.map((d) => {
    const st = STATUS[d.status] || STATUS.ok;
    const up = UPDATE[d.update || ''] || UPDATE[''];
    return `
      <tr class="${d.retired ? 'retired' : ''}">
        <td><span class="num">${d.id}</span></td>
        <td class="cell-serial"><span class="serial">${esc(d.serial)}</span></td>
        <td class="cell-model">${esc(d.manufacturer)} ${esc(d.model)}</td>
        <td data-label="מצב"><button class="badge ${st.cls}" data-act="status" data-id="${d.id}" title="לחיצה לשינוי מצב">${st.icon} ${st.label}</button>${d.retired ? ' <span class="badge info">הוסר</span>' : ''}</td>
        <td data-label="מערכת" class="os">${esc(d.os)}</td>
        <td data-label="עדכון"><span class="badge ${up.cls}">${up.label}</span></td>
        <td data-label="מיקום">${esc(d.location)}</td>
        <td data-label="הערות" class="notes">${esc(d.notes)}</td>
        <td data-label="עודכן" class="muted">${esc(fmtDate(d.updatedAt || d.addedAt))}</td>
        <td><button class="btn small ghost" data-act="edit" data-id="${d.id}">✏️ עריכה</button></td>
      </tr>`;
  }).join('');

  const empty = $('#empty');
  empty.hidden = rows.length > 0;
  empty.textContent = state.devices[kind].length === 0
    ? `עדיין אין ${KINDS[kind].many} במערכת. לחצו "הוסף מכשיר" כדי להתחיל.`
    : 'אין מכשירים שמתאימים לחיפוש.';

  $('#tbody').querySelectorAll('[data-act]').forEach((el) => {
    const id = Number(el.dataset.id);
    el.onclick = () => (el.dataset.act === 'status' ? cycleStatus(kind, id) : openDeviceDialog({ kind, id }));
  });
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  storageSet('technoda.tab', tab);
  renderTable();
}
function setFilter(f) {
  state.filter = f;
  $('#filter').value = f;
  renderTable();
}

/* ---------- Editing ---------- */
async function cycleStatus(kind, id) {
  const d = state.devices[kind].find((x) => x.id === id);
  const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(d.status || 'ok') + 1) % STATUS_CYCLE.length];
  try {
    await mutateDevices((data) => {
      const target = data[kind].find((x) => x.id === id);
      if (target) Object.assign(target, { status: next, updatedAt: today() });
    }, `${KINDS[kind].one} #${id}: ${STATUS[next].label}`);
    toast(`${KINDS[kind].one} #${id} סומן כ${STATUS[next].label}`);
  } catch (e) {
    toast(`השמירה נכשלה: ${e.message}`, true);
  }
}

const FIELDS = ['serial', 'manufacturer', 'model', 'location', 'notes', 'os'];

function openDeviceDialog(ref) {
  const form = $('#deviceForm');
  form.reset();
  state.editing = ref;
  const d = ref ? state.devices[ref.kind].find((x) => x.id === ref.id) : null;
  const kind = ref ? ref.kind : state.tab;

  $('#dlgTitle').textContent = ref ? `עריכת ${KINDS[kind].one} #${d.id}` : 'הוספת מכשיר';
  form.kind.value = kind;
  form.kind.disabled = !!ref;
  form.id.value = ref ? d.id : nextId(kind);
  for (const f of FIELDS) form[f].value = d?.[f] ?? '';
  form.status.value = d?.status || 'ok';
  form.update.value = d?.update || '';

  $('#retireBtn').hidden = !ref;
  $('#retireBtn').textContent = d?.retired ? 'החזר למלאי' : 'הסר מהמלאי';
  $('#deleteBtn').hidden = !ref;
  $('#deviceDlg').showModal();
  (ref ? form.status : form.serial).focus();
}

async function saveDevice(e) {
  e.preventDefault();
  const form = e.target;
  const ref = state.editing;
  const kind = ref ? ref.kind : form.kind.value;
  const rec = { id: Number(form.id.value), status: form.status.value, update: form.update.value, updatedAt: today() };
  for (const f of FIELDS) rec[f] = form[f].value.trim();

  if (!Number.isInteger(rec.id) || rec.id < 1) return toast('מספר פנימי לא תקין', true);
  if (!rec.serial) return toast('חובה למלא מספר סידורי', true);
  const takenId = state.devices[kind].find((x) => x.id === rec.id && (!ref || x.id !== ref.id));
  if (takenId) return toast(`המספר ${rec.id} כבר תפוס (${takenId.serial})`, true);
  const dup = findSerial(rec.serial, ref);
  if (dup) return toast(`המספר הסידורי כבר רשום ל${KINDS[dup.kind].one} #${dup.id}`, true);

  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await mutateDevices((data) => {
      if (ref) {
        const i = data[kind].findIndex((x) => x.id === ref.id);
        if (i < 0) throw new Error('המכשיר לא נמצא – אולי נמחק ע"י מישהו אחר');
        if (rec.id !== ref.id && data[kind].some((x) => x.id === rec.id)) throw new Error(`המספר ${rec.id} נתפס בינתיים`);
        data[kind][i] = { ...data[kind][i], ...rec };
      } else {
        if (data[kind].some((x) => x.id === rec.id)) throw new Error(`המספר ${rec.id} נתפס בינתיים`);
        data[kind].push({ ...rec, addedAt: today(), retired: false });
      }
      data[kind].sort((a, b) => a.id - b.id);
    }, ref ? `עדכון ${KINDS[kind].one} #${rec.id}` : `הוספת ${KINDS[kind].one} #${rec.id} (${rec.serial})`);
    $('#deviceDlg').close();
    if (kind !== state.tab) setTab(kind);
    toast(ref ? 'נשמר ✓' : `${KINDS[kind].one} #${rec.id} נוסף ✓`);
  } catch (err) {
    toast(`השמירה נכשלה: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

async function toggleRetire() {
  const { kind, id } = state.editing;
  const retire = !state.devices[kind].find((x) => x.id === id).retired;
  try {
    await mutateDevices((data) => {
      const t = data[kind].find((x) => x.id === id);
      t.retired = retire;
      t.updatedAt = today();
      if (retire) t.retiredAt = today(); else delete t.retiredAt;
    }, `${retire ? 'הסרת' : 'החזרת'} ${KINDS[kind].one} #${id}`);
    $('#deviceDlg').close();
    toast(retire ? `${KINDS[kind].one} #${id} הוסר מהמלאי (אפשר לשחזר דרך הסינון "הוסרו")` : 'הוחזר למלאי ✓');
  } catch (e) {
    toast(`השמירה נכשלה: ${e.message}`, true);
  }
}

async function deleteDevice() {
  const { kind, id } = state.editing;
  if (!confirm(`למחוק לצמיתות את ${KINDS[kind].one} #${id}? (ההיסטוריה נשמרת ב-git)`)) return;
  try {
    await mutateDevices((data) => {
      data[kind] = data[kind].filter((x) => x.id !== id);
    }, `מחיקת ${KINDS[kind].one} #${id}`);
    $('#deviceDlg').close();
    toast('נמחק');
  } catch (e) {
    toast(`המחיקה נכשלה: ${e.message}`, true);
  }
}

/* ---------- Export ---------- */
function exportCsv() {
  const kind = state.tab;
  const head = ['מספר', 'מספר סידורי', 'יצרן', 'דגם', 'מצב', 'מערכת', 'עדכון', 'מיקום', 'הערות', 'עודכן', 'הוסר'];
  const lines = visibleRows(kind).map((d) => [
    d.id, d.serial, d.manufacturer, d.model, (STATUS[d.status] || STATUS.ok).label, d.os,
    (UPDATE[d.update || ''] || UPDATE['']).label.replace(/^[⚠✓]\s*/, ''), d.location, d.notes,
    fmtDate(d.updatedAt || d.addedAt), d.retired ? 'כן' : '',
  ]);
  const csv = [head, ...lines].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${KINDS[kind].many}-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Theme ---------- */
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  storageSet('technoda.theme', next);
}

/* ---------- Wire up ---------- */
applyTheme(storageGet('technoda.theme'));
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => setTab(t.dataset.tab)));
$('#search').oninput = (e) => { state.search = e.target.value; renderTable(); };
$('#filter').onchange = (e) => setFilter(e.target.value);
$('#addBtn').onclick = () => openDeviceDialog(null);
$('#exportBtn').onclick = exportCsv;
$('#themeBtn').onclick = toggleTheme;
$('#refreshBtn').onclick = () => loadAll().then(() => toast('רוענן ✓'));
$('#deviceForm').onsubmit = saveDevice;
$('#cancelBtn').onclick = () => $('#deviceDlg').close();
$('#retireBtn').onclick = toggleRetire;
$('#deleteBtn').onclick = deleteDevice;
$('#deviceForm').kind.onchange = (e) => {
  if (!state.editing) $('#deviceForm').id.value = nextId(e.target.value);
};

const savedTab = storageGet('technoda.tab');
if (savedTab && KINDS[savedTab]) setTab(savedTab);
loadAll();
