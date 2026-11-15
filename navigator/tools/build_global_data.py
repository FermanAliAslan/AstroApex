"""Build data/global_data.js: a whole-Moon slope map and a north-pole pack, so the map layers cover the globe.

Sources (public NASA products, download them into one folder and pass it as the argument):
  ldem_16.img                LOLA global elevation, 16 px/deg, simple cylindrical   NASA PDS Geosciences, LRO-L-LOLA-4-GDR-V1.0
  ldem_75n_240m.img          LOLA elevation, 240 m/px north polar stereographic    NASA PDS Geosciences, LRO-L-LOLA-4-GDR-V1.0
  LPSR_75N_120M_201608.TIF   permanently shadowed regions, 120 m/px, north         NASA GSFC PGDA product 69 (Mazarico et al. 2011)

  https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/
  https://pgda.gsfc.nasa.gov/products/69

Output:
  slope   whole Moon, 4 px/deg (1440 x 720 cells, about 7.6 km at the equator), quarter degrees per byte.
          Row 0 is the north edge, column 0 starts at longitude 0 and runs east. The slope is the gradient of
          the 16 px/deg grid (a 3.8 km baseline at the equator) averaged over 4 x 4 pixels, so it shows crater
          walls and mountain fronts, not landing-scale roughness.
  north   80 N .. 90 N, polar stereographic (true at the pole, longitude 0 DOWN, east positive), 960 m cells:
          mean elevation (1 m), mean slope from the 240 m grid (quarter degrees), shadowed sixteenths of each
          cell in the low 5 bits and 128 for a trap of 3 km2 or more.

Run:  pip install numpy pillow   then   python tools/build_global_data.py <folder with the three files>
"""
import base64
import io
import json
import os
import sys
import zlib

import numpy as np
from PIL import Image

from build_polar_data import block, components

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RM = 1737400.0
SRC_N, SRC_RES = 3812, 240.0
CELL = 960.0
LAT_EDGE = 80.0
BIG_KM2 = 3.0


def pack(*arrays):
    return base64.b64encode(zlib.compress(b"".join(a.tobytes() for a in arrays), 9)).decode("ascii")


def global_slope(src):
    dem = np.fromfile(os.path.join(src, "ldem_16.img"), dtype="<i2").reshape(2880, 5760) * 0.5
    lat = np.radians(90 - (np.arange(2880) + 0.5) / 16)
    step = np.radians(1 / 16) * RM                                   # metres per pixel along a meridian
    gy = np.gradient(dem, step, axis=0)
    wrapped = np.concatenate([dem[:, -1:], dem, dem[:, :1]], axis=1)  # longitude wraps
    gx = (wrapped[:, 2:] - wrapped[:, :-2]) / (2 * step * np.maximum(np.cos(lat), 0.02)[:, None])
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    return dem, np.clip(np.rint(block(slope, 4, np.mean) * 4), 0, 255).astype(np.uint8)


def north_pack(src, dem16):
    half_m = 2 * RM * np.tan(np.radians(90 - LAT_EDGE) / 2)
    n = int(np.ceil(half_m / CELL)) * 2
    f = int(CELL / SRC_RES)
    c0 = SRC_N // 2 - n * f // 2
    crop = slice(c0, c0 + n * f)
    full = np.fromfile(os.path.join(src, "ldem_75n_240m.img"), dtype="<i2").reshape(SRC_N, SRC_N) * 0.5
    gy, gx = np.gradient(full, SRC_RES)
    slp = np.degrees(np.arctan(np.hypot(gx, gy)))[crop, crop]
    psr120 = np.array(Image.open(os.path.join(src, "LPSR_75N_120M_201608.TIF")))
    assert psr120.shape == (SRC_N * 2, SRC_N * 2), psr120.shape
    psr120 = psr120[2 * c0:2 * (c0 + n * f), 2 * c0:2 * (c0 + n * f)] > 0

    elev = np.rint(block(full[crop, crop], f, np.mean)).astype(np.int32)
    slope = np.clip(np.rint(block(slp, f, np.mean) * 4), 0, 255).astype(np.uint8)
    cells120 = (2 * f) ** 2
    frac = np.rint(block(psr120.astype(np.int32), 2 * f, np.sum) * 16.0 / cells120).astype(np.int32)   # sixteenths
    psr240 = block(psr120.astype(np.int32), 2, np.sum) >= 2
    lab, sizes = components(psr240)
    big_ids = sizes * (SRC_RES / 1000.0) ** 2 >= BIG_KM2
    big_ids[0] = False
    big = block(big_ids[lab].astype(np.int32), f, np.max).astype(bool) & (frac > 0)
    psr = (frac | (big.astype(np.int32) << 7)).astype(np.uint8)

    # orientation check against the global grid: longitude 0 must point DOWN in the north polar product
    worst = 0.0
    for lat_d, lon_d in [(84, 0), (84, 90), (84, 180), (84, 270), (87, 45), (82, 300)]:
        r = 2 * RM * np.tan(np.radians(90 - lat_d) / 2)
        x, y = r * np.sin(np.radians(lon_d)), -r * np.cos(np.radians(lon_d))
        i, j = int(np.floor(x / CELL + n / 2)), int(np.floor(n / 2 - y / CELL))
        g = dem16[int((90 - lat_d) * 16), int((lon_d % 360) * 16)]
        worst = max(worst, abs(float(elev[j, i]) - float(g)))
        print("  check %dN %3dE  polar %6.0f m  global %6.0f m" % (lat_d, lon_d, elev[j, i], g))
    assert worst < 400, "north grid orientation does not match the global grid (worst %.0f m)" % worst

    res = elev.copy()
    res[:, 1:] -= elev[:, :-1]
    res[1:, :] -= np.diff(elev, axis=1, prepend=0)[:-1, :]
    zz = ((res << 1) ^ (res >> 31)).astype(np.uint32)
    assert zz.max() < 65536
    ds = slope.copy()
    ds[:, 1:] = slope[:, 1:] - slope[:, :-1]
    return {
        "n": n, "cell": CELL, "radius": RM, "latEdge": LAT_EDGE,
        "sumElev": int(elev.astype(np.int64).sum() % 4294967296), "sumSlope": int(slope.astype(np.int64).sum()),
        "sumPsr": int(psr.astype(np.int64).sum()),
        "elev": pack((zz & 255).astype(np.uint8), (zz >> 8).astype(np.uint8)), "slope": pack(ds), "psr": pack(psr),
    }, int(big_ids.sum()), float((frac > 0).mean())


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    Image.MAX_IMAGE_PIXELS = None
    dem16, slope = global_slope(src)
    north, traps, share = north_pack(src, dem16)
    out = {
        "source": "NASA LOLA GDR LDEM_16 and LDEM_75N_240M · NASA GSFC PGDA LPSR_75N_120M_201608",
        "slope": {"w": 1440, "h": 720, "ppd": 4, "sum": int(slope.astype(np.int64).sum()), "data": pack(slope)},
        "north": north,
    }
    path = os.path.join(ROOT, "data", "global_data.js")
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("/* Whole-Moon slope map (4 px/deg) and north-pole pack (80 N - 90 N, 960 m cells): LOLA elevation and slope,\n"
                 "   permanently shadowed regions. Built by tools/build_global_data.py from public NASA products. */\n")
        fh.write("window.GLOBAL_DATA = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print("global slope: median %.1f deg, 95%% %.1f deg" % (np.median(slope) / 4, np.percentile(slope, 95) / 4))
    print("north: n=%d, shadow share %.2f%%, large traps %d" % (north["n"], 100 * share, traps))
    print("wrote %s (%.2f MB)" % (path, os.path.getsize(path) / 1e6))


if __name__ == "__main__":
    main()
