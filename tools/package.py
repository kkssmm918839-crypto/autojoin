#!/usr/bin/env python3
"""Package simple JS-only Revenge plugin as an expression-format ZIP.
The official Revenge CLI is preferred when dependencies are available;
this standalone packer transforms a single entry module with no imports.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import sys

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / 'plugins' / 'vc-follow'
MANIFEST = P / 'manifest.json'
SRC = P / 'js' / 'index.js'
OUT = ROOT / 'dist' / 'dev.community.vc-follow@0.2.0.zip'

def build():
    manifest = json.loads(MANIFEST.read_text())
    source = SRC.read_text()
    needle = 'export default plugin('
    assert source.count(needle) >= 1, 'Missing default plugin export'
    assert not source.count('import '), 'Use the official CLI to bundle imported dependencies'
    head, rest = source.rsplit(needle, 1)
    assert rest.rstrip().endswith(');')
    rest = rest.rstrip()[:-2] + ')'  # source ends in });, replace with })
    bundled = '(() => {\n' + head + 'return (' + rest + ';\n})()\n'
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT, 'w', ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
        z.writestr('index.js', bundled)
    (ROOT / 'dist' / 'index.js').write_text(bundled)
    print(OUT)
if __name__ == '__main__':
    build()
