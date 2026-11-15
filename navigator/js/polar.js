/* South-pole terrain engine: real horizons, slopes and permanently shadowed regions from NASA LOLA data.

   data/polar_data.js carries a 480 m grid of the area south of 80 S (see tools/build_polar_data.py):
   elevation and slope from the LOLA 240 m polar DEM, and the NASA GSFC map of permanently shadowed
   regions (PSRs). This module unpacks it in the browser and answers four questions about any point:
     - what does the skyline look like from here?      Polar.skyline(lat, lon)
     - how steep is the ground around here?            Polar.slopeStats(lat, lon)
     - is this spot in permanent shadow?               Polar.psr(lat, lon)
     - where is the nearest large ice trap?            Polar.nearestTrap(lat, lon)

   Grid geometry: polar stereographic, true at the pole, longitude 0 up and east positive:
     x = r sin(lon), y = r cos(lon), r = 2 R tan((90 + lat) / 2); cell (i, j) covers
     x = (i - n/2) * cell .. , y = (n/2 - j) * cell .. (row 0 is the top).

   Without the data file, or in a browser with no DecompressionStream, Polar.ready stays false and the
   rest of the site keeps working with the fixed-angle horizon it had before. */
(function () {
  'use strict';
  const D = Math.PI / 180;
  const SAFE_SLOPE = 8;     // deg: the usual limit for a crewed lander footprint
  const COVER_LAT = -82;    // skylines are offered up to here, so that at least 60 km of terrain surrounds the observer
  const GRID_LAT = -80.2;   // slope and shadow lookups are valid up to here
  const OBSERVER_M = 2;     // eye / antenna height above the surface, same as the precomputed skylines
  const MAX_RANGE = 250000; // m: terrain farther than this cannot rise above the horizon of a 2 m observer

  /* IAU-named craters that hold the large south-pole shadows (centre, diameter in km), used only to name a trap. */
  const CRATERS = [
    ['Shackleton', -89.67, 129.78, 21], ['Haworth', -87.45, -5.17, 51], ['Shoemaker', -88.1, 44.9, 52],
    ['Faustini', -87.18, 84.31, 42], ['de Gerlache', -88.5, -87.1, 32], ['Sverdrup', -88.5, -152.0, 33],
    ['Cabeus', -85.33, -42.13, 100], ['Nobile', -85.28, 53.27, 79], ['Slater', -88.08, 111.29, 25],
    ['Amundsen', -84.5, 82.8, 103], ['Wiechert', -84.01, 163.34, 41], ['Kocher', -84.47, -134.02, 24],
    ['Malapert', -84.9, 12.9, 69], ['Scott', -81.9, 45.3, 103], ['Ibn Bajja', -86.3, -75.04, 12]
  ];

  const P = {
    ready: false, failed: false, pending: false, n: 0, cell: 0, R: 1737400, source: '',
    SAFE_SLOPE, COVER_LAT, GRID_LAT, CRATERS
  };
  let n = 0, cell = 0, half = 0, R = 1737400, elev = null, slope = null, psr = null, near = null;
  const waiting = [];

  /* ---------- geometry ---------- */
  function toXY(lat, lon) {
    const r = 2 * R * Math.tan((90 + lat) * D / 2);
    return [r * Math.sin(lon * D), r * Math.cos(lon * D)];
  }
  function toLL(x, y) {
    const r = Math.hypot(x, y);
    return [-90 + 2 * Math.atan(r / (2 * R)) / D, r ? Math.atan2(x, y) / D : 0];
  }
  const cellOf = (x, y) => { // integer cell index, or -1 outside the grid
    const i = Math.floor(x / cell + half), j = Math.floor(half - y / cell);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  // bilinear elevation (m) at map position; NaN outside the grid
  function elevXY(x, y) {
    const fx = x / cell + half - 0.5, fy = half - y / cell - 0.5;
    let i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) {
      if (fx < -0.5 || fy < -0.5 || fx > n - 0.5 || fy > n - 0.5) return NaN;
      i = Math.max(0, Math.min(n - 2, i)); j = Math.max(0, Math.min(n - 2, j));
    }
    const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fy - j)), o = j * n + i;
    return (elev[o] * (1 - u) + elev[o + 1] * u) * (1 - v) + (elev[o + n] * (1 - u) + elev[o + n + 1] * u) * v;
  }
  const inGrid = (lat, lon) => P.ready && lat <= GRID_LAT && cellOf(...toXY(lat, lon)) >= 0;
  const covered = (lat, lon) => P.ready && lat <= COVER_LAT;

  /* ---------- skyline ---------- */
  // Horizon elevation (deg) for nAz azimuths, north = 0, east = 90, for an observer OBSERVER_M above the surface.
  // Each ray walks outward over the grid; the angle to every terrain sample includes the curvature of the Moon.
  function skyline(lat, lon, nAz) {
    nAz = nAz || 360;
    const out = new Float32Array(nAz);
    if (!covered(lat, lon)) return null;
    const [x0, y0] = toXY(lat, lon), h0 = elevXY(x0, y0);
    if (isNaN(h0)) return null;
    const r0 = R + h0 + OBSERVER_M, l = lon * D;
    const k = 1 / Math.pow(Math.cos((90 + lat) * D / 2), 2);      // map metres per ground metre at the observer
    const nx = Math.sin(l), ny = Math.cos(l), ex = Math.cos(l), ey = -Math.sin(l); // north and east in map axes
    const step0 = cell * 0.6;
    for (let a = 0; a < nAz; a++) {
      const az = a * 2 * Math.PI / nAz, dx = (nx * Math.cos(az) + ex * Math.sin(az)) * k, dy = (ny * Math.cos(az) + ey * Math.sin(az)) * k;
      let best = -Infinity;
      for (let d = step0; d < MAX_RANGE; d += Math.max(step0, d * 0.025)) {
        const h = elevXY(x0 + dx * d, y0 + dy * d);
        if (isNaN(h)) break;
        const th = d / R, r1 = R + h, tn = (r1 * Math.cos(th) - r0) / (r1 * Math.sin(th));
        if (tn > best) best = tn;
      }
      out[a] = best === -Infinity ? 0 : Math.atan(best) / D;
    }
    return out;
  }

  /* ---------- slope ---------- */
  const slopeAt = (lat, lon) => { const c = P.ready ? cellOf(...toXY(lat, lon)) : -1; return c < 0 ? null : slope[c] / 4; };
  // Slope inside a circle (default 1 km radius, about a landing footprint): mean, worst cell, share of ground under 8 deg.
  function slopeStats(lat, lon, radiusKm) {
    if (!inGrid(lat, lon)) return null;
    const [x0, y0] = toXY(lat, lon), rad = (radiusKm || 1) * 1000, m = Math.ceil(rad / cell);
    const ci = Math.floor(x0 / cell + half), cj = Math.floor(half - y0 / cell);
    let sum = 0, max = 0, safe = 0, cnt = 0;
    for (let j = cj - m; j <= cj + m; j++) for (let i = ci - m; i <= ci + m; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const cx = (i + 0.5 - half) * cell - x0, cy = (half - j - 0.5) * cell - y0;
      if (cx * cx + cy * cy > rad * rad && (i !== ci || j !== cj)) continue;
      const s = slope[j * n + i] / 4;
      sum += s; cnt++; if (s > max) max = s; if (s <= SAFE_SLOPE) safe++;
    }
    return cnt ? { mean: sum / cnt, max, safe: safe / cnt, here: slope[cj * n + ci] / 4, cells: cnt, radiusKm: radiusKm || 1 } : null;
  }

  /* ---------- permanent shadow ---------- */
  // Share (0..1) of the 480 m cell at this point that never sees the Sun.
  const psrAt = (lat, lon) => { const c = P.ready && lat <= GRID_LAT ? cellOf(...toXY(lat, lon)) : -1; return c < 0 ? 0 : (psr[c] & 31) / 16; };
  const cellShadow = c => (psr[c] & 31) / 16;

  // Nearest-trap lookup table: for every cell, the cell of the closest LARGE trap (two-pass vector distance transform).
  function buildNear() {
    const N = n * n, sx = new Int16Array(N).fill(-1), sy = new Int16Array(N).fill(-1);
    for (let c = 0; c < N; c++) if (psr[c] & 128) { sx[c] = c % n; sy[c] = (c / n) | 0; }
    const take = (c, i, j, q) => {
      if (sx[q] < 0) return;
      const d = (sx[q] - i) * (sx[q] - i) + (sy[q] - j) * (sy[q] - j);
      if (sx[c] < 0 || d < (sx[c] - i) * (sx[c] - i) + (sy[c] - j) * (sy[c] - j)) { sx[c] = sx[q]; sy[c] = sy[q]; }
    };
    for (let pass = 0; pass < 2; pass++) { // twice, so that diagonal information settles
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const c = j * n + i;
        if (i) take(c, i, j, c - 1);
        if (j) { take(c, i, j, c - n); if (i) take(c, i, j, c - n - 1); if (i < n - 1) take(c, i, j, c - n + 1); }
      }
      for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
        const c = j * n + i;
        if (i < n - 1) take(c, i, j, c + 1);
        if (j < n - 1) { take(c, i, j, c + n); if (i < n - 1) take(c, i, j, c + n + 1); if (i) take(c, i, j, c + n - 1); }
      }
    }
    near = { sx, sy };
  }
  function craterName(lat, lon) {
    const u = unit(lat, lon); let best = null, bestQ = 1.15;
    for (const [name, la, lo, dia] of CRATERS) {
      const v = unit(la, lo), km = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * R / 1000, q = km / (dia / 2);
      if (q < bestQ) { bestQ = q; best = name; }
    }
    return best;
  }
  const unit = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
  // Closest large trap (connected permanent shadow of 3 km2 or more): distance, position, bearing and crater name.
  function nearestTrap(lat, lon) {
    if (!inGrid(lat, lon)) return null;
    if (!near) buildNear();
    const [x0, y0] = toXY(lat, lon), c = cellOf(x0, y0);
    if (near.sx[c] < 0) return null;
    const tx = (near.sx[c] + 0.5 - half) * cell, ty = (half - near.sy[c] - 0.5) * cell, [tla, tlo] = toLL(tx, ty);
    const inside = !!(psr[c] & 128) && cellShadow(c) >= 0.5;
    const k = 1 / Math.pow(Math.cos((90 + lat) * D / 2), 2), km = inside ? 0 : Math.hypot(tx - x0, ty - y0) / k / 1000;
    const l = lon * D, dn = (tx - x0) * Math.sin(l) + (ty - y0) * Math.cos(l), de = (tx - x0) * Math.cos(l) - (ty - y0) * Math.sin(l);
    let bearing = Math.atan2(de, dn) / D; if (bearing < 0) bearing += 360;
    return { km, lat: tla, lon: tlo, bearing, inside, name: craterName(tla, tlo) };
  }

  /* ---------- rover route to the ice ---------- */
  // A* path over the 480 m grid to a large trap, minimizing the slope-weighted travel cost.
  // Cells steeper than maxSlope are closed; cost grows with slope, so the path prefers gentle ground.
  // If nothing is reachable under maxSlope the search is repeated with relaxSlope and flagged as relaxed.
  function route(lat, lon, opts) {
    if (!inGrid(lat, lon)) return null;
    opts = opts || {};
    const maxKm = opts.maxKm || 60, first = opts.maxSlope || 15, relax = opts.relaxSlope || 25;
    const [x0, y0] = toXY(lat, lon), start = cellOf(x0, y0), si = start % n, sj = (start / n) | 0;
    if (start < 0) return null;
    const reach = Math.ceil(maxKm * 1000 / cell), w = 2 * reach + 1, size = w * w;
    const local = (i, j) => (j - sj + reach) * w + (i - si + reach);
    const attempt = limit => {
      if (slope[start] / 4 > limit) return null;
      if ((psr[start] & 128) && cellShadow(start) >= 0.5) return { found: true, inside: true, km: 0, maxSlope: slope[start] / 4, meanSlope: slope[start] / 4, limit, relaxed: limit !== first, path: [[lat, lon]] };
      const gCost = new Float32Array(size).fill(Infinity), from = new Int32Array(size).fill(-1), closed = new Uint8Array(size);
      const heap = [], hk = []; // binary heap of local ids keyed by f = g + straight-line distance to the nearest trap
      const push = (id, f) => { let c = heap.length; heap.push(id); hk.push(f); while (c) { const p = (c - 1) >> 1; if (hk[p] <= f) break; heap[c] = heap[p]; hk[c] = hk[p]; c = p; } heap[c] = id; hk[c] = f; };
      const pop = () => {
        const top = heap[0], id = heap.pop(), f = hk.pop(), m = heap.length;
        if (m) { let c = 0; for (;;) { let k = 2 * c + 1; if (k >= m) break; if (k + 1 < m && hk[k + 1] < hk[k]) k++; if (hk[k] >= f) break; heap[c] = heap[k]; hk[c] = hk[k]; c = k; } heap[c] = id; hk[c] = f; }
        return top;
      };
      if (!near) buildNear();
      const hDist = (i, j) => { const c = j * n + i; return near.sx[c] < 0 ? 0 : Math.hypot(near.sx[c] - i, near.sy[c] - j); };
      const s0 = local(si, sj); gCost[s0] = 0; push(s0, hDist(si, sj));
      let goal = -1;
      while (heap.length) {
        const id = pop(); if (closed[id]) continue; closed[id] = 1;
        const li = id % w, lj = (id / w) | 0, i = li - reach + si, j = lj - reach + sj, c = j * n + i;
        if ((psr[c] & 128) && cellShadow(c) >= 0.5) { goal = id; break; }
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj, nli = li + di, nlj = lj + dj;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n || nli < 0 || nlj < 0 || nli >= w || nlj >= w) continue;
          const nc = nj * n + ni, s = slope[nc] / 4;
          if (s > limit) continue;
          // A diagonal step cannot pass between impassable cells at their shared corner.
          if (di && dj && (slope[j * n + ni] / 4 > limit || slope[nj * n + i] / 4 > limit)) continue;
          const nid = nlj * w + nli; if (closed[nid]) continue;
          const g = gCost[id] + (di && dj ? 1.41421356 : 1) * (1 + (s / 15) * (s / 15));
          if (g < gCost[nid]) { gCost[nid] = g; from[nid] = id; push(nid, g + hDist(ni, nj)); }
        }
      }
      if (goal < 0) return null;
      const cells = []; for (let id = goal; id >= 0; id = from[id]) cells.push(id);
      cells.reverse();
      let km = 0, maxS = 0, sumS = 0; const path = [[lat, lon]];
      cells.forEach(id => {
        const i = id % w - reach + si, j = ((id / w) | 0) - reach + sj, s = slope[j * n + i] / 4;
        maxS = Math.max(maxS, s); sumS += s;
        const point = toLL((i + 0.5 - half) * cell, (half - j - 0.5) * cell), previous = path[path.length - 1];
        const h = Math.sin((point[0] - previous[0]) * D / 2) ** 2 + Math.cos(previous[0] * D) * Math.cos(point[0] * D) * Math.sin((point[1] - previous[1]) * D / 2) ** 2;
        const distance = 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) / 1000;
        if (distance > 1e-9) { km += distance; path.push(point); }
      });
      return { found: true, inside: false, km, maxSlope: maxS, meanSlope: sumS / cells.length, limit, relaxed: limit !== first, path };
    };
    return attempt(first) || attempt(relax) || { found: false, km: null, path: [], limit: relax, relaxed: true };
  }

  /* ---------- small maps for the globe and the report ---------- */
  // Raw layer values for a unit vector on the Moon (vz < 0): -1 outside the grid, else the cell index.
  function cellForVector(vx, vy, vz) {
    const q = 2 * R / (1 - vz) / cell, i = Math.floor(vy * q + half), j = Math.floor(half - vx * q);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  }
  // Shaded-relief picture of the pole: fills an ImageData (size x size px) covering +-spanKm around the pole.
  function relief(img, spanKm) {
    const size = img.width, px = img.data, mPer = spanKm * 2000 / size;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - size / 2) * mPer, y = (size / 2 - j - 0.5) * mPer, o = (j * size + i) * 4, c = cellOf(x, y);
      if (c < 0) { px[o] = px[o + 1] = px[o + 2] = 20; px[o + 3] = 255; continue; }
      const e = elevXY(x, y), ex = elevXY(x + cell, y), ey = elevXY(x, y + cell);
      const sh = isNaN(ex) || isNaN(ey) ? 0 : ((e - ex) - (ey - e)) / cell;            // light from the upper left
      let g = Math.max(30, Math.min(235, 132 + sh * 330));
      const s = cellShadow(c);
      px[o] = g * (1 - 0.75 * s) + 40 * 0.75 * s; px[o + 1] = g * (1 - 0.75 * s) + 140 * 0.75 * s; px[o + 2] = g * (1 - 0.75 * s) + 255 * 0.75 * s; px[o + 3] = 255;
    }
    return img;
  }

  /* ---------- unpacking ---------- */
  async function inflate(b64) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // Unpack one polar pack {n, elev, slope, psr, sum*} into typed arrays; throws when sizes or checksums are off.
  async function unpack(src) {
    const N = src.n * src.n, [eb, sb, pb] = await Promise.all([inflate(src.elev), inflate(src.slope), inflate(src.psr)]);
    if (eb.length !== 2 * N || sb.length !== N || pb.length !== N) throw new Error('size');
    const e = new Int16Array(N), s = sb; let sumE = 0, sumS = 0, sumP = 0;
    for (let j = 0, c = 0; j < src.n; j++) {
      let rowAcc = 0, prev = 0;
      for (let i = 0; i < src.n; i++, c++) {
        const zz = eb[c] | (eb[N + c] << 8), res = (zz >>> 1) ^ -(zz & 1);
        // res is the second difference; undo the vertical step with the row above, then the horizontal one
        const dPrev = j ? e[c - src.n] - (i ? e[c - src.n - 1] : 0) : 0;
        rowAcc = res + dPrev; prev = (i ? prev : 0) + rowAcc; e[c] = prev;
        if (i) s[c] = (s[c] + s[c - 1]) & 255;
        sumE += prev; sumS += s[c]; sumP += pb[c];
      }
    }
    if (((sumE % 4294967296) + 4294967296) % 4294967296 !== src.sumElev || sumS !== src.sumSlope || sumP !== src.sumPsr) throw new Error('checksum');
    return { n: src.n, cell: src.cell, R: src.radius, elev: e, slope: s, psr: pb };
  }
  async function load() {
    const src = window.POLAR_DATA;
    if (!src || !src.elev || typeof DecompressionStream !== 'function') { P.failed = true; return; }
    P.pending = true;
    try {
      const g = await unpack(src);
      n = g.n; cell = g.cell; half = n / 2; R = g.R; elev = g.elev; slope = g.slope; psr = g.psr;
      Object.assign(P, { n, cell, R, source: src.source, ready: true });
      src.elev = src.slope = src.psr = null; // free the text copies
    } catch (err) { P.failed = true; }
    P.pending = false;
    await loadGlobal();
  }

  /* ---------- whole-Moon slope map and north-pole pack (data/global_data.js, optional) ---------- */
  // The south pack above drives every calculation. These two only widen the MAP LAYERS and the coarse scan:
  //   world  slope of the whole Moon, 4 px/deg (about 7.6 km cells at the equator), quarter degrees per byte
  //   north  80 N .. 90 N at 960 m: elevation (shaded relief), slope, permanent shadow.
  //          North polar stereographic: x = r sin(lon), y = -r cos(lon), r = 2 R tan((90 - lat) / 2).
  let world = null, north = null;
  async function loadGlobal() {
    const src = window.GLOBAL_DATA;
    if (!src || typeof DecompressionStream !== 'function') return;
    try {
      const sl = await inflate(src.slope.data);
      if (sl.length !== src.slope.w * src.slope.h) throw new Error('size');
      let sum = 0; for (let i = 0; i < sl.length; i++) sum += sl[i];
      if (sum !== src.slope.sum) throw new Error('checksum');
      world = { w: src.slope.w, h: src.slope.h, ppd: src.slope.ppd, slope: sl };
      src.slope.data = null;
    } catch (err) { world = null; }
    try {
      north = await unpack(src.north);
      src.north.elev = src.north.slope = src.north.psr = null;
    } catch (err) { north = null; }
    P.globalReady = !!world;
  }
  // Coarse slope around any point of the Moon from the 4 px/deg map: mean and share under 8 deg of the 3 x 3 cells
  // (about 23 km across at the equator). It shows crater walls and mountain fronts, not landing-scale roughness.
  function coarseSlope(lat, lon) {
    if (!world) return null;
    const { w, h, ppd, slope: s } = world, r0 = Math.min(h - 1, Math.max(0, Math.floor((90 - lat) * ppd))), c0 = Math.floor((((lon % 360) + 360) % 360) * ppd) % w;
    let sum = 0, safe = 0, cnt = 0, max = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = r0 + dr; if (r < 0 || r >= h) continue;
      const v = s[r * w + (c0 + dc + w) % w] / 4; sum += v; cnt++; if (v <= SAFE_SLOPE) safe++; if (v > max) max = v;
    }
    return { mean: sum / cnt, max, safe: safe / cnt, here: s[r0 * w + c0] / 4, coarse: true };
  }

  Object.assign(P, {
    toXY, toLL, inGrid, covered, skyline, slopeAt, slopeStats, psr: psrAt, nearestTrap, cellForVector, relief,
    elev: (lat, lon) => { if (!P.ready) return null; const h = elevXY(...toXY(lat, lon)); return isNaN(h) ? null : h; },
    // raw arrays for per-pixel map layers: psr = sixteenths of shadow in the low 5 bits (+128 = large trap), slope = quarter degrees
    grid: () => ({ n, cell, R, psr, slope, elev }),
    world: () => world, north: () => north, coarseSlope, globalReady: false,
    route,
    // run fn once the data is unpacked (or has failed); the app re-renders from here
    onSettled(fn) { if (P.ready || P.failed) fn(); else waiting.push(fn); }
  });
  window.Polar = P;
  load().then(() => { for (const fn of waiting.splice(0)) { try { fn(); } catch (e) { /* keep the others running */ } } });
})();
