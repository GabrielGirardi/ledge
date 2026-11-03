"""Generates the fixtures for README screenshots: a wallpaper, album art and a
calendar with events around the current time. No third-party images or real
user data end up in the docs."""

import datetime
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
rng = random.Random(7)


def glow_field(size, blobs, base, blur):
    w, h = size
    img = Image.new("RGB", size, base)
    layer = Image.new("RGB", size, (0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for (cx, cy, r, color) in blobs:
        draw.ellipse([cx * w - r * w, cy * h - r * w, cx * w + r * w, cy * h + r * w], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.blend(img, layer, 0.85)


def add_grain(img, amount=6):
    noise = Image.effect_noise(img.size, amount).convert("RGB")
    return Image.blend(img, noise, 0.04)


wallpaper = glow_field((2560, 1600), [
    (0.18, 0.25, 0.30, (88, 52, 190)),
    (0.80, 0.20, 0.26, (24, 120, 200)),
    (0.62, 0.78, 0.34, (190, 60, 140)),
    (0.10, 0.92, 0.22, (30, 160, 150)),
    (0.95, 0.70, 0.18, (240, 140, 70)),
], (12, 10, 28), 260)
add_grain(wallpaper).save(out / "wallpaper.png")

cover = glow_field((512, 512), [
    (0.25, 0.30, 0.45, (255, 90, 120)),
    (0.80, 0.75, 0.45, (90, 70, 255)),
    (0.70, 0.15, 0.25, (255, 190, 80)),
], (20, 10, 40), 70)
d = ImageDraw.Draw(cover)
for i in range(9):
    y = 300 + i * 18
    amp = 30 * math.sin(i / 2.0)
    d.line([(60, y + amp), (452, y - amp)], fill=(255, 255, 255), width=2)
cover.save(out / "cover.png")

now = datetime.datetime.now().replace(second=0, microsecond=0)
start = now.replace(minute=(now.minute // 15) * 15)
events = [
    ("Focus time", start - datetime.timedelta(minutes=30), start + datetime.timedelta(minutes=45)),
    ("Design review: widgets", start + datetime.timedelta(minutes=75), start + datetime.timedelta(minutes=105)),
    ("Call with Sam", start + datetime.timedelta(minutes=135), start + datetime.timedelta(minutes=150)),
]
fmt = "%Y%m%dT%H%M%S"
lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ledge//screenshots//EN"]
for i, (summary, a, b) in enumerate(events):
    lines += ["BEGIN:VEVENT", f"UID:ledge-demo-{i}@example.invalid",
              f"DTSTAMP:{now.strftime(fmt)}", f"DTSTART:{a.strftime(fmt)}",
              f"DTEND:{b.strftime(fmt)}", f"SUMMARY:{summary}", "END:VEVENT"]
lines.append("END:VCALENDAR")
(out / "calendar.ics").write_text("\r\n".join(lines) + "\r\n")
print(out)
