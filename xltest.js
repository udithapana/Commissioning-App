// Excel export / import tests. Writes out/xl_*.xlsx and out/xl_app.json for the Python checker.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const HTML = path.resolve(process.argv[2] || '../index.html');
const LAUNCH = { args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };
fs.mkdirSync('out', { recursive: true });
(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true }); const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.stack)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load/.test(m.text())) errs.push(m.text()); });
  await pg.route('**/*', r => { const u = r.request().url(); if (u.includes('pdf-lib')) return r.fulfill({ path: require.resolve('pdf-lib/dist/pdf-lib.min.js'), contentType: 'application/javascript' }); if (u.includes('jszip')) return r.fulfill({ path: require.resolve('jszip/dist/jszip.min.js'), contentType: 'application/javascript' }); return u.startsWith('file:') || u.startsWith('blob:') || u.startsWith('data:') ? r.continue() : r.abort(); });
  await pg.goto('file://' + HTML); await pg.click('text=Open sample project');
  // enrich the sample: battery, a 3rd inverter with 40 strings, OL / >999 / comma readings, punch, sign-off, 70 serials, odd text
  await pg.evaluate(() => {
    P.applic.battery = 'Yes'; P.bat.brand = 'Sample BESS'; P.bat.kwh = '100'; P.bat.mod[0] = Object.assign(newBMod(), { mod: 'R1', str: '1', vn: '51.2', vm: '52.1', ins: '500', s: 'Pass' });
    P.bat.prm[0].val = '58.4'; P.bat.prm[0].s = 'Pass'; P.bat.tests[0].t0 = '09:15'; P.bat.tests[0].t1 = '10:45';
    const inv = newInv(2, P); inv.loc = 'Ground <b>&"room"'; inv.make = 'Sample'; inv.model = 'SI-50K'; inv.kw = '50';
    for (let m = 1; m <= 10; m++) for (let s = 1; s <= 4; s++) { const st = newStr(String(m), String(s), '18'); st.voc = String(890 + m); st.ip = m === 1 ? 'OL' : '>999'; st.in = '1,000'; st.ipn = '0,5'; st.pol = 'OK'; inv.strings.push(st); }
    P.invs.push(inv);
    P.applic['dc:' + P.invs[1].id] = 'Yes';
    P.punch.push(Object.assign(newPunch(), { loc: 'Roof', issue: 'Line1\nLine2 — “quotes” & <tags>', s: 'Closed', closed: '2026-10-10', target: '2026-10-09' }));
    P.sign.comments = 'All good.\nSecond line.'; P.sign.hand[0] = 'Yes'; P.sign.roles[1].name = 'QA Person'; P.sign.roles[1].date = '2026-10-11';
    for (let k = 0; k < 70; k++) P.pser.push({ sn: 'XS' + k, sid: inv.strings[k % 40].id });
    P.equip[0].model = 'MIT430'; P.equip[0].cal = '2026-01-15'; P.lim.vocdev = '4'; P.lim.vtol = '8';
    P.info.date = '2026-10-11'; P.info.tel_mobile = '0771234567'; P.info.account = '0012345678';
    touch(); render();
  });
  await pg.click('.tab:has-text("Excel")');
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('text=Download Excel workbook (.xlsx)')]);
  await dl.saveAs('out/xl_export.xlsx');
  console.log('export msg:', await pg.evaluate(() => S.xlMsg));
  // what the app computed, for comparison with Excel's own formulas
  const app = await pg.evaluate(() => ({ summary: summary().map(r => [r.key, r.status, r.pass, r.fail, r.open]), overall: overall(), dc: P.invs.map((inv, i) => inv.strings.slice(0, 36).map((s, j) => dcRes(inv, j))), ac: P.ac.rows.map(acRes), project: JSON.parse(JSON.stringify(P)) }));
  fs.writeFileSync('out/xl_app.json', JSON.stringify(app));
  // round trip: import the exported file back (replace) and compare
  await pg.setInputFiles('#xlfile', 'out/xl_export.xlsx'); await new Promise(r => setTimeout(r, 800));
  console.log('import default action:', await pg.$eval('select[data-imp]', s => s.value));
  await pg.click('text=Apply import'); await new Promise(r => setTimeout(r, 800));
  const back = await pg.evaluate(() => JSON.parse(JSON.stringify(P)));
  fs.writeFileSync('out/xl_back.json', JSON.stringify(back));
  // blank workbook download + hand-filled import + old-template rejection
  const [dl2] = await Promise.all([pg.waitForEvent('download'), pg.click('text=Download blank workbook')]); await dl2.saveAs('out/xl_blank.xlsx');
  if (fs.existsSync('out/xl_hand.xlsx')) {
    await pg.click('text=‹ Projects'); await pg.setInputFiles('#imp', 'out/xl_hand.xlsx'); await new Promise(r => setTimeout(r, 800));
    console.log('hand import card:', await pg.isVisible('text=Apply import'));
    await pg.click('text=Apply import'); await new Promise(r => setTimeout(r, 600));
    const hp = await pg.evaluate(() => { const p = projects.find(x => x.info.name === 'Hand filled site'); return p ? JSON.parse(JSON.stringify(p)) : null; });
    fs.writeFileSync('out/xl_hand_back.json', JSON.stringify(hp));
  }
  if (fs.existsSync('fixtures/old_template_v1.xlsx')) { await pg.setInputFiles('#imp', 'fixtures/old_template_v1.xlsx'); await new Promise(r => setTimeout(r, 600)); console.log('old template toast:', await pg.textContent('#toast')); }
  console.log('errors:', errs);
  await b.close();
})();
