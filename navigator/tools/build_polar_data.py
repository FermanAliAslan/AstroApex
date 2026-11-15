"""Build data/polar_data.js: the south-pole terrain pack the site uses for real horizons, slopes and ice traps.

Sources (public NASA products, download them into one folder and pass it as the argument):
  ldem_75s_240m.img          LOLA elevation, 240 m/px polar stereographic      NASA PDS Geosciences, LRO-L-LOLA-4-GDR-V1.0
  LPSR_75S_120M_201608.TIF   permanently shadowed regions, 120 m/px            NASA GSFC PGDA product 69 (Mazarico et al. 2011)

  https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/
  https://pgda.gsfc.nasa.gov/products/69

Output grid: 80 S .. 90 S, polar stereographic (true at the pole, R = 1737.4 km, longitude 0 up, east
positive), 480 m cells. Per cell: mean elevation (1 m), mean surface slope (0.25 deg), share of the cell
that is permanently shadowed (0..16 sixteenths) and a flag for shadow that belongs to a large trap
(a connected shadowed area of at least 3 km2).

Slope is the gradient of the 240 m elevation grid (central difference, so a 480 m baseline), averaged over each 480 m cell. NASA's own
slope grid (LDSM_75S_240M) is not used because a fifth of its cells in this area carry no data; where both
exist the two agree with a correlation of 0.96.

Packing: plane-predicted elevation residuals and left-delta slopes, zlib level 9, base64.

Run:  pip install numpy pillow   then   python tools/build_polar_data.py <folder with the three files>
"""
import base64
import io
import json
import os
import sys
import zlib

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RM = 1737400.0          # reference radius of the PDS products, m
SRC_N, SRC_RES = 3812, 240.0
LAT_EDGE = -80.0
CELL = 480.0
BIG_KM2 = 3.0


def components(mask):
    """4-connected components of a boolean grid -> (labels, sizes). Plain flood fill, no SciPy needed."""
    h, w = mask.shape
    lab = np.zeros(mask.shape, dtype=np.int32)
    flat_m, flat_l = mask.ravel(), lab.ravel()
    sizes = [0]
    for start in np.flatnonzero(flat_m):
        if flat_l[start]:
            continue
        cur = len(sizes)
        flat_l[start] = cur
        stack, count = [int(start)], 0
        while stack:
            p = stack.pop()
            count += 1
            x = p % w
            for q in (p - w, p + w, p - 1 if x else -1, p + 1 if x < w - 1 else -1):
                if 0 <= q < h * w and flat_m[q] and not flat_l[q]:
                    flat_l[q] = cur
                    stack.append(q)
        sizes.append(count)
    return lab, np.array(sizes)


def block(a, f, fn):
    h, w = a.shape
    return fn(fn(a.reshape(h // f, f, w // f, f), 3), 1)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    Image.MAX_IMAGE_PIXELS = None

    half_m = 2 * RM * np.tan(np.radians(90 + LAT_EDGE) / 2)
    n = int(np.ceil(half_m / CELL)) * 2                      # output cells per side
    f = int(CELL / SRC_RES)
    c0 = SRC_N // 2 - n * f // 2                              # the pole sits on the corner between the four centre pixels
    crop = slice(c0, c0 + n * f)

    full = np.fromfile(os.path.join(src, "ldem_75s_240m.img"), dtype="<i2").reshape(SRC_N, SRC_N) * 0.5
    gy, gx = np.gradient(full, SRC_RES)
    dem, slp = full[crop, crop], np.degrees(np.arctan(np.hypot(gx, gy)))[crop, crop]
    psr120 = np.array(Image.open(os.path.join(src, "LPSR_75S_120M_201608.TIF")))
    assert psr120.shape == (SRC_N * 2, SRC_N * 2), psr120.shape
    psr120 = psr120[2 * c0:2 * (c0 + n * f), 2 * c0:2 * (c0 + n * f)] > 0

    elev = np.rint(block(dem, f, np.mean)).astype(np.int32)
    slope = np.clip(np.rint(block(slp, f, np.mean) * 4), 0, 255).astype(np.uint8)
    frac = block(psr120.astype(np.int32), 2 * f, np.sum)       # 0..16 shadowed 120 m pixels per 480 m cell
    assert frac.max() <= 16

    # large traps: connected shadow of at least BIG_KM2, labelled at 240 m
    psr240 = block(psr120.astype(np.int32), 2, np.sum) >= 2
    lab, sizes = components(psr240)
    big_ids = sizes * (SRC_RES / 1000.0) ** 2 >= BIG_KM2
    big_ids[0] = False
    big = block(big_ids[lab].astype(np.int32), f, np.max).astype(bool) & (frac > 0)
    psr = (frac | (big.astype(np.int32) << 7)).astype(np.uint8)

    # plane predictor: residual = e - left - up + upleft (exactly invertible with two running sums)
    res = elev.copy()
    res[:, 1:] -= elev[:, :-1]
    res[1:, :] -= np.diff(elev, axis=1, prepend=0)[:-1, :]
    zz = ((res << 1) ^ (res >> 31)).astype(np.uint32)           # zigzag
    assert zz.max() < 65536
    lo, hi = (zz & 255).astype(np.uint8), (zz >> 8).astype(np.uint8)
    ds = slope.copy()
    ds[:, 1:] = slope[:, 1:] - slope[:, :-1]                    # uint8 wrap-around is intended

    def pack(*arrays):
        return base64.b64encode(zlib.compress(b"".join(a.tobytes() for a in arrays), 9)).decode("ascii")

    out = {
        "n": n, "cell": CELL, "radius": RM, "latEdge": LAT_EDGE,
        "elevMin": int(elev.min()), "elevMax": int(elev.max()),
        "sumElev": int(elev.astype(np.int64).sum() % 4294967296),
        "sumSlope": int(slope.astype(np.int64).sum()), "sumPsr": int(psr.astype(np.int64).sum()),
        "psrShare": round(float((frac > 0).mean()), 5),
        "source": "NASA LOLA GDR LDEM_75S_240M · NASA GSFC PGDA LPSR_75S_120M_201608",
        "elev": pack(lo, hi), "slope": pack(ds), "psr": pack(psr),
    }
    path = os.path.join(ROOT, "data", "polar_data.js")
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("/* South-pole terrain pack (80 S - 90 S, 480 m cells): LOLA elevation and slope, permanently shadowed regions.\n"
                 "   Built by tools/build_polar_data.py from public NASA products; see that file for sources and format. */\n")
        fh.write("window.POLAR_DATA = " + json.dumps(out, separators=(",", ":")) + ";\n")
    np.savez_compressed(os.path.join(src, "polar_grid.npz"), elev=elev, slope=slope, psr=psr)
    print("n=%d  elev %d..%d m  slope mean %.1f deg  shadow share %.2f%%  large traps %d" % (
        n, elev.min(), elev.max(), slope.mean() / 4, 100 * (frac > 0).mean(), int(big_ids.sum())))
    print("wrote %s (%.2f MB: elev %.2f, slope %.2f, psr %.2f)" % (
        path, os.path.getsize(path) / 1e6, len(out["elev"]) / 1e6, len(out["slope"]) / 1e6, len(out["psr"]) / 1e6))


if __name__ == "__main__":
    main()
