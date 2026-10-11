/* ================= Excel workbook: export (fill the Regen template) and import ================= */
// The template is the same workbook the team uses by hand. Export only writes into its input cells
// (styles, formulas, logo, drop-downs and print settings stay exactly as designed); import reads them back.
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
async function ensureZip() {
  if (window.JSZip) return;
  for (const src of ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js']) {
    await new Promise(res => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s); });
    if (window.JSZip) return;
  }
  throw new Error('Excel engine could not be loaded (check the connection)');
}
const colNum = c => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const splitRef = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return [m[1], +m[2]]; };
const isoToSerial = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim()); return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5 : null; };
const timeToFrac = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()); return m && +m[1] < 24 && +m[2] < 60 ? (+m[1] * 60 + +m[2]) / 1440 : null; };
const serialToIso = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 864e5)); return d.toISOString().slice(0, 10); };
const fracToTime = n => { const t = Math.round((n - Math.floor(n)) * 1440) % 1440; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
const numStr = n => (Number.isInteger(n) ? String(n) : String(+n.toPrecision(10)));

/* ---------- workbook access (shared by export and import) ---------- */
async function openBook(bytes) {
  await ensureZip();
  const zip = await JSZip.loadAsync(bytes);
  const read = async p => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const wbx = await read('xl/workbook.xml'), rels = await read('xl/_rels/workbook.xml.rels');
  if (!wbx || !rels) throw new Error('not an Excel workbook');
  const relMap = {}; [...rels.getElementsByTagName('Relationship')].forEach(r => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
  const sheets = {};
  [...wbx.getElementsByTagNameNS(NS, 'sheet')].forEach((s, i) => {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
    let t = relMap[rid] || ''; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    sheets[s.getAttribute('name')] = { path: t, el: s, index: i };
  });
  const ss = [];
  const sst = await read('xl/sharedStrings.xml');
  if (sst) [...sst.getElementsByTagNameNS(NS, 'si')].forEach(si => ss.push([...si.getElementsByTagNameNS(NS, 't')].map(t => t.textContent).join('')));
  const docs = {};
  const sheetDoc = async name => { const s = sheets[name]; if (!s) return null; if (!docs[name]) docs[name] = await read(s.path); return docs[name]; };
  return { zip, wbx, sheets, ss, docs, sheetDoc };
}
function findRow(doc, r, create) {
  const sd = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
  let before = null;
  for (const row of sd.children) { const n = +row.getAttribute('r'); if (n === r) return row; if (n > r) { before = row; break; } }
  if (!create) return null;
  const row = doc.createElementNS(NS, 'row'); row.setAttribute('r', r); sd.insertBefore(row, before); return row;
}
function findCell(doc, ref, create) {
  const [c, r] = splitRef(ref), row = findRow(doc, r, create); if (!row) return null;
  const ci = colNum(c); let before = null;
  for (const cell of row.children) { const k = colNum(splitRef(cell.getAttribute('r'))[0]); if (k === ci) return cell; if (k > ci) { before = cell; break; } }
  if (!create) return null;
  const cell = doc.createElementNS(NS, 'c'); cell.setAttribute('r', ref); row.insertBefore(cell, before); return cell;
}
function readCell(bk, doc, ref) {
  const cell = doc && findCell(doc, ref, false); if (!cell) return null;
  const t = cell.getAttribute('t'), v = cell.getElementsByTagNameNS(NS, 'v')[0];
  if (t === 'inlineStr') return [...cell.getElementsByTagNameNS(NS, 't')].map(x => x.textContent).join('');
  if (!v || v.textContent === '') return null;
  if (t === 's') return bk.ss[+v.textContent] ?? null;
  if (t === 'str' || t === 'e') return v.textContent;
  if (t === 'b') return v.textContent === '1' ? 'TRUE' : 'FALSE';
  const n = parseFloat(v.textContent); return isNaN(n) ? v.textContent : n;
}
function writeCell(doc, ref, val) {
  const cell = findCell(doc, ref, true);
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.removeAttribute('t');
  if (val === null || val === undefined || val === '') return;
  if (typeof val === 'number' && isFinite(val)) { const v = doc.createElementNS(NS, 'v'); v.textContent = String(val); cell.appendChild(v); return; }
  const s = String(val).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 32000);
  cell.setAttribute('t', 'inlineStr');
  const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't');
  t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.textContent = s; is.appendChild(t); cell.appendChild(is);
}
const setRowHidden = (doc, r, hidden) => { const row = findRow(doc, r, true); if (hidden) row.setAttribute('hidden', '1'); else row.removeAttribute('hidden'); };

/* value conversion */
const xNum = v => { v = String(v ?? '').trim(); if (v === '') return ''; const n = num(v); if (n === Infinity) return 9999; return /^[>≥<≤~]?\s*-?\d[\d.,]*\s*[A-Za-zΩ°%/]*\s*$/.test(v) && isFinite(n) ? n : v; };
const xDate = v => { const n = isoToSerial(v); return n === null ? String(v ?? '') : n; };
const xTime = v => { const n = timeToFrac(v); return n === null ? String(v ?? '') : n; };
const xInt = v => (/^\d+$/.test(String(v ?? '').trim()) ? +String(v).trim() : String(v ?? ''));
const rStr = v => (v === null || v === undefined ? '' : typeof v === 'number' ? numStr(v) : String(v).trim());
const rDate = v => (typeof v === 'number' && v > 1000 ? serialToIso(v) : rStr(v));
const rTime = v => (typeof v === 'number' && v >= 0 && v < 2 ? fracToTime(v) : rStr(v));
const rDateTime = v => (typeof v === 'number' && v > 1000 ? serialToIso(v) + (v % 1 ? ' ' + fracToTime(v) : '') : rStr(v));

/* ---------- export ---------- */
async function buildWorkbook() {
  const M = XL_MAP, warn = [];
  const bk = await openBook(dataBytes('data:x;base64,' + XL_TPL));
  const S_ = async n => { const d = await bk.sheetDoc(n); if (!d) throw new Error('template sheet missing: ' + n); return d; };
  const I = P.info;
  // Cover
  let d = await S_('Cover');
  for (const [k, ref] of Object.entries(M.cover)) writeCell(d, ref, k === 'date' || k === 'appr_date' ? xDate(I[k]) : ['kwp', 'kwac', 'ninv', 'pv_wp', 'npan', 'nstr'].includes(k) ? xNum(I[k]) : I[k]);
  // Equipment + limits
  d = await S_(M.equip.sheet);
  P.equip.slice(0, M.equip.n).forEach((e, i) => { const r = M.equip.first + i, c = M.equip.cols; writeCell(d, c.model + r, e.model); writeCell(d, c.sn + r, e.sn); writeCell(d, c.cal + r, xDate(e.cal)); writeCell(d, c.due + r, xDate(e.due)); writeCell(d, c.use + r, e.use); });
  for (const [k, o] of Object.entries(M.limits)) { const n = num(P.lim[k]); writeCell(d, o.cell, isFinite(n) ? (o.pct ? n / 100 : n) : null); }
  // Visual inspection
  d = await S_(M.visual.sheet);
  M.visual.rows.forEach((r, i) => { writeCell(d, 'D' + r, P.vis[i].s); writeCell(d, 'E' + r, P.vis[i].r); });
  writeCell(d, M.visual.by, P.vis_by); writeCell(d, M.visual.date, xDate(P.vis_date));
  // Inverter register + main panel
  d = await S_(M.invreg.sheet);
  if (P.invs.length > M.invreg.n) warn.push(`Only the first ${M.invreg.n} inverters fit in the workbook (${P.invs.length} recorded).`);
  for (let i = 0; i < M.invreg.n; i++) {
    const r = M.invreg.first + i, v = P.invs[i];
    for (const [k, c] of Object.entries(M.invreg.cols)) writeCell(d, c + r, v ? (k === 'kw' || k === 'iso_qty' ? xNum(v[k]) : v[k]) : null);
    setRowHidden(d, r, i >= Math.max(P.invs.length, 1));
  }
  for (const [k, ref] of Object.entries(M.panel)) if (k !== 'sheet') writeCell(d, ref, k === 'brk_a' || k === 'rcd' ? xNum(P.panel[k]) : P.panel[k]);
  // DC string tests, one sheet per inverter
  const nInv = Math.min(P.invs.length, M.dc.sheets.length);
  for (let k = 0; k < M.dc.sheets.length; k++) {
    const name = M.dc.sheets[k], el = bk.sheets[name].el, inv = P.invs[k];
    const used = k < Math.max(nInv, 1);
    if (used) el.removeAttribute('state'); else el.setAttribute('state', 'hidden');
    if (!inv) continue;
    d = await S_(name); const h = M.dc.head;
    writeCell(d, h.loc, inv.loc); writeCell(d, h.makemodel, [inv.make, inv.model].filter(filled).join(' ')); writeCell(d, h.sn, inv.sn); writeCell(d, h.kw, xNum(inv.kw));
    writeCell(d, h.dt, inv.dt); writeCell(d, h.by, inv.by || I.engineer); writeCell(d, h.wx, inv.wx);
    const cap = M.dc.last - M.dc.first + 1;
    if (inv.strings.length > cap) warn.push(`${invTag(k)}: only the first ${cap} of ${inv.strings.length} strings fit on its sheet.`);
    for (let j = 0; j < cap; j++) {
      const r = M.dc.first + j, s = inv.strings[j];
      for (const [f, c] of Object.entries(M.dc.cols)) writeCell(d, c + r, !s ? null : f === 'mppt' || f === 'str' ? xInt(s[f]) : M.dc.num.includes(f) ? xNum(s[f]) : s[f]);
      setRowHidden(d, r, j >= Math.max(inv.strings.length, 1));
    }
  }
  if (P.invs.length > M.dc.sheets.length) warn.push(`Only ${M.dc.sheets.length} DC string test sheets exist in the workbook.`);
  // generic table writer
  const table = async (sheet, t, list, conv, label) => {
    const dd = await S_(sheet), cap = t.last - t.first + 1;
    if (list.length > cap) warn.push(`${label}: only the first ${cap} of ${list.length} rows fit.`);
    for (let j = 0; j < cap; j++) {
      const r = t.first + j, row = list[j];
      for (const [f, c] of Object.entries(t.cols)) writeCell(dd, c + r, row ? conv(f, row[f]) : null);
      setRowHidden(dd, r, j >= Math.max(list.length, 1));
    }
    return dd;
  };
  const conv = t => (f, v) => (t.num && t.num.includes(f) ? xNum(v) : t.time && t.time.includes(f) ? xTime(v) : t.date && t.date.includes(f) ? xDate(v) : v);
  // AC output
  const A = M.ac; d = await table(A.sheet, A, P.ac.rows, conv(A), 'AC output');
  writeCell(d, A.date, xDate(P.ac.date)); writeCell(d, A.by, P.ac.by || I.engineer); writeCell(d, A.officer, P.ac.officer);
  // AC insulation + earthing
  const AI = M.acins; d = await S_(AI.sheet);
  { const cap = AI.last - AI.first + 1; if (P.acins.rows.length > cap) warn.push(`AC insulation: only the first ${cap} of ${P.acins.rows.length} rows fit.`);
    for (let j = 0; j < cap; j++) { const r = AI.first + j, row = P.acins.rows[j]; writeCell(d, AI.cols.pt + r, row ? row.pt : null); writeCell(d, AI.cols.rem + r, row ? row.rem : null); AI.vcols.forEach((c, k) => writeCell(d, c + r, row ? xNum(row.v[k]) : null)); setRowHidden(d, r, j >= Math.max(P.acins.rows.length, 1)); } }
  await table(AI.sheet, AI.earth, P.acins.earth, conv(AI.earth), 'Earthing');
  writeCell(d, AI.date, xDate(P.acins.date)); writeCell(d, AI.volt, xNum(P.acins.volt)); writeCell(d, AI.by, P.acins.by || I.engineer); writeCell(d, AI.officer, P.acins.officer);
  // Thermal
  const T = M.th;
  await table(T.sheet, T.pan, P.th.pan, conv(T.pan), 'Thermal — panels'); await table(T.sheet, T.inv, P.th.inv, conv(T.inv), 'Thermal — inverters'); d = await table(T.sheet, T.sw, P.th.sw, conv(T.sw), 'Thermal — breakers');
  writeCell(d, T.date, xDate(P.th.date)); writeCell(d, T.amb, xNum(P.th.amb)); writeCell(d, T.irr, xNum(P.th.irr)); writeCell(d, T.by, P.th.by || I.engineer); writeCell(d, T.officer, P.th.officer);
  // Battery
  const BT = M.bat, b = P.bat;
  d = await table(BT.sheet, BT.mod, b.mod, conv(BT.mod), 'Battery modules');
  for (const k of ['brand', 'type', 'bms', 'by']) writeCell(d, BT[k], b[k]);
  for (const k of ['kwh', 'vn', 'mods', 'strs']) writeCell(d, BT[k], xNum(b[k]));
  writeCell(d, BT.officer, b.officer);
  b.prm.forEach((x, i) => { const r = BT.prm.first + i; for (const [f, c] of Object.entries(BT.prm.cols)) writeCell(d, c + r, x[f]); });
  b.tests.forEach((x, i) => { const r = BT.tests.first + i; for (const [f, c] of Object.entries(BT.tests.cols)) writeCell(d, c + r, BT.tests.time.includes(f) ? xTime(x[f]) : f === 'cur' || f === 'dur' ? xNum(x[f]) : x[f]); });
  if (P.applic.battery === 'No') bk.sheets[BT.sheet].el.setAttribute('state', 'hidden');
  // Protection
  const PR = M.prot; d = await S_(PR.sheet);
  P.prot.forEach((x, i) => { const r = PR.first + i; for (const [f, c] of Object.entries(PR.cols)) writeCell(d, c + r, x[f]); });
  writeCell(d, PR.by, P.prot_by); writeCell(d, PR.date, xDate(P.prot_date));
  // Punch list
  await table(M.punch.sheet, M.punch, P.punch, conv(M.punch), 'Punch list');
  // Summary: which sections apply, one visible row per inverter
  const SM = M.summary; d = await S_(SM.sheet);
  for (const [key, r] of Object.entries(SM.rows)) {
    if (key.startsWith('dc')) { const k = +key.slice(2) - 1, inv = P.invs[k]; const used = k < Math.max(nInv, 1); writeCell(d, SM.col + r, used ? (inv && P.applic['dc:' + inv.id] === 'No' ? 'No' : 'Yes') : 'No'); setRowHidden(d, r, !used); }
    else writeCell(d, SM.col + r, P.applic[key] === 'No' || (key === 'battery' && P.applic.battery !== 'Yes') ? 'No' : 'Yes');
  }
  // Sign-off
  const SG = M.sign; d = await S_(SG.sheet);
  writeCell(d, SG.date, xDate(P.sign.date)); writeCell(d, SG.officer, P.sign.officer); writeCell(d, SG.comments, P.sign.comments);
  P.sign.roles.forEach((x, i) => { const r = SG.roles.first + i; writeCell(d, SG.roles.cols.name + r, x.name); writeCell(d, SG.roles.cols.co + r, x.co); writeCell(d, SG.roles.cols.date + r, xDate(x.date)); });
  P.sign.hand.forEach((v, i) => writeCell(d, SG.hand.col + (SG.hand.first + i), v));
  // Panel serials: the register grows beyond the template's rows when needed
  const SE = M.serials; d = await S_(SE.sheet);
  const rows = []; serialGroups().forEach(g => { const f = strList().find(x => x.sid === g.sid); g.list.forEach(sn => rows.push([f ? invTag(f.i) : 'Unassigned', f ? xInt(f.s.mppt) : '', f ? xInt(f.s.str) : '', sn])); });
  const lastTpl = SE.last, styleRow = findRow(d, lastTpl, false), styles = {};
  for (const c of styleRow.children) styles[splitRef(c.getAttribute('r'))[0]] = c.getAttribute('s');
  const lastRow = Math.max(lastTpl, SE.first + rows.length - 1);
  for (let j = 0; SE.first + j <= lastRow; j++) {
    const r = SE.first + j, x = rows[j], row = findRow(d, r, true);
    if (r > lastTpl) { row.setAttribute('ht', styleRow.getAttribute('ht') || '18'); row.setAttribute('customHeight', '1'); }
    const vals = { no: x ? j + 1 : (r <= lastTpl ? j + 1 : null), inv: x ? x[0] : null, mppt: x ? x[1] : null, str: x ? x[2] : null, sn: x ? x[3] : null, rem: null };
    for (const [f, c] of Object.entries(SE.cols)) { writeCell(d, c + r, vals[f]); const cell = findCell(d, c + r, true); if (styles[c] && r > lastTpl) cell.setAttribute('s', styles[c]); }
    setRowHidden(d, r, j >= Math.max(rows.length, 1));
  }
  if (lastRow > lastTpl) {   // stretch the print area of the serial sheet
    const idx = bk.sheets[SE.sheet].index;
    [...bk.wbx.getElementsByTagNameNS(NS, 'definedName')].forEach(n => { if (n.getAttribute('name') === '_xlnm.Print_Area' && n.getAttribute('localSheetId') === String(idx)) n.textContent = n.textContent.replace(/\$(\d+)$/, '$' + lastRow); });
    const dim = d.getElementsByTagNameNS(NS, 'dimension')[0]; if (dim) dim.setAttribute('ref', dim.getAttribute('ref').replace(/\d+$/, String(lastRow)));
  }
  // hidden app sheet: lets the app recognise its own file on import
  d = await S_(M.app.sheet);
  writeCell(d, M.app.pid, P.id); writeCell(d, M.app.exported, new Date().toISOString()); writeCell(d, M.app.app, 'Site Commissioning App'); writeCell(d, M.app.engineer, I.engineer);
  // make Excel recalculate every formula when the file is opened
  let calc = bk.wbx.getElementsByTagNameNS(NS, 'calcPr')[0];
  if (!calc) { calc = bk.wbx.createElementNS(NS, 'calcPr'); const ref = bk.wbx.getElementsByTagNameNS(NS, 'extLst')[0] || null; bk.wbx.documentElement.insertBefore(calc, ref); }
  calc.setAttribute('fullCalcOnLoad', '1');
  const ser = new XMLSerializer();
  for (const [name, doc] of Object.entries(bk.docs)) bk.zip.file(bk.sheets[name].path, ser.serializeToString(doc));
  bk.zip.file('xl/workbook.xml', ser.serializeToString(bk.wbx));
  if (bk.zip.file('xl/calcChain.xml')) bk.zip.remove('xl/calcChain.xml');
  const out = await bk.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { bytes: out, warn };
}
window.__buildWorkbook = buildWorkbook;

/* ---------- import ---------- */
async function readWorkbook(bytes) {
  const M = XL_MAP, bk = await openBook(bytes);
  const cov = await bk.sheetDoc('Cover');
  if (!cov || !/project name/i.test(String(readCell(bk, cov, 'B7') ?? ''))) throw new Error('This is not a Regen commissioning workbook.');
  const app = await bk.sheetDoc(M.app.sheet);
  if (!app || !/^SCA-TEMPLATE$/.test(String(readCell(bk, app, 'A1') ?? '')) || (+readCell(bk, app, 'B1') || 0) < 2) throw new Error('This workbook was made from an older version of the template. Download the blank workbook from the Excel tab and copy the readings into it.');
  const g = async n => bk.sheetDoc(n), rc = (d, ref) => readCell(bk, d, ref);
  const p = newProject(); const I = p.info;
  for (const [k, ref] of Object.entries(M.cover)) I[k] = k === 'date' || k === 'appr_date' ? rDate(rc(cov, ref)) : rStr(rc(cov, ref));
  let d = await g(M.equip.sheet);
  p.equip.forEach((e, i) => { const r = M.equip.first + i, c = M.equip.cols; e.model = rStr(rc(d, c.model + r)); e.sn = rStr(rc(d, c.sn + r)); e.cal = rDate(rc(d, c.cal + r)); e.due = rDate(rc(d, c.due + r)); e.use = rStr(rc(d, c.use + r)) || e.use; });
  for (const [k, o] of Object.entries(M.limits)) { const v = rc(d, o.cell); if (typeof v === 'number') p.lim[k] = numStr(o.pct ? v * 100 : v); else if (filled(v)) p.lim[k] = rStr(v); }
  d = await g(M.visual.sheet);
  M.visual.rows.forEach((r, i) => { p.vis[i].s = rStr(rc(d, 'D' + r)); p.vis[i].r = rStr(rc(d, 'E' + r)); });
  p.vis_by = rStr(rc(d, M.visual.by)); p.vis_date = rDate(rc(d, M.visual.date));
  // inverters: register rows + DC sheets, up to the last one that holds any data
  const reg = await g(M.invreg.sheet), invs = [];
  for (let k = 0; k < M.dc.sheets.length; k++) {
    const inv = newInv(k, null); inv.dt = ''; let any = false;
    if (k < M.invreg.n) for (const [f, c] of Object.entries(M.invreg.cols)) { const v = rStr(rc(reg, c + (M.invreg.first + k))); if (v) { inv[f] = v; any = true; } }
    const ds = await g(M.dc.sheets[k]);
    if (ds) {
      const h = M.dc.head;
      if (!inv.loc) inv.loc = rStr(rc(ds, h.loc)); if (!inv.sn) inv.sn = rStr(rc(ds, h.sn)); if (!inv.kw) inv.kw = rStr(rc(ds, h.kw));
      const mm = rStr(rc(ds, h.makemodel)); if (mm && !inv.make && !inv.model) inv.model = mm;
      inv.dt = rDateTime(rc(ds, h.dt)); inv.by = rStr(rc(ds, h.by)); inv.wx = rStr(rc(ds, h.wx));
      if ([inv.loc, inv.sn, inv.kw, mm, inv.dt, inv.by, inv.wx].some(filled)) any = true;
      for (let r = M.dc.first; r <= M.dc.last; r++) {
        const s = newStr(); let used = false;
        for (const [f, c] of Object.entries(M.dc.cols)) { const v = rStr(rc(ds, c + r)); s[f] = v; if (v && f !== 'mppt' && f !== 'str') used = true; }
        if (used || (s.mppt && s.str && s.mods)) { inv.strings.push(s); any = true; }
      }
    }
    invs.push({ inv, any });
  }
  let last = -1; invs.forEach((x, k) => { if (x.any) last = k; });
  p.invs = invs.slice(0, last + 1).map(x => x.inv);
  d = await g(M.invreg.sheet);
  for (const [k, ref] of Object.entries(M.panel)) if (k !== 'sheet') p.panel[k] = rStr(rc(d, ref));
  // tables
  const rows = async (sheet, t, make, conv) => { const dd = await g(sheet), out = []; for (let r = t.first; r <= t.last; r++) { const o = make(); let used = false; for (const [f, c] of Object.entries(t.cols)) { const v = conv(f, rc(dd, c + r)); o[f] = v; if (v) used = true; } if (used) out.push(o); } return out; };
  const cv = t => (f, v) => (t.time && t.time.includes(f) ? rTime(v) : t.date && t.date.includes(f) ? rDate(v) : rStr(v));
  const A = M.ac; d = await g(A.sheet);
  p.ac.rows = await rows(A.sheet, A, newAc, cv(A)); if (!p.ac.rows.length) p.ac.rows = [Object.assign(newAc(), { pt: 'Grid side (no load)' })];
  p.ac.date = rDate(rc(d, A.date)); p.ac.by = rStr(rc(d, A.by)); p.ac.officer = rStr(rc(d, A.officer));
  const AI = M.acins; d = await g(AI.sheet); p.acins.rows = [];
  for (let r = AI.first; r <= AI.last; r++) { const o = newAcIns(); o.pt = rStr(rc(d, AI.cols.pt + r)); o.rem = rStr(rc(d, AI.cols.rem + r)); o.v = AI.vcols.map(c => rStr(rc(d, c + r))); if (o.pt || o.rem || o.v.some(filled)) p.acins.rows.push(o); }
  if (!p.acins.rows.length) p.acins.rows = [newAcIns()];
  p.acins.earth = await rows(AI.sheet, AI.earth, newEarth, cv(AI.earth)); if (!p.acins.earth.length) p.acins.earth = [newEarth()];
  p.acins.date = rDate(rc(d, AI.date)); p.acins.volt = rStr(rc(d, AI.volt)); p.acins.by = rStr(rc(d, AI.by)); p.acins.officer = rStr(rc(d, AI.officer));
  const T = M.th; d = await g(T.sheet);
  p.th.pan = await rows(T.sheet, T.pan, newPan, cv(T.pan)); p.th.inv = await rows(T.sheet, T.inv, newThInv, cv(T.inv)); p.th.sw = await rows(T.sheet, T.sw, newSw, cv(T.sw));
  if (!p.th.pan.length) p.th.pan = [newPan()]; if (!p.th.inv.length) p.th.inv = [newThInv()]; if (!p.th.sw.length) p.th.sw = [newSw()];
  // a breaker row holding only the pre-printed "Main Breaker" label counts as empty
  p.th.sw = p.th.sw.filter((x, i) => i === 0 || [x.rating, x.time, x.tin, x.tout, x.c].some(filled) || x.where !== 'Main Breaker');
  p.th.date = rDate(rc(d, T.date)); p.th.amb = rStr(rc(d, T.amb)); p.th.irr = rStr(rc(d, T.irr)); p.th.by = rStr(rc(d, T.by)); p.th.officer = rStr(rc(d, T.officer));
  const BT = M.bat; d = await g(BT.sheet);
  for (const k of ['brand', 'type', 'kwh', 'vn', 'mods', 'strs', 'bms', 'by', 'officer']) p.bat[k] = rStr(rc(d, BT[k]));
  p.bat.mod = await rows(BT.sheet, BT.mod, newBMod, cv(BT.mod)); if (!p.bat.mod.length) p.bat.mod = [newBMod()];
  p.bat.prm.forEach((x, i) => { const r = BT.prm.first + i; for (const [f, c] of Object.entries(BT.prm.cols)) x[f] = rStr(rc(d, c + r)); });
  p.bat.tests.forEach((x, i) => { const r = BT.tests.first + i; for (const [f, c] of Object.entries(BT.tests.cols)) x[f] = BT.tests.time.includes(f) ? rTime(rc(d, c + r)) : rStr(rc(d, c + r)); });
  const PR = M.prot; d = await g(PR.sheet);
  p.prot.forEach((x, i) => { const r = PR.first + i; for (const [f, c] of Object.entries(PR.cols)) x[f] = rStr(rc(d, c + r)); });
  p.prot_by = rStr(rc(d, PR.by)); p.prot_date = rDate(rc(d, PR.date));
  p.punch = (await rows(M.punch.sheet, M.punch, newPunch, cv(M.punch))).filter(x => [x.loc, x.issue, x.action, x.resp].some(filled)).map(x => { if (!['Open', 'In Progress', 'Closed'].includes(x.s)) x.s = 'Open'; return x; });
  // applicability from the Summary sheet
  const SM = M.summary; d = await g(SM.sheet);
  for (const [key, r] of Object.entries(SM.rows)) {
    const v = rStr(rc(d, SM.col + r)); if (v !== 'Yes' && v !== 'No') continue;
    if (key.startsWith('dc')) { const inv = p.invs[+key.slice(2) - 1]; if (inv && v === 'No') p.applic['dc:' + inv.id] = 'No'; }
    else if (key === 'battery' || v === 'No') p.applic[key] = v;
  }
  const SG = M.sign; d = await g(SG.sheet);
  p.sign.date = rDate(rc(d, SG.date)); p.sign.officer = rStr(rc(d, SG.officer)); p.sign.comments = rStr(rc(d, SG.comments));
  p.sign.roles.forEach((x, i) => { const r = SG.roles.first + i; x.name = rStr(rc(d, SG.roles.cols.name + r)); x.co = rStr(rc(d, SG.roles.cols.co + r)); x.date = rDate(rc(d, SG.roles.cols.date + r)); });
  p.sign.hand = p.sign.hand.map((_, i) => rStr(rc(d, SG.hand.col + (SG.hand.first + i))));
  // panel serials: matched back to inverter / MPPT / string
  const SE = M.serials; d = await g(SE.sheet);
  if (d) {
    const sd = d.getElementsByTagNameNS(NS, 'sheetData')[0], lastR = Math.max(SE.last, ...[...sd.children].map(r => +r.getAttribute('r')));
    for (let r = SE.first; r <= lastR; r++) {
      const sn = rStr(rc(d, SE.cols.sn + r)); if (!sn) continue;   // duplicates are kept so the app can flag them
      const tag = rStr(rc(d, SE.cols.inv + r)), m = /(\d+)/.exec(tag), inv = m ? p.invs[+m[1] - 1] : null;
      const mp = grpKey(rStr(rc(d, SE.cols.mppt + r))), st = grpKey(rStr(rc(d, SE.cols.str + r)));
      const s = inv ? inv.strings.find(x => grpKey(x.mppt) === mp && grpKey(x.str) === st) : null;
      p.pser.push({ sn: sn.slice(0, 120), sid: s ? s.id : '' });
    }
  }
  I.engineer = rStr(rc(app, M.app.engineer)) || p.sign.officer || p.ac.by || '';
  const pid = rStr(rc(app, M.app.pid));
  if (ID_RE.test(pid)) p.id = pid;
  p.updated = Date.now();
  if (!filled(I.name)) I.name = 'Imported workbook';
  return migrate(p);
}

/* ---------- UI: Excel tab ---------- */
Object.assign(S, { xlMsg: '', xlBusy: false });
function vExcel() {
  return `${head('Excel workbook', 'The Regen commissioning workbook (.xlsx), filled from this app — or read back into the app after it was filled in Excel.')}
  <div class="card"><h2>Download as Excel</h2>
  <p style="margin:0 0 10px">Writes every reading of this project into the Regen workbook — same sheets, formulas, drop-downs and print layout as the blank one. Excel recalculates all results when the file is opened. Unused rows and inverter sheets are hidden, not deleted.</p>
  <div class="row"><button class="btn pri" data-act="xlexport" ${S.xlBusy ? 'disabled' : ''}>${S.xlBusy ? 'Building…' : 'Download Excel workbook (.xlsx)'}</button><button class="btn" data-act="xlblank">Download blank workbook</button></div>
  ${S.xlMsg ? `<p class="hint" style="margin:10px 0 0;white-space:pre-line">${esc(S.xlMsg)}</p>` : ''}
  <p class="hint" style="margin:10px 0 0">Capacity: 20 inverters × 36 strings, 22 AC rows, 21 insulation rows, 10 earth rods, 30 snags; panel serials have no limit. Photos stay in the app (Photos tab). Over-range insulation readings typed as “OL” are written as 9999 MΩ.</p></div>
  ${impCard()}
  <div class="card"><h2>Import from Excel</h2>
  <p style="margin:0 0 10px">Reads a filled Regen workbook (exported from this app or filled by hand) into a project. If the file came from this app, you can replace the project it came from — a checkpoint is saved first — or import it as a copy. Photos already in the app are kept.</p>
  <div class="row"><label class="btn pri" style="cursor:pointer">Choose Excel file…<input type="file" id="xlfile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label><span class="hint">Works with workbooks from today’s template onward (the one with up to 20 inverter sheets).</span></div></div>`;
}
async function xlExport() {
  if (S.xlBusy) return; S.xlBusy = true; S.xlMsg = ''; render();
  try {
    const { bytes, warn } = await buildWorkbook();
    const r = await saveFile(fname('xlsx'), bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    S.xlMsg = (r === 'saved' ? 'Excel workbook created.' : 'Save was cancelled.') + (warn.length ? '\n' + warn.join('\n') : '');
  } catch (e) { console.error(e); S.xlMsg = 'Could not build the workbook: ' + (e && e.message ? e.message : e); }
  S.xlBusy = false; if (P && S.tab === 'excel') render();
}
async function xlBlank() {
  try { const r = await saveFile('Solar_PV_Commissioning_Report_blank.xlsx', dataBytes('data:x;base64,' + XL_TPL), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); if (r === 'saved') toast('Blank workbook saved'); } catch (e) { toast('Could not save the file here'); }
}
async function handleExcelFile(f) {
  try {
    const p = await readWorkbook(await f.arrayBuffer());
    const ex = projects.find(x => x.id === p.id);
    S.imp = { file: f.name, items: [{ p, photos: {}, name: p.info.name, ex: !!ex, newer: true, act: ex ? 'replace' : 'add', excel: true }] };
    render(); scrollTo(0, 0);
  } catch (e) { toast(e && e.message && !/zip|central directory|end of data/i.test(e.message) ? e.message : 'That file could not be read as an Excel workbook', 6000); }
}

async function extraAct3(a, d, b, e) {
  switch (a) {
    case 'xlexport': await xlExport(); break;
    case 'xlblank': await xlBlank(); break;
  }
}
