/* Ephemeris core: Sun & Earth as seen from a point on the lunar surface.

   PRIMARY SOURCE — NASA SPICE
   data/spice_table.js holds Sun and Earth positions in the Moon body-fixed frame (IAU_MOON, LT+S),
   computed with NASA NAIF CSPICE from the JPL DE440 ephemeris by tools/build_spice_table.py.
   The table has one sample every 2 hours; Catmull-Rom interpolation reproduces SPICE to ~2e-6 deg.

   FALLBACK — astronomy-engine
   Dates outside the table (or a missing table) use astronomy-engine (VSOP87 / ELP based) with the
   IAU lunar rotation model. It is also the independent cross-check shown in the Resources tab. */
(function () {
  const A = window.Astronomy;
  const AU = 149597870.7, RM = 1737.4, RS = 695700, RE = 6378.137;
  const D = Math.PI / 180;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  /* ---------- SPICE table ---------- */
  let T = null;
  (function loadTable() {
    const src = window.SPICE_TABLE;
    if (!src || !src.b64) return;
    try {
      const bin = atob(src.b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const v = new Float32Array(bytes.buffer);
      if (v.length !== src.n * 6) return;
      T = { v, t0: src.t0, step: src.step, n: src.n, meta: src };
      src.b64 = null; // free the text copy
    } catch (e) { T = null; }
  })();
  const inTable = ms => !!T && ms >= T.t0 && ms <= T.t0 + (T.n - 1) * T.step;

  function frameSpice(ms) {
    const x = (ms - T.t0) / T.step;
    const i = Math.min(Math.floor(x), T.n - 2), u = x - i, u2 = u * u, u3 = u2 * u;
    const v = T.v, r = new Array(6);
    let o, w0, w1, w2, w3;
    if (i === 0 || i === T.n - 2) {
      // Use the four nearest samples for the two edge intervals (one-sided cubic).
      const base = i === 0 ? 0 : T.n - 4, t = x - base;
      o = base * 6;
      w0 = -(t - 1) * (t - 2) * (t - 3) / 6;
      w1 = t * (t - 2) * (t - 3) / 2;
      w2 = -t * (t - 1) * (t - 3) / 2;
      w3 = t * (t - 1) * (t - 2) / 6;
    } else {
      // Catmull-Rom weights for samples i-1, i, i+1, i+2.
      o = (i - 1) * 6;
      w0 = (-u3 + 2 * u2 - u) / 2; w1 = (3 * u3 - 5 * u2 + 2) / 2;
      w2 = (-3 * u3 + 4 * u2 + u) / 2; w3 = (u3 - u2) / 2;
    }
    for (let c = 0; c < 6; c++) r[c] = w0 * v[o + c] + w1 * v[o + 6 + c] + w2 * v[o + 12 + c] + w3 * v[o + 18 + c];
    return { sun: [r[0], r[1], r[2]], earth: [r[3], r[4], r[5]], src: 'spice' };
  }

  /* ---------- astronomy-engine ---------- */
  const cache = new Map();
  function frameAE(ms) {
    if (!A) return null;
    let f = cache.get(ms);
    if (f) return f;
    if (cache.size > 20000) cache.clear();
    const t = A.MakeTime(new Date(ms));
    const m = A.GeoMoon(t);
    const s = A.GeoVector(A.Body.Sun, t, false);
    const ax = A.RotationAxis(A.Body.Moon, t);
    const a = ax.ra * 15 * D, d = ax.dec * D, w = ax.spin * D;
    const p = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
    const n = [-Math.sin(a), Math.cos(a), 0];
    const q = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
    const xb = [0, 1, 2].map(i => n[i] * Math.cos(w) + q[i] * Math.sin(w));
    const yb = cross(p, xb);
    const E = [-m.x * AU, -m.y * AU, -m.z * AU];
    const S = [(s.x - m.x) * AU, (s.y - m.y) * AU, (s.z - m.z) * AU];
    f = { sun: [dot(S, xb), dot(S, yb), dot(S, p)], earth: [dot(E, xb), dot(E, yb), dot(E, p)], src: 'ae' };
    cache.set(ms, f);
    return f;
  }

  // Sun and Earth position vectors (km) in the Moon body-fixed frame at time ms (UTC).
  function frame(ms) {
    if (inTable(ms)) return frameSpice(ms);
    const f = frameAE(ms);
    if (!f) throw new Error('No ephemeris available for this date');
    return f;
  }

  function site(lat, lon) {
    const f = lat * D, l = lon * D;
    return {
      u: [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)],
      e: [-Math.sin(l), Math.cos(l), 0],
      n: [-Math.sin(f) * Math.cos(l), -Math.sin(f) * Math.sin(l), Math.cos(f)]
    };
  }

  // Topocentric direction of a body at B (km, Moon-centred) for an observer on the surface.
  function look(st, B, R) {
    const d = [B[0] - RM * st.u[0], B[1] - RM * st.u[1], B[2] - RM * st.u[2]];
    const r = Math.hypot(d[0], d[1], d[2]);
    const east = dot(d, st.e), north = dot(d, st.n);
    let az = Math.atan2(east, north) / D;
    if (az < 0) az += 360;
    return { el: Math.atan2(dot(d, st.u), Math.hypot(east, north)) / D, az, dist: r, rad: Math.asin(R / r) / D };
  }
  const observeFrame = (st, f) => ({ sun: look(st, f.sun, RS), earth: look(st, f.earth, RE), src: f.src });
  const observe = (st, ms) => observeFrame(st, frame(ms));

  // Same observation from both sources, for the cross-check panel. Either side may be null.
  function crossCheck(st, ms) {
    const s = inTable(ms) ? observeFrame(st, frameSpice(ms)) : null, f = frameAE(ms), a = f ? observeFrame(st, f) : null;
    return { spice: s, ae: a };
  }

  function subPoint(v) {
    const r = Math.hypot(v[0], v[1], v[2]);
    return { lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) / D, lon: Math.atan2(v[1], v[0]) / D, dist: r };
  }

  // Fraction of a disc above a horizon line; x = (centre elevation - horizon) / radius
  function discFrac(x) {
    if (x >= 1) return 1;
    if (x <= -1) return 0;
    return (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI;
  }

  window.Ephem = {
    frame, site, observe, crossCheck, subPoint, discFrac, AU, RM,
    hasSpice: !!T, hasAE: !!A,
    meta: T ? T.meta : null,
    range: T ? [T.t0, T.t0 + (T.n - 1) * T.step] : null,
    sourceAt: ms => inTable(ms) ? 'spice' : 'ae'
  };
})();
