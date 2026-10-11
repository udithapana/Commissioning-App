/* ================= storage ================= */
const LS_KEY = 'sca.projects.v1';
let DB = null, projects = [], saveTimer = null, saving = false, dirty = false;
const clone = o => JSON.parse(JSON.stringify(o));
/* ---- data normalisation: every project that comes from storage, the shared db or an imported file is
   rebuilt against the current template, so wrong types, missing fields or hostile ids can't break the app ---- */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const safeId = (v, pre = '') => (typeof v === 'string' && ID_RE.test(v) ? v : pre + uid());
function normObj(def, v) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  for (const k of Object.keys(def)) {
    const d = def[k], x = o[k];
    if (Array.isArray(d)) o[k] = Array.isArray(x) ? x : clone(d);
    else if (d && typeof d === 'object') o[k] = normObj(d, x);
    else if (typeof d === 'number') o[k] = typeof x === 'number' && isFinite(x) ? x : d;
    else o[k] = typeof x === 'string' ? x : typeof x === 'number' && isFinite(x) ? String(x) : d;
  }
  return o;
}
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const normArr = (arr, make) => (Array.isArray(arr) ? arr : []).filter(isObj).map(x => normObj(make(), x));
const normFixed = (defs, arr) => defs.map((d, i) => normObj(d, Array.isArray(arr) ? arr[i] : null));
function migrate(p) {
  if (!isObj(p)) throw new Error('not a project');
  const b = newProject(); const raw = p; p = normObj(b, p);
  p.id = safeId(raw.id, 'p');
  p.invs = normArr(p.invs, () => newInv(0, null)).map(v => { v.id = safeId(v.id); v.strings = normArr(v.strings, () => newStr()).map(s => { s.id = safeId(s.id); return s; }); return v; });
  p.equip = normFixed(b.equip, p.equip); p.vis = normFixed(b.vis, p.vis); p.prot = normFixed(b.prot, p.prot);
  p.bat.prm = normFixed(b.bat.prm, p.bat.prm); p.bat.tests = normFixed(b.bat.tests, p.bat.tests); p.sign.roles = normFixed(b.sign.roles, p.sign.roles);
  p.sign.hand = b.sign.hand.map((d, i) => (Array.isArray(p.sign.hand) && typeof p.sign.hand[i] === 'string' ? p.sign.hand[i] : ''));
  p.ac.rows = normArr(p.ac.rows, newAc); p.acins.earth = normArr(p.acins.earth, newEarth);
  p.acins.rows = normArr(p.acins.rows, newAcIns).map(r => { const v = Array.isArray(r.v) ? r.v : []; r.v = Array.from({ length: 10 }, (_, k) => (typeof v[k] === 'string' ? v[k] : typeof v[k] === 'number' && isFinite(v[k]) ? String(v[k]) : '')); return r; });
  p.th.pan = normArr(p.th.pan, newPan); p.th.inv = normArr(p.th.inv, newThInv); p.th.sw = normArr(p.th.sw, newSw); p.bat.mod = normArr(p.bat.mod, newBMod);
  p.punch = normArr(p.punch, newPunch);
  p.pser = (Array.isArray(p.pser) ? p.pser : []).filter(x => isObj(x) && (typeof x.sn === 'string' || typeof x.sn === 'number') && String(x.sn).trim()).map(x => ({ sn: String(x.sn).trim().slice(0, 120), sid: typeof x.sid === 'string' && ID_RE.test(x.sid) ? x.sid : '' }));
  const seen = new Set();
  p.photos = normArr(p.photos, () => ({ id: '', cat: PH_CATS[0], inv: '', cap: '', ts: Date.now() })).map(x => { x.id = safeId(x.id, 'ph'); if (seen.has(x.id)) x.id = 'ph' + uid(); seen.add(x.id); if (!ID_RE.test(x.inv)) x.inv = ''; if (!PH_CATS.includes(x.cat)) x.cat = PH_CATS[PH_CATS.length - 1]; return x; });
  const ap = {}; if (isObj(raw.applic)) for (const k in raw.applic) if (/^[A-Za-z0-9_:-]{1,80}$/.test(k) && (raw.applic[k] === 'Yes' || raw.applic[k] === 'No')) ap[k] = raw.applic[k];
  if (!ap.battery) ap.battery = 'No'; p.applic = ap;
  return p;
}
const migrateAll = list => { const ids = new Set(); return (Array.isArray(list) ? list : []).map(x => { try { return migrate(x); } catch (e) { return null; } }).filter(p => p && !ids.has(p.id) && ids.add(p.id)); };
function lsRead() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } }
function lsWrite() { try { localStorage.setItem(LS_KEY, JSON.stringify(projects)); } catch (e) { } }
const IN_ARTIFACT = !!(window.claude && window.claude.use);
const BASE = {};                                   // project id -> 'updated' of the version last read from / written to the shared db
const MAXDOC = 250 * 1024;                         // shared-db document limit is 256 KiB
const bytes = s => new Blob([s]).size;
async function initStore() {
  try { if (IN_ARTIFACT) DB = await claude.use('db'); } catch (e) { DB = null; }
  await refreshList();
}
async function refreshList() {
  let list = [];
  if (DB) {
    for (let a = 0; a < 2; a++) {
      try { const s = await DB.collection('projects').get(); list = s.docs.map(d => clone(d.data())); list.forEach(x => { if (x && x.id) BASE[x.id] = x.updated; }); break; }
      catch (e) { if (a) { DB = null; toast('Shared database not reachable — working on this device only'); } else await new Promise(r => setTimeout(r, 600)); }
    }
  }
  if (!DB) list = lsRead();
  if (P) { const i = list.findIndex(x => x && x.id === P.id); if (i >= 0) list[i] = P; }
  projects = migrateAll(list);
  if (P) P = projects.find(x => x.id === P.id) || P;
}
function setSave(t) { const e = $('#savest'); if (e) e.textContent = t; }
function touch() { if (!P) return; P.updated = Date.now(); dirty = true; setSave('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 900); }
async function flush() {
  if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); return; }
  if (!dirty || !P) return;
  saving = true; dirty = false;
  const snap = clone(P), size = bytes(JSON.stringify(snap));
  try {
    lsWrite();
    if (DB && size > MAXDOC) {
      setSave(`Too large to share (${Math.round(size / 1024)} KB) — kept on this device`);
      if (!S.bigWarned) { S.bigWarned = true; toast('This project is larger than the shared database allows (about 250 KB), so it is only kept on this device. Split very large sites into several projects (for example one per inverter group).', 8000); }
    } else if (DB) {
      const ref = DB.doc('projects/' + snap.id), cur = await ref.get();
      if (cur.exists) {
        const r = cur.data();
        if (BASE[snap.id] !== undefined && typeof r.updated === 'number' && r.updated > BASE[snap.id]) {
          await snapshot('Other user’s version (saved before overwrite)', migrate(clone(r)), true);
          toast('Someone else saved this project at the same time. Their version was saved in History & Backup before yours replaced it.', 7000);
        }
      }
      await ref.set(snap); BASE[snap.id] = snap.updated;
      setSave('Saved · shared'); S.bigWarned = false;
    } else setSave('Saved on this device');
    maybeAuto();
  } catch (e) { console.error(e); lsWrite(); setSave('Kept on this device (sync failed)'); }
  saving = false; if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); }
}
function flushNow() { if (dirty && P) { clearTimeout(saveTimer); lsWrite(); flush(); } }
addEventListener('pagehide', flushNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
async function deleteProject(id) {
  const dp = projects.find(p => p.id === id); if (dp && dp.photos) dp.photos.forEach(x => phDel(x.id));
  try { (await histEnsure(id)).forEach(h => histDel(h.id)); await metaSet(id, []); if (DB) await DB.doc('histmeta/' + id).delete(); else localStorage.removeItem('sca.hist.' + id); } catch (e) { }
  projects = projects.filter(p => p.id !== id); lsWrite();
  if (DB) { try { await DB.doc('projects/' + id).delete(); } catch (e) { } }
}

/* ================= UI state ================= */
const S = { tab: 'overview', inv: 0, gen: { m: 3, s: 2, mods: 20 }, busy: false, msg: '' };
const TABS = [['overview', 'Overview'], ['info', 'Project'], ['equip', 'Equipment & Limits'], ['visual', 'Visual'], ['inv', 'Inverters & DC'], ['serials', 'Panel Serials'], ['acout', 'AC Output'], ['acins', 'AC Ins. & Earth'], ['thermal', 'Thermal'], ['battery', 'Battery'], ['prot', 'Protection'], ['punch', 'Punch List'], ['photos', 'Photos'], ['sign', 'Sign-off'], ['report', 'Report PDF'], ['excel', 'Excel'], ['backup', 'History & Backup']];
const TABKEYS = { visual: ['visual'], acout: ['acout'], acins: ['acins', 'earth'], thermal: ['thermal'], battery: ['battery'], prot: ['prot'], punch: ['punch'] };
const toast = (m, ms = 2600) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); };

function worst(rows) {
  if (!rows.length) return 'none';
  if (rows.every(r => r.status === 'N/A')) return 'na';
  if (rows.some(r => r.status === 'FAIL')) return 'bad';
  if (rows.some(r => r.status === 'IN PROGRESS')) return 'warn';
  if (rows.every(r => r.status === 'PASS' || r.status === 'N/A')) return 'ok';
  return 'none';
}
function tabsHtml() {
  const rows = summary();
  return TABS.map(([k, l]) => {
    let d = 'none';
    if (k === 'inv') d = worst(rows.filter(r => r.key.startsWith('dc:')));
    else if (TABKEYS[k]) d = worst(rows.filter(r => TABKEYS[k].includes(r.key)));
    else if (k === 'overview' || k === 'report') d = { PASS: 'ok', FAIL: 'bad', INCOMPLETE: 'warn' }[overall(rows)];
    else if (k === 'info') d = filled(P.info.name) ? 'ok' : 'none';
    else if (k === 'serials') d = serialStatus();
    else if (k === 'photos') d = P.photos.length ? 'ok' : 'none';
    else if (k === 'sign') d = filled(P.sign.officer) ? 'ok' : 'none';
    return `<button class="tab" role="tab" data-act="tab" data-v="${k}" aria-selected="${S.tab === k}"><i class="dot ${d}"></i>${l}</button>`;
  }).join('');
}

/* live fragments */
function liveVal(key) {
  const p = key.split(':');
  switch (p[0]) {
    case 'tabs': return tabsHtml();
    case 'dc': { const inv = P.invs[+p[1]]; return inv && inv.strings[+p[2]] ? badge(dcRes(inv, +p[2])) : ''; }
    case 'dev': { const inv = P.invs[+p[1]]; const d = inv && inv.strings[+p[2]] ? dcDev(inv, +p[2]) : NaN; return isNaN(d) ? '—' : (d >= 0 ? '+' : '') + r2(d, 2) + ' %'; }
    case 'dcs': { const inv = P.invs[+p[1]]; if (!inv) return ''; const c = count(inv.strings.map((s, j) => dcRes(inv, j))); const nm = inv.strings.reduce((a, s) => a + (isN(s.mods) ? num(s.mods) : 0), 0); return `<b>${inv.strings.length}</b> strings · <b>${nm}</b> modules · <b>${c.Pass}</b> pass · <b>${c.Fail}</b> fail · <b>${c.Incomplete}</b> incomplete`; }
    case 'ac': return badge(acRes(P.ac.rows[+p[1]] || {}));
    case 'ai': return badge(acInsRes(P.acins.rows[+p[1]] || { v: [] }));
    case 'ea': return badge(earthRes(P.acins.earth[+p[1]] || {}));
    case 'thp': case 'thi': { const r = P.th[p[0] === 'thp' ? 'pan' : 'inv'][+p[1]]; if (!r) return ''; const d = thDT(r.t); return (isNaN(d) ? '' : `<span class="hint mono">ΔT ${r2(d, 1)} °C</span> `) + badge(thRes('p', r)); }
    case 'ths': { const r = P.th.sw[+p[1]]; if (!r) return ''; const t = [r.tin, r.tout].filter(isN).map(num); const d = t.length && isN(P.th.amb) ? Math.max(...t) - num(P.th.amb) : NaN; return (isNaN(d) ? '' : `<span class="hint mono">ΔT ${r2(d, 1)} °C</span> `) + badge(thRes('sw', r)); }
    case 'acsum': { const t = acTotal(); return t.n ? r2(t.s, 2) + ' kW' : '—'; }
    case 'visg': { const gi = +p[1]; const it = VIS_FLAT.map((x, i) => [x, i]).filter(([x]) => x.g === gi); const c = count(it.map(([, i]) => P.vis[i].s)); return `${c.Pass} pass · ${c.Fail} fail · ${it.length - c.Pass - c.Fail - c['N/A']} open`; }
    case 'tot': { const t = totals(); return `Calculated from test data: <b>${t.ns}</b> strings · <b>${t.nm}</b> modules · <b>${r2(t.kw, 1)}</b> kW AC · <b>${isNaN(t.kwp) ? '—' : r2(t.kwp, 2)}</b> kWp`; }
    case 'ovr': { const o = overall(); return `<span class="big" style="color:var(--${{ PASS: 'ok', FAIL: 'bad', INCOMPLETE: 'warn' }[o]})">${o}</span>`; }
    case 'ovrb': return badge(overall());
    case 'lim': return `Voltage window ${r2(L('vnom') * (1 - L('vtol') / 100), 1)}–${r2(L('vnom') * (1 + L('vtol') / 100), 1)} V · frequency ${r2(L('fnom') - L('ftol'), 2)}–${r2(L('fnom') + L('ftol'), 2)} Hz`;
    case 'pc': { const c = P.punch.filter(x => x.s === 'Closed').length; return `${P.punch.length} items · ${c} closed · ${P.punch.length - c} open`; }
  }
  return '';
}
const live = k => `<span class="lv" data-k="${k}">${liveVal(k)}</span>`;
function refreshLive() { $$('.lv').forEach(e => { const v = liveVal(e.dataset.k); if (e.innerHTML !== v) e.innerHTML = v; }); }

/* field builders */
function fld(label, path, o = {}) {
  const v = get(P, path) ?? ''; const t = o.t || 'text'; let inp;
  const ph = o.ph ? ` placeholder="${esc(o.ph)}"` : '';
  if (t === 'sel') inp = `<select data-p="${path}"${o.after ? ` data-after="${o.after}"` : ''}><option value=""></option>${o.opts.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  else if (t === 'area') inp = `<textarea data-p="${path}" rows="${o.rows || 3}"${ph}>${esc(v)}</textarea>`;
  else if (t === 'num') inp = `<input type="text" inputmode="decimal" autocomplete="off" class="mono" data-p="${path}" value="${esc(v)}"${ph}>`;
  else inp = `<input type="${t}" data-p="${path}" value="${esc(v)}"${ph}${t === 'text' ? ' autocomplete="off"' : ''}>`;
  return `<label class="f ${o.cls || ''}"><span>${label}</span>${inp}</label>`;
}
function seg(path, opts, cur, act = 'seg', key = '') {
  return `<span class="seg">${opts.map(([v, l, c]) => `<button type="button" data-act="${act}" data-p="${path}" data-key="${esc(key)}" data-v="${esc(v)}" class="${cur === v ? 'on ' + c : ''}" data-c="${c}">${l || v}</button>`).join('')}</span>`;
}
const PFN = path => seg(path, [['Pass', 'Pass', 'p'], ['Fail', 'Fail', 'f'], ['N/A', 'N/A', 'n']], get(P, path));
const delBtn = (list, i) => `<button class="btn sm danger" data-act="del" data-list="${list}" data-i="${i}" data-confirm="1" aria-label="Delete row">Delete</button>`;
const head = (t, sub, extra = '') => `<div class="pagehead"><div><h1>${t}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${extra}</div>`;
const NEWMAP = { 'ac.rows': newAc, 'acins.rows': newAcIns, 'acins.earth': newEarth, 'th.pan': newPan, 'th.inv': newThInv, 'th.sw': newSw, 'bat.mod': newBMod, 'punch': newPunch };

/* ================= views ================= */
function vHome() {
  const list = [...projects].sort((a, b) => b.updated - a.updated);
  return `<div class="topbar"><span class="brand"><img class="sun" src="${LOGO.mark}" alt="">Site Commissioning</span><span class="ttl"></span></div>
  <main><div class="pagehead"><div class="logohead"><img class="hlogo" src="${LOGO.full}" alt="Regen — The Solar Energy Company"><div><h1>Projects</h1><p>Record readings on site; limits are checked as you type and the A4 report is built from the same data.</p></div></div><div class="row"><button class="btn pri" data-act="new">New project</button><button class="btn" data-act="demo">Open sample project</button><button class="btn" data-act="import">Import / restore</button><button class="btn" data-act="backupall">Back up all projects</button><input type="file" id="imp" accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></div></div>
  ${impCard()}${list.length ? `<div class="projs">${list.map(p => { const keep = P; P = p; const rows = summary(), o = overall(rows); P = keep; const tot = rows.filter(r => r.app === 'Yes'); const pc = tot.reduce((a, r) => a + r.pass, 0), fc = tot.reduce((a, r) => a + r.fail, 0), oc = tot.reduce((a, r) => a + r.open, 0), all = pc + fc + oc || 1; return `<div class="card proj" data-act="open" data-id="${esc(p.id)}" tabindex="0" role="button"><div class="row sp"><b style="font-size:16px">${esc(p.info.name || 'Untitled project')}</b>${badge(o)}</div><span class="hint">${esc(p.info.address || 'No address yet')} · ${esc(dFmt(p.info.date))}</span><div class="bar"><i class="a" style="width:${pc / all * 100}%"></i><i class="b" style="width:${fc / all * 100}%"></i><i class="c" style="width:${oc / all * 100}%"></i></div><span class="hint">${pc} pass · ${fc} fail · ${oc} open</span><div class="row"><button class="btn sm danger" data-act="delproj" data-id="${esc(p.id)}" data-confirm="1">Delete</button></div></div>`; }).join('')}</div>` : `<div class="card empty">No projects yet. Start a new one, or open the sample project to see how the checks and the report behave.</div>`}
  <div class="callout">${DB ? 'Projects are stored in the shared app database — anyone you share this app with can open and edit them. ' : 'Projects are stored on this device (browser storage). '}Use “Back up all projects” regularly to keep a backup file.</div></main>`;
}

function shell(inner) {
  const t = P.info.name || 'Untitled project';
  return `<div class="topbar"><button class="btn sm" data-act="home" aria-label="All projects">‹ Projects</button><span class="ttl"><b>${esc(t)}</b><small>${esc(P.info.address || 'Commissioning')}</small></span><span class="lv" data-k="ovrb">${liveVal('ovrb')}</span><span class="save" id="savest">${DB ? 'Shared database' : 'This device'}</span></div>
  <div class="tabs" role="tablist"><span class="lv" data-k="tabs" style="display:contents">${tabsHtml()}</span></div>
  <main>${inner}${nextBar()}</main>`;
}
function nextBar() {
  const i = TABS.findIndex(t => t[0] === S.tab), a = TABS[i - 1], b = TABS[i + 1];
  return `<div class="nextbar">${a ? `<button class="btn" data-act="tab" data-v="${a[0]}">‹ ${a[1]}</button>` : '<span></span>'}${b ? `<button class="btn nav" data-act="tab" data-v="${b[0]}">${b[1]} ›</button>` : ''}</div>`;
}

function vOverview() {
  const rows = summary();
  const act = rows.filter(r => r.app === 'Yes'), pc = act.reduce((a, r) => a + r.pass, 0), fc = act.reduce((a, r) => a + r.fail, 0), oc = act.reduce((a, r) => a + r.open, 0), all = pc + fc + oc || 1;
  return `${head(esc(P.info.name || 'New commissioning'), 'Everything you enter is checked against the acceptance limits and collected here — nothing is typed twice.')}
  <div class="card"><div class="ovr"><div><div class="sech" style="margin:0">Overall result</div>${live('ovr')}</div><div style="flex:1;min-width:200px"><div class="bar"><i class="a" style="width:${pc / all * 100}%"></i><i class="b" style="width:${fc / all * 100}%"></i><i class="c" style="width:${oc / all * 100}%"></i></div><div class="kpi" style="margin-top:6px"><span><b>${pc}</b> pass</span><span><b>${fc}</b> fail</span><span><b>${oc}</b> open</span></div></div><div class="row"><button class="btn" data-act="autocover">Auto-fill project details</button><button class="btn pri" data-act="tab" data-v="report">Create PDF report</button></div></div></div>
  <div class="card"><h2>Commissioning summary</h2><div class="scroll"><table class="t"><thead><tr><th>Section</th><th>Applicable</th><th class="n">Pass</th><th class="n">Fail</th><th class="n">Open</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td><a href="#" data-act="goto" data-key="${esc(r.key)}" style="color:inherit;font-weight:600">${esc(r.label)}</a><div style="margin-top:4px">${badge(r.status)}</div></td><td>${seg('x', [['Yes', 'Yes', 'o'], ['No', 'No', 'n']], r.app, 'applic', r.key)}</td><td class="n">${r.pass}</td><td class="n">${r.fail}</td><td class="n">${r.open}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="callout">Workflow on site: <b>Project</b> details → <b>Visual</b> inspection → add each inverter and its strings under <b>Inverters &amp; DC</b> → AC, thermal, protection → punch list → sign-off. Use <b>Auto-fill</b> buttons to copy inverter names into the AC and thermal tables.</div>`;
}

function vInfo() {
  const I = 'info.'; const t = totals();
  return `${head('Project details', 'Printed on the cover page of the report.')}
  <div class="card"><h2>1. General details</h2><div class="g wide">
  ${fld('Project name', I + 'name', { cls: 'full' })}${fld('Address', I + 'address', { cls: 'full' })}
  ${fld('Client', I + 'client')}${fld('Contact person', I + 'contact')}${fld('Telephone — fixed', I + 'tel_fixed', { t: 'tel' })}${fld('Telephone — mobile', I + 'tel_mobile', { t: 'tel' })}${fld('E-mail', I + 'email', { t: 'email' })}
  ${fld('Document no.', I + 'docno')}${fld('Revision no.', I + 'rev')}${fld('Commissioning date', I + 'date', { t: 'date' })}${fld('Weather condition', I + 'weather', { ph: 'Sunny / cloudy…' })}${fld('Electricity bill available', I + 'bill', { t: 'sel', opts: ['Yes', 'No'] })}
  ${fld('Commissioning engineer (default “tested by”)', I + 'engineer')}</div></div>
  <div class="card"><h2>2. PV system &amp; utility</h2><div class="g wide">
  ${fld('EPC / installation contractor', I + 'epc')}${fld('Installation type', I + 'itype', { t: 'sel', opts: ['Grid-tied', 'Hybrid (with battery)', 'Off-grid'], after: 'itype' })}
  ${fld('Inverter brand & model', I + 'inv_model')}${fld('Number of inverters', I + 'ninv', { t: 'num' })}${fld('PV system capacity (kWp)', I + 'kwp', { t: 'num' })}${fld('System AC capacity (kW)', I + 'kwac', { t: 'num' })}
  ${fld('Roof structure', I + 'roof')}${fld('Connection method', I + 'conn', { t: 'sel', opts: ['Net Metering', 'Net Accounting', 'Net Plus'] })}${fld('Utility system voltage', I + 'voltage', { t: 'sel', opts: ['230V', '400V'] })}
  ${fld('Utility supplier', I + 'supplier', { t: 'sel', opts: ['CEB', 'LECO'] })}${fld("Supplier's branch office", I + 'branch')}${fld('Utility account no.', I + 'account')}</div>
  <p class="hint" style="margin:10px 0 0">${live('tot')}</p></div>
  <div class="card"><h2>3. PV panel</h2><div class="g wide">${fld('Module brand & model', I + 'pv_model')}${fld('Rated power (Wp)', I + 'pv_wp', { t: 'num' })}${fld('Voc / Vmp (V)', I + 'pv_vv', { ph: '49.5 / 41.2' })}${fld('Imp / Isc (A)', I + 'pv_ii', { ph: '13.1 / 13.9' })}${fld('Number of panels', I + 'npan', { t: 'num' })}${fld('Number of strings', I + 'nstr', { t: 'num' })}</div></div>
  <div class="card"><h2>4. Prepared / reviewed / approved</h2><div class="g wide">${fld('Prepared by (name / company)', I + 'prep')}${fld('Reviewed by (name / company)', I + 'rev_by')}${fld('Approved by (name / company)', I + 'appr')}${fld('Approval date', I + 'appr_date', { t: 'date' })}</div></div>
  <div class="card"><h2>Main electrical panel &amp; cables</h2><div class="g wide">
  ${fld('Main panel location', 'panel.loc')}${fld('Main breaker make / model', 'panel.brk')}${fld('Main breaker rating (A)', 'panel.brk_a', { t: 'num' })}${fld('Enclosure IP rating', 'panel.ip')}${fld('AC SPD fitted', 'panel.ac_spd', { t: 'sel', opts: ['Y', 'N'] })}${fld('Energy meter make / model', 'panel.meter')}
  ${fld('Energy meter serial no.', 'panel.meter_sn')}${fld('CT ratio (if used)', 'panel.ct')}${fld('RCD / ELCB rating (mA)', 'panel.rcd', { t: 'num' })}${fld('AC cable: inverter → panel', 'panel.cable_inv', { ph: 'size / type / length' })}${fld('AC cable: panel → utility', 'panel.cable_util', { ph: 'size / type / length' })}${fld('Earth conductor size', 'panel.earth')}</div></div>`;
}

function vEquip() {
  return `${head('Test equipment & acceptance limits', 'Recorded once; applies to every test in the report.')}
  <div class="card"><h2>Test equipment register</h2><div class="rcs">${P.equip.map((e, i) => `<div class="rc"><header><b>${i + 1}. ${esc(e.name)}</b></header><div class="g c2">${fld('Model / make', `equip.${i}.model`)}${fld('Serial no.', `equip.${i}.sn`)}${fld('Calibrated on', `equip.${i}.cal`, { t: 'date' })}${fld('Calibration due', `equip.${i}.due`, { t: 'date' })}</div></div>`).join('')}</div></div>
  <div class="card"><h2>Acceptance limits</h2><p class="hint" style="margin-top:0">Defaults — edit to match your company / utility standard. All pass/fail checks use these values.</p><div class="g wide">${LIMDEF.map(l => fld(`${l[1]} (${l[3]})`, 'lim.' + l[0], { t: 'num' })).join('')}</div></div>`;
}

function vVisual() {
  const done = (gi) => VIS_FLAT.map((x, i) => [x, i]).filter(([x]) => x.g === gi);
  return `${head('Visual & mechanical inspection', '30 checks. Tap Pass / Fail / N/A for each; add a remark where needed.')}
  ${VIS.map((g, gi) => `<div class="card"><div class="row sp" style="margin-bottom:6px"><h2 style="margin:0">${esc(g[0])}</h2><span class="row"><span class="hint">${live('visg:' + gi)}</span><button class="btn sm" data-act="visall" data-g="${gi}">Mark unset as Pass</button></span></div>
  ${done(gi).map(([x, i]) => `<div class="item"><span class="no">${i + 1}</span><span>${esc(x.t)}</span><div class="ctl">${PFN(`vis.${i}.s`)}${fld('', `vis.${i}.r`, { ph: 'Remarks' }).replace('<span></span>', '')}</div></div>`).join('')}</div>`).join('')}
  <div class="card"><div class="g">${fld('Inspected by', 'vis_by')}${fld('Date', 'vis_date', { t: 'date' })}</div></div>`;
}

function vInv() {
  if (!P.invs.length) return `${head('Inverters & DC string tests', 'One tab per inverter. Strings and MPPTs per inverter are fully flexible.')}<div class="card empty">No inverters yet.<br><br><button class="btn pri" data-act="addinv">Add first inverter</button></div>`;
  S.inv = Math.min(S.inv, P.invs.length - 1); const i = S.inv, inv = P.invs[i], b = `invs.${i}.`;
  const pills = `<div class="pills">${P.invs.map((v, k) => `<button class="pill" data-act="selinv" data-i="${k}" aria-pressed="${k === i}">${invTag(k)} ${(() => { const c = count(v.strings.map((s, j) => dcRes(v, j))); return `<i class="dot ${c.Fail ? 'bad' : c.Incomplete ? 'warn' : c.Pass ? 'ok' : 'none'}"></i>`; })()}</button>`).join('')}<button class="pill" data-act="addinv">+ Add inverter</button></div>`;
  return `${head('Inverters & DC string tests', 'Each string is entered once. Voc deviation, insulation and polarity are checked against the limits as you type.')}${pills}
  <div class="card"><div class="row sp"><h2 style="margin:0">${invTag(i)} — register</h2><span class="row"><button class="btn sm" data-act="dupinv">Duplicate (layout only)</button><button class="btn sm danger" data-act="delinv" data-confirm="1">Delete inverter</button></span></div>
  <div class="g wide" style="margin-top:10px">${fld('Location / room', b + 'loc')}${fld('Make', b + 'make')}${fld('Model', b + 'model')}${fld('Serial no.', b + 'sn')}${fld('Rated power (kW)', b + 'kw', { t: 'num' })}${fld('DC SPD', b + 'spd', { t: 'sel', opts: ['Y', 'N'] })}${fld('DC SPD model', b + 'spd_model')}${fld('DC isolator qty', b + 'iso_qty', { t: 'num' })}${fld('DC isolator rating', b + 'iso_rating')}${fld('DC cable (size / type)', b + 'dc_cable')}${fld('AC isolator', b + 'ac_iso', { t: 'sel', opts: ['Y', 'N'] })}${fld('AC isolator rating', b + 'ac_iso_rating')}${fld('Remarks', b + 'rem', { cls: 'full' })}</div></div>
  <div class="card"><h2>Test conditions</h2><div class="g wide">${fld('Tested by', b + 'by')}${fld('Date / time', b + 'dt')}${fld('Weather / irradiance (W/m²)', b + 'wx')}</div><p class="hint" style="margin:10px 0 0">${live('dcs:' + i)}</p></div>
  <div class="card"><h2>Add strings</h2><div class="row"><label class="f"><span>MPPTs</span><input class="mono" type="text" inputmode="numeric" data-g="m" value="${S.gen.m}" style="width:80px"></label><label class="f"><span>Strings per MPPT</span><input class="mono" type="text" inputmode="numeric" data-g="s" value="${S.gen.s}" style="width:110px"></label><label class="f"><span>Modules per string</span><input class="mono" type="text" inputmode="numeric" data-g="mods" value="${esc(S.gen.mods)}" style="width:120px"></label><button class="btn pri" data-act="genstr" style="align-self:flex-end">Generate string list</button><button class="btn" data-act="addstr" style="align-self:flex-end">Add one string</button></div><p class="hint" style="margin:8px 0 0">Appends MPPT / string numbers after the existing ones. Remove any you don't need.</p></div>
  ${inv.strings.length ? `<div class="rcs">${inv.strings.map((s, j) => { const p = `${b}strings.${j}.`; return `<div class="rc"><header><b>MPPT ${esc(s.mppt || '–')} · String ${esc(s.str || '–')}</b><span class="row">${live(`dc:${i}:${j}`)}<button class="btn sm danger" data-act="del" data-list="${b}strings" data-i="${j}" data-confirm="1">✕</button></span></header>
  <div class="g c3">${fld('MPPT', p + 'mppt')}${fld('String', p + 'str')}${fld('Modules', p + 'mods', { t: 'num' })}</div>
  <div class="g c3">${fld('Voc (V)', p + 'voc', { t: 'num' })}<label class="f"><span>Voc dev. vs group</span><div class="mono" style="padding:8px 0">${live(`dev:${i}:${j}`)}</div></label>${fld('Op. voltage (V)', p + 'opv', { t: 'num' })}</div>
  <div class="g c3">${fld('Ins. + / E (MΩ)', p + 'ip', { t: 'num' })}${fld('Ins. – / E (MΩ)', p + 'in', { t: 'num' })}${fld('Ins. + / – (MΩ)', p + 'ipn', { t: 'num' })}</div>
  <div class="row">${fld('String current (A)', p + 'cur', { t: 'num', cls: '' }).replace('class="f ', 'style="width:120px" class="f ')}<label class="f"><span>Polarity</span>${seg(p + 'pol', [['OK', 'OK', 'p'], ['Reverse', 'Reverse', 'f']], s.pol)}</label></div>${fld('Remarks', p + 'rem')}</div>`; }).join('')}</div>` : `<div class="card empty">No strings yet — use “Generate string list” above.</div>`}`;
}

function rowCard(title, list, i, body, res) {
  return `<div class="rc"><header><b>${title}</b><span class="row">${res || ''}${delBtn(list, i)}</span></header>${body}</div>`;
}
const addBtn = (list, label) => `<button class="btn" data-act="add" data-list="${list}">+ ${label}</button>`;

function vAcOut() {
  return `${head('AC output test', 'First row = grid side with inverters OFF, then each inverter on load.', `<button class="btn" data-act="syncac">Add a row for each inverter</button>`)}
  <div class="card"><div class="g">${fld('Date', 'ac.date', { t: 'date' })}${fld('Tested by', 'ac.by')}</div><p class="hint" style="margin:10px 0 0">${live('lim')}</p></div>
  <div class="rcs">${P.ac.rows.map((r, i) => { const p = `ac.rows.${i}.`; return rowCard(esc(r.pt || 'Point ' + (i + 1)), 'ac.rows', i, `<div class="g c2">${fld('Grid / inverter & room', p + 'pt')}${fld('Time', p + 'time', { t: 'time' })}</div>
  <div class="g c3">${fld('V L1–N', p + 'v1', { t: 'num' })}${fld('V L2–N', p + 'v2', { t: 'num' })}${fld('V L3–N', p + 'v3', { t: 'num' })}</div><div class="g c3">${fld('I L1 (A)', p + 'i1', { t: 'num' })}${fld('I L2 (A)', p + 'i2', { t: 'num' })}${fld('I L3 (A)', p + 'i3', { t: 'num' })}</div>
  <div class="g c3">${fld('Power (kW)', p + 'kw', { t: 'num' })}${fld('PF', p + 'pf', { t: 'num' })}${fld('Freq (Hz)', p + 'hz', { t: 'num' })}</div>${fld('Remarks', p + 'rem')}`, live('ac:' + i)); }).join('')}</div>
  <div class="row sp">${addBtn('ac.rows', 'Add row')}<span class="hint">Total plant AC power (all rows except grid side): <b class="mono">${live('acsum')}</b></span></div>
  <div class="card"><div class="g">${fld('Officer name', 'ac.officer')}</div></div>`;
}

const PH = ['L1–L2', 'L1–L3', 'L2–L3', 'L1–N', 'L2–N', 'L3–N', 'L1–E', 'L2–E', 'L3–E', 'N–E'];
function vAcIns() {
  return `${head('AC insulation & earthing', 'Single-phase: type N/A in the cells that do not apply. If the tester shows “>” or “OL”, type the highest number displayed.', `<button class="btn" data-act="syncins">Add a row for each inverter</button>`)}
  <div class="card"><h2>AC side insulation resistance (MΩ)</h2><div class="g">${fld('Date', 'acins.date', { t: 'date' })}${fld('Test voltage (V)', 'acins.volt', { t: 'num' })}${fld('Tested by', 'acins.by')}</div></div>
  <div class="rcs">${P.acins.rows.map((r, i) => { const p = `acins.rows.${i}.`; return rowCard(esc(r.pt || 'Circuit ' + (i + 1)), 'acins.rows', i, `${fld('Inverter / circuit', p + 'pt')}<div class="g c3">${PH.map((h, k) => fld(h, `${p}v.${k}`, { t: 'num' })).join('')}</div>${fld('Remarks', p + 'rem')}`, live('ai:' + i)); }).join('')}</div>
  ${addBtn('acins.rows', 'Add circuit')}
  <div class="card"><h2>Earthing test</h2><p class="hint" style="margin-top:0">Maximum allowed: ${esc(P.lim.earth)} Ω</p></div>
  <div class="rcs">${P.acins.earth.map((r, i) => { const p = `acins.earth.${i}.`; return rowCard('Rod ' + (i + 1), 'acins.earth', i, `<div class="g c2">${fld('Location', p + 'loc')}${fld('Value (Ω)', p + 'val', { t: 'num' })}</div>${fld('Remarks', p + 'rem')}`, live('ea:' + i)); }).join('')}</div>
  ${addBtn('acins.earth', 'Add earth rod')}<div class="card"><div class="g">${fld('Officer name', 'acins.officer')}</div></div>`;
}

function vThermal() {
  return `${head('Thermal imaging test', 'Result = Fail when the hottest reading is more than the ΔT limit (' + esc(P.lim.dt) + ' °C) above ambient.', `<button class="btn" data-act="syncth">Add a row for each inverter</button>`)}
  <div class="card"><h2>Test conditions</h2><div class="g">${fld('Date', 'th.date', { t: 'date' })}${fld('Ambient temp (°C)', 'th.amb', { t: 'num' })}${fld('Irradiance (W/m²)', 'th.irr', { t: 'num' })}${fld('Tested by', 'th.by')}</div></div>
  <div class="card"><h2 style="margin:0">Solar panels — critical / hot panels</h2></div><div class="rcs">${P.th.pan.map((r, i) => { const p = `th.pan.${i}.`; return rowCard('Panel ' + (i + 1), 'th.pan', i, `<div class="g c2">${fld('Inverter / string', p + 'where')}${fld('Panel serial no.', p + 'sn')}${fld('Time', p + 'time', { t: 'time' })}${fld('Temp (°C)', p + 't', { t: 'num' })}</div>${fld('Comment', p + 'c')}`, live('thp:' + i)); }).join('')}</div>${addBtn('th.pan', 'Add panel')}
  <div class="card"><h2 style="margin:0">Inverters</h2></div><div class="rcs">${P.th.inv.map((r, i) => { const p = `th.inv.${i}.`; return rowCard('Inverter point ' + (i + 1), 'th.inv', i, `<div class="g c2">${fld('Inverter / room', p + 'where')}${fld('Point inspected', p + 'pt')}${fld('Time', p + 'time', { t: 'time' })}${fld('Temp (°C)', p + 't', { t: 'num' })}</div>${fld('Comment', p + 'c')}`, live('thi:' + i)); }).join('')}</div>${addBtn('th.inv', 'Add inverter point')}
  <div class="card"><h2 style="margin:0">Switchgear panel — breakers</h2></div><div class="rcs">${P.th.sw.map((r, i) => { const p = `th.sw.${i}.`; return rowCard('Breaker ' + (i + 1), 'th.sw', i, `<div class="g c2">${fld('Breaker (main / inverter)', p + 'where')}${fld('Rating / ref', p + 'rating')}${fld('Time', p + 'time', { t: 'time' })}</div><div class="g c2">${fld('IN temp (°C)', p + 'tin', { t: 'num' })}${fld('OUT temp (°C)', p + 'tout', { t: 'num' })}</div>${fld('Comment', p + 'c')}`, live('ths:' + i)); }).join('')}</div>${addBtn('th.sw', 'Add breaker')}
  <div class="card"><div class="g">${fld('Officer name', 'th.officer')}</div></div>`;
}

function vBattery() {
  const on = P.applic.battery === 'Yes';
  const top = head('Battery test', 'For hybrid / battery-backed systems only.', `<span class="row"><span class="hint">Applicable</span>${seg('x', [['Yes', 'Yes', 'o'], ['No', 'No', 'n']], P.applic.battery, 'applic', 'battery')}</span>`);
  if (!on) return top + `<div class="card empty">Battery test is switched off. Choose “Hybrid (with battery)” as the installation type on the Project tab, or set Applicable to Yes.</div>`;
  return `${top}<div class="card"><h2>Battery system details</h2><div class="g wide">${fld('Brand & model', 'bat.brand')}${fld('Type', 'bat.type', { t: 'sel', opts: ['Lithium-ion', 'Lead-Acid', 'Other'] })}${fld('Bank capacity (kWh)', 'bat.kwh', { t: 'num' })}${fld('Nominal voltage (V)', 'bat.vn', { t: 'num' })}${fld('No. of modules / racks', 'bat.mods', { t: 'num' })}${fld('No. of battery strings', 'bat.strs', { t: 'num' })}${fld('BMS model', 'bat.bms')}${fld('Tested by', 'bat.by')}</div></div>
  <div class="card"><h2 style="margin:0">Module / string voltage &amp; insulation</h2></div><div class="rcs">${P.bat.mod.map((r, i) => { const p = `bat.mod.${i}.`; return rowCard('Module ' + (i + 1), 'bat.mod', i, `<div class="g c2">${fld('Module / rack no.', p + 'mod')}${fld('String no.', p + 'str')}${fld('Nominal V', p + 'vn', { t: 'num' })}${fld('Measured V', p + 'vm', { t: 'num' })}${fld('Insulation (MΩ)', p + 'ins', { t: 'num' })}</div><div class="row">${PFN(p + 's')}</div>${fld('Remarks', p + 'rem')}`, ''); }).join('')}</div>${addBtn('bat.mod', 'Add module')}
  <div class="card"><h2>Battery protection &amp; BMS settings</h2>${BPARAMS.map((n, i) => `<div class="item"><span class="no">${i + 1}</span><span>${esc(n)}</span><div class="ctl">${fld('', `bat.prm.${i}.val`, { ph: 'Set / measured' }).replace('<span></span>', '')}${fld('', `bat.prm.${i}.std`, { ph: 'Standard / ref' }).replace('<span></span>', '')}${PFN(`bat.prm.${i}.s`)}${fld('', `bat.prm.${i}.rem`, { ph: 'Remarks' }).replace('<span></span>', '')}</div></div>`).join('')}</div>
  <div class="card"><h2>Charge / discharge / backup test</h2><div class="rcs">${BTESTS.map((n, i) => { const p = `bat.tests.${i}.`; return `<div class="rc"><header><b>${n}</b></header><div class="g c2">${fld('Start time', p + 't0', { t: 'time' })}${fld('End time', p + 't1', { t: 'time' })}${fld('Start / end SOC (%)', p + 'soc', { ph: '20 / 95' })}${fld('Start / end voltage (V)', p + 'volt')}${fld('Current (A)', p + 'cur', { t: 'num' })}${fld('Duration (min)', p + 'dur', { t: 'num' })}</div>${fld('Remarks', p + 'rem')}</div>`; }).join('')}</div></div>
  <div class="card"><div class="g">${fld('Officer name', 'bat.officer')}</div></div>`;
}

function vProt() {
  return `${head('Protection & grid settings', 'Record the set or measured value, the reference it was checked against, and the result.')}
  <div class="card">${PROT.map((n, i) => `<div class="item"><span class="no">${i + 1}</span><span>${esc(n[0])}</span><div class="ctl">${fld('', `prot.${i}.val`, { ph: n[1] || 'Set / measured value' }).replace('<span></span>', '')}${fld('', `prot.${i}.std`, { ph: 'Standard / reference' }).replace('<span></span>', '')}${PFN(`prot.${i}.s`)}${fld('', `prot.${i}.rem`, { ph: 'Remarks' }).replace('<span></span>', '')}</div></div>`).join('')}</div>
  <div class="card"><div class="g">${fld('Verified by', 'prot_by')}${fld('Date', 'prot_date', { t: 'date' })}</div></div>`;
}

function vPunch() {
  return `${head('Punch list / snag list', 'Every open item stops the overall result from reaching PASS.', `<span class="hint">${live('pc')}</span>`)}
  ${P.punch.length ? `<div class="rcs">${P.punch.map((r, i) => { const p = `punch.${i}.`; return rowCard('Item ' + (i + 1), 'punch', i, `<div class="g c2">${fld('Date raised', p + 'date', { t: 'date' })}${fld('Location / inverter', p + 'loc')}</div>${fld('Issue description', p + 'issue', { t: 'area', rows: 2 })}<div class="g c2">${fld('Category', p + 'cat', { t: 'sel', opts: ['Electrical', 'Mechanical', 'Civil', 'Documentation', 'Other'] })}${fld('Raised by', p + 'by')}</div>${fld('Corrective action', p + 'action', { t: 'area', rows: 2 })}<div class="g c2">${fld('Responsible', p + 'resp')}${fld('Target date', p + 'target', { t: 'date' })}</div><div class="row"><label class="f"><span>Status</span>${seg(p + 's', [['Open', 'Open', 'f'], ['In Progress', 'In progress', 'o'], ['Closed', 'Closed', 'p']], r.s)}</label>${fld('Closed date', p + 'closed', { t: 'date' })}</div>`, ''); }).join('')}</div>` : '<div class="card empty">No snags recorded.</div>'}${addBtn('punch', 'Add snag')}`;
}

function vSign() {
  return `${head('Final sign-off', 'Overall result is calculated from all sections.')}
  <div class="card"><div class="ovr"><div><div class="sech" style="margin:0">Overall commissioning result</div>${live('ovr')}</div><div class="g c2" style="flex:1;min-width:240px">${fld('Commissioned date', 'sign.date', { t: 'date' })}${fld('Commissioned officer', 'sign.officer')}</div></div></div>
  <div class="card"><h2>Sign-off</h2><div class="rcs">${ROLES.map((r, i) => `<div class="rc"><header><b>${r}</b></header><div class="g c2">${fld('Name', `sign.roles.${i}.name`)}${fld('Company', `sign.roles.${i}.co`)}${fld('Date', `sign.roles.${i}.date`, { t: 'date' })}</div></div>`).join('')}</div><p class="hint">Signatures are added by hand on the printed report.</p></div>
  <div class="card"><h2>Handover checklist</h2>${HANDOVER.map((h, i) => `<div class="item"><span class="no">${i + 1}</span><span>${h}</span><div class="ctl">${seg(`sign.hand.${i}`, [['Yes', 'Yes', 'p'], ['No', 'No', 'f'], ['N/A', 'N/A', 'n']], P.sign.hand[i])}</div></div>`).join('')}${fld('Comments', 'sign.comments', { t: 'area', rows: 4, cls: 'full' })}</div>`;
}

function vReport() {
  const rows = summary(), o = overall(rows), warn = [];
  if (!filled(P.info.name)) warn.push('Project name is empty (Project tab).');
  if (!P.invs.length) warn.push('No inverters recorded.');
  rows.forEach(r => { if (r.status === 'FAIL') warn.push(`${r.label}: ${r.fail} failing.`); else if (r.status === 'IN PROGRESS') warn.push(`${r.label}: ${r.open} still open.`); else if (r.status === 'NOT TESTED') warn.push(`${r.label}: not tested yet.`); });
  return `${head('A4 report', 'Builds the complete commissioning report from the data you entered — same sections as the Excel workbook.')}
  <div class="card"><div class="ovr"><div><div class="sech" style="margin:0">Overall result</div>${live('ovr')}</div><div class="row"><button class="btn pri" data-act="pdf" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Building…' : 'Generate A4 PDF'}</button><button class="btn" data-act="tab" data-v="excel">Excel workbook</button><button class="btn" data-act="tab" data-v="backup">Backup / send project</button></div></div>${S.msg ? `<p class="hint" style="margin:10px 0 0">${esc(S.msg)}</p>` : ''}</div>
  <div class="card"><h2>Before you issue the report</h2>${warn.length ? `<ul style="margin:0;padding-left:18px;display:grid;gap:4px">${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul><p class="hint">You can still generate the PDF now — open items are printed as open.</p>` : '<p style="margin:0">Nothing outstanding — all applicable sections are complete and passing.</p>'}</div>
  <div class="card"><h2>Report contents</h2><div class="kpi">${['Cover & project details', 'Summary', 'Test equipment & limits', 'Visual inspection', 'Inverter register & main panel', 'DC string tests (per inverter)', 'Panel serial numbers', 'AC output', 'AC insulation & earthing', 'Thermal imaging', 'Battery (if applicable)', 'Protection & grid', 'Punch list', 'Sign-off & handover'].map((x, i) => `<span>${i + 1}. ${x}</span>`).join('')}</div><p class="hint">Tables print only the rows you filled in. Photos are a separate document (Photos tab). Letters outside the standard PDF font (Ω, Δ, Sinhala, Tamil) are printed as “Ohm”, “dT” or “?”.</p></div>`;
}

function view() {
  return ({ overview: vOverview, info: vInfo, equip: vEquip, visual: vVisual, inv: vInv, acout: vAcOut, acins: vAcIns, thermal: vThermal, battery: vBattery, prot: vProt, punch: vPunch, serials: vSerials, photos: vPhotos, sign: vSign, report: vReport, excel: vExcel, backup: vBackup })[S.tab]();
}
function render(keepScroll = true) {
  const y = window.scrollY, app = $('#app');
  const ax = $('.tabs') ? $('.tabs').scrollLeft : 0;
  app.innerHTML = P ? shell(view()) : vHome();
  if (keepScroll) window.scrollTo(0, y);
  const tb = $('.tabs'); if (tb) { tb.scrollLeft = ax; const a = $('.tab[aria-selected=true]'); if (a && !keepScroll) a.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  const imp = $('#imp'); if (imp) imp.onchange = onImport;
  if (P) afterRender();
}
