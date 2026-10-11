#!/usr/bin/env bash
# Rebuilds the Excel workbook + cell map, then (if LibreOffice is installed) stores calculated results in the delivered copy.
set -euo pipefail
cd "$(dirname "$0")"
python3 build_workbook.py
if command -v soffice >/dev/null 2>&1; then python3 ../tests/recalc_lo.py Solar_PV_Commissioning_Report.xlsx; else echo "LibreOffice not found - workbook left un-recalculated (Excel recalculates on open)"; fi
