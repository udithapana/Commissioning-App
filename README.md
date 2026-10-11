# Regen Site Commissioning

On-site commissioning app for solar PV installations by **Regen Renewables (Pvt) Ltd.**
Engineers record readings on a phone or laptop, every reading is checked against the acceptance limits as it is typed,
and the same data produces the A4 commissioning report (PDF), a photo document (PDF) and the Regen Excel workbook.

> © Regen Renewables (Pvt) Ltd. All rights reserved. Confidential — not for distribution outside Regen without written permission.

## What it does

| Area | Details |
|---|---|
| Project details | Cover information, PV system & utility, PV panel, prepared / reviewed / approved, main panel & cables |
| Checks | Visual & mechanical (30 items), DC string tests per inverter (any number of MPPTs / strings), AC output, AC insulation, earthing, thermal imaging, battery (hybrid / off-grid), protection & grid settings, punch list, sign-off & handover |
| Live results | Pass / Fail / Incomplete per reading, section status and overall result — the same rules as the Excel workbook (verified cell-for-cell, see *Tests*) |
| Panel serial numbers | Type, use a USB / Bluetooth scanner, paste a list, or read a QR / barcode from a photo; duplicates blocked; CSV download |
| Photos | Camera or gallery, compressed to ~80 KB, separate photo document PDF |
| Reports | A4 commissioning report PDF and photo document PDF with the Regen logo, header and confidentiality footer |
| Excel | Download the project as the Regen workbook (formulas, drop-downs, logo and print layout kept) and import a filled workbook back |
| Data safety | Auto-save, automatic + manual checkpoints (history), project files to send to a colleague, full backup / restore |

## Repository layout

```
index.html                  built standalone app (open in a browser, or publish with GitHub Pages)
dist/artifact.html          built page for a Claude artifact (shared database + downloads)
src/                        app source, concatenated in this order by scripts/build.sh
  00-shell.html             styles + page shell
  10-core.js                data model and all engineering calculations
  11-logo.js                generated — logo as data URIs
  12-template.js            generated — Excel template + cell map
  20-storage-ui.js          storage, data validation, screens
  30-serials-photos.js      panel serial numbers, QR reading, photos, photo document
  40-history-backup.js      checkpoints, export / import, backups
  50-excel.js               Excel export (fills the template) and import
  60-actions-pdf.js         button actions, sample project, A4 report PDF, start-up
workbook/
  build_workbook.py         generates the Excel workbook and cellmap.json
  make_workbook.sh          build + recalculate with LibreOffice
  Solar_PV_Commissioning_Report.xlsx   the workbook (blank, ready to use)
  template_raw.xlsx         same workbook before recalculation — embedded in the app
  cellmap.json              where every app field lives in the workbook
assets/logo/                Regen logo (source + transparent PNGs)
scripts/                    build.sh, gen_assets.py, prepare_logo.py
tests/                      unit, Excel-parity, Excel round-trip and browser tests
```

## Build

Requirements: Python 3.10+ with `pip install -r requirements.txt`, Node.js 18+.

```bash
python3 scripts/prepare_logo.py          # only when the logo changes
bash workbook/make_workbook.sh           # only when the workbook layout changes
bash scripts/build.sh                    # -> index.html and dist/artifact.html
```

Edit files in `src/` and `workbook/build_workbook.py`, never the generated `index.html`, `dist/`, `src/11-logo.js`
or `src/12-template.js`.

## Run / deploy

* **On a phone or laptop:** open `index.html` in Chrome, Edge or Safari. Projects, photos and history are stored in that
  browser only — use *History & Backup → Back up all projects* regularly.
* **GitHub Pages:** Settings → Pages → deploy from the `main` branch, root folder. The site serves `index.html`.
  Keep the repository **private** if the data or layout is confidential (GitHub Pages on a private repository needs a paid plan).
* **Claude artifact (shared by the team):** publish `dist/artifact.html` with the `db` and `downloads` capabilities;
  projects and photos are then shared by everyone the artifact is shared with.

The page loads two libraries from public CDNs when they are first needed: `pdf-lib 1.17.1` (PDFs) and `jszip 3.10.1` (Excel).
Everything else is in the single HTML file.

## Tests

```bash
npm install                    # playwright, pdf-lib, jszip (dev only)
npx playwright install chromium
npm test                       # all suites
```

| Suite | What it proves |
|---|---|
| `test:unit` | 63 edge cases — exact limit boundaries, `>999`, `OL`, `1,000`, `0,5`, MPPT `01` = `1`, section statuses |
| `test:parity` | Random readings written into the workbook, recalculated in LibreOffice, compared with the app: every DC / AC / insulation / earth / thermal result must match (needs LibreOffice) |
| `test:excel` | Export → workbook opens cleanly, keeps logo / drop-downs / formatting, Excel's own formulas agree with the app; export → import gives the same project; a hand-filled workbook imports correctly; an old-layout workbook is rejected with a clear message |
| `test:e2e` | Browser run of every screen, field and button; DC workflow; serials; persistence; hostile-text and broken-file security checks; PDFs incl. a 40-page stress report; photos; history / backup / restore; 320–1280 px layouts; dark mode; shared-database mode with two users |

Set `CHROMIUM_PATH` to use a specific Chromium build.

## Known limitations

* Sinhala / Tamil text prints as “?” in the PDFs (only the built-in PDF fonts can be used); Ω and Δ print as “Ohm” / “d”.
* Shared mode: one project must stay under ~250 KB (about 5,000 panel serials); larger projects stay on the device with a warning.
* Two people editing the same project at the same moment are not merged — the other version is kept in History.
* Excel workbook capacity: 20 inverters × 36 strings, 22 AC rows, 21 insulation rows, 10 earth rods, 30 snags (the app warns when data is cut).
* QR reading from a photo and the camera button depend on the phone's browser; test on your devices.
