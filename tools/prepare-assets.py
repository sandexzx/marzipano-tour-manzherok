#!/usr/bin/env python3
"""Prepare the October 7 renders and relabel the available legacy plans."""
from pathlib import Path
import argparse
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=ROOT / 'archive/final-0710/0710 рендер')
parser.add_argument('--plans', type=Path, default=ROOT / 'archive/legacy/1-39')
args = parser.parse_args()
ASSETS = ROOT / 'assets'
ASSETS.mkdir(exist_ok=True)

for point in range(1, 38):
    with Image.open(args.source / f'{point}.jpg') as image:
        if image.size != (8192, 4096):
            raise ValueError(f'Unexpected panorama dimensions: {point}: {image.size}')
        image.resize((4096, 2048), Image.Resampling.LANCZOS).save(
            ASSETS / f'{point}.jpg', quality=90, optimize=True)

# Legacy label centers and their new numbers; no final plans were in the ZIP.
labels = {
    1: [(389,930,1), (531,926,2), (682,926,5), (624,643,7),
        (624,453,9), (421,1074,3), (543,1077,4), (683,1076,6),
        (647,270,11), (786,624,8), (815,318,10), (965,1065,14),
        (851,1094,15), (950,966,13)],
    2: [(428,640,19), (536,485,20), (509,260,21), (511,890,28),
        (581,737,30), (418,733,31), (686,1034,26), (441,1031,27),
        (890,1033,24), (935,740,22), (931,921,23), (709,910,25),
        (702,622,29), (702,512,33), (769,387,35), (947,586,34),
        (727,230,36), (950,389,37), (803,670,32)]
}
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
for floor in (1, 2):
    source = next(args.plans.glob(f'*{floor} го*'))
    with Image.open(source) as original:
        image = original.convert('RGB')
        draw = ImageDraw.Draw(image)
        for x, y, point in labels[floor]:
            # Cover the previous red number plates before relabeling.
            if floor == 1 and point == 11:
                box = (629, 235, 665, 309)
            elif floor == 1 and point == 13:
                box = (916, 942, 985, 986)
            else:
                box = (x - 32, y - 21, x + 32, y + 21)
            draw.rectangle(box, fill='white')
        points = re.findall(r"\[(\d+), '[^']+', (\d+), (\d+), \[\[", (ROOT / 'tour.js').read_text())
        for point, x, y in points:
            point, x, y = int(point), int(x), int(y)
            if (1 if point <= 18 else 2) != floor:
                continue
            draw.rectangle((x-29, y-19, x+29, y+19), fill=(255,0,0))
            draw.text((x,y), str(point), font=font, fill='white', anchor='mm')
        image.save(ASSETS / f'plan-{floor}.png')
        image.crop((300,180,1050,1200)).save(ASSETS / f'plan-{floor}-detail.png')
print('Prepared 37 browser panoramas and four relabeled legacy plan images.')
