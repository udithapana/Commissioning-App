# Validate the exported workbook: opens cleanly, Excel's own formulas (recalculated in LibreOffice) agree with the app,
# and export -> import gives back the same project.
import json, shutil, subprocess, openpyxl, sys
ok = bad = 0
def chk(name, cond, extra=''):
    global ok, bad
    if cond: ok += 1
    else: bad += 1; print('FAIL', name, extra)
m = json.load(open('../workbook/cellmap.json'))
app = json.load(open('out/xl_app.json'))
wb = openpyxl.load_workbook('out/xl_export.xlsx')            # structural validity
chk('veryHidden app sheet kept', wb['_app'].sheet_state == 'veryHidden')
chk('3 DC sheets visible, rest hidden', [wb[n].sheet_state for n in m['dc']['sheets'][:4]] == ['visible', 'visible', 'visible', 'hidden'])
chk('logo image kept', len(wb['Cover']._images) == 1)
chk('data validations kept', len(wb['DC INV 01'].data_validations.dataValidation) >= 1)
chk('conditional formats kept', len(wb['DC INV 01'].conditional_formatting) >= 1)
shutil.copy('out/xl_export.xlsx', 'out/xl_recalc.xlsx')
subprocess.run([sys.executable, 'recalc_lo.py', 'out/xl_recalc.xlsx'], check=True)
errs = [f'{ws.title}!{c.coordinate}' for ws in openpyxl.load_workbook('out/xl_recalc.xlsx', data_only=True).worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith('#') and c.value.endswith(('!', '?', 'A'))]
chk('recalc: no formula errors', not errs, str(errs[:5]))
v = openpyxl.load_workbook('out/xl_recalc.xlsx', data_only=True)
sm = v['Summary']; rows = m['summary']['rows']
proj = app['project']
for key, st, p, f, o in app['summary']:
    if key.startswith('dc:'):
        k = [i for i, inv in enumerate(proj['invs']) if 'dc:' + inv['id'] == key][0]; xk = 'dc%d' % (k + 1)
    else: xk = key
    r_ = rows[xk]
    xst = sm.cell(r_, 8).value
    chk('summary status %s' % key, xst == st, f'excel={xst} app={st}')
    if not (key.startswith('dc:') and len(proj['invs'][k]['strings']) > 36):
        chk('summary counts %s' % key, [sm.cell(r_, c).value for c in (5, 6, 7)] == [p, f, o], f'excel={[sm.cell(r_, c).value for c in (5,6,7)]} app={[p,f,o]}')
ovr = [sm.cell(rr, 8).value for rr in range(1, 60) if sm.cell(rr, 2).value == 'OVERALL RESULT'][0]
chk('overall result', ovr == app['overall'], f'excel={ovr} app={app["overall"]}')
for k, res in enumerate(app['dc']):
    ws = v[m['dc']['sheets'][k]]
    xl = [ws.cell(m['dc']['first'] + j, 14).value or '' for j in range(len(res))]
    chk('DC results INV %02d' % (k + 1), xl == res, f'{xl[:6]} vs {res[:6]}')
ac = v['AC Output']; xa = [ac.cell(m['ac']['first'] + j, 14).value or '' for j in range(len(app['ac']))]
chk('AC results', xa == app['ac'], f'{xa} vs {app["ac"]}')
# round trip
back = json.load(open('out/xl_back.json'))
def norm_ins(x):
    return {'OL': '9999', '>999': '999', '1,000': '1000', '0,5': '0.5'}.get(x, x)
def nv(x):
    # numbers compare by value ('787.0' == '787'): Excel keeps the number, the cell format shows the decimals
    if isinstance(x, dict): return {k: nv(v) for k, v in x.items()}
    if isinstance(x, list): return [nv(v) for v in x]
    if isinstance(x, str):
        try: return float(x) if x.strip() not in ('',) and not x.strip().startswith('0') or x.strip() in ('0',) or x.strip().startswith('0.') else x
        except ValueError: return x
    return x
def cmp(name, a, b):
    a, b = nv(a), nv(b)
    if a != b and isinstance(a, list) and isinstance(b, list):
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y: print('   first difference at', i, json.dumps(x)[:300], '!=', json.dumps(y)[:300]); break
    chk('round trip ' + name, a == b, json.dumps(a)[:150] + ' != ' + json.dumps(b)[:150])
cmp('project id', back['id'], proj['id'])
cmp('info', back['info'], proj['info'])
cmp('limits', {k: float(x) for k, x in back['lim'].items()}, {k: float(x) for k, x in proj['lim'].items()})
cmp('equipment', back['equip'], proj['equip'])
cmp('visual', back['vis'], proj['vis']); cmp('visual by/date', [back['vis_by'], back['vis_date']], [proj['vis_by'], proj['vis_date']])
cmp('panel', back['panel'], proj['panel'])
keys = ['loc', 'make', 'model', 'sn', 'kw', 'spd', 'spd_model', 'iso_qty', 'iso_rating', 'dc_cable', 'ac_iso', 'ac_iso_rating', 'rem', 'by', 'dt', 'wx']
cmp('inverter count', len(back['invs']), len(proj['invs']))
for k, (a, b) in enumerate(zip(back['invs'], proj['invs'])):
    cmp('inverter %d register' % k, {x: a[x] for x in keys}, {x: b[x] for x in keys})
    sk = ['mppt', 'str', 'mods', 'voc', 'ip', 'in', 'ipn', 'pol', 'opv', 'cur', 'rem']
    cmp('inverter %d strings' % k, [{x: s[x] for x in sk} for s in a['strings']], [{x: (norm_ins(s[x]) if x in ('ip', 'in', 'ipn') else s[x]) for x in sk} for s in b['strings'][:36]])
for sec, ks in [('ac', ['date', 'by', 'officer', 'rows']), ('acins', ['date', 'volt', 'by', 'officer', 'rows', 'earth']), ('th', ['date', 'amb', 'irr', 'by', 'officer', 'pan', 'inv', 'sw'])]:
    for k in ks: cmp(sec + '.' + k, back[sec][k], proj[sec][k])
cmp('battery', {k: back['bat'][k] for k in back['bat']}, {k: proj['bat'][k] for k in proj['bat']})
cmp('protection', [back['prot'], back['prot_by'], back['prot_date']], [proj['prot'], proj['prot_by'], proj['prot_date']])
cmp('punch', [{k: x[k] for k in x} for x in back['punch']], [{k: x[k] for k in x} for x in proj['punch']])
cmp('sign-off', back['sign'], proj['sign'])
cmp('applicability', {k: v_ for k, v_ in back['applic'].items()}, {k: v_ for k, v_ in proj['applic'].items() if v_ == 'No' or k == 'battery'})
cmp('photos kept', back['photos'], proj['photos'])
sid_ok = {s['id'] for inv in proj['invs'] for s in inv['strings'][:36]}
exp_ser = [x['sn'] for x in proj['pser']]
cmp('serial numbers (same set)', sorted(x['sn'] for x in back['pser']), sorted(exp_ser))
# hand-filled workbook
h = json.load(open('out/xl_hand_back.json'))
chk('hand: name/date/kwp/account', [h['info']['name'], h['info']['date'], h['info']['kwp'], h['info']['account']] == ['Hand filled site', '2026-10-05', '99.5', '0012345678'], str([h['info']['name'], h['info']['date'], h['info']['kwp'], h['info']['account']]))
chk('hand: 3 inverters (middle one empty)', len(h['invs']) == 3 and len(h['invs'][1]['strings']) == 0 and len(h['invs'][2]['strings']) == 1)
chk('hand: inverter 1 strings', [(s['mppt'], s['str'], s['voc'], s['pol']) for s in h['invs'][0]['strings']] == [('1', '1', '990', 'OK'), ('1', '2', '991', 'OK'), ('2', '1', '992', 'OK'), ('2', '2', '993', 'OK')])
chk('hand: register make/model', [h['invs'][0]['make'], h['invs'][0]['model'], h['invs'][0]['loc']] == ['Huawei', 'SUN2000-150K', 'Roof A'])
chk('hand: dc date/time', h['invs'][0]['dt'] == '2026-10-05 10:30', h['invs'][0]['dt'])
chk('hand: AC row with time', h['ac']['rows'][0]['v1'] == '231' and h['ac']['rows'][0]['time'] == '09:45' and h['ac']['rows'][0]['pt'] == 'Grid side (no load)', str(h['ac']['rows'][0]))
chk('hand: serial matched to string', any(x['sn'] == 'HSN-001' and x['sid'] == h['invs'][0]['strings'][1]['id'] for x in h['pser']) and any(x['sn'] == 'HSN-002' and x['sid'] == '' for x in h['pser']))
chk('hand: battery applicable + limit %', h['applic']['battery'] == 'Yes' and float(h['lim']['vocdev']) == 3)
chk('hand: visual statuses', [h['vis'][0]['s'], h['vis'][1]['s']] == ['Pass', 'Fail'])
print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)
