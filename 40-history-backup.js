/* ================= history (checkpoints), backup, import / export ================= */
Object.assign(S, { imp: null, expPhotos: true, histLabel: '', histBusy: false });
const HM = {};            // history meta cache by project id
const HLAST = {};         // last snapshot text by project id
const HKEEP = 25, HMAX = 240000, HAUTO_MS = 10 * 60 * 1000;
const stripT = o => { const c = JSON.parse(JSON.stringify(o)); delete c.updated; return JSON.stringify(c); };

function normMeta(items) {
  const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  return (Array.isArray(items) ? items : []).filter(x => isObj(x) && typeof x.id === 'string' && ID_RE.test(x.id)).map(x => ({
    id: x.id, ts: n(x.ts), label: String(x.label || 'Checkpoint').slice(0, 120),
    sum: isObj(x.sum) ? { o: ['PASS', 'FAIL', 'INCOMPLETE'].includes(x.sum.o) ? x.sum.o : 'INCOMPLETE', pass: n(x.sum.pass), fail: n(x.sum.fail), open: n(x.sum.open), ser: n(x.sum.ser), ph: n(x.sum.ph) } : null
  }));
}
async function metaGet(pid) {
  try {
    if (DB) { const d = await DB.doc('histmeta/' + pid).get(); return normMeta(d.exists ? d.data().items : []); }
    return normMeta(JSON.parse(localStorage.getItem('sca.hist.' + pid) || '[]'));
  } catch (e) { return []; }
}
async function metaSet(pid, items) {
  HM[pid] = items;
  try { if (DB) await DB.doc('histmeta/' + pid).set({ pid, items }); else localStorage.setItem('sca.hist.' + pid, JSON.stringify(items)); } catch (e) { }
}
async function histEnsure(pid) { if (!HM[pid]) HM[pid] = await metaGet(pid); return HM[pid]; }
async function histPut(id, pid, data) { if (DB) await DB.doc('history/' + id).set({ pid, data }); else await idbOp('readwrite', s => s.put(data, id), 'hist'); }
async function histGet(id) { if (DB) { const d = await DB.doc('history/' + id).get(); return d.exists ? d.data().data : null; } return await idbOp('readonly', s => s.get(id), 'hist'); }
async function histDel(id) { try { if (DB) await DB.doc('history/' + id).delete(); else await idbOp('readwrite', s => s.delete(id), 'hist'); } catch (e) { } }

function projSummary(p) {
  const keep = P; P = p; let r; try { const rows = summary(); const act = rows.filter(x => x.app === 'Yes'); r = { o: overall(rows), pass: act.reduce((a, x) => a + x.pass, 0), fail: act.reduce((a, x) => a + x.fail, 0), open: act.reduce((a, x) => a + x.open, 0), ser: p.pser.length, ph: p.photos.length }; } finally { P = keep; }
  return r;
}
async function snapshot(label, p = P, quiet = false) {
  if (!p) return false;
  const items = await histEnsure(p.id);
  const txt = JSON.stringify(p);
  if (bytes(txt) > HMAX) { if (!quiet) toast('Project is too large for a checkpoint'); return false; }
  const id = 'h' + uid();
  try {
    await histPut(id, p.id, txt);
    const next = [{ id, ts: Date.now(), label: label || 'Checkpoint', sum: projSummary(p) }, ...items];
    const drop = next.splice(HKEEP); drop.forEach(x => histDel(x.id));
    await metaSet(p.id, next); HLAST[p.id] = stripT(p);
    return true;
  } catch (e) { console.error(e); if (!quiet) toast('Could not save the checkpoint'); return false; }
}
let autoBusy = false;
async function maybeAuto() {
  const p = P; if (!p || autoBusy) return; autoBusy = true;   // keep a reference: the user may leave the project while this runs
  try {
    const items = await histEnsure(p.id), last = items[0] ? items[0].ts : 0;
    if (Date.now() - last > HAUTO_MS && stripT(p) !== HLAST[p.id]) await snapshot('Auto checkpoint', p, true);
  } catch (e) { } finally { autoBusy = false; }
}
async function restoreHist(id) {
  let o; try { const txt = await histGet(id); o = migrate(JSON.parse(txt)); } catch (e) { toast('That checkpoint is no longer available'); return; }
  await snapshot('Before restore', P, true); o.id = P.id; const k = projects.findIndex(x => x.id === P.id); projects[k] = o; P = o; HLAST[P.id] = stripT(P);
  touch(); render(); toast('Checkpoint restored — the previous state was saved as “Before restore”', 4000);
}
async function dropHist(id) { const items = (await histEnsure(P.id)).filter(x => x.id !== id); histDel(id); await metaSet(P.id, items); render(); }

/* ----- export ----- */
async function exportObj(p, withPh) {
  const o = { type: 'sca-project', v: 1, app: 'Site Commissioning', exported: new Date().toISOString(), project: p };
  if (withPh && p.photos.length) { o.photos = {}; for (const x of p.photos) { const d = await phGet(x.id); if (d) o.photos[x.id] = d; } }
  return o;
}
const slug = s => (String(s || 'Project').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'Project');
async function exportJson() {
  try {
    const o = await exportObj(P, S.expPhotos);
    const r = await saveFile('Commissioning_Project_' + slug(P.info.name) + '_' + today() + '.json', JSON.stringify(o), 'application/json');
    if (r === 'saved') toast('Project file saved — send it to your colleague');
  } catch (e) { toast('Could not save the file here'); }
}
async function exportAll() {
  try {
    await flush();
    const arr = []; for (const p of projects) arr.push(await exportObj(p, S.expPhotos));
    const r = await saveFile('Commissioning_Backup_' + today() + '.json', JSON.stringify({ type: 'sca-backup', v: 1, exported: new Date().toISOString(), items: arr }), 'application/json');
    if (r === 'saved') toast(`Backup saved — ${arr.length} project${arr.length === 1 ? '' : 's'}`);
  } catch (e) { toast('Could not save the file here'); }
}
async function exportCheckpoint(id) {
  let txt; try { txt = await histGet(id); JSON.parse(txt); } catch (e) { txt = null; } if (!txt) { toast('Checkpoint not available'); return; }
  try { await saveFile('Commissioning_Checkpoint_' + slug(P.info.name) + '_' + id.slice(1, 6) + '.json', JSON.stringify({ type: 'sca-project', v: 1, project: JSON.parse(txt) }), 'application/json'); } catch (e) { toast('Could not save the file here'); }
}

/* ----- import ----- */
function onImport(e) { const f = e.target.files[0]; e.target.value = ''; if (f) handleImportFile(f); }
function handleImportFile(f) {
  if (/\.xlsx$/i.test(f.name)) return handleExcelFile(f);
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const j = JSON.parse(rd.result); let list = [];
      if (j && j.type === 'sca-backup' && Array.isArray(j.items)) list = j.items;
      else if (j && j.type === 'sca-project' && j.project) list = [j];
      else if (j && j.info && j.invs) list = [{ project: j }];
      else throw new Error('format');
      const items = list.map(it => {
        let p; try { p = migrate(isObj(it) ? it.project : null); } catch (e) { return null; }
        const ex = projects.find(x => x.id === p.id);
        return { p, photos: isObj(it.photos) ? it.photos : {}, name: p.info.name || 'Untitled project', ex: !!ex, newer: ex ? (p.updated || 0) > (ex.updated || 0) : true, act: ex ? ((p.updated || 0) > (ex.updated || 0) ? 'replace' : 'copy') : 'add' };
      }).filter(Boolean);
      if (!items.length) throw new Error('empty');
      S.imp = { file: f.name, items }; render(); scrollTo(0, 0);
    } catch (x) { S.imp = null; toast('That file is not a commissioning project or backup file', 3500); }
  };
  rd.readAsText(f);
}
async function saveProjNow(p) { try { if (DB) await DB.doc('projects/' + p.id).set(clone(p)); } catch (e) { } lsWrite(); }
async function applyImport() {
  if (!S.imp) return; const done = { add: 0, replace: 0, copy: 0, skip: 0 };
  for (const it of S.imp.items) {
    const act = it.act; done[act]++;
    if (act === 'skip') continue;
    let p = it.p, ph = it.photos;
    if (it.excel && act === 'replace') { const cur = projects.find(x => x.id === p.id); if (cur) p.photos = cur.photos; }
    if (act === 'copy') {
      p = migrate(clone(p)); p.id = 'p' + uid(); p.info.name = (p.info.name || 'Untitled project') + ' (copy)'; const map = {}, nph = {};
      p.photos.forEach(x => { const n = 'ph' + uid(); map[x.id] = n; if (ph[x.id]) nph[n] = ph[x.id]; x.id = n; }); ph = nph;
    }
    if (act === 'replace') { const cur = projects.find(x => x.id === p.id); if (cur) await snapshot('Before import', cur, true); }
    p.updated = Date.now();
    for (const x of p.photos) { const d = ph[x.id]; if (typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d) && d.length < 2e6) { try { await phPut(x.id, d, p.id); } catch (e) { } } }
    const k = projects.findIndex(x => x.id === p.id); if (k >= 0) projects[k] = p; else projects.push(p);
    if (P && P.id === p.id) P = p;
    await saveProjNow(p);
  }
  const n = S.imp.items.length; S.imp = null; render();
  toast(`Imported: ${done.add} new, ${done.replace} replaced, ${done.copy} as copy${done.skip ? `, ${done.skip} skipped` : ''}`, 4000);
}
function impCard() {
  if (!S.imp) return '';
  return `<div class="card" style="border-color:var(--accent)"><h2>Import — ${esc(S.imp.file)}</h2>${S.imp.items.map((it, i) => `<div class="item" style="grid-template-columns:1fr"><div class="row sp"><b>${esc(it.name)}</b><span class="hint">${it.p.photos.length ? it.p.photos.length + ' photos · ' : ''}saved ${esc(it.p.updated ? dtFmt(it.p.updated) : '—')}</span></div>
  <label class="f"><span>${it.ex ? (it.newer ? 'This project exists here — the file is newer' : 'This project exists here — your version is newer or equal') : 'New project'}</span><select data-imp="${i}">${it.ex ? `<option value="replace"${it.act === 'replace' ? ' selected' : ''}>Replace my version (a checkpoint is saved first)</option><option value="copy"${it.act === 'copy' ? ' selected' : ''}>Import as a separate copy</option>` : `<option value="add" selected>Add to my projects</option>`}<option value="skip"${it.act === 'skip' ? ' selected' : ''}>Skip</option></select></label></div>`).join('')}
  <div class="row" style="margin-top:10px"><button class="btn pri" data-act="impapply">Apply import</button><button class="btn" data-act="impcancel">Cancel</button></div></div>`;
}

/* ----- backup tab ----- */
function vBackup() {
  const items = HM[P.id];
  if (!items) { histEnsure(P.id).then(() => { if (S.tab === 'backup') render(); }); }
  const list = items || [];
  const sumHtml = s => s ? `${badge(s.o)} <span class="hint">${s.pass} pass · ${s.fail} fail · ${s.open} open · ${s.ser} serials · ${s.ph} photos</span>` : '';
  return `${head('History & backup', 'Checkpoints let you go back; project and backup files let you move work between devices or send it to a colleague to edit.')}
  ${impCard()}
  <div class="card"><h2>Send this project to someone to edit</h2>
  <p style="margin:0 0 10px">Download the project file, send it by e-mail or WhatsApp, and ask your colleague to open it in the app with <b>Import file</b>. They edit it in the app and send the file back; you import it here and choose <i>Replace my version</i>. A checkpoint is saved first, so nothing is lost.</p>
  <div class="row"><button class="btn pri" data-act="export">Download project file (.json)</button><label class="row hint" style="gap:6px;cursor:pointer"><input type="checkbox" data-ep="1" ${S.expPhotos ? 'checked' : ''}> Include photos (larger file)</label></div>
  <p class="hint" style="margin:10px 0 0">The file is plain JSON. It can be opened in any text editor, but editing inside the app is safer — the app checks and recalculates everything.</p></div>
  <div class="card"><h2>Import a file</h2><div class="row"><label class="btn" style="cursor:pointer">Import file…<input type="file" id="impfile" accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label><span class="hint">A project file, a full backup (.json) or a filled Excel workbook (.xlsx).</span></div></div>
  <div class="card"><h2>Back up everything</h2><p style="margin:0 0 10px">${projects.length} project${projects.length === 1 ? '' : 's'} on this ${DB ? 'shared app' : 'device'}. Keep a backup file somewhere safe — before clearing browser data, changing phone, or after a big site day.</p><div class="row"><button class="btn pri" data-act="backupall">Download full backup (.json)</button></div></div>
  <div class="card"><h2>History — checkpoints of this project</h2>
  <div class="row"><label class="f" style="flex:1;min-width:200px"><input type="text" data-hl="1" placeholder="Label, e.g. After DC tests INV 01" value="${esc(S.histLabel)}"></label><button class="btn pri" data-act="snap">Save checkpoint now</button></div>
  <p class="hint">Checkpoints are also saved automatically about every 10 minutes while you work, and before every restore or import. The latest ${HKEEP} are kept.</p>
  ${list.length ? `<div style="margin-top:6px">${list.map(h => `<div class="item" style="grid-template-columns:1fr"><div class="row sp"><span><b>${esc(h.label)}</b> <span class="hint">· ${esc(dtFmt(h.ts))}</span></span><span class="row"><button class="btn sm" data-act="histrestore" data-id="${esc(h.id)}" data-confirm="1">Restore</button><button class="btn sm" data-act="histdl" data-id="${esc(h.id)}">Download</button><button class="btn sm danger" data-act="histdel" data-id="${esc(h.id)}" data-confirm="1">Delete</button></span></div><div class="row">${sumHtml(h.sum)}</div></div>`).join('')}</div>` : `<p class="hint" style="margin:10px 0 0">${items ? 'No checkpoints yet.' : 'Loading…'}</p>`}</div>`;
}

async function extraAct2(a, d, b, e) {
  switch (a) {
    case 'snap': { const ok = await snapshot(S.histLabel.trim() || 'Manual checkpoint'); if (ok) { S.histLabel = ''; toast('Checkpoint saved'); } render(); break; }
    case 'histrestore': await restoreHist(d.id); break;
    case 'histdl': exportCheckpoint(d.id); break;
    case 'histdel': await dropHist(d.id); break;
    case 'backupall': exportAll(); break;
    case 'impapply': await applyImport(); break;
    case 'impcancel': S.imp = null; render(); break;
    default: await extraAct3(a, d, b, e);
  }
}
