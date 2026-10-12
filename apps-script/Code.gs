/**
 * Technoda devices – save API.
 * Runs on Google Apps Script and holds the GitHub token (in Script Properties, never in the site).
 * The site calls it to read and write data/devices.json in the GitHub repo.
 *
 * Script Properties (Project Settings → Script Properties):
 *   GITHUB_TOKEN  – Fine-grained token, Contents: Read and write, this repo only
 *   GITHUB_REPO   – owner/repo, e.g. my-user/technoda-devices
 *   GITHUB_BRANCH – optional, default "main"
 */

const FILE = 'data/devices.json';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === 'read') return json(readDevices_());
    if (req.action === 'write') return json(writeDevices_(req));
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'technoda-devices' });
}

function settings_() {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('GITHUB_TOKEN');
  const repo = p.getProperty('GITHUB_REPO');
  if (!token || !repo) throw new Error('GITHUB_TOKEN / GITHUB_REPO not set in Script Properties');
  return { token: token, repo: repo, branch: p.getProperty('GITHUB_BRANCH') || 'main' };
}

function github_(method, path, payload) {
  const s = settings_();
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + s.repo + '/' + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + s.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  return { status: res.getResponseCode(), body: res.getContentText() };
}

function readDevices_() {
  const s = settings_();
  const r = github_('get', 'contents/' + FILE + '?ref=' + encodeURIComponent(s.branch));
  if (r.status !== 200) return { ok: false, status: r.status, error: 'GitHub ' + r.status };
  const meta = JSON.parse(r.body);
  const text = Utilities.newBlob(Utilities.base64Decode(meta.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  return { ok: true, data: JSON.parse(text), sha: meta.sha };
}

function writeDevices_(req) {
  const data = req.data;
  if (!data || !Array.isArray(data.laptops) || !Array.isArray(data.tablets)) {
    return { ok: false, error: 'invalid data' };
  }
  const s = settings_();
  const content = Utilities.base64Encode(JSON.stringify(data, null, 2) + '\n', Utilities.Charset.UTF_8);
  const r = github_('put', 'contents/' + FILE, {
    message: String(req.message || 'update devices').slice(0, 200),
    content: content,
    sha: req.sha,
    branch: s.branch,
  });
  if (r.status >= 300) return { ok: false, status: r.status, error: 'GitHub ' + r.status };
  return { ok: true };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
