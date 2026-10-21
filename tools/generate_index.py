#!/usr/bin/env python3
"""Generate Revenge format:1 index.json from this plugin ZIP for HTTPS hosting."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

p = argparse.ArgumentParser()
p.add_argument('--base-url', required=True, help='HTTPS base URL of the hosted site')
p.add_argument('--zip', default='dist/dev.community.vc-follow@0.2.0.zip')
p.add_argument('--output', default='site/index.json')
args = p.parse_args()
root = Path(__file__).resolve().parent.parent
zip_path = root / args.zip
with ZipFile(zip_path) as archive:
    manifest = json.loads(archive.read('manifest.json'))
file_bytes = zip_path.read_bytes()
plugin_id, version = manifest['id'], manifest['version']
base = args.base_url.rstrip('/') + '/'
index = {
    'format': 1,
    'name': 'VC Follow Plugins',
    'description': 'VC Follow for Revenge Next',
    'plugins': {
        plugin_id: {
            'name': manifest['name'],
            'description': manifest['description'],
            'author': manifest['author'],
            'channels': {'latest': version},
            'versions': {
                version: {
                    'url': base + 'pool/' + zip_path.name,
                    'sha256': hashlib.sha256(file_bytes).hexdigest(),
                    'size': len(file_bytes),
                    'dependencies': manifest['dependencies'],
                },
            },
        },
    },
}
out = root / args.output
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(index, indent=2) + '\n')
asset_dir = out.parent / 'pool'
asset_dir.mkdir(parents=True, exist_ok=True)
(asset_dir / zip_path.name).write_bytes(file_bytes)
# Compatibility with clients whose '+' dialog expects a plugin base URL
# and fetches manifest.json instead of a repository index.
(out.parent / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
with ZipFile(zip_path) as archive:
    (out.parent / 'index.js').write_bytes(archive.read('index.js'))
(out.parent / '.nojekyll').touch()
print(out)
