// Installable-app / offline / "two apps on one github.io site" test.
// Serves the repo under /regen/ next to a fake other app that registers a site-wide service worker (scope "/"),
// like another GitHub Pages project on the same username.github.io address.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OTHER = { '/other/': ['text/html', '<!doctype html><html><head><meta charset="utf-8"><link rel="manifest" href="/other/manifest.json"></head><body><h1 id="g">Other app</h1><script>localStorage.setItem("projects","other-app-data");navigator.serviceWorker.register("/sw-root.js",{scope:"/"});</script></body></html>'],
  '/other/manifest.json': ['application/json', '{"name":"Other app","start_url":"/","scope":"/","display":"standalone"}'],
  '/sw-root.js': ['text/javascript', 'self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>{if(e.request.mode==="navigate")e.respondWith(fetch(e.request));});'] };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (OTHER[u]) { res.writeHead(200, { 'Content-Type': OTHER[u][0] }); return res.end(OTHER[u][1]); }
  if (u.startsWith('/regen/')) { let rel = u.slice(7); if (!rel || rel.endsWith('/')) rel += 'index.html'; const f = path.join(ROOT, rel); if (f.startsWith(ROOT) && fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f)); } }
  res.writeHead(404); res.end();
});
let pass = 0, fail = 0; const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log('FAIL', n, x); } };
server.listen(0, async () => {
  const base = 'http://localhost:' + server.address().port;
  process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
  const b = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\./, r => { const u = r.request().url(); if (u.includes('pdf-lib')) return r.fulfill({ path: require.resolve('pdf-lib/dist/pdf-lib.min.js'), contentType: 'application/javascript' }); if (u.includes('jszip')) return r.fulfill({ path: require.resolve('jszip/dist/jszip.min.js'), contentType: 'application/javascript' }); return r.fulfill({ status: 200, body: '', contentType: 'text/css' }); });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(base + '/other/'); await pg.evaluate(() => navigator.serviceWorker.ready); await pg.reload();
  ok('other app owns the whole site', /sw-root\.js$/.test(await pg.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL)));
  await pg.goto(base + '/regen/'); await pg.waitForSelector('text=Projects'); await pg.evaluate(() => navigator.serviceWorker.ready); await pg.reload(); await pg.waitForSelector('text=Projects');
  ok('our app is controlled by its own service worker', /\/regen\/sw\.js$/.test(await pg.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL)));
  const cdp = await ctx.newCDPSession(pg), man = await cdp.send('Page.getAppManifest');
  ok('manifest loads without errors', /\/regen\/manifest\.webmanifest$/.test(man.url) && !man.errors.length, JSON.stringify(man.errors));
  const id = await cdp.send('Page.getAppId'); ok('own app id (not the site root)', /regen-site-commissioning$/.test(id.appId), id.appId);
  const inst = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.filter(e => e.errorId !== 'in-incognito');
  ok('installable', inst.length === 0, JSON.stringify(inst));
  await pg.click('text=Open sample project'); await new Promise(r => setTimeout(r, 1500)); await pg.click('text=‹ Projects');
  await ctx.setOffline(true); await pg.reload(); await pg.waitForSelector('text=Sample Site', { timeout: 10000 });
  ok('opens offline with saved projects', true);
  await pg.click('text=Sample Site');
  ok('A4 PDF works offline', (await pg.evaluate(async () => (await __buildPdf()).length)) > 10000);
  ok('Excel export works offline', (await pg.evaluate(async () => (await __buildWorkbook()).bytes.length)) > 10000);
  await ctx.setOffline(false);
  await pg.goto(base + '/other/');
  ok('other app unaffected', (await pg.textContent('#g')) === 'Other app' && (await pg.evaluate(() => localStorage.getItem('projects'))) === 'other-app-data');
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close(); server.close();
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
});
