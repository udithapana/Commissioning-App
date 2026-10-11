'use strict';
/* ================= helpers ================= */
const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const nowT = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function set(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }
// Reading parser: '>999' -> 999, 'OL' (over-range) -> Infinity, '1,000' -> 1000, '0,5' -> 0.5, '230V' -> 230
const num = v => {
  if (v == null) return NaN;
  let s = String(v).trim().replace(/^[>≥<≤~]\s*/, '');
  if (/^(OL|O\.L\.?|OVER|INF|∞)$/i.test(s)) return Infinity;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?(\D.*)?$/.test(s)) s = s.replace(/,/g, ''); else s = s.replace(',', '.');
  return s === '' ? NaN : parseFloat(s);
};
const isN = v => isFinite(num(v));          // finite number (voltages, temperatures, Voc …)
const isIns = v => !isNaN(num(v));          // insulation readings may be over-range (Infinity)
const grpKey = v => String(v ?? '').trim().toLowerCase().replace(/^0+(?=\d)/, '');
const filled = v => v != null && String(v).trim() !== '';
const r2 = (x, d = 2) => (isFinite(x) ? (Math.round(x * 10 ** d) / 10 ** d).toString() : '');
const dFmt = s => { if (!s) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!m) return s; const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]; return m[3] + '-' + mo + '-' + m[1]; };

/* ================= static content ================= */
const VIS = [
  ['A. PV Modules & Mounting Structure', ['Modules free of physical damage (cracks, hot spots, delamination)', 'Modules clean and free of shading obstructions', 'Mounting structure secure, level and correctly torqued', 'Module clamps / bolts torqued to spec, no loose fixings', 'Structure and module frames bonded to earthing system']],
  ['B. DC Cabling', ['DC cables routed and dressed neatly, no sharp bends', 'Cables secured with UV-rated cable ties / clips', 'MC4 (or equivalent) connectors fully locked, no exposed conductor', 'String / cable labelling complete and legible', 'Cable entry points and conduits sealed (IP rated)']],
  ['C. Inverter & DC Protection', ['Inverter securely mounted, correct orientation and clearance', 'Ventilation / cooling clearance around inverter as per manual', 'Cable glands sealed, unused entries blanked off', 'DC surge protection device (SPD) fitted and indicator normal', 'DC isolator / switch labelled and operates freely', 'Inverter display / status LEDs functioning normally']],
  ['D. AC Side & Main Panel', ['AC cable terminations tight and correctly torqued', 'AC circuit breaker rating matches design / datasheet', 'AC isolator accessible and labelled', 'AC cable and circuit labelling complete', 'Energy meter / CT connections correct and secure']],
  ['E. Earthing & Lightning Protection', ['Earth pit(s) installed and accessible for testing', 'Earth cable size / type as per design', 'Equipotential bonding complete across all metallic parts', 'Lightning / surge protection installed where specified']],
  ['F. Safety & Signage', ['Danger / warning labels posted at DC & AC points', 'Single line diagram (SLD) posted at site / inverter room', 'Fire extinguisher (CO2 / DCP, rated for electrical) available', 'PPE available for O&M personnel', 'Emergency shutdown procedure posted']]
];
const VIS_FLAT = []; VIS.forEach((g, gi) => g[1].forEach(t => VIS_FLAT.push({ g: gi, t })));
const PROT = [
  ['Over Voltage Protection Trip (V)', 'e.g. 253'], ['Under Voltage Protection Trip (V)', 'e.g. 195'], ['Over Frequency Protection Trip (Hz)', 'e.g. 52'],
  ['Under Frequency Protection Trip (Hz)', 'e.g. 47.5'], ['Anti-Islanding Protection Test', 'Tripped in __ s'], ['Reconnection Time Delay (s)', 'e.g. 60'],
  ['Export Power Limit Setting (kW / %)', 'e.g. 0 kW zero export'], ['RCD / ELCB Rated Trip Current (mA)', 'e.g. 30'], ['RCD / ELCB Trip Test Result', 'Trip time (ms)'],
  ['Earth Fault Protection Test', ''], ['Remote Shutdown / Emergency Stop Test', ''], ['Communication Module (WiFi / 4G / RS485) Test', ''],
  ['Monitoring Portal Registration', 'Portal / plant ID'], ['Inverter Firmware Version(s)', 'e.g. V100R001C00']
];
const BPARAMS = ['Over Voltage Protection (V)', 'Under Voltage Protection (V)', 'Over Current Protection (A)', 'Over Temperature Protection (°C)', 'Under Temperature Protection (°C)', 'Cell Balancing Function Test', 'SOC Display Accuracy', 'BMS Communication / Monitoring Test', 'Battery Emergency Shutdown Test'];
const BTESTS = ['Charge Test', 'Discharge Test', 'Backup / Off-Grid Test (grid failure simulation)'];
const EQUIP = [['Insulation Resistance Tester', 'DC & AC insulation tests'], ['Digital Multimeter / Clamp Meter', 'Voltage, current, polarity'], ['PV String Tester / I-V Curve Tracer', 'Voc, Isc, string current'], ['Digital Earth Tester', 'Earthing test'], ['Thermal Imaging Camera', 'Panels, inverters, switchgear'], ['Power / Energy Analyser', 'AC output, PF, frequency'], ['Irradiance Meter', 'Irradiance during on-load tests'], ['Other', '']];
const HANDOVER = ['As-built drawings provided', 'O&M manual provided', 'Warranty certificates provided', 'Spare parts list provided', 'O&M training conducted', 'Monitoring portal access provided', 'Test certificates / thermal images attached'];
const ROLES = ['Commissioning Engineer', 'QA / QC Engineer', 'Client Representative / Consultant', 'Site Safety Officer'];
const LIMDEF = [
  ['insdc', 'DC insulation resistance — minimum', 1, 'MΩ'], ['insac', 'AC insulation resistance — minimum', 1, 'MΩ'], ['vocdev', 'String Voc deviation within same MPPT / module count — maximum', 5, '%'],
  ['earth', 'Earth resistance — maximum', 5, 'Ω'], ['vnom', 'Nominal phase voltage (L–N)', 230, 'V'], ['vtol', 'Voltage tolerance (±)', 10, '%'],
  ['fnom', 'Nominal frequency', 50, 'Hz'], ['ftol', 'Frequency tolerance (±)', 1, 'Hz'], ['dt', 'Thermal ΔT above ambient — maximum', 20, '°C']
];
const CO = { name: 'Regen Renewables (Pvt) Ltd.', line: 'Regen Renewables (Pvt) Ltd.   ·   31/10 Castle Street, Colombo 8, Sri Lanka   ·   regen.lk', notice: '© Regen Renewables (Pvt) Ltd. All rights reserved. This document is confidential and the property of Regen Renewables (Pvt) Ltd. It must not be copied, shared or used without written permission.' };

/* ================= data model ================= */
const newStr = (m = '', s = '', mods = '') => ({ id: uid(), mppt: m, str: s, mods, voc: '', ip: '', in: '', ipn: '', pol: '', opv: '', cur: '', rem: '' });
const newInv = (n, P) => ({ id: uid(), loc: '', make: '', model: '', sn: '', kw: '', spd: '', spd_model: '', iso_qty: '', iso_rating: '', dc_cable: '', ac_iso: '', ac_iso_rating: '', rem: '', by: P ? P.info.engineer : '', dt: today() + ' ' + nowT(), wx: '', strings: [] });
const newAc = () => ({ pt: '', time: '', v1: '', v2: '', v3: '', i1: '', i2: '', i3: '', kw: '', pf: '', hz: '', rem: '' });
const newAcIns = () => ({ pt: '', v: Array(10).fill(''), rem: '' });
const newEarth = () => ({ loc: '', val: '', rem: '' });
const newPan = () => ({ where: '', sn: '', time: '', t: '', c: '' });
const newThInv = () => ({ where: '', pt: '', time: '', t: '', c: '' });
const newSw = () => ({ where: '', rating: '', time: '', tin: '', tout: '', c: '' });
const newBMod = () => ({ mod: '', str: '', vn: '', vm: '', ins: '', s: '', rem: '' });
const newPunch = () => ({ date: today(), loc: '', issue: '', cat: '', by: '', action: '', resp: '', target: '', s: 'Open', closed: '' });

function newProject() {
  const d = today();
  return {
    id: 'p' + uid(), v: 1, created: Date.now(), updated: Date.now(),
    info: { name: '', docno: '', rev: 'Rev 0', address: '', date: d, contact: '', tel_fixed: '', tel_mobile: '', email: '', weather: '', bill: '', client: '', epc: '', engineer: '', inv_model: '', ninv: '', kwp: '', kwac: '', roof: '', conn: '', voltage: '', supplier: '', branch: '', account: '', itype: 'Grid-tied', pv_model: '', pv_wp: '', pv_vv: '', pv_ii: '', npan: '', nstr: '', prep: '', rev_by: '', appr: '', appr_date: '' },
    lim: Object.fromEntries(LIMDEF.map(l => [l[0], String(l[2])])),
    equip: EQUIP.map((e, i) => ({ name: e[0], model: i === 3 ? '4105A / KYORITSU' : '', sn: '', cal: '', due: '', use: e[1] })),
    vis: VIS_FLAT.map(() => ({ s: '', r: '' })), vis_by: '', vis_date: d,
    invs: [], panel: { loc: '', brk: '', brk_a: '', ip: '', ac_spd: '', meter: '', meter_sn: '', ct: '', rcd: '', cable_inv: '', cable_util: '', earth: '' },
    ac: { date: d, by: '', rows: [Object.assign(newAc(), { pt: 'Grid side (no load)' })], officer: '' }, total_kw: '',
    acins: { date: d, volt: '500', by: '', rows: [newAcIns()], earth: [newEarth()], officer: '' },
    th: { date: d, amb: '', irr: '', by: '', pan: [newPan()], inv: [newThInv()], sw: [Object.assign(newSw(), { where: 'Main Breaker' })], officer: '' },
    bat: { brand: '', type: '', kwh: '', vn: '', mods: '', strs: '', bms: '', by: '', mod: [newBMod()], prm: BPARAMS.map(() => ({ val: '', std: '', s: '', rem: '' })), tests: BTESTS.map(() => ({ t0: '', t1: '', soc: '', volt: '', cur: '', dur: '', rem: '' })), officer: '' },
    prot: PROT.map(() => ({ val: '', std: '', s: '', rem: '' })), prot_by: '', prot_date: d,
    pser: [], photos: [],
    punch: [], sign: { date: d, officer: '', roles: ROLES.map(() => ({ name: '', co: '', date: '' })), hand: HANDOVER.map(() => ''), comments: '' },
    applic: { battery: 'No' }
  };
}

/* ================= engineering calculations (mirror the Excel workbook) ================= */
let P = null; // current project
const L = k => { const v = num(P.lim[k]); return !isFinite(v) ? ({ insdc: 1, insac: 1, vocdev: 5, earth: 5, vnom: 230, vtol: 10, fnom: 50, ftol: 1, dt: 20 }[k]) : v; };

function dcDev(inv, j) {
  const s = inv.strings[j]; if (!isN(s.voc)) return NaN;
  let grp;
  if (filled(s.mppt) && isN(s.mods)) grp = inv.strings.filter(x => grpKey(x.mppt) === grpKey(s.mppt) && num(x.mods) === num(s.mods) && isN(x.voc));
  else grp = inv.strings.filter(x => isN(x.voc));
  if (!grp.length) return NaN;
  const avg = grp.reduce((a, x) => a + num(x.voc), 0) / grp.length;
  return avg ? (num(s.voc) / avg - 1) * 100 : NaN;
}
function dcRes(inv, j) {
  const s = inv.strings[j];
  const any = [s.voc, s.ip, s.in, s.ipn, s.pol, s.opv, s.cur].some(filled);
  if (!any) return '';
  const ins = [s.ip, s.in, s.ipn].filter(isIns).map(num);
  const dev = dcDev(inv, j);
  if (s.pol === 'Reverse' || (ins.length && Math.min(...ins) < L('insdc')) || (!isNaN(dev) && Math.abs(dev) > L('vocdev'))) return 'Fail';
  if (isN(s.voc) && ins.length === 3 && s.pol === 'OK') return 'Pass';
  return 'Incomplete';
}
function acRes(r) {
  const v = [r.v1, r.v2, r.v3].filter(isN).map(num);
  if (!v.length) return '';
  const hi = L('vnom') * (1 + L('vtol') / 100), lo = L('vnom') * (1 - L('vtol') / 100);
  if (Math.max(...v) > hi || Math.min(...v) < lo || (isN(r.hz) && Math.abs(num(r.hz) - L('fnom')) > L('ftol'))) return 'Fail';
  return 'Pass';
}
function acInsRes(r) {
  const nums = r.v.filter(isIns).map(num), f = r.v.filter(filled).length;
  if (!f) return '';
  if (nums.length && Math.min(...nums) < L('insac')) return 'Fail';
  return f === 10 ? 'Pass' : 'Incomplete';
}
const earthRes = r => (!isN(r.val) ? '' : num(r.val) <= L('earth') ? 'Pass' : 'Fail');
function thDT(t) { return isN(t) && isN(P.th.amb) ? num(t) - num(P.th.amb) : NaN; }
function thRes(kind, r) {
  if (kind === 'sw') {
    const t = [r.tin, r.tout].filter(isN).map(num); if (!t.length) return '';
    if (!isN(P.th.amb)) return 'Incomplete';
    return Math.max(...t) - num(P.th.amb) > L('dt') ? 'Fail' : 'Pass';
  }
  if (!isN(r.t)) return '';
  if (!isN(P.th.amb)) return 'Incomplete';
  return thDT(r.t) > L('dt') ? 'Fail' : 'Pass';
}
const bmodRes = r => r.s || '';

/* section summaries */
function count(arr) { const c = { Pass: 0, Fail: 0, Incomplete: 0, 'N/A': 0 }; arr.forEach(x => { if (x in c) c[x]++; }); return c; }
// touched = how many items carry any entry; nothing entered -> NOT TESTED, only N/A entries -> N/A
function status(app, p, f, o, touched) { return app === 'No' ? 'N/A' : f > 0 ? 'FAIL' : touched === 0 ? 'NOT TESTED' : o > 0 ? 'IN PROGRESS' : p > 0 ? 'PASS' : 'N/A'; }
function summary() {
  const out = [], A = k => (P.applic[k] === 'No' ? 'No' : 'Yes');
  const add = (key, label, p, f, o, st, touched = p + f + o) => { const app = A(key); if (app === 'No') p = f = o = 0; out.push({ key, label, app, pass: p, fail: f, open: o, status: st || status(app, p, f, o, touched) }); };
  const v = count(P.vis.map(x => x.s));
  add('visual', 'Visual & Mechanical Inspection', v.Pass, v.Fail, VIS_FLAT.length - v.Pass - v.Fail - v['N/A'], null, v.Pass + v.Fail + v['N/A']);
  P.invs.forEach((inv, i) => { const c = count(inv.strings.map((s, j) => dcRes(inv, j))); add('dc:' + inv.id, 'DC String Tests — ' + invName(inv, i), c.Pass, c.Fail, c.Incomplete); });
  const a = count(P.ac.rows.map(acRes)); add('acout', 'AC Output (grid no-load & inverters)', a.Pass, a.Fail, a.Incomplete);
  const ai = count(P.acins.rows.map(acInsRes)); add('acins', 'AC Insulation Resistance', ai.Pass, ai.Fail, ai.Incomplete);
  const e = count(P.acins.earth.map(earthRes)); add('earth', 'Earthing', e.Pass, e.Fail, 0);
  const tc = count([...P.th.pan.map(r => thRes('p', r)), ...P.th.inv.map(r => thRes('i', r)), ...P.th.sw.map(r => thRes('sw', r))]);
  add('thermal', 'Thermal Imaging (panels, inverters, switchgear)', tc.Pass, tc.Fail, tc.Incomplete);
  const bm = count(P.bat.mod.map(bmodRes)), bp = count(P.bat.prm.map(x => x.s));
  const bOpen = P.bat.prm.length - bp.Pass - bp.Fail - bp['N/A'] + P.bat.mod.filter(m => [m.mod, m.vm, m.ins].some(filled) && !m.s).length;
  const bTouched = bp.Pass + bp.Fail + bp['N/A'] + P.bat.mod.filter(m => [m.mod, m.vm, m.ins, m.s].some(filled)).length;
  add('battery', 'Battery Test (hybrid systems only)', bm.Pass + bp.Pass, bm.Fail + bp.Fail, bOpen, null, bTouched);
  const pc = count(P.prot.map(x => x.s)); add('prot', 'Protection & Grid Settings', pc.Pass, pc.Fail, PROT.length - pc.Pass - pc.Fail - pc['N/A'], null, pc.Pass + pc.Fail + pc['N/A']);
  const pcl = P.punch.filter(x => x.s === 'Closed').length, pop = P.punch.filter(x => x.s !== 'Closed' && (filled(x.issue) || filled(x.loc))).length;
  add('punch', 'Punch List — all items closed', pcl, 0, pop, A('punch') === 'No' ? 'N/A' : pop > 0 ? 'IN PROGRESS' : 'PASS');
  return out;
}
function overall(rows) {
  rows = rows || summary();
  if (rows.some(r => r.status === 'FAIL')) return 'FAIL';
  if (rows.some(r => r.status === 'IN PROGRESS' || r.status === 'NOT TESTED')) return 'INCOMPLETE';
  return 'PASS';
}
const invName = (inv, i) => 'INV ' + String(i + 1).padStart(2, '0') + (inv.loc ? ' (' + inv.loc + ')' : '');
const invTag = i => 'INV ' + String(i + 1).padStart(2, '0');
function acTotal() { let s = 0, n = 0; P.ac.rows.forEach(r => { if (!/grid/i.test(r.pt) && isN(r.kw)) { s += num(r.kw); n++; } }); return { s, n }; }
function totals() {
  let ns = 0, nm = 0, kw = 0;
  P.invs.forEach(inv => { inv.strings.forEach(s => { ns++; if (isN(s.mods)) nm += num(s.mods); }); if (isN(inv.kw)) kw += num(inv.kw); });
  const wp = num(P.info.pv_wp);
  return { ns, nm, kw, kwp: isNaN(wp) ? NaN : nm * wp / 1000 };
}
const sCls = s => ({ Pass: 'ok', PASS: 'ok', Fail: 'bad', FAIL: 'bad', Incomplete: 'warn', 'IN PROGRESS': 'warn', INCOMPLETE: 'warn', 'N/A': 'na', 'NOT TESTED': 'none' }[s] || 'none');
const badge = s => `<span class="bdg ${sCls(s)}">${s ? esc(s) : '—'}</span>`;
