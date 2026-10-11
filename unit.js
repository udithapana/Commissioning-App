// Boundary and edge-case unit tests for the app's calculation code.
const vm = require('vm'), fs = require('fs');
const SRC = process.argv[2] || '../src';
const ctx = { console, Math, Date, JSON, String, Number, Array, Object, isNaN, isFinite, parseFloat, parseInt, Set, Infinity };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(SRC + '/10-core.js', 'utf8') + '\n;globalThis.__setP = x => { P = x }; Object.assign(globalThis, { dcRes, dcDev, acRes, acInsRes, earthRes, thRes, newProject, num, summary, overall, status, totals, newStr, newInv });', ctx);
let pass = 0, fail = 0;
const eq = (name, got, exp) => { const ok = Object.is(got, exp) || (typeof exp === 'number' && Math.abs(got - exp) < 1e-9); if (ok) pass++; else { fail++; console.log('FAIL', name, 'got', got, 'expected', exp); } };
const P = ctx.newProject(); ctx.__setP(P);
const S = o => Object.assign(ctx.newStr('1', '1', '20'), o);
const dc = (strings, j = 0) => ctx.dcRes({ strings }, j);
// number parsing
eq('num plain', ctx.num('230'), 230); eq('num spaces', ctx.num(' 230 '), 230); eq('num >', ctx.num('>999'), 999);
eq('num comma decimal', ctx.num('0,5'), 0.5); eq('num thousands', ctx.num('1,000'), 1000); eq('num thousands dec', ctx.num('1,000.5'), 1000.5);
eq('num OL', ctx.num('OL'), Infinity); eq('num text', isNaN(ctx.num('abc')), true); eq('num empty', isNaN(ctx.num('')), true); eq('num neg', ctx.num('-5'), -5);
eq('num trailing unit', ctx.num('230V'), 230);
// DC
const ok = { voc: '1000', ip: '500', in: '500', ipn: '500', pol: 'OK' };
eq('dc empty', dc([S({})]), ''); eq('dc pass', dc([S(ok)]), 'Pass');
eq('dc ins exactly limit passes', dc([S({ ...ok, ip: '1' })]), 'Pass'); eq('dc ins below', dc([S({ ...ok, ip: '0.99' })]), 'Fail');
eq('dc reverse', dc([S({ ...ok, pol: 'Reverse' })]), 'Fail'); eq('dc no polarity', dc([S({ ...ok, pol: '' })]), 'Incomplete');
eq('dc only current', dc([S({ cur: '12' })]), 'Incomplete'); eq('dc OL insulation', dc([S({ ...ok, ip: 'OL', in: '>2000', ipn: 'OL' })]), 'Pass');
// Voc deviation: 2 strings same group 1000 & 1100 -> avg 1050, dev ±4.76% (pass at 5%), 1000 & 1120 -> ±5.botched
eq('dev within', dc([S({ ...ok, voc: '1000' }), S({ ...ok, voc: '1100' })]), 'Pass');
eq('dev beyond', dc([S({ ...ok, voc: '1000' }), S({ ...ok, voc: '1120' })]), 'Fail');
eq('dev value', ctx.dcDev({ strings: [S({ voc: '1000' }), S({ voc: '1100' })] }, 0), (1000 / 1050 - 1) * 100);
eq('dev groups separate MPPT', dc([S({ ...ok, voc: '1000' }), S({ ...ok, mppt: '2', voc: '1200' })]), 'Pass');
eq('dev groups separate module count', dc([S({ ...ok, voc: '1000' }), S({ ...ok, mods: '24', voc: '1200' })]), 'Pass');
eq('dev MPPT 01 vs 1 same group', dc([S({ ...ok, voc: '1000' }), S({ ...ok, mppt: '01', voc: '1200' })]), 'Fail');
eq('dev no mppt -> whole inverter', dc([S({ ...ok, mppt: '', voc: '1000' }), S({ ...ok, mppt: '', voc: '1200' })]), 'Fail');
// AC (230 V ±10 % -> 207..253, 50 ± 1 Hz)
const ac = o => ctx.acRes(Object.assign({ v1: '', v2: '', v3: '', hz: '' }, o));
eq('ac empty', ac({}), ''); eq('ac 253 ok', ac({ v1: '253' }), 'Pass'); eq('ac 253.1', ac({ v1: '253.1' }), 'Fail'); eq('ac 207 ok', ac({ v1: '207' }), 'Pass'); eq('ac 206.9', ac({ v2: '206.9' }), 'Fail');
eq('ac hz 51 ok', ac({ v1: '230', hz: '51' }), 'Pass'); eq('ac hz 51.01', ac({ v1: '230', hz: '51.01' }), 'Fail'); eq('ac hz only', ac({ hz: '50' }), '');
// AC insulation
const ai = v => ctx.acInsRes({ v });
eq('ins empty', ai(Array(10).fill('')), ''); eq('ins full', ai(Array(10).fill('999')), 'Pass'); eq('ins N/A counts', ai([...Array(9).fill('999'), 'N/A']), 'Pass');
eq('ins partial', ai([...Array(9).fill('999'), '']), 'Incomplete'); eq('ins low', ai(['0.5', ...Array(9).fill('')]), 'Fail'); eq('ins equal limit', ai(Array(10).fill('1')), 'Pass');
// earth
eq('earth 5', ctx.earthRes({ val: '5' }), 'Pass'); eq('earth 5.01', ctx.earthRes({ val: '5.01' }), 'Fail'); eq('earth blank', ctx.earthRes({ val: '' }), '');
// thermal (amb blank -> Incomplete)
P.th.amb = ''; eq('th no ambient', ctx.thRes('p', { t: '40' }), 'Incomplete');
P.th.amb = '30'; eq('th dT 20', ctx.thRes('p', { t: '50' }), 'Pass'); eq('th dT 20.1', ctx.thRes('p', { t: '50.1' }), 'Fail'); eq('sw max', ctx.thRes('sw', { tin: '40', tout: '51' }), 'Fail');
// limits edited / invalid
P.lim.insdc = '2'; eq('limit edit', dc([S({ ...ok, ip: '1.5' })]), 'Fail'); P.lim.insdc = 'abc'; eq('limit invalid -> default 1', dc([S({ ...ok, ip: '1.5' })]), 'Pass'); P.lim.insdc = '1';
// summary semantics on a fresh project
const Q = ctx.newProject(); ctx.__setP(Q);
const st = k => ctx.summary().find(r => r.key === k).status;
eq('fresh visual NOT TESTED', st('visual'), 'NOT TESTED'); eq('fresh prot NOT TESTED', st('prot'), 'NOT TESTED'); eq('fresh battery N/A', st('battery'), 'N/A');
eq('fresh punch PASS', st('punch'), 'PASS'); eq('fresh overall', ctx.overall(), 'INCOMPLETE');
Q.vis.forEach(v => (v.s = 'N/A')); eq('visual all N/A', st('visual'), 'N/A');
Q.vis.forEach(v => (v.s = 'Pass')); Q.vis[0].s = ''; eq('visual one open', st('visual'), 'IN PROGRESS');
Q.vis[0].s = 'Fail'; eq('visual fail', st('visual'), 'FAIL');
Q.applic.battery = 'Yes'; eq('battery yes untouched', st('battery'), 'NOT TESTED');
Q.punch.push({ issue: 'x', loc: '', s: 'Open' }); eq('punch open', st('punch'), 'IN PROGRESS'); Q.punch[0].s = 'Closed'; eq('punch closed', st('punch'), 'PASS');
// complete passing project -> PASS
const R = ctx.newProject(); ctx.__setP(R);
R.vis.forEach(v => (v.s = 'Pass')); R.prot.forEach(v => (v.s = 'Pass'));
const inv = ctx.newInv(0, R); inv.strings = [S(ok), S({ ...ok, str: '2' })]; R.invs.push(inv);
R.ac.rows[0] = Object.assign(R.ac.rows[0], { v1: '230', v2: '231', v3: '229', hz: '50' }); R.acins.rows[0].v = Array(10).fill('999'); R.acins.earth[0].val = '1.2'; R.th.amb = '30'; R.th.pan[0].t = '40'; R.th.inv[0].t = '45'; R.th.sw[0].tin = '35';
eq('complete project PASS', ctx.overall(), 'PASS');
const T = ctx.totals(); eq('totals modules', T.nm, 40); R.info.pv_wp = '550'; eq('kWp', ctx.totals().kwp, 22);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
