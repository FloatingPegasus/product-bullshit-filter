#!/usr/bin/env python3
"""Draw the extension icon: three narrowing bars and a drop, amber on a dark tile."""

import struct
import zlib
from pathlib import Path

AMBER = (230, 177, 90, 255)
INK = (18, 17, 14, 255)


def in_round_rect(x, y, size, radius):
    if radius <= x < size - radius and radius <= y < size - radius:
        return True
    if x < radius and y < radius:
        return (x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2
    if x >= size - radius and y < radius:
        return (x - (size - radius - 1)) ** 2 + (y - radius) ** 2 <= radius ** 2
    if x < radius and y >= size - radius:
        return (x - radius) ** 2 + (y - (size - radius - 1)) ** 2 <= radius ** 2
    if x >= size - radius and y >= size - radius:
        return (x - (size - radius - 1)) ** 2 + (y - (size - radius - 1)) ** 2 <= radius ** 2
    return 0 <= x < size and 0 <= y < size


def pixel(size, x, y):
    radius = max(2, round(size * 0.22))
    if not in_round_rect(x, y, size, radius):
        return (0, 0, 0, 0)
    nx = (x + 0.5) / size
    ny = (y + 0.5) / size
    bars = (
        (0.18, 0.30, 0.16, 0.84),
        (0.34, 0.46, 0.28, 0.72),
        (0.50, 0.62, 0.40, 0.60),
    )
    for top, bottom, left, right in bars:
        if top <= ny < bottom and left <= nx <= right:
            return AMBER
    if 0.66 <= ny < 0.78 and 0.46 <= nx <= 0.54:
        return AMBER
    cx, cy, r = 0.50, 0.86, 0.055
    if (nx - cx) ** 2 + (ny - cy) ** 2 <= r ** 2:
        return AMBER
    return INK


def png(size, path):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(pixel(size, x, y))
        rows.append(row)
    raw = b"".join(rows)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(data)


def main():
    out = Path(__file__).resolve().parents[1] / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        png(size, out / f"{size}.png")


if __name__ == "__main__":
    main()
