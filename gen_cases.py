"""Excel-parity test, step 1: write random readings into the workbook and save them as JSON for the app.

    python3 gen_cases.py [seed]   ->  cases.xlsx + cases.json
Then: python3 recalc_lo.py cases.xlsx && python3 compare.py
"""
import json, random, sys, openpyxl
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 42)
M = json.load(open('../workbook/cellmap.json'))
wb = openpyxl.load_workbook('../workbook/template_raw.xlsx')
maybe = lambda p, f: f() if random.random() < p else None
C = {'dc': [], 'ac': [], 'ins': [], 'earth': [], 'thp': [], 'thi': [], 'ths': [], 'amb': None}
for sheet in M['dc']['sheets'][:2]:
    ws = wb[sheet]; rows = []
    for r in range(M['dc']['first'], M['dc']['last'] + 1):
        mppt = random.choice(['1', '2', '3', None]) if random.random() < .9 else None
        mods = random.choice([18, 20, None])
        voc = maybe(.85, lambda: round(random.uniform(880, 1010), 1))
        ins = [maybe(.85, lambda: random.choice([round(random.uniform(.2, 3), 2), random.randint(50, 999)])) for _ in range(3)]
        pol = maybe(.8, lambda: random.choice(['OK', 'OK', 'OK', 'Reverse']))
        opv = maybe(.6, lambda: round(random.uniform(700, 800), 1)); cur = maybe(.6, lambda: round(random.uniform(10, 14), 2))
        if random.random() < .08: voc = None; ins = [None] * 3; pol = opv = cur = None
        vals = {'C': mppt, 'D': str(r - M['dc']['first'] + 1), 'E': mods, 'F': voc, 'H': ins[0], 'I': ins[1], 'J': ins[2], 'K': pol, 'L': opv, 'M': cur}
        for k, v in vals.items(): ws[f'{k}{r}'] = v
        rows.append({k: ('' if v is None else str(v)) for k, v in vals.items()})
    C['dc'].append(rows)
A = M['ac']; ws = wb[A['sheet']]
for r in range(A['first'], A['first'] + 12):
    v = [maybe(.85, lambda: round(random.uniform(200, 260), 1)) for _ in range(3)]
    hz = maybe(.7, lambda: round(random.uniform(48.5, 51.5), 2))
    if random.random() < .1: v = [None] * 3
    for c, x in zip('EFG', v): ws[f'{c}{r}'] = x
    ws[f'M{r}'] = hz
    C['ac'].append({'r': r, 'v1': v[0], 'v2': v[1], 'v3': v[2], 'hz': hz})
I = M['acins']; ws = wb[I['sheet']]
for r in range(I['first'], I['first'] + 12):
    vals = [maybe(.9, lambda: random.choice([round(random.uniform(.3, 2), 2), 999, 'N/A'])) for _ in range(10)]
    if random.random() < .15: vals = [None] * 10
    for c, x in zip(I['vcols'], vals): ws[f'{c}{r}'] = x
    C['ins'].append({'r': r, 'v': vals})
for r in range(I['earth']['first'], I['earth']['last'] + 1):
    v = maybe(.85, lambda: round(random.uniform(.5, 9), 2)); ws[f'D{r}'] = v; C['earth'].append({'r': r, 'v': v})
T = M['th']; ws = wb[T['sheet']]; ws[T['amb']] = C['amb'] = 31.0
for key, kind in (('thp', 'pan'), ('thi', 'inv')):
    for r in range(T[kind]['first'], T[kind]['last'] + 1):
        t = maybe(.8, lambda: round(random.uniform(30, 60), 1)); ws[f'F{r}'] = t; C[key].append({'r': r, 't': t})
for r in range(T['sw']['first'], T['sw']['last'] + 1):
    a = maybe(.8, lambda: round(random.uniform(30, 60), 1)); b = maybe(.8, lambda: round(random.uniform(30, 60), 1)); ws[f'F{r}'] = a; ws[f'G{r}'] = b; C['ths'].append({'r': r, 'v': [a, b]})
wb.save('cases.xlsx'); json.dump(C, open('cases.json', 'w'))
print('cases.xlsx written')
