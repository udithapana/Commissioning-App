"""Excel-parity test, step 2: the app's calculations must give exactly the workbook's results for the same readings."""
import json, subprocess, sys, openpyxl
M = json.load(open('../workbook/cellmap.json'))
app = json.loads(subprocess.check_output(['node', 'app_calc.js'] + sys.argv[1:]))
wb = openpyxl.load_workbook('cases.xlsx', data_only=True)
C = json.load(open('cases.json'))
bad = n = 0
def chk(label, a, x):
    global bad, n; n += 1; x = '' if x is None else x
    if a != x: bad += 1; print('MISMATCH', label, 'app=', repr(a), 'excel=', repr(x))
for si, sheet in enumerate(M['dc']['sheets'][:2]):
    ws = wb[sheet]
    for j, r in enumerate(range(M['dc']['first'], M['dc']['last'] + 1)):
        res, dev = app['dc'][si][j]
        chk(f'{sheet} N{r}', res, ws[f'N{r}'].value)
        g = ws[f'G{r}'].value
        if isinstance(g, (int, float)):
            n += 1
            if dev is None or abs(dev / 100 - g) > 1e-9: bad += 1; print('DEV MISMATCH', sheet, r, dev, g)
        elif dev is not None: bad += 1; print('DEV MISMATCH (app has value)', sheet, r, dev, g)
for j, c in enumerate(C['ac']): chk(f"AC N{c['r']}", app['ac'][j], wb[M['ac']['sheet']][f"N{c['r']}"].value)
ws = wb[M['acins']['sheet']]
for j, c in enumerate(C['ins']): chk(f"INS N{c['r']}", app['ins'][j], ws[f"N{c['r']}"].value)
for j, c in enumerate(C['earth']): chk(f"EARTH G{c['r']}", app['earth'][j], ws[f"G{c['r']}"].value)
ws = wb[M['th']['sheet']]
for key in ('thp', 'thi', 'ths'):
    for j, c in enumerate(C[key]): chk(f"{key} H{c['r']}", app[key][j], ws[f"H{c['r']}"].value)
print(f'{n} checks, {bad} mismatches'); sys.exit(1 if bad else 0)
