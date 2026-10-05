#!/usr/bin/env python3
"""Reproduce pinned, local browser assets without adding Node runtime dependencies.

Versions, tarball URLs and SHA-512 integrity values live in each vendor.json.
Only the Web Awesome components imported by components.js, their module
imports, the Japanese translation and the selected theme are retained.
"""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / 'web/lib'
COMPONENTS = re.findall(r"'([a-z-]+)'", (ROOT / 'web/components.js').read_text().split('].map')[0])
WA_ROOTS = [f'dist-cdn/components/{name}/{name}.js' for name in COMPONENTS]
WA_ROOTS += ['dist-cdn/translations/ja.js', 'dist-cdn/styles/themes/default.css']
PACKAGES = ['webawesome', 'tabulator', 'notosansjp']


def verify_integrity(content, expected, name):
    actual = 'sha512-' + base64.b64encode(hashlib.sha512(content).digest()).decode()
    if actual != expected:
        raise ValueError('Integrity mismatch: ' + name)


def font_metadata():
    directory = LIB / 'notosansjp'
    metadata = json.loads((directory / 'vendor.json').read_text())
    stylesheet = metadata['stylesheet']
    content = (directory / stylesheet['file']).read_bytes()
    verify_integrity(content, stylesheet['integrity'], stylesheet['file'])
    urls = re.findall(r'url\(([^)]+)\)', content.decode('utf-8'))
    if not urls or any(not re.fullmatch(r'\./[\w.-]+\.woff2', url) for url in urls):
        raise ValueError('Font stylesheet must reference local WOFF2 assets only')
    fonts = {url[2:] for url in urls}
    assets = metadata['files']
    if fonts != {name for name in assets if name.endswith('.woff2')}:
        raise ValueError('Font stylesheet and asset manifest differ')
    if 'OFL.txt' not in assets:
        raise ValueError('Font license is missing from asset manifest')
    if any(PurePosixPath(name).name != name for name in assets):
        raise ValueError('Invalid font asset path')
    return metadata, content


def verify_fonts():
    metadata, _ = font_metadata()
    for name, asset in metadata['files'].items():
        verify_integrity((LIB / 'notosansjp' / name).read_bytes(), asset['integrity'], name)
    print(f"notosansjp: stylesheet and {len(metadata['files'])} assets verified locally")


def download_fonts():
    # Keep the pinned stylesheet in Git: the Google CSS API varies by browser
    # and can move to a newer release independently of the recorded font URLs.
    metadata, stylesheet = font_metadata()

    def fetch(item):
        name, asset = item
        with urlopen(asset['source'], timeout=60) as response:
            content = response.read()
        verify_integrity(content, asset['integrity'], name)
        if name.endswith('.woff2') and not content.startswith(b'wOF2'):
            raise ValueError('Invalid WOFF2 asset: ' + name)
        return name, content

    with ThreadPoolExecutor(max_workers=8) as pool:
        files = dict(pool.map(fetch, metadata['files'].items()))
    files[metadata['stylesheet']['file']] = stylesheet
    return files


def module_files(files, roots):
    kept = {}
    pending = list(roots)
    while pending:
        name = pending.pop()
        if name in kept:
            continue
        content = files[name]
        kept[name] = content
        text = content.decode('utf-8')
        if name.endswith('.js'):
            links = re.findall(r'''(?:from\s*|import\s*\(?\s*)["']([^"']+)["']''', text)
        elif name.endswith('.css'):
            links = re.findall(r'''url\(\s*["']?([^\s"')]+)''', text)
        else:
            links = []
        for link in links:
            if link.startswith(('data:', 'http:', 'https:', '#')):
                continue
            # The CDN build uses only relative module specifiers.
            parts = list(PurePosixPath(name).parent.parts)
            for part in PurePosixPath(link).parts:
                if part == '..':
                    if not parts:
                        raise ValueError('Dependency escapes package: ' + link)
                    parts.pop()
                elif part != '.':
                    parts.append(part)
            pending.append('/'.join(parts))
    return kept


def download(name):
    if name == 'notosansjp':
        return download_fonts()
    metadata = json.loads((LIB / name / 'vendor.json').read_text())
    with urlopen(metadata['source'], timeout=60) as response:
        archive = response.read()
    verify_integrity(archive, metadata['integrity'], name)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
        for member in package.getmembers():
            if not member.isfile() or not member.name.startswith('package/'):
                continue
            path = PurePosixPath(member.name[len('package/'):])
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Invalid package path')
            files[str(path)] = package.extractfile(member).read()
    if name == 'webawesome':
        keep = module_files(files, WA_ROOTS)
        keep['LICENSE.md'] = files['LICENSE.md']
    else:
        keep = {path: files[path] for path in ['LICENSE', 'dist/css/tabulator.min.css', 'dist/js/tabulator.min.js']}
    return keep


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packages', nargs='*', metavar='PACKAGE', help='webawesome, tabulator, or notosansjp; default: all')
    parser.add_argument('--verify-fonts', action='store_true', help='verify bundled font files offline without changing them')
    args = parser.parse_args()
    if args.verify_fonts:
        if args.packages:
            parser.error('--verify-fonts cannot be combined with package selection')
        verify_fonts()
        return
    names = args.packages or PACKAGES
    if any(name not in PACKAGES for name in names):
        parser.error('Unknown package; choose from ' + ', '.join(PACKAGES))
    # Download and validate every selected package before touching existing assets.
    packages = {name: download(name) for name in names}
    for name, files in packages.items():
        directory = LIB / name
        for child in directory.iterdir():
            if child.name == 'vendor.json':
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
        for filename, content in files.items():
            destination = directory / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        print(f'{name}: {len(files)} files, {sum(map(len, files.values())):,} bytes (integrity verified)')


if __name__ == '__main__':
    main()
