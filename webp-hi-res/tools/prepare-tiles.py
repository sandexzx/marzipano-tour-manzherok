#!/usr/bin/env python3
"""Build multiresolution Marzipano cube tiles directly from original panoramas."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from PIL import Image, features

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'webp-hi-res' / 'tiles'
FACES = 'frblud'
SIZES = (512, 1024, 2048, 4096)
TILE_SIZE = 512
QUALITY = 95
# Oversampling cube centers avoids throwing away the original angular detail.
# FFmpeg's default cube rotations match Marzipano, including the pole faces.

def project(source, destination, face_size=4096):
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
        '-threads', '2', '-i', str(source), '-filter_threads', '4',
        '-vf', f'format=rgb24,v360=input=e:output=c6x1:out_forder={FACES}:'
               f'out_frot=000000:interp=lanczos:w={face_size * 6}:h={face_size}',
        '-frames:v', '1', '-threads', '2', '-pix_fmt', 'rgb24',
        '-f', 'rawvideo', str(destination)
    ], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path,
                        default=ROOT / 'archive/final-0710/0710 рендер.zip',
                        help='Original ZIP or directory containing 1.jpg through 37.jpg')
    parser.add_argument('--points', nargs='+', type=int, default=list(range(1, 38)))
    parser.add_argument('--force', action='store_true', help='Rebuild completed points')
    args = parser.parse_args()
    if any(point < 1 or point > 37 for point in args.points):
        parser.error('Points must be between 1 and 37')
    if not features.check('webp'):
        parser.error('Pillow requires WebP support')
    if not shutil.which('ffmpeg'):
        parser.error('FFmpeg with the v360 filter is required')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archive = None if args.source.is_dir() else ZipFile(args.source)
    try:
        for point in args.points:
            filename = f'{point}.jpg'
            if archive:
                matches = [n for n in archive.namelist() if Path(n).name == filename]
                if len(matches) != 1:
                    raise ValueError(f'Expected one original {filename}, found {len(matches)}')
                original = archive.read(matches[0])
            else:
                original = (args.source / filename).read_bytes()
            with Image.open(BytesIO(original)) as image:
                if image.size != (8192, 4096):
                    raise ValueError(f'Unexpected source dimensions: {filename}: {image.size}')
            metadata = {
                'source_panorama_sha256': hashlib.sha256(original).hexdigest(),
                'source_size': [8192, 4096], 'face_order': FACES,
                'levels': list(SIZES), 'tile_size': TILE_SIZE,
                'format': 'webp', 'quality': QUALITY, 'method': 6,
                'lossless': False, 'source_format': 'jpeg', 'tile_count': 510
            }
            target = OUTPUT / str(point)
            manifest = target / 'manifest.json'
            if not args.force and manifest.exists():
                existing = json.loads(manifest.read_text())
                if all(existing.get(key) == value for key, value in metadata.items()) and len(list(target.rglob('*.webp'))) == 510:
                    print(f'Skipped completed point {point}', flush=True)
                    continue
            print(f'Preparing point {point} from original 8192x4096...', flush=True)
            # Build off to the side; failed conversions never publish partial tiles.
            with tempfile.TemporaryDirectory(prefix=f'.point-{point}-', dir=OUTPUT) as temp:
                temp = Path(temp)
                source = temp / 'source.jpg'
                raw = temp / 'cube.rgb'
                source.write_bytes(original)
                project(source, raw)
                strip = Image.frombytes('RGB', (4096 * 6, 4096), raw.read_bytes())
                staged = temp / 'tiles'
                jpeg_bytes = 0
                for index, face in enumerate(FACES):
                    with strip.crop((index * 4096, 0, (index + 1) * 4096, 4096)) as full:
                        for level, size in enumerate(SIZES):
                            image = full if size == 4096 else full.resize((size, size), Image.Resampling.LANCZOS)
                            try:
                                for y in range(size // TILE_SIZE):
                                    row = staged / str(level) / face / str(y)
                                    row.mkdir(parents=True, exist_ok=True)
                                    for x in range(size // TILE_SIZE):
                                        with image.crop((x * TILE_SIZE, y * TILE_SIZE,
                                                         (x + 1) * TILE_SIZE, (y + 1) * TILE_SIZE)) as tile:
                                            # Reproduce the approved JPEG-to-WebP result in memory.
                                            # No intermediate JPEG pyramid is stored on disk.
                                            encoded = BytesIO()
                                            tile.save(encoded, format='JPEG', quality=QUALITY,
                                                      subsampling=0, optimize=True)
                                            jpeg_bytes += encoded.tell()
                                            encoded.seek(0)
                                            with Image.open(encoded) as decoded:
                                                decoded.save(row / f'{x}.webp', format='WEBP',
                                                             quality=QUALITY, method=6, lossless=False)
                            finally:
                                if image is not full:
                                    image.close()
                strip.close()
                metadata['source_tile_bytes'] = jpeg_bytes
                metadata['output_tile_bytes'] = sum(p.stat().st_size for p in staged.rglob('*.webp'))
                metadata['projection'] = 'ffmpeg-v360-lanczos-rgb24'
                metadata['intermediate_jpeg_quality'] = QUALITY
                metadata['intermediate_jpeg_subsampling'] = 0
                (staged / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
                if target.exists():
                    # Only this separate variant's generated point is replaced.
                    shutil.rmtree(target)
                staged.rename(target)
            print(f'Prepared point {point}: 510 tiles', flush=True)
    finally:
        if archive:
            archive.close()


if __name__ == '__main__':
    main()
