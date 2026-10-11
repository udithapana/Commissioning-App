#!/usr/bin/env python3
"""Recalculate every formula in an .xlsx with LibreOffice (headless) and save the cached results in place.

Usage: python3 recalc_lo.py workbook.xlsx
Uses a throw-away LibreOffice profile whose "recalculate on load" setting is "always", then re-saves the file.
"""
import os, shutil, subprocess, sys, tempfile, pathlib

XCU = """<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
"""

def recalc(path):
    path = pathlib.Path(path).resolve()
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise SystemExit("LibreOffice (soffice) not found")
    with tempfile.TemporaryDirectory() as prof, tempfile.TemporaryDirectory() as out:
        user = pathlib.Path(prof) / "user"; user.mkdir()
        (user / "registrymodifications.xcu").write_text(XCU)
        subprocess.run([soffice, "-env:UserInstallation=" + pathlib.Path(prof).as_uri(), "--headless", "--calc",
                        "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, str(path)],
                       check=True, capture_output=True, timeout=300)
        shutil.copy(pathlib.Path(out) / path.name, path)

if __name__ == "__main__":
    for f in sys.argv[1:]:
        recalc(f)
        print("recalculated", f)
