// Run the app's own calculation code (p2.js) on the generated cases and print results as JSON.
const vm = require('vm'), fs = require('fs');
const SRC = process.argv[2] || '../src';
const ctx = { console, Math, Date, JSON, String, Number, Array, Object, isNaN, isFinite, parseFloat, parseInt, Set };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(SRC + '/10-core.js', 'utf8') + '\n;globalThis.__setP = x => { P = x }; Object.assign(globalThis, { dcRes, dcDev, acRes, acInsRes, earthRes, thRes, newProject, num, summary, overall, status });', ctx);
const C = JSON.parse(fs.readFileSync('cases.json'));
const s = v => (v == null ? '' : String(v));
const out = {};
const P = vm.runInContext('newProject()', ctx); ctx.__setP(P);
P.th.amb = s(C.amb);
out.dc = C.dc.map(rows => { const inv = { strings: rows.map(r => ({ mppt: r.C, str: r.D, mods: r.E, voc: r.F, ip: r.H, in: r.I, ipn: r.J, pol: r.K, opv: r.L, cur: r.M })) }; return inv.strings.map((x, j) => [ctx.dcRes(inv, j), ctx.dcDev(inv, j)]); });
out.ac = C.ac.map(r => ctx.acRes({ v1: s(r.v1), v2: s(r.v2), v3: s(r.v3), hz: s(r.hz) }));
out.ins = C.ins.map(c => ctx.acInsRes({ v: c.v.map(s) }));
out.earth = C.earth.map(c => ctx.earthRes({ val: s(c.v) }));
out.thp = C.thp.map(c => ctx.thRes('p', { t: s(c.t) }));
out.thi = C.thi.map(c => ctx.thRes('i', { t: s(c.t) }));
out.ths = C.ths.map(c => ctx.thRes('sw', { tin: s(c.v[0]), tout: s(c.v[1]) }));
console.log(JSON.stringify(out));
