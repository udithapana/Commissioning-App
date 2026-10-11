/* ================= actions ================= */
const isBlank = o => o == null || (typeof o === 'string' ? o.trim() === '' : Array.isArray(o) ? o.every(isBlank) : typeof o === 'object' ? Object.values(o).every(isBlank) : false);
function syncRows(arr, make, field, extra) {
  P.invs.forEach((inv, i) => {
    const tag = invTag(i);
    if (arr.some(r => String(r[field] || '').startsWith(tag))) return;
    const row = make(); row[field] = tag + (inv.loc ? ' — ' + inv.loc : ''); if (extra) extra(row, inv);
    const bi = arr.findIndex(isBlank); if (bi >= 0 && arr.length === 1) arr[bi] = row; else arr.push(row);
  });
}
function after(k) {
  if (k === 'itype') P.applic.battery = /Hybrid|Off-grid/.test(P.info.itype) ? 'Yes' : 'No';
  render();
}
function autoCover(quiet) {
  const t = totals(), I = P.info;
  I.ninv = String(P.invs.length); I.nstr = String(t.ns); I.npan = String(t.nm);
  if (t.kw) I.kwac = r2(t.kw, 2); if (!isNaN(t.kwp) && t.nm) I.kwp = r2(t.kwp, 2);
  const mm = [...new Set(P.invs.map(v => [v.make, v.model].filter(filled).join(' ')).filter(filled))]; if (mm.length) I.inv_model = mm.join(' / ');
  P.invs.forEach(v => { if (!filled(v.by) && filled(I.engineer)) v.by = I.engineer; });
  if (!filled(P.ac.by)) P.ac.by = I.engineer; if (!filled(P.acins.by)) P.acins.by = I.engineer; if (!filled(P.th.by)) P.th.by = I.engineer;
  if (!filled(P.prot_by)) P.prot_by = I.engineer; if (!filled(P.vis_by)) P.vis_by = I.engineer;
  if (!filled(P.sign.officer)) P.sign.officer = I.engineer; if (!filled(P.sign.date)) P.sign.date = I.date;
  if (!filled(P.sign.roles[0].name)) P.sign.roles[0].name = I.engineer;
  if (!filled(P.sign.roles[0].co)) P.sign.roles[0].co = CO.name;
  touch(); if (!quiet) { render(); toast('Project details filled from the test data'); }
}
function dup() {
  const src = P.invs[S.inv], n = newInv(P.invs.length, P);
  ['make', 'model', 'kw', 'spd', 'spd_model', 'iso_qty', 'iso_rating', 'dc_cable', 'ac_iso', 'ac_iso_rating'].forEach(k => (n[k] = src[k]));
  n.strings = src.strings.map(s => newStr(s.mppt, s.str, s.mods)); P.invs.push(n); S.inv = P.invs.length - 1;
}
function gen() {
  const inv = P.invs[S.inv], m = Math.max(0, Math.min(40, S.gen.m | 0)), s = Math.max(0, Math.min(12, S.gen.s | 0)), mods = S.gen.mods || '';
  if (!m || !s) { toast('Enter MPPT and string counts'); return; }
  let start = 1; inv.strings.forEach(x => { if (isN(x.mppt)) start = Math.max(start, num(x.mppt) + 1); });
  for (let a = 0; a < m; a++) for (let b = 1; b <= s; b++) inv.strings.push(newStr(String(start + a), String(b), String(mods)));
}
async function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, d = b.dataset;
  if (d.confirm && !d.armed) { e.preventDefault(); e.stopPropagation(); d.armed = '1'; b._t = b.textContent; b.textContent = 'Tap again'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = b._t; } }, 3000); return; }
  if (a === 'goto') e.preventDefault();
  switch (a) {
    case 'new': P = newProject(); projects.push(P); S.tab = 'info'; S.inv = 0; S.sertarget = ''; touch(); render(false); scrollTo(0, 0); break;
    case 'demo': P = demo(); projects.push(P); S.tab = 'overview'; S.inv = 0; S.sertarget = ''; touch(); render(false); scrollTo(0, 0); break;
    case 'open': {
      let p = projects.find(x => x.id === d.id); if (!p) { render(); break; }
      if (DB) { try { const r = await DB.doc('projects/' + p.id).get(); if (!r.exists) { toast('This project was deleted by another user'); await refreshList(); render(); break; } const fresh = migrate(clone(r.data())); BASE[fresh.id] = fresh.updated; if ((fresh.updated || 0) > (p.updated || 0)) { const k = projects.indexOf(p); projects[k] = fresh; p = fresh; } } catch (e) { } }
      P = p; S.tab = 'overview'; S.inv = 0; S.sertarget = ''; S.scan = []; S.imp = null; render(false); scrollTo(0, 0); break;
    }
    case 'home': await flush(); P = null; await refreshList(); render(false); scrollTo(0, 0); break;
    case 'delproj': await deleteProject(d.id); render(); toast('Project deleted'); break;
    case 'import': $('#imp').click(); break;
    case 'tab': S.tab = d.v; render(false); scrollTo(0, 0); break;
    case 'goto': { const k = d.key; if (k.startsWith('dc:')) { S.tab = 'inv'; S.inv = Math.max(0, P.invs.findIndex(v => 'dc:' + v.id === k)); } else S.tab = ({ visual: 'visual', acout: 'acout', acins: 'acins', earth: 'acins', thermal: 'thermal', battery: 'battery', prot: 'prot', punch: 'punch' })[k]; render(false); scrollTo(0, 0); break; }
    case 'seg': { const cur = get(P, d.p); const v = cur === d.v && !/^punch\.\d+\.s$/.test(d.p) ? '' : d.v; set(P, d.p, v); touch(); if (/^punch\./.test(d.p)) { if (v === 'Closed') { const pr = P.punch[+d.p.split('.')[1]]; if (!pr.closed) pr.closed = today(); } render(); break; } $$('button', b.parentElement).forEach(x => { x.className = x.dataset.v === v ? 'on ' + x.dataset.c : ''; }); refreshLive(); break; }
    case 'applic': P.applic[d.key] = d.v; touch(); render(); break;
    case 'visall': VIS_FLAT.forEach((x, i) => { if (x.g === +d.g && !P.vis[i].s) P.vis[i].s = 'Pass'; }); touch(); render(); break;
    case 'add': { const arr = get(P, d.list), r = NEWMAP[d.list](); if ('time' in r && !r.time) r.time = nowT(); arr.push(r); touch(); render(); break; }
    case 'del': get(P, d.list).splice(+d.i, 1); touch(); render(); break;
    case 'addinv': P.invs.push(newInv(P.invs.length, P)); S.inv = P.invs.length - 1; touch(); render(); break;
    case 'selinv': S.inv = +d.i; render(); break;
    case 'dupinv': dup(); touch(); render(); toast('Inverter duplicated (readings left blank)'); break;
    case 'delinv': P.invs.splice(S.inv, 1); S.inv = Math.max(0, S.inv - 1); touch(); render(); break;
    case 'genstr': gen(); touch(); render(); break;
    case 'addstr': { const inv = P.invs[S.inv], l = inv.strings[inv.strings.length - 1]; inv.strings.push(l ? newStr(l.mppt, isN(l.str) ? String(num(l.str) + 1) : '', l.mods) : newStr('1', '1', '')); touch(); render(); break; }
    case 'syncac': syncRows(P.ac.rows, newAc, 'pt', r => (r.time = nowT())); touch(); render(); break;
    case 'syncins': syncRows(P.acins.rows, newAcIns, 'pt'); touch(); render(); break;
    case 'syncth': syncRows(P.th.inv, newThInv, 'where', r => (r.time = nowT())); touch(); render(); break;
    case 'autocover': autoCover(); break;
    case 'pdf': makeReport(); break;
    case 'export': exportJson(); break;
    default: await extraAct(a, d, b, e);
  }
}
function onInput(e) {
  const t = e.target; if (t.tagName === 'BUTTON') return;
  if (t.dataset.g) { S.gen[t.dataset.g] = t.dataset.g === 'mods' ? t.value : parseInt(t.value) || 0; return; }
  if (t.dataset.imp !== undefined && S.imp) { S.imp.items[+t.dataset.imp].act = t.value; return; }
  if (t.dataset.ep) { S.expPhotos = t.checked; return; }
  if (t.dataset.hl) { S.histLabel = t.value; return; }
  if (t.dataset.st) { S.sertarget = t.value; return render(); }
  if (t.dataset.sc !== undefined) { S.scan[+t.dataset.sc] = t.value; return; }
  if (t.dataset.aa) { S.autoadv = t.checked; return; }
  if (t.dataset.pc) { S.phcat = t.value; return; }
  if (t.dataset.pi) { S.phinv = t.value; return; }
  const p = t.dataset.p; if (!p || !P) return;
  set(P, p, t.value); touch(); refreshLive();
  if (e.type === 'change' && t.dataset.after) after(t.dataset.after);
}

/* ================= import / export / save-as ================= */
async function saveFile(filename, data, mime) {
  let dl = null; try { if (IN_ARTIFACT) dl = await claude.use('downloads'); } catch (e) { }
  if (dl) { try { await dl.save({ filename, data }); return 'saved'; } catch (e) { if (e && e.code === 'declined') return 'declined'; throw e; } }
  if (IN_ARTIFACT) throw new Error('Saving files is not available in this view');
  const url = URL.createObjectURL(new Blob([data], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); return 'saved';
}
const fname = ext => 'Commissioning_Report_' + ((P.info.name || 'Project').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Project') + '_' + (/^\d{4}-\d{2}-\d{2}$/.test(P.info.date) ? P.info.date : today()) + '.' + ext;
async function makeReport() {
  if (S.busy) return; S.busy = true; S.msg = ''; render();
  try {
    const bytes = await buildPdf();
    const r = await saveFile(fname('pdf'), bytes, 'application/pdf');
    S.msg = r === 'saved' ? 'Report created — ' + S.pages + ' A4 pages.' : 'Save was cancelled — nothing was downloaded.';
  } catch (e) { console.error(e); S.msg = 'Could not build the PDF: ' + (e && e.message ? e.message : e); }
  S.busy = false; if (P && S.tab === 'report') render();
}

/* ================= sample project ================= */
function demo() {
  const p = newProject(); P = p;
  Object.assign(p.info, { name: 'Sample Site — Lakeview Warehouse', docno: 'RR-COM-0001', address: '12 Example Road, Colombo 3', client: 'Sample Client (Pvt) Ltd', contact: 'A. Perera', tel_mobile: '077 000 0000', email: 'site@example.com', weather: 'Sunny, 31 °C', bill: 'Yes', epc: 'Regen Renewables (Pvt) Ltd.', engineer: 'S. Fernando', roof: 'Metal sheet, standing seam', conn: 'Net Accounting', voltage: '400V', supplier: 'CEB', branch: 'Colombo City', account: '0000000000', itype: 'Grid-tied', pv_model: 'Sample 550 W mono', pv_wp: '550', pv_vv: '49.9 / 41.9', pv_ii: '13.9 / 14.7', prep: 'S. Fernando / Regen', rev_by: 'K. Silva / Regen' });
  const seed = (() => { let x = 7; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); })();
  const rnd = (a, b, d = 1) => (a + (b - a) * seed()).toFixed(d);
  for (let n = 0; n < 2; n++) {
    const inv = newInv(n, p); Object.assign(inv, { loc: n ? 'Roof level B' : 'Roof level A', make: 'Sample', model: 'SI-100K', sn: 'SN-DEMO-00' + (n + 1), kw: '100', spd: 'Y', spd_model: 'DC SPD T2 1100 V', iso_qty: '1', iso_rating: '1100 V / 32 A', dc_cable: '6 mm² PV1-F', ac_iso: 'Y', ac_iso_rating: '160 A', wx: 'Sunny / 850' });
    for (let m = 1; m <= 3; m++) for (let s = 1; s <= 2; s++) {
      const st = newStr(String(m), String(s), '20'); st.voc = rnd(995, 1001); st.ip = rnd(900, 999, 0); st.in = rnd(900, 999, 0); st.ipn = rnd(900, 999, 0); st.pol = 'OK'; st.opv = rnd(780, 800); st.cur = rnd(12.4, 13.1); inv.strings.push(st);
    }
    if (n === 1) { inv.strings[4].ip = '0.6'; inv.strings[4].rem = 'Check MC4 joint on string 2 / MPPT 3'; inv.strings[5].cur = ''; inv.strings[5].opv = ''; }
    p.invs.push(inv);
  }
  p.ac.by = p.info.engineer; p.ac.rows = [Object.assign(newAc(), { pt: 'Grid side (no load)', time: '10:05', v1: '232', v2: '231', v3: '233', hz: '50.0' }),
    Object.assign(newAc(), { pt: 'INV 01 — Roof level A', time: '11:20', v1: '236', v2: '235', v3: '237', i1: '118', i2: '119', i3: '118', kw: '82.4', pf: '0.99', hz: '50.0' }),
    Object.assign(newAc(), { pt: 'INV 02 — Roof level B', time: '11:40', v1: '236', v2: '235', v3: '237', i1: '112', i2: '113', i3: '112', kw: '78.1', pf: '0.99', hz: '50.0' })];
  p.acins.rows = [Object.assign(newAcIns(), { pt: 'INV 01 — Roof level A', v: ['999', '999', '999', '999', '999', '999', '999', '999', '999', '999'] }), Object.assign(newAcIns(), { pt: 'INV 02 — Roof level B', v: ['999', '999', '999', '999', '999', '999', '999', '999', '999', ''] })];
  p.acins.earth = [Object.assign(newEarth(), { loc: 'Main earth pit', val: '1.8' }), Object.assign(newEarth(), { loc: 'Array earth pit', val: '2.4' })];
  p.th.amb = '31'; p.th.irr = '850'; p.th.pan = [Object.assign(newPan(), { where: 'INV 01 / MPPT 2', sn: 'PN-2231', time: '12:10', t: '44.5', c: 'Normal' })];
  p.th.inv = [Object.assign(newThInv(), { where: 'INV 01', pt: 'DC terminals', time: '12:20', t: '49', c: '' })];
  p.th.sw[0] = Object.assign(p.th.sw[0], { rating: '250 A', time: '12:30', tin: '41', tout: '42' });
  p.vis.forEach((v, i) => { if (i < 24) v.s = 'Pass'; }); p.vis[7].s = 'Fail'; p.vis[7].r = 'Two MC4 connectors not fully locked';
  p.prot.forEach((v, i) => { if (i < 8) v.s = 'Pass'; }); p.prot[0].val = '253'; p.prot[1].val = '195';
  p.punch = [Object.assign(newPunch(), { loc: 'INV 02 / MPPT 3', issue: 'Low insulation on string 3.2 — re-terminate MC4', cat: 'Electrical', resp: 'Site team', s: 'Open' })];
  const ss = strList(); ss.forEach((x, k) => { const n = k < 2 ? 20 : k === 2 ? 11 : 0; for (let q = 1; q <= n; q++) p.pser.push({ sn: 'DEMO' + String(2410000 + k * 100 + q), sid: x.sid }); });
  p.pser.push({ sn: 'DEMO2410001', sid: ss[2].sid });
  autoCover(true); return p;
}

/* ================= A4 PDF ================= */
async function ensurePdfLib() {
  if (window.PDFLib) return;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'; s.onload = res; s.onerror = () => rej(new Error('PDF engine could not be loaded (check the connection)')); document.head.appendChild(s); });
  if (!window.PDFLib) throw new Error('PDF engine could not be loaded');
}
const dataBytes = u => { const b = atob(u.split(',')[1]), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
async function buildPdf() {
  await ensurePdfLib();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle('Commissioning Report — ' + (P.info.name || 'Project')); doc.setAuthor(CO.name); doc.setCreator('Site Commissioning App'); doc.setProducer('Site Commissioning App');
  const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold), It = await doc.embedFont(StandardFonts.HelveticaOblique);
  const LG = await doc.embedPng(dataBytes(LOGO.full)), LM = await doc.embedPng(dataBytes(LOGO.mark));
  const W = 595.28, H = 841.89, M = 32, CW = W - 2 * M, TOP = H - 54, BOT = 66;
  const C = { ink: rgb(.1, .15, .19), mute: rgb(.38, .43, .48), line: rgb(.78, .8, .82), navy: rgb(.07, .19, .25), head: rgb(.89, .92, .93), ok: rgb(.07, .47, .23), okb: rgb(.86, .95, .88), bad: rgb(.74, .12, .16), badb: rgb(.98, .87, .87), warn: rgb(.62, .38, 0), warnb: rgb(.99, .93, .76), na: rgb(.4, .45, .48), nab: rgb(.91, .92, .91), acc: rgb(0, .596, .282), green: rgb(0, .596, .282), white: rgb(1, 1, 1) };
  const pages = []; let page, y;
  const np = () => { page = doc.addPage([W, H]); pages.push(page); y = pages.length === 1 ? H - M : TOP; };
  const san = s => String(s ?? '').replace(/MΩ/g, 'MOhm').replace(/kΩ/g, 'kOhm').replace(/Ω/g, 'Ohm').replace(/ΔT/g, 'dT').replace(/Δ/g, 'd').replace(/[−‒]/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[→⟶]/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\t/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF–—•…€]/g, '?');
  const wrap = (t, f, sz, mw) => {
    const out = [];
    String(t ?? '').split(/\r?\n/).forEach(par => {
      const words = san(par).split(' '); let line = '';
      for (let w of words) {
        const test = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(test, sz) <= mw) { line = test; continue; }
        if (line) out.push(line);
        while (f.widthOfTextAtSize(w, sz) > mw && w.length > 1) { let k = w.length; while (k > 1 && f.widthOfTextAtSize(w.slice(0, k), sz) > mw) k--; out.push(w.slice(0, k)); w = w.slice(k); }
        line = w;
      }
      out.push(line);
    });
    return out;
  };
  const tx = (s, x, yy, o = {}) => page.drawText(san(s), { x, y: yy, size: o.sz || 8, font: o.f || F, color: o.c || C.ink });
  const txw = (s, sz, f) => (f || F).widthOfTextAtSize(san(s), sz);
  const rect = (x, yy, w, h, fill, line) => page.drawRectangle({ x, y: yy, width: w, height: h, color: fill, borderColor: line, borderWidth: line ? .5 : 0 });
  const hl = (x1, y1, x2, y2, c = C.line, t = .5) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color: c, thickness: t });
  const ensure = h => { if (y - h < BOT) np(); };
  const resC = v => { const s = String(v || '').toLowerCase(); if (['pass', 'closed', 'yes'].includes(s)) return [C.ok, C.okb]; if (['fail', 'open', 'no'].includes(s)) return [C.bad, C.badb]; if (['incomplete', 'in progress', 'in_progress'].includes(s)) return [C.warn, C.warnb]; if (s === 'n/a' || s === 'not tested') return [C.na, C.nab]; return null; };
  const SU = s => ({ 'IN PROGRESS': 'IN PROGRESS' }[s] || s);

  const fit = (t, f, sz, mw) => { t = san(t); if (f.widthOfTextAtSize(t, sz) <= mw) return t; while (t.length > 1 && f.widthOfTextAtSize(t + '…', sz) > mw) t = t.slice(0, -1); return t + '…'; };
  const cap = (lines, max) => (lines.length > max ? [...lines.slice(0, max - 1), fit(lines[max - 1] + ' …', F, 7, 9999)] : lines);
  const heading = t => { ensure(92); rect(M, y - 16, CW, 16, C.navy); tx(fit(t.toUpperCase(), B, 8.6, CW - 14), M + 7, y - 11.2, { f: B, sz: 8.6, c: C.white }); y -= 22; };
  let secN = 0; const H2 = t => heading(`${++secN}. ${t}`);
  const sub = t => { ensure(62); tx(t, M, y - 9, { f: B, sz: 8.6, c: C.navy }); hl(M, y - 13, M + CW, y - 13, C.acc, .9); y -= 19; };
  const note = (t, c = C.mute) => { const ls = wrap(t, It, 7.6, CW); ensure(ls.length * 10 + 4); ls.forEach(l => { tx(l, M, y - 8, { f: It, sz: 7.6, c }); y -= 10; }); y -= 4; };
  const gap = n => { y -= n; };

  function kv(pairs, n = 2) {
    pairs = pairs.filter(Boolean);
    const cw = CW / n;
    for (let i = 0; i < pairs.length; i += n) {
      const rowp = pairs.slice(i, i + n);
      const ls = rowp.map(p => cap(wrap(p[1] === '' || p[1] == null ? '—' : p[1], F, 8.2, cw - 10), 60));
      const h = Math.max(...ls.map(l => l.length)) * 10 + 14;
      ensure(h);
      rowp.forEach((p, k) => {
        const x = M + k * cw; rect(x, y - h, cw, h, undefined, C.line);
        tx(String(p[0]).toUpperCase(), x + 5, y - 8, { f: B, sz: 5.9, c: C.mute });
        ls[k].forEach((l, j) => tx(l, x + 5, y - 18 - j * 10, { sz: 8.2, c: (p[1] === '' || p[1] == null) ? C.line : C.ink }));
      });
      y -= h;
    }
    y -= 8;
  }

  function table(cols, rows, o = {}) {
    const sz = o.sz || 7.2, hs = 6.3, pad = 3, lh = sz * 1.2;
    const tw = cols.reduce((a, c) => a + c.w, 0), ws = cols.map(c => c.w * CW / tw);
    const xs = []; ws.reduce((a, w, i) => (xs[i] = a, a + w), M);
    const hdrLines = cols.map((c, i) => wrap(c.h, B, hs, ws[i] - 2 * pad));
    const hh = Math.max(...hdrLines.map(l => l.length)) * hs * 1.18 + 2 * pad + 1;
    const header = () => {
      rect(M, y - hh, CW, hh, C.head, C.line);
      hdrLines.forEach((ls, i) => ls.forEach((l, j) => { const w = txw(l, hs, B); const x = cols[i].a === 'r' ? xs[i] + ws[i] - pad - w : cols[i].a === 'c' ? xs[i] + (ws[i] - w) / 2 : xs[i] + pad; tx(l, x, y - pad - hs - j * hs * 1.18, { f: B, sz: hs, c: C.navy }); }));
      y -= hh;
    };
    const prep = rows.map(r => {
      if (r.band) { return { band: r.band, h: 13 }; }
      const maxL = Math.floor((TOP - BOT - hh - 2 * pad - 4) / lh);
      const cells = r.map((v, i) => cap(wrap(v, F, sz, ws[i] - 2 * pad), maxL));
      const h = Math.max(o.minH || 13, Math.max(...cells.map(c => c.length)) * lh + 2 * pad - 1);
      return { cells, vals: r, h };
    });
    if (!prep.length) return;
    ensure(hh + prep[0].h + 2); header();
    prep.forEach(r => {
      if (y - r.h < BOT) { np(); header(); }
      if (r.band) { rect(M, y - r.h, CW, r.h, C.nab, C.line); tx(r.band, M + pad + 1, y - 9, { f: B, sz: 7.4, c: C.navy }); y -= r.h; return; }
      cols.forEach((c, i) => {
        const x = xs[i], w = ws[i];
        const rc = c.res ? resC(r.vals[i]) : null;
        rect(x, y - r.h, w, r.h, rc ? rc[1] : undefined, C.line);
        r.cells[i].forEach((l, j) => {
          const f = rc ? B : F; const tw2 = txw(l, sz, f);
          const xx = c.a === 'r' ? x + w - pad - tw2 : c.a === 'c' || rc ? x + (w - tw2) / 2 : x + pad;
          tx(l, xx, y - pad - sz + 1 - j * lh, { sz, f, c: rc ? rc[0] : C.ink });
        });
      });
      y -= r.h;
    });
    y -= 9;
  }
  const dash = v => (filled(v) ? v : '');
  const rowFilled = (r, keys) => keys.some(k => filled(r[k]));
  const col = (h, w, a, res) => ({ h, w, a, res });
  const rows = summary(), ovr = overall(rows), I = P.info, T = totals();
  const val = (v, calc) => (filled(v) ? v : calc || '');

  /* ---------- cover ---------- */
  np();
  { // letterhead: Regen logo + report title, green rule
    const lh = 92, lw = lh * LG.width / LG.height, x0 = M + lw + 20;
    page.drawImage(LG, { x: M, y: H - M - lh, width: lw, height: lh });
    tx(CO.name.toUpperCase(), x0, H - M - 18, { f: B, sz: 9, c: C.green });
    tx('SOLAR PV SYSTEM INSTALLATION', x0, H - M - 44, { f: B, sz: 17, c: C.navy });
    tx('COMMISSIONING REPORT', x0, H - M - 65, { f: B, sz: 17, c: C.navy });
    tx('31/10 Castle Street, Colombo 8, Sri Lanka  ·  regen.lk', x0, H - M - 83, { sz: 7.6, c: C.mute });
    rect(M, H - M - lh - 12, CW, 2.4, C.green);
  }
  y = H - 160;
  { const pn = wrap(I.name || 'Untitled project', B, 15, CW - 130).slice(0, 3); pn.forEach(l => { tx(l, M, y - 12, { f: B, sz: 15 }); y -= 18; });
    if (I.address) { wrap(I.address, F, 9, CW - 130).slice(0, 3).forEach(l => { tx(l, M, y - 9, { sz: 9, c: C.mute }); y -= 12; }); }
    const o = resC(ovr === 'INCOMPLETE' ? 'incomplete' : ovr) || [C.na, C.nab];
    rect(W - M - 118, H - 160 - 30, 118, 40, o[1], o[0]); tx('OVERALL RESULT', W - M - 118 + 8, H - 160 - 6, { f: B, sz: 6, c: C.mute }); tx(ovr, W - M - 118 + 8, H - 160 - 26, { f: B, sz: 13, c: o[0] });
    y = Math.min(y, H - 160 - 40) - 10; }
  H2('General details');
  kv([['Project name', I.name], ['Document no.', I.docno], ['Address', I.address], ['Revision no.', I.rev], ['Contact person', I.contact], ['Commissioning date', dFmt(I.date)], ['Telephone — fixed', I.tel_fixed], ['Telephone — mobile', I.tel_mobile], ['E-mail', I.email], ['Weather condition', I.weather], ['Electricity bill available', I.bill], ['Client', I.client]]);
  H2('PV system & utility details');
  kv([['EPC / installation contractor', I.epc], ['Inverter brand & model', I.inv_model], ['PV system capacity (kWp)', val(I.kwp, isNaN(T.kwp) ? '' : r2(T.kwp, 2))], ['Number of inverters', val(I.ninv, String(P.invs.length || ''))], ['System AC capacity (kW)', val(I.kwac, T.kw ? r2(T.kw, 2) : '')], ['Roof structure', I.roof], ['PV system connection method', I.conn], ['Utility system voltage', I.voltage], ['Utility supplier', I.supplier], ["Utility supplier's branch office", I.branch], ['Utility account no.', I.account], ['Installation type', I.itype]]);
  H2('PV panel details');
  kv([['PV module brand & model', I.pv_model], ['Rated power (Wp)', I.pv_wp], ['Voc / Vmp (V)', I.pv_vv], ['Imp / Isc (A)', I.pv_ii], ['Number of panels', val(I.npan, T.nm ? String(T.nm) : '')], ['Number of strings', val(I.nstr, T.ns ? String(T.ns) : '')]]);
  H2('Prepared / reviewed / approved');
  kv([['Prepared by', I.prep], ['Reviewed by', I.rev_by], ['Approved by', I.appr], ['Approval date', dFmt(I.appr_date)]]);

  /* ---------- summary ---------- */
  H2('Commissioning summary');
  table([col('Section', 250), col('Applicable', 52, 'c'), col('Pass', 34, 'r'), col('Fail', 34, 'r'), col('Open', 34, 'r'), col('Status', 80, 'c', true)],
    [...rows.map(r => [r.label, r.app, r.pass, r.fail, r.open, r.status === 'N/A' ? 'N/A' : r.status]), ['OVERALL RESULT', '', '', '', '', ovr]]);
  note('Pass / fail results are calculated from the readings against the acceptance limits listed in the next section.');

  /* ---------- equipment & limits ---------- */
  H2('Test equipment & acceptance limits');
  table([col('No.', 18, 'r'), col('Instrument', 120), col('Model / make', 85), col('Serial no.', 70), col('Calibrated on', 55), col('Calibration due', 55), col('Used for', 100)],
    P.equip.map((e, i) => [i + 1, e.name, e.model, e.sn, dFmt(e.cal), dFmt(e.due), e.use]));
  const used = { insdc: 'DC string tests', insac: 'AC insulation', vocdev: 'DC string tests', earth: 'Earthing', vnom: 'AC output', vtol: 'AC output', fnom: 'AC output', ftol: 'AC output', dt: 'Thermal imaging' };
  table([col('Parameter', 300), col('Value', 60, 'r'), col('Unit', 50), col('Used in', 120)], LIMDEF.map(l => [l[1], P.lim[l[0]], l[3], used[l[0]]]));

  /* ---------- visual ---------- */
  if (P.applic.visual !== 'No') {
    H2('Visual & mechanical inspection');
    const vr = []; VIS.forEach((g, gi) => { vr.push({ band: g[0] }); VIS_FLAT.forEach((x, i) => { if (x.g === gi) vr.push([i + 1, x.t, P.vis[i].s, P.vis[i].r]); }); });
    table([col('No.', 20, 'r'), col('Inspection item', 270), col('Status', 48, 'c', true), col('Remarks', 170)], vr);
    kv([['Inspected by', P.vis_by || I.engineer], ['Date', dFmt(P.vis_date)]]);
  }

  /* ---------- inverters & panel ---------- */
  H2('Inverter register & main panel');
  if (P.invs.length) table([col('No.', 22), col('Location', 62), col('Make / model', 78), col('Serial no.', 62), col('kW', 26, 'r'), col('DC SPD', 54), col('DC isolator', 54), col('DC cable', 54), col('AC isolator', 50), col('Remarks', 70)],
    P.invs.map((v, i) => [invTag(i), v.loc, [v.make, v.model].filter(filled).join(' '), v.sn, v.kw, [v.spd, v.spd_model].filter(filled).join(' / '), [v.iso_qty && v.iso_qty + ' ×', v.iso_rating].filter(filled).join(' '), v.dc_cable, [v.ac_iso, v.ac_iso_rating].filter(filled).join(' / '), v.rem]));
  else note('No inverters recorded.');
  sub('Main electrical panel & cable details');
  const pn = P.panel; kv([['Main panel location', pn.loc], ['Energy meter serial no.', pn.meter_sn], ['Main breaker make / model', pn.brk], ['CT ratio (if used)', pn.ct], ['Main breaker rating (A)', pn.brk_a], ['RCD / ELCB rating (mA)', pn.rcd], ['Enclosure IP rating', pn.ip], ['AC cable: inverter -> panel', pn.cable_inv], ['AC SPD fitted', pn.ac_spd], ['AC cable: panel -> utility', pn.cable_util], ['Energy meter make / model', pn.meter], ['Earth conductor size', pn.earth]]);

  /* ---------- DC strings ---------- */
  P.invs.forEach((inv, i) => {
    if (P.applic['dc:' + inv.id] === 'No') return;
    H2(`DC string test — ${invName(inv, i)}`);
    const nm = inv.strings.reduce((a, s) => a + (isN(s.mods) ? num(s.mods) : 0), 0);
    kv([['Inverter', invTag(i) + (inv.loc ? ' — ' + inv.loc : '')], ['Make / model', [inv.make, inv.model].filter(filled).join(' ')], ['Serial no.', inv.sn], ['Rated capacity (kW)', inv.kw], ['Tested by', inv.by || I.engineer], ['Date / time', inv.dt], ['Weather / irradiance (W/m²)', inv.wx], ['Strings / PV modules', `${inv.strings.length} / ${nm}`]], 4);
    const c = count(inv.strings.map((s, j) => dcRes(inv, j)));
    if (inv.strings.length) table([col('No.', 17, 'r'), col('MPPT', 24, 'c'), col('Str.', 22, 'c'), col('PV mod.', 25, 'r'), col('Voc (V)', 32, 'r'), col('Voc dev. (%)', 32, 'r'), col('Ins. +/E (MOhm)', 36, 'r'), col('Ins. -/E (MOhm)', 36, 'r'), col('Ins. +/- (MOhm)', 36, 'r'), col('Polarity', 33, 'c'), col('Op. volt. (V)', 32, 'r'), col('Current (A)', 30, 'r'), col('Result', 44, 'c', true), col('Remarks', 110)],
      inv.strings.map((s, j) => { const d = dcDev(inv, j); return [j + 1, s.mppt, s.str, s.mods, s.voc, isNaN(d) ? '' : (d >= 0 ? '+' : '') + r2(d, 2), s.ip, s.in, s.ipn, s.pol, s.opv, s.cur, dcRes(inv, j), s.rem]; }), { sz: 6.9 });
    else note('No strings recorded for this inverter.');
    note(`Limits: insulation >= ${P.lim.insdc} MOhm; Voc deviation within the same MPPT / module count <= ${P.lim.vocdev} %; polarity must be correct.   Result: ${c.Pass} pass, ${c.Fail} fail, ${c.Incomplete} incomplete.`);
  });

  /* ---------- panel serials ---------- */
  if (P.pser.length) {
    H2(`Panel serial numbers`);
    const gr = serialGroups(), dupf = serDupSet();
    table([col('No.', 18, 'r'), col('Inverter', 80), col('MPPT / string', 62), col('Qty', 38, 'r'), col('Serial numbers', 330)], gr.map((g, i) => [i + 1, g.label, g.sub, g.list.length + (g.exp ? ' / ' + g.exp : ''), g.list.join(',  ')]), { sz: 6.8 });
    const dn = P.pser.length - new Set(P.pser.map(x => x.sn.toLowerCase())).size;
    note(`Total recorded: ${P.pser.length} serial numbers.` + (dn ? ` WARNING: ${dn} duplicate serial number(s) recorded.` : ''), dn ? C.bad : C.mute);
  }

  /* ---------- AC output ---------- */
  if (P.applic.acout !== 'No') {
    H2(`AC output test`);
    kv([['Date', dFmt(P.ac.date)], ['Tested by', P.ac.by || I.engineer]]);
    const rr = P.ac.rows.filter(r => rowFilled(r, ['v1', 'v2', 'v3', 'i1', 'i2', 'i3', 'kw', 'pf', 'hz', 'rem']));
    if (rr.length) table([col('No.', 15, 'r'), col('Grid / inverter & room', 82), col('Time', 28, 'c'), col('V L1', 26, 'r'), col('V L2', 26, 'r'), col('V L3', 26, 'r'), col('I L1', 26, 'r'), col('I L2', 26, 'r'), col('I L3', 26, 'r'), col('kW', 28, 'r'), col('PF', 22, 'r'), col('Hz', 24, 'r'), col('Result', 42, 'c', true), col('Remarks', 90)],
      rr.map((r, i) => [i + 1, r.pt, r.time, r.v1, r.v2, r.v3, r.i1, r.i2, r.i3, r.kw, r.pf, r.hz, acRes(r), r.rem]), { sz: 7 });
    else note('No AC readings recorded.');
    { const { s, n } = acTotal(); note(`Voltage window ${r2(L('vnom') * (1 - L('vtol') / 100), 1)}-${r2(L('vnom') * (1 + L('vtol') / 100), 1)} V (L-N); frequency ${P.lim.fnom} Hz +/- ${P.lim.ftol} Hz.${n ? '   Total plant AC power: ' + r2(s, 2) + ' kW.' : ''}`); }
    if (filled(P.ac.officer)) kv([['Officer name', P.ac.officer]]);
  }

  /* ---------- AC insulation & earthing ---------- */
  if (P.applic.acins !== 'No' || P.applic.earth !== 'No') {
    H2(`AC insulation & earthing`);
    if (P.applic.acins !== 'No') {
      sub('AC side insulation resistance (MOhm)');
      kv([['Date', dFmt(P.acins.date)], ['Test voltage (V)', P.acins.volt], ['Tested by', P.acins.by || I.engineer]], 3);
      const rr = P.acins.rows.filter(r => rowFilled(r, ['rem']) || r.v.some(filled));
      if (rr.length) table([col('No.', 15, 'r'), col('Inverter / circuit', 74), ...PH.map(h => col(h, 27, 'r')), col('Result', 42, 'c', true), col('Remarks', 80)], rr.map((r, i) => [i + 1, r.pt, ...r.v, acInsRes(r), r.rem]), { sz: 6.9 });
      else note('No AC insulation readings recorded.');
    }
    if (P.applic.earth !== 'No') {
      sub('Earthing test');
      const er = P.acins.earth.filter(r => rowFilled(r, ['val', 'loc']));
      if (er.length) table([col('Rod no.', 40, 'r'), col('Location', 190), col('Value (Ohm)', 60, 'r'), col('Result', 55, 'c', true), col('Remarks', 170)], er.map((r, i) => [i + 1, r.loc, r.val, earthRes(r), r.rem]));
      else note('No earth readings recorded.');
      note(`Limits: AC insulation >= ${P.lim.insac} MOhm; earth resistance <= ${P.lim.earth} Ohm.`);
    }
    if (filled(P.acins.officer)) kv([['Officer name', P.acins.officer]]);
  }

  /* ---------- thermal ---------- */
  if (P.applic.thermal !== 'No') {
    H2(`Thermal imaging test`);
    kv([['Date', dFmt(P.th.date)], ['Ambient temp (°C)', P.th.amb], ['Irradiance (W/m²)', P.th.irr], ['Tested by', P.th.by || I.engineer]], 4);
    const dts = t => { const d = thDT(t); return isNaN(d) ? '' : r2(d, 1); };
    const pr = P.th.pan.filter(r => rowFilled(r, ['t', 'sn', 'where']));
    sub('Solar panels — critical / hot panels'); if (pr.length) table([col('No.', 18, 'r'), col('Inverter / string', 90), col('Panel serial no.', 80), col('Time', 30, 'c'), col('Temp (°C)', 40, 'r'), col('dT vs amb. (°C)', 50, 'r'), col('Result', 44, 'c', true), col('Comment', 130)], pr.map((r, i) => [i + 1, r.where, r.sn, r.time, r.t, dts(r.t), thRes('p', r), r.c])); else note('None recorded.');
    const ir = P.th.inv.filter(r => rowFilled(r, ['t', 'where', 'pt']));
    sub('Inverters'); if (ir.length) table([col('No.', 18, 'r'), col('Inverter / room', 90), col('Point inspected', 80), col('Time', 30, 'c'), col('Temp (°C)', 40, 'r'), col('dT vs amb. (°C)', 50, 'r'), col('Result', 44, 'c', true), col('Comment', 130)], ir.map((r, i) => [i + 1, r.where, r.pt, r.time, r.t, dts(r.t), thRes('i', r), r.c])); else note('None recorded.');
    const sr = P.th.sw.filter(r => rowFilled(r, ['tin', 'tout', 'rating']));
    sub('Switchgear panel — breakers'); if (sr.length) table([col('No.', 18, 'r'), col('Breaker', 90), col('Rating / ref', 70), col('Time', 30, 'c'), col('IN (°C)', 40, 'r'), col('OUT (°C)', 40, 'r'), col('Result', 44, 'c', true), col('Comment', 130)], sr.map((r, i) => [i + 1, r.where, r.rating, r.time, r.tin, r.tout, thRes('sw', r), r.c])); else note('None recorded.');
    note(`Result = Fail when the hottest reading is more than ${P.lim.dt} °C above ambient.`);
  }

  /* ---------- battery ---------- */
  if (P.applic.battery === 'Yes') {
    H2(`Battery test`);
    const b = P.bat; kv([['Battery brand & model', b.brand], ['No. of modules / racks', b.mods], ['Battery type', b.type], ['No. of battery strings', b.strs], ['Bank capacity (kWh)', b.kwh], ['BMS model', b.bms], ['Nominal voltage (V)', b.vn], ['Tested by', b.by || I.engineer]]);
    const mr = b.mod.filter(r => rowFilled(r, ['mod', 'vm', 'ins', 's']));
    sub('Module / string voltage & insulation'); if (mr.length) table([col('No.', 18, 'r'), col('Module / rack', 70), col('String', 40), col('Nominal V', 50, 'r'), col('Measured V', 50, 'r'), col('Insulation (MOhm)', 60, 'r'), col('Status', 46, 'c', true), col('Remarks', 120)], mr.map((r, i) => [i + 1, r.mod, r.str, r.vn, r.vm, r.ins, r.s, r.rem])); else note('None recorded.');
    sub('Battery protection & BMS settings');
    table([col('No.', 18, 'r'), col('Parameter', 170), col('Set / measured', 80), col('Standard / ref', 80), col('Result', 46, 'c', true), col('Remarks', 120)], BPARAMS.map((n, i) => [i + 1, n, b.prm[i].val, b.prm[i].std, b.prm[i].s, b.prm[i].rem]));
    sub('Charge / discharge / backup test');
    table([col('Test', 120), col('Start', 34, 'c'), col('End', 34, 'c'), col('SOC start / end (%)', 56), col('Voltage start / end (V)', 60), col('Current (A)', 40, 'r'), col('Duration (min)', 44, 'r'), col('Remarks', 100)], BTESTS.map((n, i) => { const t = b.tests[i]; return [n, t.t0, t.t1, t.soc, t.volt, t.cur, t.dur, t.rem]; }));
    if (filled(b.officer)) kv([['Officer name', b.officer]]);
  }

  /* ---------- protection ---------- */
  if (P.applic.prot !== 'No') {
    H2(`Protection & grid settings verification`);
    table([col('No.', 18, 'r'), col('Parameter', 170), col('Set / measured value', 90), col('Standard / reference', 90), col('Result', 46, 'c', true), col('Remarks', 110)], PROT.map((n, i) => [i + 1, n[0], P.prot[i].val, P.prot[i].std, P.prot[i].s, P.prot[i].rem]));
    kv([['Verified by', P.prot_by || I.engineer], ['Date', dFmt(P.prot_date)]]);
  }

  /* ---------- punch ---------- */
  if (P.applic.punch !== 'No') {
    H2(`Punch list / snag list`);
    if (P.punch.length) table([col('No.', 21, 'r'), col('Raised', 50), col('Location', 54), col('Issue', 100), col('Category', 44), col('By', 36), col('Corrective action', 90), col('Resp.', 38), col('Target', 40), col('Status', 42, 'c', true), col('Closed', 40)],
      P.punch.map((r, i) => [i + 1, dFmt(r.date), r.loc, r.issue, r.cat, r.by, r.action, r.resp, dFmt(r.target), r.s, dFmt(r.closed)]), { sz: 6.6 });
    else note('No snags recorded.');
  }

  /* ---------- sign-off ---------- */
  H2(`Final commissioning sign-off`);
  { const o = resC(ovr === 'INCOMPLETE' ? 'incomplete' : ovr) || [C.na, C.nab]; ensure(34); rect(M, y - 28, CW, 28, o[1], o[0]); tx('OVERALL COMMISSIONING RESULT', M + 8, y - 11, { f: B, sz: 6.6, c: C.mute }); tx(ovr, M + 8, y - 24, { f: B, sz: 12, c: o[0] }); tx('Commissioned: ' + dFmt(P.sign.date) + '     Officer: ' + (P.sign.officer || ''), M + 190, y - 18, { sz: 8.4 }); y -= 36; }
  table([col('Role', 130), col('Name', 110), col('Company', 100), col('Signature', 110), col('Date', 60)], ROLES.map((r, i) => [r, P.sign.roles[i].name, P.sign.roles[i].co, '', dFmt(P.sign.roles[i].date)]), { minH: 30 });
  sub('Handover checklist');
  table([col('Item', 330), col('Status', 70, 'c', true)], HANDOVER.map((h, i) => [h, P.sign.hand[i]]));
  if (filled(P.sign.comments)) { sub('Comments'); wrap(P.sign.comments, F, 8, CW).forEach(l => { ensure(11); tx(l, M, y - 8, { sz: 8 }); y -= 10.5; }); }

  /* ---------- header / footer on every page ---------- */
  const N = pages.length, nl = wrap(CO.notice, F, 6, CW);
  pages.forEach((pg, i) => {
    page = pg;
    if (i > 0) { const mw = 16 * LM.width / LM.height; page.drawImage(LM, { x: M, y: H - 32, width: mw, height: 16 }); const lt = CO.name + '  —  Solar PV Installation Commissioning Report'; tx(lt, M + mw + 6, H - 28, { sz: 6.8, c: C.mute }); const t = fit(I.name || 'Untitled project', B, 6.8, CW - txw(lt, 6.8) - mw - 30); tx(t, W - M - txw(t, 6.8, B), H - 28, { sz: 6.8, f: B, c: C.navy }); hl(M, H - 34, W - M, H - 34, C.navy, .8); }
    hl(M, 54, W - M, 54, C.line, .6);
    nl.forEach((l, k) => tx(l, (W - txw(l, 6)) / 2, 45 - k * 7.4, { sz: 6, c: C.mute }));
    const pt = `Page ${i + 1} of ${N}`;
    tx(fit((I.name || '') + (I.docno ? '   ·   ' + I.docno : '') + (I.rev ? '   ·   ' + I.rev : ''), F, 6.8, CW - txw(pt, 7.4, B) - 24), M, 22, { sz: 6.8, c: C.mute });
    tx(pt, W - M - txw(pt, 7.4, B), 22, { sz: 7.4, f: B, c: C.navy });
  });
  S.pages = N;
  return await doc.save();
}
window.__buildPdf = buildPdf;

/* ================= init ================= */
document.addEventListener('click', onClick);
document.addEventListener('input', onInput);
document.addEventListener('change', onInput);
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'serin') { e.preventDefault(); onClick({ target: $('[data-act=addser]'), preventDefault() { }, stopPropagation() { } }); return; }
   if (e.key === 'Enter' && e.target.matches && e.target.matches('.proj')) e.target.click(); });
(async function () {
  try { await initStore(); } catch (e) { console.error(e); }
  render(false);
  setupInstall();
})();
// Installable app + offline use when hosted as a website (e.g. GitHub Pages). The manifest and service worker are
// scoped to this app's own folder, so other apps on the same site (other repositories under the same github.io
// address) neither capture this app nor get captured by it.
function setupInstall() {
  if (IN_ARTIFACT || !/^https?:$/.test(location.protocol)) return;
  const add = (tag, attrs) => { const el = document.createElement(tag); Object.assign(el, attrs); document.head.appendChild(el); };
  add('link', { rel: 'manifest', href: 'manifest.webmanifest' });
  add('link', { rel: 'apple-touch-icon', href: 'icons/apple-touch-icon.png' });
  add('meta', { name: 'theme-color', content: '#12303f' });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(e => console.warn('offline cache not available', e));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
}
