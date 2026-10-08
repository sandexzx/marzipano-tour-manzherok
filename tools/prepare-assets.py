#!/usr/bin/env python3
"""Prepare browser panoramas and numbered floor plans from the supplied archives."""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
import argparse
import json
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=ROOT / '0710 рендер.zip',
                    help='Panorama ZIP or directory containing 1.jpg through 37.jpg')
parser.add_argument('--plans', type=Path,
                    default=ROOT / 'Attachments_YanochkaBurakova19@yandex.ru_2026-10-08_07-28-42.zip',
                    help='Numbered floor-plan ZIP or directory')
parser.add_argument('--skip-panoramas', action='store_true',
                    help='Update only the floor plans')
args = parser.parse_args()
ASSETS = ROOT / 'assets'
ASSETS.mkdir(exist_ok=True)


def load_image(source, filename):
    if source.is_dir():
        return Image.open(source / filename)
    with ZipFile(source) as archive:
        for info in archive.infolist():
            name = info.filename
            if not info.flag_bits & 0x800:
                try:
                    name = name.encode('cp437').decode('utf-8')
                except (UnicodeError, LookupError):
                    pass
            if Path(name).name == filename:
                return Image.open(BytesIO(archive.read(info)))
    raise FileNotFoundError(f'{filename} not found in {source}')


if not args.skip_panoramas:
    for point in range(1, 38):
        with load_image(args.source, f'{point}.jpg') as image:
            if image.size != (8192, 4096):
                raise ValueError(f'Unexpected panorama dimensions: {point}: {image.size}')
            image.resize((4096, 2048), Image.Resampling.LANCZOS).save(
                ASSETS / f'{point}.jpg', quality=90, optimize=True)
    print('Prepared 37 browser panoramas.')

# Read the same dimensions and crop used by the interactive plan viewer.
data = json.loads(subprocess.check_output([
    'node', '-e',
    "global.window = {}; require('./tour.js'); console.log(JSON.stringify(window.TOUR_DATA));"
], cwd=ROOT, text=True))
for floor in data['floors']:
    number = floor['id']
    with load_image(args.plans, f'Манжерок план {number} го этажа.jpg') as original:
        if original.size != (floor['width'], floor['height']):
            raise ValueError(f'Unexpected plan dimensions: {number}: {original.size}')
        # Preserve the architect's original labels and drawing without repainting.
        image = original.convert('RGB')
        image.save(ASSETS / f'plan-{number}.png', optimize=True)
        image.crop(tuple(data['planCrop'])).save(
            ASSETS / f'plan-{number}-detail.png', optimize=True)
print('Prepared four floor-plan images with the original numbered labels.')
