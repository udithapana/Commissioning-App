// End-to-end tests for the Site Commissioning app (Playwright + Chromium).
// Usage: node e2e.js <path-to-html>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const HTML = path.resolve(process.argv[2] || '../index.html');
const OUT = path.resolve('out'); fs.mkdirSync(OUT, { recursive: true });
const PDFLIB = require.resolve('pdf-lib/dist/pdf-lib.min.js'), JSZIPLIB = require.resolve('jszip/dist/jszip.min.js');
const LAUNCH = { args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL', name, extra); } };
const T0 = Date.now(); const sec = n => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${n}`);
const RUN = n => !process.env.ONLY || process.env.ONLY.split(',').includes(String(n));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* shared in-memory "db" used by the claude.use('db') mock, so two pages can share data */
const STORE = new Map(); const DOWNLOADS = [];
async function newPage(browser, { mock = false, width = 420, height = 900, scheme = 'light', ctx = null } = {}) {
  const context = ctx || await browser.newContext({ viewport: { width, height }, acceptDownloads: true, colorScheme: scheme });
  if (mock && !context.__mocked) {
    context.__mocked = true;
    await context.exposeFunction('__dbGet', p => (STORE.has(p) ? STORE.get(p) : null));
    await context.exposeFunction('__dbSet', (p, s) => { STORE.set(p, s); });
    await context.exposeFunction('__dbDel', p => { STORE.delete(p); });
    await context.exposeFunction('__dbList', c => JSON.stringify([...STORE].filter(([k]) => k.startsWith(c + '/') && k.split('/').length === c.split('/').length + 1).map(([k, v]) => [k.split('/').pop(), v])));
    await context.exposeFunction('__dlSave', (name, b64) => { DOWNLOADS.push({ name, data: Buffer.from(b64, 'base64') }); });
    await context.addInitScript(() => {
      const mkDoc = p => ({
        id: p.split('/').pop(), path: p,
        get: async () => { const v = await window.__dbGet(p); return { id: p.split('/').pop(), exists: v != null, data: () => (v == null ? undefined : Object.freeze(JSON.parse(v))) }; },
        set: async d => { const s = JSON.stringify(d); if (new Blob([s]).size > 262144) { const e = new Error('document over 256 KiB'); e.code = 'invalid_argument'; throw e; } await window.__dbSet(p, s); },
        delete: async () => window.__dbDel(p)
      });
      const db = { doc: mkDoc, collection: c => ({ get: async () => { const docs = JSON.parse(await window.__dbList(c)); return { docs: docs.map(([id, v]) => ({ id, exists: true, data: () => Object.freeze(JSON.parse(v)) })), size: docs.length, empty: !docs.length }; }, doc: id => mkDoc(c + '/' + id) }) };
      const toB64 = async data => { const blob = data instanceof Blob ? data : new Blob([data]); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
      const downloads = { save: async ({ filename, data }) => { await window.__dlSave(filename, await toB64(data)); return { status: 'saved' }; } };
      window.claude = { use: async n => (n === 'db' ? db : n === 'downloads' ? downloads : null) };
    });
  }
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('PAGEERROR ' + (e.stack || e.message).split('\n').slice(0, 4).join(' <- ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => { page.errors.push('DIALOG ' + d.message()); d.dismiss(); });
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('pdf-lib')) return r.fulfill({ path: PDFLIB, contentType: 'application/javascript' }); if (u.includes('jszip')) return r.fulfill({ path: JSZIPLIB, contentType: 'application/javascript' }); if (u.startsWith('file:') || u.startsWith('blob:') || u.startsWith('data:')) return r.continue(); return r.abort(); });
  await page.goto('file://' + HTML);
  await page.waitForSelector('#app main');
  return page;
}
const tab = async (pg, label) => { await pg.click(`.tab:has-text("${label}")`); await sleep(60); };
const ev = (pg, fn, ...a) => pg.evaluate(fn, ...a);
const noErr = (pg, name) => { ok(name + ': no console/page errors', pg.errors.length === 0, pg.errors.slice(0, 3).join(' | ')); pg.errors.length = 0; };
async function dl(pg, clickFn) { let d; try { [d] = await Promise.all([pg.waitForEvent('download', { timeout: 20000 }), clickFn()]); } catch (e) { await pg.screenshot({ path: path.join(OUT, 'dl_fail.png') }).catch(() => {}); console.log('    download missing; app message:', await pg.evaluate(() => S.msg + ' | busy=' + S.busy + ' | tab=' + S.tab).catch(() => '?'), pg.errors.join(' | ')); throw e; } const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return f; }
const pdfText = f => execSync(`pdftotext -layout "${f}" -`).toString();
const pdfPages = f => +execSync(`pdfinfo "${f}" | awk '/^Pages/{print $2}'`).toString().trim();
const TABS = ['Overview', 'Project', 'Equipment & Limits', 'Visual', 'Inverters & DC', 'Panel Serials', 'AC Output', 'AC Ins. & Earth', 'Thermal', 'Battery', 'Protection', 'Punch List', 'Photos', 'Sign-off', 'Report PDF', 'Excel', 'History & Backup'];

(async () => {
  const browser = await chromium.launch(LAUNCH);

  /* ---------- 1. load, empty state, every tab of a new project ---------- */
  let pg = await newPage(browser);
  sec('1. load + new project + every tab');
  if (RUN(1)) {
  ok('home shows empty state', await pg.isVisible('text=No projects yet'));
  await pg.click('text=Open sample project'); await sleep(200); ok('opening the sample shows no stray toast', await pg.isHidden('#toast')); await pg.click('text=‹ Projects'); await ev(pg, () => { projects.length = 0; lsWrite(); render(); });
  await pg.click('text=New project'); await sleep(100);
  for (const t of TABS) { await tab(pg, t); ok(`tab ${t} renders`, await pg.isVisible('main h1')); }
  noErr(pg, 'new project tabs');

  /* ---------- 2. fill every input on every tab, verify it lands in the data ---------- */
  }
  sec('2. fill every field');
  if (RUN(2)) {
  await ev(pg, () => { P.applic.battery = 'Yes'; P.invs.push(newInv(0, P)); P.invs[0].strings.push(newStr('1', '1', '20')); P.punch.push(newPunch()); render(); });
  let filledCount = 0, mismatch = [];
  for (const t of TABS) {
    await tab(pg, t);
    const n = await pg.$$eval('[data-p]:is(input,textarea,select)', els => els.length);
    for (let i = 0; i < n; i++) {
      const el = (await pg.$$('[data-p]:is(input,textarea,select)'))[i]; if (!el) continue;
      const info = await el.evaluate(e => ({ tag: e.tagName, type: e.type, p: e.dataset.p, opts: e.tagName === 'SELECT' ? [...e.options].map(o => o.value).filter(Boolean) : [] }));
      let v;
      if (info.tag === 'SELECT') { if (!info.opts.length) continue; v = info.opts[0]; await el.selectOption(v); }
      else if (info.type === 'date') { v = '2026-10-09'; await el.fill(v); }
      else if (info.type === 'time') { v = '09:30'; await el.fill(v); }
      else { v = /lim\./.test(info.p) ? null : 'T' + i; if (v === null) continue; await el.fill(v); }
      const got = await ev(pg, p => get(P, p), info.p);
      filledCount++; if (got !== v) mismatch.push(`${info.p}=${got}≠${v}`);
    }
  }
  ok(`all ${filledCount} fields write to the project`, mismatch.length === 0, mismatch.slice(0, 5).join(', '));
  noErr(pg, 'fill every field');

  /* ---------- 3. click every button on every tab (monkey test) ---------- */
  }
  sec('3. click every button');
  if (RUN(3)) {
  await pg.click('text=‹ Projects'); await pg.click('text=Open sample project'); await sleep(200);
  for (const t of TABS) {
    await tab(pg, t);
    const labels = await pg.$$eval('main [data-act]', els => els.map((e, i) => i));
    for (const i of labels) {
      const b = (await pg.$$('main [data-act]'))[i]; if (!b) continue;
      const act = await b.evaluate(e => e.dataset.act);
      if (['home', 'tab', 'import', 'pdf', 'phpdf', 'export', 'backupall', 'exportser', 'histdl', 'goto', 'open', 'xlexport', 'xlblank'].includes(act)) continue; // covered elsewhere / navigates away
      if (!(await b.isVisible()) || (await b.isDisabled())) continue;
      await b.click().catch(() => {}); await sleep(30);
      if (await b.evaluate(e => e.isConnected && e.dataset.armed === '1')) { await b.click().catch(() => {}); await sleep(30); }
      if (!(await pg.$('.tab[aria-selected=true]'))) { await pg.click('text=Open sample project').catch(() => {}); }
      const cur = await pg.$eval('.tab[aria-selected=true]', e => e.textContent.trim()).catch(() => '');
      if (cur && cur !== t) await tab(pg, t);
    }
  }
  noErr(pg, 'monkey click every button');

  /* ---------- 4. DC workflow through the UI ---------- */
  }
  sec('4. DC workflow');
  if (RUN(4)) {
  await pg.click('text=‹ Projects'); await pg.click('text=New project'); await tab(pg, 'Inverters & DC');
  await pg.click('text=Add first inverter');
  await pg.fill('input[data-g=m]', '2'); await pg.fill('input[data-g=s]', '2'); await pg.fill('input[data-g=mods]', '20'); await pg.click('text=Generate string list');
  ok('generator made 4 strings', (await ev(pg, () => P.invs[0].strings.length)) === 4);
  const fillS = async (j, o) => { for (const [k, v] of Object.entries(o)) await pg.fill(`[data-p="invs.0.strings.${j}.${k}"]`, v); };
  await fillS(0, { voc: '1000', ip: '500', in: '500', ipn: '500' }); await pg.click('[data-p="invs.0.strings.0.pol"][data-v="OK"]');
  ok('string 1 Pass badge', (await pg.textContent('[data-k="dc:0:0"]')).includes('Pass'));
  await fillS(1, { voc: '1,120' });
  ok('thousands separator Voc 1,120 → deviation shown', (await pg.textContent('[data-k="dev:0:1"]')).includes('+5.66'), await pg.textContent('[data-k="dev:0:1"]'));
  ok('string 1 becomes Fail after deviation', (await pg.textContent('[data-k="dc:0:0"]')).includes('Fail'));
  await fillS(1, { voc: '1000' }); ok('back to Pass', (await pg.textContent('[data-k="dc:0:0"]')).includes('Pass'));
  await pg.click('[data-p="invs.0.strings.0.pol"][data-v="OK"]'); ok('toggle polarity off → Incomplete', (await pg.textContent('[data-k="dc:0:0"]')).includes('Incomplete'));
  await pg.click('text=Duplicate (layout only)'); ok('duplicate inverter', (await ev(pg, () => P.invs.length === 2 && P.invs[1].strings.length === 4 && P.invs[1].strings[0].voc === '')));
  await pg.click('text=Delete inverter'); await pg.click('text=Tap again'); ok('delete inverter needs confirm', (await ev(pg, () => P.invs.length)) === 1);
  await tab(pg, 'Project'); await pg.selectOption('[data-p="info.itype"]', 'Off-grid'); ok('off-grid switches battery test on', (await ev(pg, () => P.applic.battery)) === 'Yes');
  await pg.selectOption('[data-p="info.itype"]', 'Grid-tied'); ok('grid-tied switches battery test off', (await ev(pg, () => P.applic.battery)) === 'No');
  await tab(pg, 'Overview'); ok('switched-off section shows no open items', (await ev(pg, () => summary().find(r => r.key === 'battery').open)) === 0);
  noErr(pg, 'DC workflow');

  /* ---------- 5. serial numbers ---------- */
  }
  sec('5. serials');
  if (RUN(5)) {
  await tab(pg, 'Panel Serials');
  await pg.selectOption('select[data-st]', { index: 1 });
  for (const s of ['SN001', 'SN002']) { await pg.fill('#serin', s); await pg.press('#serin', 'Enter'); }
  await pg.fill('#serin', 'sn001'); await pg.press('#serin', 'Enter');
  ok('duplicate (case-insensitive) blocked', (await ev(pg, () => P.pser.length)) === 2);
  ok('serial input keeps focus for scanner', (await ev(pg, () => document.activeElement && document.activeElement.id)) === 'serin');
  await ev(pg, () => { P.invs[0].strings[0].mods = '3'; render(); });
  await pg.fill('#serin', 'SN003'); await pg.press('#serin', 'Enter');
  ok('auto-advance to next string when full', (await ev(pg, () => S.sertarget === P.invs[0].strings[1].id)));
  await pg.click('button:has-text("Paste a list")'); await pg.fill('#serpaste', 'A1\nA2,A3;A4\tA5\n\nA1'); await pg.click('text=Add pasted list');
  ok('paste list adds 5, skips dup', (await ev(pg, () => P.pser.length)) === 8);
  // two identical serials stored in different strings (e.g. imported) – removing one must remove the right one
  await ev(pg, () => { P.pser.push({ sn: 'DUP', sid: P.invs[0].strings[2].id }, { sn: 'DUP', sid: P.invs[0].strings[3].id }); render(); });
  await pg.click(`[data-act=delser][data-sn="DUP"] >> nth=1`);
  ok('delete chip removes the serial from that string', (await ev(pg, () => P.pser.filter(x => x.sn === 'DUP').map(x => P.invs[0].strings.findIndex(s => s.id === x.sid)).join())) === '2');
  await pg.fill('#serin', '=HYPERLINK("http://x")'); await pg.press('#serin', 'Enter');
  const csv = await dl(pg, () => pg.click('text=Download CSV'));
  ok('CSV neutralises formula injection', fs.readFileSync(csv, 'utf8').includes(`"'=HYPERLINK(""http://x"")"`), fs.readFileSync(csv, 'utf8').split('\r\n').pop());
  const csvTxt = fs.readFileSync(csv, 'utf8'); ok('CSV has header + rows', csvTxt.split('\r\n').length === 1 + (await ev(pg, () => P.pser.length)), csvTxt.slice(0, 80));
  noErr(pg, 'serials');

  /* ---------- 6. persistence ---------- */
  }
  sec('6. persistence');
  if (RUN(6)) {
  await tab(pg, 'Project'); await pg.fill('[data-p="info.name"]', 'Persist Test'); await sleep(1500);
  await pg.reload(); await pg.waitForSelector('#app main');
  ok('project survives reload', await pg.isVisible('text=Persist Test'));
  await pg.click('text=Persist Test'); await tab(pg, 'Project');
  await pg.fill('[data-p="info.client"]', 'Typed then reloaded fast'); await pg.reload(); await pg.waitForSelector('#app main');
  const fastSaved = await ev(pg, () => (JSON.parse(localStorage.getItem('sca.projects.v1')).find(p => p.info.name === 'Persist Test') || {}).info.client);
  ok('edit saved even when the page is closed within a second', fastSaved === 'Typed then reloaded fast', String(fastSaved));
  noErr(pg, 'persistence');

  /* ---------- 7. security: hostile data in fields and imported files ---------- */
  }
  sec('7. security');
  if (RUN(7)) {
  const X = '"><img src=x onerror="window.__xss=(window.__xss||0)+1">';
  await pg.click('text=Persist Test');
  await ev(pg, X => { P.info.name = X; P.info.address = X; P.info.date = X; P.invs[0].loc = X; P.invs[0].strings[0].mppt = X; P.pser.push({ sn: X, sid: '' }); P.punch.push(Object.assign(newPunch(), { issue: X, loc: X })); P.ac.rows[0].pt = X; P.photos.push({ id: 'ph1', cat: X, inv: X, cap: X, ts: Date.now() }); touch(); }, X);
  for (const t of TABS) await tab(pg, t);
  await pg.click('text=‹ Projects'); await sleep(300);
  ok('no script runs from typed text', !(await ev(pg, () => window.__xss)), 'xss count ' + (await ev(pg, () => window.__xss)));
  const evil = { type: 'sca-project', project: { id: 'x" onmouseover="window.__xss=1" data-a="', info: { name: 'Evil import', date: '<img src=x onerror="window.__xss=1">' }, invs: [{ id: '"><img src=x onerror="window.__xss=1">', loc: 'L', strings: [{ id: '"><svg onload="window.__xss=1">', mppt: '1' }] }], photos: [{ id: '"><img src=x onerror="window.__xss=1">', cat: 'c', inv: '', cap: '', ts: 1 }], pser: [{ sn: 'Z', sid: '"><img src=x onerror="window.__xss=1">' }], applic: { 'dc:"><img src=x onerror="window.__xss=1">': 'No' } } };
  fs.writeFileSync(path.join(OUT, 'evil.json'), JSON.stringify(evil));
  await pg.setInputFiles('#imp', path.join(OUT, 'evil.json')); await sleep(300);
  if (await pg.isVisible('text=Apply import')) await pg.click('text=Apply import'); await sleep(300);
  await pg.hover('text=Evil import').catch(() => {}); await pg.click('text=Evil import').catch(() => {});
  for (const t of TABS) await tab(pg, t).catch(() => {});
  await pg.click('text=‹ Projects').catch(() => {}); await sleep(200);
  ok('no script runs from imported ids', !(await ev(pg, () => window.__xss)));
  // malformed files must not break the app
  const bads = { 'notjson.json': 'this is not json', 'wrongtypes.json': JSON.stringify({ type: 'sca-project', project: { info: 5, invs: 'x', ac: { rows: 'y' }, pser: [null, 3], photos: {}, punch: [1], vis: 'z', applic: [] } }), 'array.json': '[1,2,3]', 'null.json': 'null' };
  for (const [n, c] of Object.entries(bads)) {
    fs.writeFileSync(path.join(OUT, n), c); await pg.setInputFiles('#imp', path.join(OUT, n)); await sleep(250);
    if (await pg.isVisible('text=Apply import')) { await pg.click('text=Apply import'); await sleep(250); }
  }
  ok('app still usable after malformed imports', await pg.isVisible('text=New project'));
  for (const p of await ev(pg, () => projects.map(p => p.id))) { await ev(pg, id => { P = projects.find(p => p.id === id); S.tab = 'overview'; render(); }, p); for (const t of TABS) await tab(pg, t); await ev(pg, () => { P = null; render(); }); }
  noErr(pg, 'security + malformed import (all tabs of every project)');
  // corrupt data already in storage must not stop the app from starting
  await ev(pg, () => { const l = JSON.parse(localStorage.getItem('sca.projects.v1')); l.push({ id: 'broken', invs: 'nope', info: null }); l.push(null); localStorage.setItem('sca.projects.v1', JSON.stringify(l)); });
  await pg.reload(); await sleep(300);
  ok('app starts with corrupt stored data', await pg.isVisible('text=New project'));
  noErr(pg, 'corrupt storage');
  await pg.context().close();

  /* ---------- 8. PDFs: sample, blank, stress ---------- */
  }
  sec('8. PDFs');
  if (RUN(8)) {
  pg = await newPage(browser);
  await pg.click('text=Open sample project'); await tab(pg, 'Report PDF');
  let f = await dl(pg, () => pg.click('text=Generate A4 PDF'));
  let t = pdfText(f); ok('sample PDF generated', pdfPages(f) >= 5, 'pages ' + pdfPages(f));
  ok('PDF has all sections', ['GENERAL DETAILS', 'COMMISSIONING SUMMARY', 'VISUAL & MECHANICAL', 'DC STRING TEST', 'PANEL SERIAL NUMBERS', 'AC OUTPUT TEST', 'AC INSULATION & EARTHING', 'THERMAL IMAGING', 'PROTECTION & GRID', 'PUNCH LIST', 'FINAL COMMISSIONING SIGN-OFF'].every(s => t.includes(s)), ['GENERAL DETAILS', 'PANEL SERIAL NUMBERS'].filter(s => !t.includes(s)).join());
  ok('PDF footer notice on every page', (t.match(/All rights reserved/g) || []).length === pdfPages(f));
  ok('PDF section numbers are consecutive', (() => { const n = [...t.matchAll(/^\s*(\d+)\. [A-Z]/gm)].map(m => +m[1]); return n.every((v, i) => i === 0 || v === n[i - 1] + 1); })(), [...t.matchAll(/^\s*(\d+)\. [A-Z]/gm)].map(m => m[1]).join(','));
  await pg.click('text=‹ Projects'); await pg.click('text=New project'); await tab(pg, 'Report PDF');
  f = await dl(pg, () => pg.click('text=Generate A4 PDF')); ok('blank project PDF generated', pdfPages(f) >= 3);
  // stress: many inverters/strings, long text, unicode, 3,000 serials, everything filled
  await ev(pg, () => {
    const long = 'Very long remark '.repeat(400);
    P.info.name = 'Stress test — ' + 'ශ්‍රී ලංකා 中文 Ω Δ ≤ ≥ → ✓ '.repeat(3) + 'A very long project name that keeps going and going for the header';
    P.info.address = long.slice(0, 600);
    for (let n = 0; n < 10; n++) { const inv = newInv(n, P); inv.loc = 'Room ' + n + ' ' + 'x'.repeat(120); for (let m = 1; m <= 6; m++) for (let s = 1; s <= 4; s++) { const st = newStr(String(m), String(s), '22'); st.voc = String(990 + (m * s) % 7); st.ip = 'OL'; st.in = '>999'; st.ipn = '1,000'; st.pol = 'OK'; st.rem = n === 0 && m === 1 && s === 1 ? long : ''; inv.strings.push(st); } P.invs.push(inv); }
    let k = 0; for (const inv of P.invs) for (const s of inv.strings) for (let q = 0; q < 12 && k < 3000; q++) P.pser.push({ sn: 'SER' + String(k++).padStart(7, '0'), sid: s.id });
    P.punch = Array.from({ length: 40 }, (_, i) => Object.assign(newPunch(), { issue: 'Issue ' + i + ' ' + 'detail '.repeat(i % 7 * 5), loc: 'Loc ' + i, s: ['Open', 'Closed', 'In Progress'][i % 3] }));
    P.sign.comments = long; P.applic.battery = 'Yes'; touch(); render();
  });
  f = await dl(pg, () => pg.click('text=Generate A4 PDF'));
  ok('stress PDF generated', pdfPages(f) > 10, 'pages ' + pdfPages(f)); fs.copyFileSync(f, path.join(OUT, 'stress.pdf'));
  t = pdfText(f); ok('stress PDF lists last serial', t.includes('SER0002879'));
  ok('stress PDF: OL / >999 / 1,000 insulation pass', (t.match(/Result: 24 pass, 0 fail, 0 incomplete/g) || []).length === 10, String((t.match(/Result: [^\n]*/g) || []).slice(0, 2)));
  const projBytes = await ev(pg, () => new Blob([JSON.stringify(P)]).size);
  console.log('    stress project size', Math.round(projBytes / 1024), 'KB');
  noErr(pg, 'PDFs');

  /* ---------- 9. photos + photo document ---------- */
  }
  sec('9. photos');
  if (RUN(9)) {
  await pg.click('text=‹ Projects'); await pg.click('text=Open sample project'); await tab(pg, 'Photos');
  await pg.setInputFiles('#phgal', ['fixtures/ph0.jpg', 'fixtures/ph1.jpg', 'fixtures/ph2.jpg', 'fixtures/ph3.jpg', 'fixtures/ph0.jpg', 'fixtures/ph1.jpg', 'fixtures/ph2.jpg']); await sleep(3000);
  ok('7 photos saved', (await ev(pg, () => P.photos.length)) === 7);
  ok('photos compressed to ≤ 165 KB', await ev(pg, () => P.photos.every(p => phCache[p.id] && phCache[p.id].length * 0.75 <= 165000)));
  fs.writeFileSync(path.join(OUT, 'not_image.jpg'), 'not an image');
  await pg.setInputFiles('#phgal', path.join(OUT, 'not_image.jpg')); await sleep(800);
  ok('broken image rejected cleanly', (await ev(pg, () => P.photos.length)) === 7);
  f = await dl(pg, () => pg.click('text=Download photo document (PDF)'));
  ok('photo document generated', pdfPages(f) === 3, 'pages ' + pdfPages(f));
  await pg.click('[data-act=delph] >> nth=0'); await pg.click('text=Tap again'); ok('photo deleted', (await ev(pg, () => P.photos.length)) === 6);
  await pg.reload(); await pg.click('text=Sample Site'); await tab(pg, 'Photos'); await sleep(800);
  ok('photos reload from device storage', (await pg.$$eval('img[data-ph]', a => a.filter(i => i.naturalWidth > 0).length)) === 6);
  noErr(pg, 'photos');

  /* ---------- 10. history, export / import, backup / restore ---------- */
  }
  sec('10. history / backup');
  if (RUN(10)) {
  await tab(pg, 'History & Backup'); await sleep(300);
  await pg.fill('input[data-hl]', 'QA checkpoint'); await pg.click('text=Save checkpoint now'); await sleep(300);
  await ev(pg, () => { P.info.client = 'CHANGED'; touch(); }); await sleep(1300); await tab(pg, 'History & Backup'); await sleep(200);
  await pg.click('.item:has-text("QA checkpoint") [data-act=histrestore]'); await pg.click('text=Tap again'); await sleep(500);
  ok('restore checkpoint', (await ev(pg, () => P.info.client)) === 'Sample Client (Pvt) Ltd');
  const pf = await dl(pg, () => pg.click('text=Download project file (.json)'));
  const pj = JSON.parse(fs.readFileSync(pf)); ok('project file has photos', Object.keys(pj.photos || {}).length === 6);
  pj.project.info.client = 'Edited by colleague'; pj.project.updated = Date.now() + 60000; fs.writeFileSync(path.join(OUT, 'edited.json'), JSON.stringify(pj));
  await pg.setInputFiles('#impfile', path.join(OUT, 'edited.json')); await sleep(300);
  ok('newer file defaults to replace', (await pg.$eval('select[data-imp]', s => s.value)) === 'replace');
  await pg.click('text=Apply import'); await sleep(500);
  ok('replace import applied', (await ev(pg, () => P.info.client)) === 'Edited by colleague');
  ok('checkpoint saved before import', await ev(pg, () => HM[P.id][0].label === 'Before import'));
  await pg.click('text=‹ Projects');
  const bf = await dl(pg, () => pg.click('text=Back up all projects'));
  const bj = JSON.parse(fs.readFileSync(bf)); ok('backup contains all projects', bj.items.length === (await ev(pg, () => projects.length)));
  const pg2 = await newPage(browser);
  await pg2.setInputFiles('#imp', bf); await sleep(300); await pg2.click('text=Apply import'); await sleep(1500);
  ok('restore on a fresh device', (await ev(pg2, () => projects.length)) === bj.items.length);
  await pg2.click('text=Sample Site'); await tab(pg2, 'Photos'); await sleep(800);
  ok('restored photos display', (await pg2.$$eval('img[data-ph]', a => a.filter(i => i.naturalWidth > 0).length)) === 6);
  await pg2.click('text=‹ Projects'); await pg2.setInputFiles('#imp', bf); await sleep(300);
  ok('re-importing same backup defaults to copy (not overwrite) when not newer', (await pg2.$$eval('select[data-imp]', s => s.map(x => x.value))).every(v => v === 'copy'));
  await pg2.click('text=Cancel');
  noErr(pg, 'history/backup'); noErr(pg2, 'restore');
  await pg.context().close(); await pg2.context().close();

  /* ---------- 11. responsive + dark mode ---------- */
  }
  sec('11. responsive');
  if (RUN(11)) {
  for (const w of [320, 375, 768, 1280]) {
    const p = await newPage(browser, { width: w, height: 800 });
    await p.click('text=Open sample project');
    const over = [];
    for (const t of TABS) { await tab(p, t); const sw = await ev(p, () => [document.documentElement.scrollWidth, innerWidth]); if (sw[0] > sw[1] + 1) over.push(`${t}:${sw[0]}`); }
    ok(`no horizontal page scroll at ${w}px`, over.length === 0, over.join(' '));
    if (w === 320) { await tab(p, 'Inverters & DC'); await p.screenshot({ path: path.join(OUT, 'w320_inv.png'), fullPage: false }); await tab(p, 'Overview'); await p.screenshot({ path: path.join(OUT, 'w320_overview.png') }); }
    if (w === 1280) { await tab(p, 'Overview'); await p.screenshot({ path: path.join(OUT, 'w1280_overview.png') }); }
    noErr(p, 'responsive ' + w); await p.context().close();
  }
  const dk = await newPage(browser, { scheme: 'dark' });
  ok('dark mode background', (await ev(dk, () => getComputedStyle(document.body).backgroundColor)) !== 'rgb(244, 245, 242)');
  await dk.click('text=Open sample project'); await tab(dk, 'Inverters & DC'); await dk.screenshot({ path: path.join(OUT, 'dark_inv.png') });
  noErr(dk, 'dark'); await dk.context().close();

  /* ---------- 12. shared database mode (claude.use mock) ---------- */
  }
  sec('12. shared db mode');
  if (RUN(12)) {
  const A = await newPage(browser, { mock: true });
  ok('db mode banner', await A.isVisible('text=shared app database'));
  await A.click('text=Open sample project'); await sleep(1500);
  ok('project saved to db', [...STORE.keys()].some(k => k.startsWith('projects/')));
  await tab(A, 'Photos'); await A.setInputFiles('#phgal', ['fixtures/ph0.jpg']); await sleep(1500);
  ok('photo saved to db', [...STORE.keys()].some(k => k.startsWith('photos/')));
  await tab(A, 'Report PDF'); const before = DOWNLOADS.length; await A.click('text=Generate A4 PDF'); await sleep(2500);
  ok('PDF saved through downloads capability', DOWNLOADS.length === before + 1 && DOWNLOADS[DOWNLOADS.length - 1].data.slice(0, 4).toString() === '%PDF');
  const Bp = await newPage(browser, { mock: true, ctx: A.context() });
  ok('second user sees the project', await Bp.isVisible('text=Sample Site'));
  await Bp.click('text=Sample Site'); await tab(Bp, 'Photos'); await sleep(800);
  ok('second user sees the photo', (await Bp.$$eval('img[data-ph]', a => a.filter(i => i.naturalWidth > 0).length)) === 1);
  // concurrent edit: B saves, then A (stale) saves — B's version must not be lost silently
  await tab(Bp, 'Project'); await Bp.fill('[data-p="info.client"]', 'Client from B'); await sleep(1500);
  await tab(A, 'Project'); await A.fill('[data-p="info.contact"]', 'Contact from A'); await sleep(2000);
  const saved = JSON.parse(STORE.get([...STORE.keys()].find(k => k.startsWith('projects/'))));
  const histKeys = [...STORE.keys()].filter(k => k.startsWith('history/'));
  const keptB = saved.info.client === 'Client from B' || histKeys.some(k => STORE.get(k).includes('Client from B'));
  ok('concurrent edit by another user is kept (merged or saved as checkpoint)', keptB);
  // oversized project
  await ev(A, () => { for (let k = 0; k < 9000; k++) P.pser.push({ sn: 'BIG' + String(k).padStart(8, '0'), sid: '' }); touch(); }); await sleep(2000);
  const st = await A.textContent('#savest');
  ok('oversized project gives a clear warning', /too large|not shared|split/i.test(st), st);
  noErr(A, 'db mode A'); noErr(Bp, 'db mode B');
  await A.context().close();

  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
