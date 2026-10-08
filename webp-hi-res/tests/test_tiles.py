"""Validate the published WebP pyramids and the source cube projection."""
import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_tiles', ROOT / 'tools/prepare-tiles.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class TileTests(unittest.TestCase):
    def test_projection_matches_marzipano(self):
        width, height, size = 1024, 512, 64
        panorama = Image.new('RGB', (width, height))
        pixels = panorama.load()
        for y in range(height):
            pitch = math.pi * ((y + 0.5) / height - 0.5)
            for x in range(width):
                yaw = 2 * math.pi * ((x + 0.5) / width - 0.5)
                direction = (math.sin(yaw) * math.cos(pitch), -math.sin(pitch),
                             -math.cos(yaw) * math.cos(pitch))
                pixels[x, y] = tuple(round(127.5 * (value + 1)) for value in direction)
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'source.png', Path(directory) / 'cube.rgb'
            panorama.save(source)
            prepare.project(source, output, size)
            cube = Image.frombytes('RGB', (size * 6, size), output.read_bytes())
        rotations = {'f': (0, 0), 'b': (0, math.pi), 'l': (0, math.pi / 2),
                     'r': (0, -math.pi / 2), 'u': (math.pi / 2, 0), 'd': (-math.pi / 2, 0)}
        for index, face in enumerate(prepare.FACES):
            rx, ry = rotations[face]
            for x, y in [(32, 32), (8, 8), (55, 8), (8, 55), (55, 55)]:
                vx, vy, vz = 2 * (x + 0.5) / size - 1, 1 - 2 * (y + 0.5) / size, -1
                vy, vz = vy * math.cos(rx) - vz * math.sin(rx), vy * math.sin(rx) + vz * math.cos(rx)
                vx, vz = vx * math.cos(ry) + vz * math.sin(ry), -vx * math.sin(ry) + vz * math.cos(ry)
                norm = math.sqrt(vx * vx + vy * vy + vz * vz)
                expected = tuple(round(127.5 * (v / norm + 1)) for v in (vx, vy, vz))
                actual = cube.getpixel((index * size + x, y))
                self.assertLessEqual(max(abs(a - b) for a, b in zip(actual, expected)), 3,
                                     f'Face {face}, pixel {x},{y}: {actual} != {expected}')

    def test_complete_pyramids(self):
        total = 0
        for point in range(1, 38):
            folder = ROOT / 'tiles' / str(point)
            metadata = json.loads((folder / 'manifest.json').read_text())
            self.assertEqual(len(metadata['source_panorama_sha256']), 64)
            self.assertEqual(metadata['source_size'], [8192, 4096])
            self.assertEqual(metadata['levels'], list(prepare.SIZES))
            self.assertEqual(metadata['quality'], 95)
            self.assertEqual(metadata['method'], 6)
            self.assertFalse(metadata['lossless'])
            self.assertEqual(len(list(folder.rglob('*.webp'))), 510)
            point_bytes = 0
            for level, size in enumerate(prepare.SIZES):
                for face in prepare.FACES:
                    for y in range(size // 512):
                        for x in range(size // 512):
                            webp = folder / str(level) / face / str(y) / f'{x}.webp'
                            point_bytes += webp.stat().st_size
                            with Image.open(webp) as tile:
                                self.assertEqual(tile.format, 'WEBP')
                                self.assertEqual(tile.size, (512, 512))
                                tile.load()
            self.assertEqual(metadata['output_tile_bytes'], point_bytes)
            total += point_bytes
        # Leave ample space for the main tour below the GitHub Pages site limit.
        self.assertLess(total, 900_000_000)
        print(f'Published WebP image bytes: {total}')


if __name__ == '__main__':
    unittest.main()
