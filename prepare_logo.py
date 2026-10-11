"""Turns the supplied Regen logo (green on black) into transparent PNGs used by the app, the PDFs and the workbook.

    python3 scripts/prepare_logo.py assets/logo/regen_logo_source.jpg
writes assets/logo/regen_logo.png (full logo) and assets/logo/regen_mark.png (sun + tree emblem)
"""
import os, sys
import numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets', 'logo', 'regen_logo_source.jpg')
a = np.asarray(Image.open(src).convert('RGB')).astype(float)
alpha = np.clip((a[:, :, 1] - 18) / (152 - 18), 0, 1)            # black -> transparent, keeps anti-aliasing
out = np.zeros((a.shape[0], a.shape[1], 4), np.uint8); out[:, :, :3] = (0, 152, 72); out[:, :, 3] = (alpha * 255).astype(np.uint8)
full = Image.fromarray(out, 'RGBA'); full = full.crop(full.getbbox())
full.resize((640, round(640 * full.size[1] / full.size[0])), Image.LANCZOS).quantize(colors=32, method=Image.Quantize.FASTOCTREE).save(os.path.join(ROOT, 'assets', 'logo', 'regen_logo.png'), optimize=True)
mk = np.array(Image.fromarray(out, 'RGBA').crop((336, 0, 1284, 960)))
mk[455:500, :12, 3] = 0; mk[455:500, -12:, 3] = 0                # remove the frame rails touching the outer leaves
mk = Image.fromarray(mk); mk = mk.crop(mk.getbbox())
mk.resize((160, round(160 * mk.size[1] / mk.size[0])), Image.LANCZOS).quantize(colors=32, method=Image.Quantize.FASTOCTREE).save(os.path.join(ROOT, 'assets', 'logo', 'regen_mark.png'), optimize=True)
print('logo PNGs written')
