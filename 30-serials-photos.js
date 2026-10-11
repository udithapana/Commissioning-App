/* ================= panel serial numbers ================= */
Object.assign(S, { sertarget: '', autoadv: true, scan: [], scanMsg: '', paste: false, phcat: 'PV panels / array', phinv: '', phbusy: '' });
const PH_CATS = ['PV panels / array', 'Panel serial labels', 'Inverter', 'DC cabling & strings', 'AC panel / switchgear', 'Earthing', 'Thermal images', 'Battery', 'Labels & signage', 'Snag / defect', 'Handover / other'];
function strList() { const out = []; P.invs.forEach((inv, i) => inv.strings.forEach((s, j) => out.push({ sid: s.id, inv, i, s, j }))); return out; }
const strLabel = sid => { const f = strList().find(x => x.sid === sid); return f ? `${invTag(f.i)} · MPPT ${f.s.mppt || '–'} / String ${f.s.str || '–'}` : 'Unassigned'; };
const serCount = sid => P.pser.filter(x => x.sid === sid).length;
const serFind = sn => P.pser.find(x => x.sn.toLowerCase() === sn.toLowerCase());
const serExpected = sid => { const f = strList().find(x => x.sid === sid); return f && isN(f.s.mods) ? num(f.s.mods) : 0; };
function serAdvance() {
  const l = strList(); if (!l.length) return;
  const k = l.findIndex(x => x.sid === S.sertarget);
  for (let n = 1; n <= l.length; n++) { const c = l[(k + n + l.length) % l.length]; if (serExpected(c.sid) === 0 || serCount(c.sid) < serExpected(c.sid)) { S.sertarget = c.sid; return; } }
}
function addSerials(list) {
  let added = 0; const dup = [];
  for (let sn of list) {
    sn = String(sn).trim().replace(/\s+/g, ' ').slice(0, 120); if (!sn) continue;
    const ex = serFind(sn); if (ex) { dup.push(sn); continue; }
    P.pser.push({ sn, sid: S.sertarget }); added++;
    const e = serExpected(S.sertarget); if (S.autoadv && S.sertarget && e && serCount(S.sertarget) >= e) serAdvance();
  }
  if (added) touch();
  return { added, dup };
}
function serDupSet() { const m = {}; P.pser.forEach(x => { const k = x.sn.toLowerCase(); m[k] = (m[k] || 0) + 1; }); return k => m[k.toLowerCase()] > 1; }
function serialGroups() {
  const g = []; const un = P.pser.filter(x => !strList().some(y => y.sid === x.sid));
  strList().forEach(x => { const l = P.pser.filter(y => y.sid === x.sid); if (l.length || serExpected(x.sid)) g.push({ label: `${invTag(x.i)}${x.inv.loc ? ' — ' + x.inv.loc : ''}`, sub: `MPPT ${x.s.mppt || '–'} / String ${x.s.str || '–'}`, exp: serExpected(x.sid), list: l.map(y => y.sn), sid: x.sid }); });
  if (un.length) g.push({ label: 'Unassigned', sub: '', exp: 0, list: un.map(y => y.sn), sid: '' });
  return g;
}
function serialStatus() {
  const l = strList(); const dups = P.pser.length - new Set(P.pser.map(x => x.sn.toLowerCase())).size;
  if (!P.pser.length) return 'none';
  const full = l.length && l.every(x => !serExpected(x.sid) || serCount(x.sid) >= serExpected(x.sid));
  return dups ? 'bad' : full && !P.pser.some(x => !strList().some(y => y.sid === x.sid)) ? 'ok' : 'warn';
}

async function loadJsQR() {
  if (window.jsQR) return;
  await new Promise(res => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; s.onload = res; s.onerror = res; document.head.appendChild(s); });
}
async function decodeImage(file) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 1800 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0, w, h);
  let found = [];
  if ('BarcodeDetector' in window) {
    try {
      const want = ['qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'data_matrix', 'codabar', 'upc_a', 'upc_e', 'pdf417', 'aztec'];
      const sup = await BarcodeDetector.getSupportedFormats(); const det = new BarcodeDetector({ formats: sup.filter(f => want.includes(f)) });
      found = (await det.detect(cv)).map(x => x.rawValue);
    } catch (e) { }
  }
  if (!found.length) { await loadJsQR(); if (window.jsQR) { const id = cx.getImageData(0, 0, w, h); const q = jsQR(id.data, w, h, { inversionAttempts: 'attemptBoth' }); if (q && q.data) found = [q.data]; } }
  return [...new Set(found.map(s => String(s).trim()).filter(Boolean))];
}
async function onScanFile(file) {
  S.scanMsg = 'Reading code…'; render();
  try { const r = await decodeImage(file); S.scan = r; S.scanMsg = r.length ? '' : 'No code found. Retake closer and sharper with the code filling the frame, or type the serial number.'; }
  catch (e) { S.scan = []; S.scanMsg = 'Could not read that image.'; }
  render();
}
function csvEsc(v) { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
async function exportSerials() {
  const rows = [['Inverter', 'Location', 'MPPT', 'String', 'Serial no.']];
  serialGroups().forEach(g => { const f = strList().find(x => x.sid === g.sid); g.list.forEach(sn => rows.push([f ? invTag(f.i) : 'Unassigned', f ? f.inv.loc : '', f ? f.s.mppt : '', f ? f.s.str : '', sn])); });
  try { const r = await saveFile(fname('csv').replace('Report', 'Panel_Serials'), '﻿' + rows.map(r => r.map(csvEsc).join(',')).join('\r\n'), 'text/csv'); if (r === 'saved') toast('Serial list saved'); } catch (e) { toast('Could not save the file here'); }
}

function vSerials() {
  if (S.sertarget && !strList().some(x => x.sid === S.sertarget)) S.sertarget = '';   // target string was deleted
  const l = strList(), t = S.sertarget, exp = serExpected(t), dupf = serDupSet();
  const total = P.pser.length, dups = total - new Set(P.pser.map(x => x.sn.toLowerCase())).size, mods = totals().nm;
  const groups = serialGroups();
  return `${head('Panel serial numbers', 'Type each serial, use a USB / Bluetooth scanner, scan a QR or barcode from a photo, or paste a list. Each serial is stored once.', `<span class="row"><button class="btn" data-act="exportser" ${total ? '' : 'disabled'}>Download CSV</button></span>`)}
  <div class="card"><h2>Add serial numbers</h2>
  <div class="g wide"><label class="f"><span>Save to string</span><select data-st="1"><option value="">Unassigned</option>${l.map(x => `<option value="${esc(x.sid)}"${x.sid === t ? ' selected' : ''}>${esc(invTag(x.i))} · MPPT ${esc(x.s.mppt || '–')} / String ${esc(x.s.str || '–')} (${serCount(x.sid)}${serExpected(x.sid) ? '/' + serExpected(x.sid) : ''})</option>`).join('')}</select></label>
  <label class="f"><span>Serial number${exp ? ` — ${serCount(t)} of ${exp}` : ''}</span><input type="text" id="serin" autocomplete="off" autocapitalize="characters" spellcheck="false" class="mono" placeholder="Type or scan, then press Enter"></label></div>
  <div class="row" style="margin-top:10px"><button class="btn pri" data-act="addser">Add</button><label class="btn" style="cursor:pointer">Scan QR / barcode from photo<input type="file" id="scanfile" accept="image/*" capture="environment" hidden></label><button class="btn" data-act="togpaste">${S.paste ? 'Hide paste box' : 'Paste a list'}</button><label class="row hint" style="gap:6px;cursor:pointer"><input type="checkbox" data-aa="1" ${S.autoadv ? 'checked' : ''}> Move to next string when full</label></div>
  ${S.paste ? `<div style="margin-top:10px"><textarea id="serpaste" rows="5" placeholder="One serial per line (commas, semicolons or tabs also work)"></textarea><div class="row" style="margin-top:8px"><button class="btn pri" data-act="addpaste">Add pasted list</button></div></div>` : ''}
  ${S.scanMsg ? `<p class="hint" style="margin:10px 0 0">${esc(S.scanMsg)}</p>` : ''}
  <p class="hint" style="margin:10px 0 0">Scanning works from a photo: tap the scan button and take a picture of the module label. A wired or Bluetooth scanner types into the box above and ends with Enter.</p></div>
  ${S.scan.length ? `<div class="card"><h2>Codes found — check before adding</h2><div class="grid" style="display:grid;gap:8px">${S.scan.map((v, i) => `<div class="row" style="flex-wrap:nowrap"><input type="text" class="mono" data-sc="${i}" value="${esc(v)}"><button class="btn sm danger" data-act="scandel" data-i="${i}">✕</button></div>`).join('')}</div><div class="row" style="margin-top:10px"><button class="btn pri" data-act="scanadd">Add ${S.scan.length} to ${esc(strLabel(t))}</button><button class="btn" data-act="scanclr">Discard</button></div><p class="hint">Module QR codes can hold extra text (a URL or several fields). Edit each line so it contains only the serial number.</p></div>` : ''}
  <div class="card"><div class="kpi"><span>Serials recorded <b>${total}</b></span><span>Modules in strings <b>${mods || '—'}</b></span><span>Duplicates <b style="color:${dups ? 'var(--bad)' : 'inherit'}">${dups}</b></span></div></div>
  ${groups.length ? `<div class="rcs">${groups.map(g => { const ok = g.exp ? g.list.length >= g.exp : g.list.length > 0; return `<div class="rc"><header><b>${esc(g.label)}${g.sub ? ' · ' + esc(g.sub) : ''}</b><span class="row"><span class="bdg ${g.exp ? (g.list.length === g.exp ? 'ok' : g.list.length > g.exp ? 'bad' : 'warn') : 'na'}">${g.list.length}${g.exp ? ' / ' + g.exp : ''}</span>${g.sid !== undefined && g.sid ? `<button class="btn sm" data-act="settarget" data-sid="${esc(g.sid)}">Use</button>` : ''}</span></header>
  <div class="row" style="gap:6px">${g.list.map(sn => `<span class="bdg ${dupf(sn) ? 'bad' : 'none'}" style="font-family:var(--mono);text-transform:none;font-weight:500;padding:3px 4px 3px 9px;display:inline-flex;gap:6px;align-items:center">${esc(sn)}<button class="btn sm" style="min-height:22px;padding:0 6px;border:0" data-act="delser" data-sn="${esc(sn)}" data-sid="${esc(g.sid)}" aria-label="Remove ${esc(sn)}">✕</button></span>`).join('') || '<span class="hint">None yet</span>'}</div></div>`; }).join('')}</div>` : `<div class="card empty">${l.length ? 'No serials yet — start typing or scanning above.' : 'Add inverters and strings first (Inverters &amp; DC), or save serials as Unassigned.'}</div>`}`;
}

/* ================= photos ================= */
const phCache = {};
let idb = null;
function idbOpen() { return idb || (idb = new Promise((res, rej) => { try { const r = indexedDB.open('sca-photos', 2); r.onupgradeneeded = () => { const d = r.result; ['ph', 'hist'].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } })); }
async function idbOp(mode, fn, st = 'ph') { const d = await idbOpen(); return new Promise((res, rej) => { const tx = d.transaction(st, mode), q = fn(tx.objectStore(st)); tx.oncomplete = () => res(q.result); tx.onerror = () => rej(tx.error); }); }
async function phPut(id, data, pid) { phCache[id] = data; if (DB) await DB.doc('photos/' + id).set({ pid, data }); else await idbOp('readwrite', s => s.put(data, id)); }
async function phGet(id) {
  if (phCache[id]) return phCache[id];
  try { if (DB) { const d = await DB.doc('photos/' + id).get(); if (d.exists) return (phCache[id] = d.data().data); } else { const v = await idbOp('readonly', s => s.get(id)); if (v) return (phCache[id] = v); } } catch (e) { }
  return null;
}
async function phDel(id) { delete phCache[id]; try { if (DB) await DB.doc('photos/' + id).delete(); else await idbOp('readwrite', s => s.delete(id)); } catch (e) { } }
async function compress(file) {
  const bmp = await createImageBitmap(file);
  let max = 1280, q = .8, out = null;
  for (let k = 0; k < 6; k++) {
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(bmp, 0, 0, w, h);
    out = cv.toDataURL('image/jpeg', q);
    if (out.length * 0.75 <= 165000) break;
    if (q > .55) q -= .12; else max = Math.round(max * .82);
  }
  return out;
}
async function addPhotos(files) {
  const list = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name)); if (!list.length) return;
  let ok = 0, bad = 0; const proj = P, cat = S.phcat, inv = S.phinv;
  for (let i = 0; i < list.length; i++) {
    S.phbusy = `Saving photo ${i + 1} of ${list.length}…`; setPhBusy();
    try { const data = await compress(list[i]); const id = 'ph' + uid(); await phPut(id, data, proj.id); proj.photos.push({ id, cat, inv, cap: '', ts: Date.now() }); ok++; proj.updated = Date.now(); if (P === proj) touch(); else { lsWrite(); saveProjNow(proj); } }
    catch (e) { bad++; }
  }
  S.phbusy = ''; if (P === proj) render(); toast(ok ? `${ok} photo${ok > 1 ? 's' : ''} saved${bad ? `, ${bad} failed` : ''}` : 'Could not save the photo(s)');
}
const setPhBusy = () => { const e = $('#phbusy'); if (e) e.textContent = S.phbusy; };
const dtFmt = ts => { const d = new Date(ts); return dFmt(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const phInvLabel = v => (v === '' || v == null ? 'General' : (() => { const k = P.invs.findIndex(x => x.id === v); return k < 0 ? 'General' : invName(P.invs[k], k); })());
function vPhotos() {
  const n = P.photos.length;
  if (S.phinv && !P.invs.some(v => v.id === S.phinv)) S.phinv = '';
  const invOpts = sel => `<option value=""${sel ? '' : ' selected'}>General / whole site</option>${P.invs.map((v, i) => `<option value="${esc(v.id)}"${sel === v.id ? ' selected' : ''}>${esc(invName(v, i))}</option>`).join('')}`;
  return `${head('Site photos', 'Photos are shrunk to fit the report and kept with the project. They are NOT printed in the commissioning report — download them as a separate photo document.', `<button class="btn pri" data-act="phpdf" ${n ? '' : 'disabled'}>Download photo document (PDF)</button>`)}
  <div class="card"><h2>Add photos</h2><div class="g wide"><label class="f"><span>Category</span><select data-pc="1">${PH_CATS.map(c => `<option${c === S.phcat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label class="f"><span>Related to</span><select data-pi="1">${invOpts(S.phinv)}</select></label></div>
  <div class="row" style="margin-top:10px"><label class="btn pri" style="cursor:pointer">Take photo<input type="file" id="phcam" accept="image/*" capture="environment" hidden></label><label class="btn" style="cursor:pointer">Choose from gallery<input type="file" id="phgal" accept="image/*" multiple hidden></label><span class="hint" id="phbusy">${esc(S.phbusy)}</span></div></div>
  ${n ? `<div class="rcs">${P.photos.map((p, i) => `<div class="rc"><img data-ph="${esc(p.id)}" alt="Photo ${i + 1}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:7px;background:var(--panel);display:block"><header><b>${i + 1}. ${esc(p.cat)}</b><span class="hint">${esc(dtFmt(p.ts))}</span></header>
  <div class="g c2"><label class="f"><span>Category</span><select data-p="photos.${i}.cat">${PH_CATS.map(c => `<option${c === p.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label class="f"><span>Related to</span><select data-p="photos.${i}.inv">${invOpts(p.inv)}</select></label></div>${fld('Caption', `photos.${i}.cap`, { ph: 'e.g. Array row 3, string 2 junction' })}<div class="row"><button class="btn sm danger" data-act="delph" data-i="${i}" data-confirm="1">Delete photo</button></div></div>`).join('')}</div>` : '<div class="card empty">No photos yet. Use “Take photo” on site or choose existing pictures.</div>'}`;
}
async function afterRender() {
  $$('img[data-ph]').forEach(async im => { const d = await phGet(im.dataset.ph); if (d && /^data:image\/(jpeg|png|webp);base64,/.test(d) && im.isConnected) im.src = d; else if (im.isConnected) im.alt = 'Photo not available on this device'; });
  const sf = $('#scanfile'); if (sf) sf.onchange = () => { const f = sf.files[0]; sf.value = ''; if (f) onScanFile(f); };
  const pc = $('#phcam'); if (pc) pc.onchange = () => { const f = [...pc.files]; pc.value = ''; addPhotos(f); };
  const ifl = $('#impfile'); if (ifl) ifl.onchange = onImport;
  const xf = $('#xlfile'); if (xf) xf.onchange = () => { const f = xf.files[0]; xf.value = ''; if (f) handleExcelFile(f); };
  const pg = $('#phgal'); if (pg) pg.onchange = () => { const f = [...pg.files]; pg.value = ''; addPhotos(f); };
}

/* photo document */
async function buildPhotoPdf() {
  await ensurePdfLib();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create(); doc.setTitle('Photo Documentation — ' + (P.info.name || 'Project')); doc.setAuthor(CO.name); doc.setCreator('Site Commissioning App');
  const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 32, CW = W - 2 * M, TOP = H - 54, BOT = 66;
  const ink = rgb(.1, .15, .19), mute = rgb(.38, .43, .48), line = rgb(.78, .8, .82), navy = rgb(.07, .19, .25), acc = rgb(.85, .54, 0), white = rgb(1, 1, 1);
  const san = s => String(s ?? '').replace(/MΩ/g, 'MOhm').replace(/Ω/g, 'Ohm').replace(/Δ/g, 'd').replace(/[−‒]/g, '-').replace(/[→]/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF–—•…]/g, '?');
  const wrapT = (t, f, sz, mw) => { const out = []; String(t ?? '').split(/\r?\n/).forEach(par => { let line2 = ''; for (let w of san(par).split(' ')) { const test = line2 ? line2 + ' ' + w : w; if (f.widthOfTextAtSize(test, sz) <= mw) { line2 = test; continue; } if (line2) out.push(line2); while (f.widthOfTextAtSize(w, sz) > mw && w.length > 1) { let k = w.length; while (k > 1 && f.widthOfTextAtSize(w.slice(0, k), sz) > mw) k--; out.push(w.slice(0, k)); w = w.slice(k); } line2 = w; } out.push(line2); }); return out; };
  const pages = []; let page, y;
  const np = () => { page = doc.addPage([W, H]); pages.push(page); y = pages.length === 1 ? H - M : TOP; };
  const tx = (s, x, yy, o = {}) => page.drawText(san(s), { x, y: yy, size: o.sz || 8, font: o.f || F, color: o.c || ink });
  const tw = (s, sz, f) => (f || F).widthOfTextAtSize(san(s), sz);
  const fit = (t, f, sz, mw) => { t = san(t); if (f.widthOfTextAtSize(t, sz) <= mw) return t; while (t.length > 1 && f.widthOfTextAtSize(t + '…', sz) > mw) t = t.slice(0, -1); return t + '…'; };
  np();
  const LG = await doc.embedPng(dataBytes(LOGO.full)), LM = await doc.embedPng(dataBytes(LOGO.mark)), green = rgb(0, .596, .282);
  { const lh = 92, lw = lh * LG.width / LG.height, x0 = M + lw + 20;
    page.drawImage(LG, { x: M, y: H - M - lh, width: lw, height: lh });
    tx(CO.name.toUpperCase(), x0, H - M - 18, { f: B, sz: 9, c: green }); tx('PHOTO DOCUMENTATION', x0, H - M - 48, { f: B, sz: 19, c: navy });
    tx('Solar PV system installation commissioning — site photographs', x0, H - M - 68, { sz: 8.5, c: mute });
    page.drawRectangle({ x: M, y: H - M - lh - 12, width: CW, height: 2.4, color: green }); y = H - M - lh - 30; }
  wrapT(P.info.name || 'Untitled project', B, 15, CW).slice(0, 3).forEach(l => { tx(l, M, y - 12, { f: B, sz: 15 }); y -= 18; });
  [[P.info.address, ''], ['Commissioning date: ' + dFmt(P.info.date) + '     Photos: ' + P.photos.length, '']].forEach(([t]) => { if (t) wrapT(t, F, 9, CW).forEach(l => { tx(l, M, y - 9, { sz: 9, c: mute }); y -= 12; }); });
  y -= 10;
  // index table
  const cols = [['No.', 24], ['Category', 120], ['Related to', 120], ['Caption', 190], ['Taken', 77]]; const tsum = cols.reduce((a, c) => a + c[1], 0), ws = cols.map(c => c[1] * CW / tsum); const xs = []; ws.reduce((a, w, i) => (xs[i] = a, a + w), M);
  const header = () => { page.drawRectangle({ x: M, y: y - 14, width: CW, height: 14, color: rgb(.89, .92, .93), borderColor: line, borderWidth: .5 }); cols.forEach((c, i) => tx(c[0], xs[i] + 3, y - 10, { f: B, sz: 6.6, c: navy })); y -= 14; };
  tx('INDEX', M, y - 8, { f: B, sz: 8.6, c: navy }); y -= 16; header();
  P.photos.forEach((p, i) => {
    const cells = [String(i + 1), p.cat, phInvLabel(p.inv), p.cap || '', dtFmt(p.ts)].map((v, k) => wrapT(v, F, 7.2, ws[k] - 6).slice(0, 8)); const h = Math.max(13, Math.max(...cells.map(c => c.length)) * 8.6 + 5);
    if (y - h < BOT) { np(); header(); }
    cols.forEach((c, k) => { page.drawRectangle({ x: xs[k], y: y - h, width: ws[k], height: h, borderColor: line, borderWidth: .5 }); cells[k].forEach((l, j) => tx(l, xs[k] + 3, y - 9.3 - j * 8.6, { sz: 7.2 })); });
    y -= h;
  });
  // photo pages: 2 columns x 3 rows
  const gx = 12, cw = (CW - gx) / 2, rows = 3, ch = (TOP - BOT + 6) / rows - 6, capH = 36, imgH = ch - capH;
  for (let i = 0; i < P.photos.length; i++) {
    if (i % 6 === 0) np();
    const k = i % 6, col = k % 2, row = Math.floor(k / 2), x = M + col * (cw + gx), top = TOP - row * (ch + 6);
    const p = P.photos[i]; const data = await phGet(p.id);
    page.drawRectangle({ x, y: top - ch, width: cw, height: ch, borderColor: line, borderWidth: .6 });
    if (data) {
      try {
        const bin = atob(data.split(',')[1]), arr = new Uint8Array(bin.length); for (let q = 0; q < bin.length; q++) arr[q] = bin.charCodeAt(q);
        const im = await doc.embedJpg(arr), sc = Math.min((cw - 8) / im.width, (imgH - 8) / im.height), w = im.width * sc, h = im.height * sc;
        page.drawImage(im, { x: x + (cw - w) / 2, y: top - 4 - h - (imgH - 8 - h) / 2, width: w, height: h });
      } catch (e) { tx('Image could not be embedded', x + 8, top - 20, { c: mute }); }
    } else tx('Photo not available on this device', x + 8, top - 20, { c: mute });
    page.drawLine({ start: { x, y: top - imgH }, end: { x: x + cw, y: top - imgH }, color: line, thickness: .5 });
    tx(fit(`${i + 1}.  ${p.cat}`, B, 7.4, cw - 10), x + 5, top - imgH - 10, { f: B, sz: 7.4, c: navy });
    tx(fit(phInvLabel(p.inv) + '  ·  ' + dtFmt(p.ts), F, 6.6, cw - 10), x + 5, top - imgH - 19.5, { sz: 6.6, c: mute });
    wrapT(p.cap, F, 7.2, cw - 10).slice(0, 2).forEach((l, j) => tx(l, x + 5, top - imgH - 29.5 - j * 8.2, { sz: 7.2 }));
  }
  const N = pages.length, nl = wrapT(CO.notice, F, 6, CW);
  pages.forEach((pg, i) => {
    page = pg;
    if (i > 0) { const mw = 16 * LM.width / LM.height; page.drawImage(LM, { x: M, y: H - 32, width: mw, height: 16 }); tx(CO.name + '  —  Photo Documentation', M + mw + 6, H - 28, { sz: 6.8, c: mute }); const t = fit(P.info.name || 'Untitled project', B, 6.8, CW - tw(CO.name + '  —  Photo Documentation', 6.8) - 24); tx(t, W - M - tw(t, 6.8, B), H - 28, { sz: 6.8, f: B, c: navy }); page.drawLine({ start: { x: M, y: H - 34 }, end: { x: W - M, y: H - 34 }, color: navy, thickness: .8 }); }
    page.drawLine({ start: { x: M, y: 54 }, end: { x: W - M, y: 54 }, color: line, thickness: .6 });
    nl.forEach((l, k) => tx(l, (W - tw(l, 6)) / 2, 45 - k * 7.4, { sz: 6, c: mute }));
    tx(fit((P.info.name || '') + (P.info.docno ? '   ·   ' + P.info.docno : ''), F, 6.8, CW - 80), M, 22, { sz: 6.8, c: mute }); const pt = `Page ${i + 1} of ${N}`; tx(pt, W - M - tw(pt, 7.4, B), 22, { sz: 7.4, f: B, c: navy });
  });
  S.pages = N; return await doc.save();
}
window.__buildPhotoPdf = buildPhotoPdf;

/* ================= extra actions ================= */
async function extraAct(a, d, b, e) {
  switch (a) {
    case 'addser': { const i = $('#serin'); const r = addSerials([i.value]); if (r.dup.length) toast('Already recorded: ' + r.dup[0] + ' (' + strLabel(serFind(r.dup[0]).sid) + ')', 3500); render(); { const n = $('#serin'); if (n) n.focus(); } break; }
    case 'addpaste': { const v = $('#serpaste').value.split(/[\r\n,;\t]+/); const r = addSerials(v); S.paste = false; render(); toast(`${r.added} added${r.dup.length ? `, ${r.dup.length} duplicate${r.dup.length > 1 ? 's' : ''} skipped` : ''}`, 3500); break; }
    case 'togpaste': S.paste = !S.paste; render(); break;
    case 'delser': { const inGroup = x => (d.sid ? x.sid === d.sid : !strList().some(y => y.sid === x.sid)); const k = P.pser.findIndex(x => x.sn === d.sn && inGroup(x)); if (k >= 0) { P.pser.splice(k, 1); touch(); render(); } break; }
    case 'settarget': S.sertarget = d.sid; render(); scrollTo(0, 0); break;
    case 'scandel': S.scan.splice(+d.i, 1); render(); break;
    case 'scanclr': S.scan = []; render(); break;
    case 'scanadd': { const r = addSerials(S.scan); S.scan = []; render(); toast(`${r.added} added${r.dup.length ? `, ${r.dup.length} already recorded` : ''}`, 3500); break; }
    case 'exportser': exportSerials(); break;
    case 'delph': { const p = P.photos.splice(+d.i, 1)[0]; if (p) phDel(p.id); touch(); render(); break; }
    case 'phpdf': { S.phbusy = 'Building photo document…'; setPhBusy(); try { const bytes = await buildPhotoPdf(); const r = await saveFile(fname('pdf').replace('Report', 'Photos'), bytes, 'application/pdf'); S.phbusy = ''; render(); toast(r === 'saved' ? `Photo document created — ${S.pages} pages` : 'Save was cancelled'); } catch (x) { console.error(x); S.phbusy = ''; render(); toast('Could not build the photo document'); } break; }
    default: await extraAct2(a, d, b, e);
  }
}
