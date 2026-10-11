"""Simulates a workbook filled in by hand on site (used by xltest.js / xlcheck.py)."""
import datetime, json, os, openpyxl
os.makedirs('out', exist_ok=True)
m = json.load(open('../workbook/cellmap.json'))
wb = openpyxl.load_workbook('../workbook/template_raw.xlsx')
c = wb['Cover']; c[m['cover']['name']] = 'Hand filled site'; c[m['cover']['date']] = datetime.datetime(2026, 10, 5); c[m['cover']['kwp']] = 99.5; c[m['cover']['account']] = '0012345678'
ws = wb['DC INV 01']; h = m['dc']['head']; ws[h['loc']] = 'Roof A'; ws[h['dt']] = datetime.datetime(2026, 10, 5, 10, 30)
for j in range(4):
    r = m['dc']['first'] + j
    ws[f'C{r}'] = 1 + j // 2; ws[f'D{r}'] = 1 + j % 2; ws[f'E{r}'] = 20; ws[f'F{r}'] = 990 + j
    ws[f'H{r}'] = 500; ws[f'I{r}'] = 500; ws[f'J{r}'] = 500; ws[f'K{r}'] = 'OK'
ws = wb['DC INV 03']; r = m['dc']['first']; ws[f'C{r}'] = 1; ws[f'D{r}'] = 1; ws[f'E{r}'] = 18; ws[f'F{r}'] = 800   # inverter 3 used, inverter 2 left empty
reg = wb[m['invreg']['sheet']]; reg['D8'] = 'Huawei'; reg['E8'] = 'SUN2000-150K'
a = wb[m['ac']['sheet']]; a['E11'] = 231; a['F11'] = 232; a['G11'] = 230; a['M11'] = 50; a['D11'] = datetime.time(9, 45)
s = wb[m['serials']['sheet']]; s['C7'] = 'INV 01'; s['D7'] = 1; s['E7'] = 2; s['F7'] = 'HSN-001'; s['C8'] = 'INV 01'; s['D8'] = 9; s['E8'] = 9; s['F8'] = 'HSN-002'
wb[m['summary']['sheet']]['D%d' % m['summary']['rows']['battery']] = 'Yes'
wb[m['equip']['sheet']][m['limits']['vocdev']['cell']] = 0.03
v = wb[m['visual']['sheet']]; v['D%d' % m['visual']['rows'][0]] = 'Pass'; v['D%d' % m['visual']['rows'][1]] = 'Fail'
wb.save('out/xl_hand.xlsx'); print('out/xl_hand.xlsx written')
