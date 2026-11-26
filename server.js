'use strict';
// DocsRot — real server (Node.js, zero dependencies).
// Serves the UI and runs the real work server-side via /api/* endpoints.
//   npm start  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain', '.txt': 'text/plain' };

function send(res, code, obj, type) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { resolve({ _raw: s }); } });
    req.on('error', reject);
  });
}
async function fetchTimeout(url, opts, ms) {
  opts = opts || {}; ms = ms || 12000;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: c.signal, redirect: 'follow', headers: { 'User-Agent': 'DocsRot/1.0.0 (https://alltoolfree.site)', ...(opts.headers || {}) } });
  } finally { clearTimeout(t); }
}
function store(name, rec) {
  const f = path.join(DATA, name + '.json');
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  arr.push({ ...rec, at: new Date().toISOString() });
  if (arr.length > 500) arr = arr.slice(-500);
  fs.writeFileSync(f, JSON.stringify(arr, null, 2));
  return arr;
}
function loadAll(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8')); } catch (e) { return []; }
}
function saveAll(name, arr) {
  fs.writeFileSync(path.join(DATA, name + '.json'), JSON.stringify(arr, null, 2));
}


async function handleCheck(body) {
  const base = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(base)) return { error: 'Enter a full http(s) URL' };
  const r = await fetchTimeout(base, {}, 15000);
  const html = await r.text();
  const links = [...new Set([...html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map(m => m[1]).filter(h => /^https?:\/\//i.test(h) || h.startsWith('/')))].map(h => h.startsWith('/') ? new URL(h, base).href : h).slice(0, 40);
  const results = [];
  for (const u of links) {
    try { const hr = await fetchTimeout(u, { method: 'HEAD' }, 6000); results.push({ url: u, status: hr.status, ok: hr.ok }); }
    catch (e) { results.push({ url: u, status: 0, ok: false }); }
  }
  const staleDays = Number(body.staleDays || 180);
  const dateMatch = html.match(/(datetime|datePublished|dateModified|lastmod)[^0-9]*(\d{4}-\d{2}-\d{2})/i);
  let ageDays = null;
  if (dateMatch) ageDays = Math.floor((Date.now() - new Date(dateMatch[2]).getTime()) / 86400000);
  const broken = results.filter(x => !x.ok).length;
  store('history', { base, checked: results.length, broken, ageDays });
  return { ok: true, base, checked: results.length, broken, ageDays, stale: ageDays !== null && ageDays > staleDays, results };
}


const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/health') return send(res, 200, { ok: true, product: 'docsrot', version: '1.0.0', time: new Date().toISOString() });
    if (req.method === 'GET' && u.pathname === '/api/history') return send(res, 200, loadAll('history'));
    if (req.method === 'POST' && u.pathname === '/api/check') {
      const body = await readBody(req);
      const out = await handleCheck(body);
      return send(res, 200, out);
    }
    if (req.method === 'GET') {
      const p = u.pathname === '/' ? '/index.html' : u.pathname;
      const fp = path.join(__dirname, p);
      if (!fp.startsWith(__dirname)) return send(res, 403, { error: 'forbidden' });
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        return fs.createReadStream(fp).pipe(res);
      }
      return send(res, 404, { error: 'not found' });
    }
    return send(res, 404, { error: 'unknown route' });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
});
server.listen(PORT, () => console.log('DocsRot listening on http://localhost:' + PORT));

