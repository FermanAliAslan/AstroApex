(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = Math.PI / 180, H = 3600000, DAY = 86400000;
  const C = { sun: '#ffb648', earth: '#5aa9ff', both: '#57d9a3', text: '#ece8de', muted: '#949aa8', line: '#272c36', b: '#ff7ab8' };
  const KEYS = ['A', 'B'];
  const DURS = [7, 14, 29.5, 60, 90];
  const MASKS = [[-1.5, 'mask_n15'], [-0.5, 'mask_n05'], [0, 'mask_0'], [1, 'mask_1'], [2, 'mask_2'], [5, 'mask_5']];
  const TERRAIN = window.TERRAIN || {};
  // South-pole terrain engine (js/polar.js); a stub keeps everything working when its data is absent.
  const Polar = window.Polar || { ready: false, failed: true, pending: false, covered: () => false, inGrid: () => false, onSettled(fn) { fn(); } };
  const PRESETS = window.PRESETS || [];
  // Power model: tracking array (29% cells, 90% packing and pointing), 95% charge efficiency, 80% usable depth of discharge.
  const PV_EFF = 0.29 * 0.9, CHG_EFF = 0.95, DOD = 0.8, WH_KG = 180;
  const PWR_LIMITS = { load: [10, 5000], cap: [0.5, 500], area: [0.2, 100] };

  const S = {
    lang: 'en', dur: 14, cur: 0, playing: false, tab: 'compare',
    sc: {
      A: { site: 'ridge', lat: -89.4632, lon: -137.49, start: Date.UTC(2027, 0, 8), mask: 'lola' },
      B: { site: 'malapert', lat: -85.9948, lon: -0.23578, start: Date.UTC(2027, 0, 8), mask: 'lola' }
    },
    data: {}, year: {},
    pwr: { load: 200, cap: 10, area: 2 },   // continuous load (W), battery (kWh), array (m2)
    scout: null,                             // result of the last region scan (js/scout.js)
    scanMode: 'pole',                        // 'pole' = south pole with real terrain, 'moon' = whole Moon, coarse
    regions: null,                           // best point inside each NASA study region (js/scout.js)
    globe: { lat0: -90, lon0: 0, zoom: 4, light: false, labels: true, ice: true, slope: false, temp: false, regions: true, route: true, heat: true, heatBy: 'score', target: 'A', tex: null }
  };

  /* ---------- helpers ---------- */
  const t = (k, v) => {
    let s = I18N[S.lang][k] ?? k;
    if (v) for (const n in v) s = s.replace('{' + n + '}', v[n]);
    return s;
  };
  const nf = (v, d = 0) => v.toLocaleString(S.lang, { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtDate = (ms, time = true) => new Date(ms).toLocaleString(S.lang, Object.assign(
    { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' },
    time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}));
  const fmtCoord = (lat, lon) =>
    `${nf(Math.abs(lat), 2)}° ${lat < 0 ? t('S') : t('N')} · ${nf(Math.abs(lon), 2)}° ${lon < 0 ? t('W') : t('E')}`;
  const fmtDur = h => {
    const m = Math.round(h * 60), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d) return `${d} ${t('d')} ${hh} ${t('h')}`;
    if (hh) return `${hh} ${t('h')} ${mm} ${t('m')}`;
    return `${mm} ${t('m')}`;
  };
  const toLocal = ms => new Date(ms).toISOString().slice(0, 16);
  const fromLocal = v => Date.parse(v + (v.length === 16 ? ':00Z' : 'Z'));
  const stepMin = () => S.dur <= 14 ? 10 : S.dur <= 30 ? 20 : S.dur <= 60 ? 30 : 60;
  const siteName = k => {
    const s = SITES.find(x => x.id === S.sc[k].site);
    return s ? s.name : t('custom');
  };
  function fit(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(50, Math.round(r.width)), h = Math.max(50, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  const niceStep = range => [1, 2, 5, 10, 15, 30, 45].find(s => range / s <= 7) || 45;

  /* ---------- horizon model ---------- */
  // Returns horizon elevation (deg) as a function of azimuth: a LOLA skyline where we have one, else a fixed angle.
  // Skyline samples for a scenario, or null when only a fixed angle applies. Three NASA study-region centres
  // carry a precomputed 80 m skyline; any other point south of 82 S gets one computed here from the 480 m LOLA grid.
  const skyCache = new Map();
  // The 80 m skyline belongs to a place, not to a menu entry: a custom point at the same coordinates gets it too.
  const terrainEntry = sc => TERRAIN[sc.site] || Object.values(TERRAIN).find(T => Math.abs(T.lat - sc.lat) < 6e-4 && Math.abs(T.lon - sc.lon) < 6e-4) || null;
  // Which horizon a scenario really uses: 'lola80' (precomputed 80 m profile), 'lola480' (480 m grid) or 'flat'.
  const horizonSrc = sc => sc.mask !== 'lola' ? 'flat' : sc.sky ? 'lola480' : terrainEntry(sc) ? 'lola80' : profile(sc) ? 'lola480' : 'flat';
  function profile(sc) {
    if (sc.sky) return sc.sky;
    if (sc.mask !== 'lola') return null;
    const T80 = terrainEntry(sc);
    if (T80) return T80.angles;
    if (!Polar.covered(sc.lat, sc.lon)) return null;
    const key = sc.lat + '|' + sc.lon;
    let p = skyCache.get(key);
    if (p === undefined) { if (skyCache.size > 40) skyCache.clear(); p = Polar.skyline(sc.lat, sc.lon, 360) || null; skyCache.set(key, p); }
    return p;
  }
  function horizonFn(sc) {
    const a = profile(sc);
    if (!a) { const m = sc.mask === 'lola' ? 0 : sc.mask; return () => m; }
    const n = a.length;
    return az => {
      const x = ((az % 360 + 360) % 360) * n / 360, i = Math.floor(x), f = x - i;
      return a[i % n] * (1 - f) + a[(i + 1) % n] * f;
    };
  }
  const terrainOK = sc => !!terrainEntry(sc) || Polar.covered(sc.lat, sc.lon);
  const hasTerrain = sc => sc.mask === 'lola' && !!profile(sc);
  // While the terrain pack is still unpacking, a 'lola' choice is kept as it is.
  function normalize(sc) { if (sc.mask === 'lola' && !terrainOK(sc) && !Polar.pending) sc.mask = 0; }
  // While the pack is unpacking, a point inside its area is assumed covered; normalize() corrects it if loading fails.
  const terrainSoon = sc => terrainOK(sc) || (Polar.pending && sc.lat <= Polar.COVER_LAT);
  function setSite(k, id) {
    const sc = S.sc[k], s = SITES.find(x => x.id === id);
    if (!s) return;
    sc.site = id; sc.lat = s.lat; sc.lon = s.lon;
    sc.mask = terrainSoon(sc) ? 'lola' : (sc.mask === 'lola' ? 0 : sc.mask);
  }
  // A free point (map click, scan result, assistant): real terrain is switched on wherever the LOLA grid covers it.
  function setPoint(k, lat, lon) {
    const sc = S.sc[k];
    sc.lat = Math.max(-90, Math.min(90, +lat.toFixed(3))); sc.lon = +(((lon + 180) % 360 + 360) % 360 - 180).toFixed(3); sc.site = 'custom';
    sc.mask = terrainSoon(sc) ? 'lola' : (sc.mask === 'lola' ? 0 : sc.mask);
  }
  // Ground facts at a point from the LOLA grid: slope around the footprint, nearest large ice trap, permanent shadow.
  const factCache = new Map();
  function facts(sc) {
    const key = sc.lat + '|' + sc.lon + '|' + Polar.ready + '|' + !!Polar.globalReady;
    let f = factCache.get(key);
    if (!f) {
      if (factCache.size > 400) factCache.clear();
      const ok = Polar.inGrid(sc.lat, sc.lon);
      f = { data: ok, slope: ok ? Polar.slopeStats(sc.lat, sc.lon, 1) : null, trap: ok ? Polar.nearestTrap(sc.lat, sc.lon) : null, shadow: ok ? Polar.psr(sc.lat, sc.lon) : 0 };
      // elsewhere on the Moon only the coarse world slope map is available (cells of about 7.6 km)
      f.coarse = !f.slope && Polar.coarseSlope ? Polar.coarseSlope(sc.lat, sc.lon) : null;
      factCache.set(key, f);
    }
    return f;
  }

  /* ---------- computation ---------- */
  function runs(arr, n) {
    const out = []; let s = -1;
    for (let i = 0; i < n; i++) {
      if (arr[i] && s < 0) s = i;
      if (!arr[i] && s >= 0) { out.push([s, i]); s = -1; }
    }
    if (s >= 0) out.push([s, n]);
    return out;
  }
  // Share of the solar disc NOT covered by the Earth, seen from the site (below 1 during a lunar eclipse).
  // Two-circle overlap with the apparent radii; sunlight bent through the Earth's atmosphere is ignored.
  function sunUncovered(o) {
    const D = Math.PI / 180, a1 = o.sun.el * D, a2 = o.earth.el * D;
    const cs = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos((o.sun.az - o.earth.az) * D);
    const sep = Math.acos(Math.max(-1, Math.min(1, cs))) / D, r = o.sun.rad, R = o.earth.rad;
    if (sep >= r + R) return 1;
    if (sep <= R - r) return 0;
    const cl = v => Math.max(-1, Math.min(1, v));
    const area = r * r * Math.acos(cl((sep * sep + r * r - R * R) / (2 * sep * r))) + R * R * Math.acos(cl((sep * sep + R * R - r * r) / (2 * sep * R)))
      - 0.5 * Math.sqrt(Math.max(0, (-sep + r + R) * (sep + r - R) * (sep - r + R) * (sep + r + R)));
    return Math.max(0, 1 - area / (Math.PI * r * r));
  }
  // Pure simulation of one scenario: sc = {site, lat, lon, start, mask}, dur in days, sm = step in minutes.
  function simulate(sc, dur, sm) {
    const n = Math.round(dur * 1440 / sm) + 1, dtH = sm / 60;
    const st = Ephem.site(sc.lat, sc.lon), hz = horizonFn(sc);
    const d = {
      n, dtH, sunEl: new Float32Array(n), sunAz: new Float32Array(n), earthEl: new Float32Array(n),
      earthAz: new Float32Array(n), frac: new Float32Array(n), flux: new Float32Array(n),
      sunM: new Float32Array(n), earthM: new Float32Array(n), // elevation above the LOCAL horizon (terrain included)
      sunUp: new Uint8Array(n), earthUp: new Uint8Array(n), both: new Uint8Array(n), sunR: 0.27, earthR: 0.95
    };
    let sunC = 0, earthC = 0, bothC = 0, elSum = 0, energy = 0, eclC = 0;
    let maxEl = -90, eMin = 90, eMax = -90, sMin = 90, nSpice = 0;
    for (let i = 0; i < n; i++) {
      const o = Ephem.observe(st, sc.start + i * sm * 60000);
      if (o.src === 'spice') nSpice++;
      d.sunEl[i] = o.sun.el; d.sunAz[i] = o.sun.az; d.earthEl[i] = o.earth.el; d.earthAz[i] = o.earth.az;
      d.sunM[i] = o.sun.el - hz(o.sun.az); d.earthM[i] = o.earth.el - hz(o.earth.az);
      const fT = Ephem.discFrac(d.sunM[i] / o.sun.rad), unc = fT > 0 ? sunUncovered(o) : 1, f = fT * unc; // terrain, then the Earth
      if (unc < 1 && i < n - 1) eclC++;
      d.frac[i] = f;
      d.flux[i] = 1361 * Math.pow(Ephem.AU / o.sun.dist, 2) * f;
      d.sunUp[i] = f > 0 ? 1 : 0;
      d.earthUp[i] = o.earth.el > hz(o.earth.az) ? 1 : 0;
      d.both[i] = d.sunUp[i] & d.earthUp[i];
      d.sunR = o.sun.rad; d.earthR = o.earth.rad;
      maxEl = Math.max(maxEl, o.sun.el); sMin = Math.min(sMin, o.sun.el);
      eMin = Math.min(eMin, o.earth.el); eMax = Math.max(eMax, o.earth.el);
      if (i < n - 1) {
        sunC += d.sunUp[i]; earthC += d.earthUp[i]; bothC += d.both[i];
        if (d.sunUp[i]) elSum += o.sun.el;
        energy += d.flux[i] * dtH / 1000;
      }
    }
    const inv = a => a.map(v => v ? 0 : 1);
    const longest = rs => rs.reduce((m, r) => Math.max(m, r[1] - r[0]), 0) * dtH;
    d.runs = { sun: runs(d.sunUp, n), earth: runs(d.earthUp, n), both: runs(d.both, n) };
    const total = (n - 1) * dtH;
    d.stats = {
      total, sun: sunC * dtH, earth: earthC * dtH, both: bothC * dtH,
      dark: Math.min(total, longest(runs(inv(d.sunUp), n))), nocomm: Math.min(total, longest(runs(inv(d.earthUp), n))),
      maxEl, sMin, meanEl: sunC ? elSum / sunC : null, energy, eMin, eMax, eclipse: eclC * dtH
    };
    d.hz = horizonSrc(sc);
    d.src = nSpice === n ? 'spice' : nSpice ? 'mixed' : 'ae';
    return d;
  }
  // Battery state of charge through the mission for a given load, battery and array (starts full).
  // need = the capacity that would ride through the worst energy deficit while using only 80% of the battery.
  function powerSim(d, p) {
    const n = d.n, capWh = p.cap * 1000, soc = new Float32Array(n);
    let e = capWh, minE = capWh, emptyH = 0, firstEmpty = -1, run = 0, deficit = 0, gen = 0;
    for (let i = 0; i < n; i++) {
      soc[i] = e / capWh;
      if (i === n - 1) break;
      const pin = d.flux[i] * p.area * PV_EFF, net = (pin - p.load) * d.dtH, dE = net > 0 ? net * CHG_EFF : net; // Wh in this step
      gen += pin * d.dtH;
      if (dE < 0 && e + dE <= 0) { emptyH += d.dtH * Math.min(1, (-e - dE) / -dE); if (firstEmpty < 0) firstEmpty = i; }
      e = Math.max(0, Math.min(capWh, e + dE));
      if (e < minE) minE = e;
      run = Math.min(0, run + dE); if (-run > deficit) deficit = -run;
    }
    const need = deficit / DOD / 1000, min = minE / capWh;
    return {
      soc, min, emptyH, firstEmpty, need, massKg: need * 1000 / WH_KG, gen: gen / 1000, used: p.load * (n - 1) * d.dtH / 1000,
      state: emptyH > 0 ? 'bad' : min < 1 - DOD ? 'mid' : 'good'
    };
  }
  function compute(k) { const d = S.data[k] = simulate(S.sc[k], S.dur, stepMin()); d.pw = powerSim(d, S.pwr); }
  const idxAt = k => Math.min(S.data[k].n - 1, Math.max(0, Math.round(S.cur / S.data[k].dtH)));

  /* ---------- scenario cards ---------- */
  function buildScenario(k) {
    const el = $('#scn-' + k);
    el.innerHTML = `
      <div class="scn-head">
        <div class="scn-title"><span class="badge ${k.toLowerCase()}">${k}</span><span class="k"><span data-i18n="scenario"></span> ${k}</span></div>
        <span class="coord mono" data-coord></span>
      </div>
      <div class="scn-form">
        <label class="field"><span data-i18n="site"></span><select data-f="site"></select></label>
        <label class="field"><span data-i18n="start"></span><input data-f="start" type="datetime-local"></label>
      </div>
      <details class="acc flat">
        <summary><span data-i18n="adv"></span></summary>
        <div class="scn-form three">
          <label class="field"><span data-i18n="lat"></span><input data-f="lat" type="number" min="-90" max="90" step="0.01"></label>
          <label class="field"><span data-i18n="lon"></span><input data-f="lon" type="number" min="-180" max="180" step="0.01"></label>
          <label class="field"><span data-i18n="mask"></span><select data-f="mask"></select></label>
        </div>
      </details>`;
    el.addEventListener('change', e => {
      const f = e.target.dataset.f, sc = S.sc[k], v = e.target.value;
      if (!f) return;
      if (f === 'site') {
        if (v === 'custom') sc.site = 'custom'; else setSite(k, v);
      } else if (f === 'lat' || f === 'lon') {
        const x = parseFloat(v);
        if (isNaN(x)) return syncForms();
        if (f === 'lat') sc.lat = Math.max(-90, Math.min(90, x));
        else sc.lon = ((x + 180) % 360 + 360) % 360 - 180;
        sc.site = 'custom';
      } else if (f === 'start') {
        const ms = fromLocal(v);
        if (isNaN(ms)) return syncForms();
        sc.start = ms;
      } else if (f === 'mask') sc.mask = v === 'lola' ? 'lola' : parseFloat(v);
      refresh();
    });
  }
  function fillSelects() {
    for (const k of KEYS) {
      const sel = $(`#scn-${k} [data-f=site]`);
      sel.innerHTML = ['pole', 'clps', 'apollo', 'intl'].map(g =>
        `<optgroup label="${t('g_' + g)}">${SITES.filter(s => s.g === g).map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</optgroup>`
      ).join('') + `<option value="custom">${t('custom')}</option>`;
      $(`#scn-${k} [data-f=mask]`).innerHTML = `<option value="lola">${t('mask_lola')}</option>` +
        MASKS.map(m => `<option value="${m[0]}">${t(m[1])}</option>`).join('');
    }
    $('#dur').innerHTML = DURS.map(d => `<option value="${d}">${d === 29.5 ? `${nf(29.5, 1)} ${t('days')} · ${t('lunar_day')}` : d + ' ' + t('days')}</option>`).join('');
    $('#presets').innerHTML = PRESETS.map(p => `<button data-preset="${p.id}">${t('ps_' + p.id)}</button>`).join('');
    $('#slips').innerHTML = [1, 7, 14, 29.5].map(d => `<button data-slip="${d}">${t('same_site')} · +${nf(d, d % 1 ? 1 : 0)} ${t('days')}</button>`).join('') +
      `<button data-slip="swap">${t('swap')}</button>`;
  }
  function syncForms() {
    for (const k of KEYS) {
      const sc = S.sc[k], el = $('#scn-' + k);
      el.querySelector('[data-f=site]').value = sc.site;
      el.querySelector('[data-f=lat]').value = sc.lat;
      el.querySelector('[data-f=lon]').value = sc.lon;
      el.querySelector('[data-f=start]').value = toLocal(sc.start);
      const mk = el.querySelector('[data-f=mask]');
      mk.querySelector('option[value=lola]').disabled = !terrainOK(sc);
      mk.value = String(sc.mask);
      el.querySelector('[data-coord]').textContent = fmtCoord(sc.lat, sc.lon);
    }
    $('#dur').value = S.dur;
    $$('#target button').forEach(b => b.classList.toggle('on', b.dataset.t === S.globe.target));
    $$('#lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === S.lang));
    $('#light').checked = S.globe.light; $('#labels').checked = S.globe.labels;
    for (const id of LAYERS) { const el = $('#lay-' + id); el.checked = S.globe[id]; el.disabled = id === 'heat' ? !S.scout : id === 'temp' || id === 'regions' ? false : !Polar.ready; }
    const legOn = id => id === 'heat' ? !!(S.scout && S.globe.heat) : id === 'temp' || id === 'regions' ? S.globe[id] : id === 'route' ? false : Polar.ready && S.globe[id];
    $('#map-legend').hidden = !LAYERS.some(legOn);
    $$('#map-legend [data-leg]').forEach(el => { el.hidden = !legOn(el.dataset.leg); });
    $('#leg-heat-text').textContent = t('leg_heat_' + S.globe.heatBy);
    $$('#heat-by button').forEach(b => b.classList.toggle('on', b.dataset.by === S.globe.heatBy));
    $('#heat-by').hidden = !S.scout;
    renderRoute();
    for (const f of ['load', 'cap', 'area']) $('#pw-' + f).value = S.pwr[f];
    $$('#presets button').forEach(b => { const p = PRESETS.find(x => x.id === b.dataset.preset); b.classList.toggle('on', !!p && presetActive(p)); });
  }
  const LAYERS = ['ice', 'slope', 'temp', 'regions', 'route', 'heat'];
  // Rover route from a scenario's point to the nearest large ice trap (cached per point).
  const routeCache = new Map();
  function routeFor(sc) {
    if (!Polar.ready || !Polar.inGrid(sc.lat, sc.lon)) return null;
    const key = sc.lat + '|' + sc.lon;
    let r = routeCache.get(key);
    if (r === undefined) { if (routeCache.size > 60) routeCache.clear(); r = Polar.route(sc.lat, sc.lon) || null; routeCache.set(key, r); }
    return r;
  }
  const ROVER_KMH = 0.8; // assumed average driving speed of a small polar rover
  function renderRoute() {
    const el = $('#route-info'), k = S.globe.target, r = S.globe.route ? routeFor(S.sc[k]) : null;
    el.hidden = !r;
    if (!r) return;
    el.innerHTML = `<span class="badge ${k.toLowerCase()}">${k}</span> ` + (r.inside ? t('route_in') : !r.found ? t('route_none', { s: nf(r.limit) })
      : t('route_ok', { km: nf(r.km, 1), s: nf(r.maxSlope, 1), h: nf(r.km / ROVER_KMH), v: nf(ROVER_KMH, 1) }) + (r.relaxed ? ' <b>' + t('route_relaxed', { s: nf(r.limit) }) + '</b>' : ''));
  }
  const presetActive = p => S.sc.A.site === p.a && S.sc.B.site === p.b && S.sc.B.start - S.sc.A.start === (p.slip || 0) * DAY;
  function applyPreset(id) {
    const p = PRESETS.find(x => x.id === id); if (!p) return;
    setSite('A', p.a); setSite('B', p.b);
    S.sc.B.start = S.sc.A.start + (p.slip || 0) * DAY;
    refresh();
  }

  /* ---------- verdict, windows, table ---------- */
  function renderVerdict() {
    const a = S.data.A.stats, b = S.data.B.stats, diff = b.both - a.both;
    const tol = S.data.A.dtH / 2; // less than half a time step is no difference
    const hm = h => h < 10 ? fmtDur(h) : nf(h) + ' ' + t('h'); // minutes stay visible for short windows
    $('#verdict-h').textContent = a.both <= 0 && b.both <= 0 ? t('verdict_none')
      : Math.abs(diff) < tol ? t('verdict_eq2', { h: hm(a.both) })
        : t('verdict_more2', { w: diff > 0 ? 'B' : 'A', h: hm(Math.abs(diff)) });
    $('#verdict-chips').innerHTML = KEYS.map(k => {
      const s = S.data[k].stats, ps = s.sun / s.total, pe = s.earth / s.total;
      const pc = ps > 0.8 ? 'good' : ps > 0.4 ? 'mid' : 'bad', pl = { good: 'p_good', mid: 'p_mid', bad: 'p_bad' }[pc];
      const cc = pe > 0.995 ? 'good' : pe > 0 ? 'mid' : 'bad', cl = { good: 'c_full', mid: 'c_part', bad: 'c_none' }[cc];
      return `<div class="vchip"><span class="badge ${k.toLowerCase()}">${k}</span>
        <span class="pill ${pc}">${t('power')} <b>${t(pl)}</b> · ${nf(ps * 100)}%</span>
        <span class="pill ${cc}">${t('comm')} <b>${t(cl)}</b> · ${nf(pe * 100)}%</span></div>`;
    }).join('');
  }
  // One plain sentence per scenario, so the bars can be understood without reading them.
  function winSummary(k) {
    const s = S.data[k].stats, ps = s.sun / s.total, pe = s.earth / s.total;
    const a = s.dark <= 0 ? t('ws_sun_all') : ps >= 0.85 ? t('ws_sun_most2', { d: fmtDur(s.dark) })
      : ps >= 0.5 ? t('ws_sun_part', { p: nf(ps * 100), d: nf(s.dark) })
        : ps > 0 ? t('ws_sun_low', { d: nf(s.dark) }) : t('ws_sun_none');
    const b = s.nocomm <= 0 ? t('ws_earth_all') : pe <= 0 ? t('ws_earth_none') : pe >= 0.995 ? t('ws_earth_most', { d: fmtDur(s.nocomm) }) : t('ws_earth_part', { p: pe < 0.01 ? '<1' : nf(pe * 100), d: nf(s.nocomm) });
    return a + ' ' + b + (s.eclipse > 0 ? ' ' + t('ws_eclipse', { d: fmtDur(s.eclipse) }) : '');
  }
  const fmtDay = ms => new Date(ms).toLocaleString(S.lang, { timeZone: 'UTC', day: 'numeric', month: 'short' });
  function renderWindows() {
    const tot = S.dur * 24;
    $('#win-rows').innerHTML = KEYS.map(k => {
      const d = S.data[k], s = d.stats, sc = S.sc[k], N = d.n - 1;
      const row = (b, val) => {
        const rs = d.runs[b];
        const segs = rs.map(r => `<i style="left:${r[0] / N * 100}%;width:${(Math.min(r[1], N) - r[0]) / N * 100}%"></i>`).join('');
        let gaps = '';
        if (b !== 'both') { // name the long gaps: they are the risk
          const add = (a, z) => {
            if ((z - a) / N >= 0.16) gaps += `<span class="gp" style="left:${a / N * 100}%;width:${(z - a) / N * 100}%">${t(b === 'sun' ? 'w_gap_sun' : 'w_gap_earth', { h: nf((z - a) * d.dtH) })}</span>`;
          };
          let p = 0;
          for (const r of rs) { add(p, r[0]); p = Math.min(r[1], N); }
          add(p, N);
        }
        return `<div class="wrow"><span class="wl"><i class="sw ${b}"></i>${t('w_' + b)}</span>
          <div class="track ${b}" title="${k} · ${t(b)}">${segs}${gaps}<b class="wcur"></b></div><span class="wv">${val}</span></div>`;
      };
      const hShort = h => h > 0 && h < 10 ? fmtDur(h) : nf(h) + ' ' + t('h'); // minutes stay visible
      const pv = (h) => `<b>${nf(h / s.total * 100)}%</b> · ${hShort(h)}`;
      const ticks = [0, 1, 2, 3, 4].map(i => `<span>${fmtDay(sc.start + i / 4 * tot * H)}</span>`).join('');
      return `<div class="wcard">
        <div class="wcard-head"><div class="scn-title"><span class="badge ${k.toLowerCase()}">${k}</span><b>${siteName(k)}</b></div>
          <span class="mono coord">${fmtDay(sc.start)} – ${fmtDate(sc.start + tot * H, false)} · ${nf(S.dur, S.dur % 1 ? 1 : 0)} ${t('days')}</span></div>
        <p class="wsum">${winSummary(k)}</p>${d.hz === 'lola480' ? `<p class="wsum hz-note">${t('hz_480')}</p>` : ''}
        ${row('sun', pv(s.sun))}${row('earth', pv(s.earth))}${row('both', `<b>${hShort(s.both)}</b>`)}
        <div class="wrow waxis"><span></span><div>${ticks}</div><span></span></div>
      </div>`;
    }).join('');
  }
  function renderTable() {
    const a = S.data.A.stats, b = S.data.B.stats, pa = S.data.A.pw, pb = S.data.B.pw, fa = facts(S.sc.A), fb = facts(S.sc.B);
    const row = (label, x, y, dec = 0, better = 1) => {
      const dx = x == null || y == null ? null : y - x;
      const cls = dx == null || Math.abs(dx) < Math.pow(10, -dec) / 2 ? '' : (dx * better > 0 ? 'pos' : 'neg');
      const f = v => v == null ? '—' : nf(v, dec);
      return `<tr><td>${label}</td><td>${f(x)}</td><td>${f(y)}</td><td class="${cls}">${dx == null ? '—' : (dx > 0 ? '+' : '') + nf(dx, dec)}</td></tr>`;
    };
    const rng = s => `${nf(s.eMin, 1)} … ${nf(s.eMax, 1)}`;
    $('#metrics').innerHTML = `<thead><tr><th>${t('metric')}</th>
      <th>A<small>${siteName('A')}</small></th><th>B<small>${siteName('B')}</small></th><th>B − A</th></tr></thead><tbody>` +
      row(t('m_both'), a.both, b.both) + row(t('m_sun'), a.sun, b.sun) + row(t('m_earth'), a.earth, b.earth) +
      row(t('m_dark'), a.dark, b.dark, 0, -1) + row(t('m_nocomm'), a.nocomm, b.nocomm, 0, -1) +
      row(t('m_maxel'), a.maxEl, b.maxEl, 1) + row(t('m_meanel'), a.meanEl, b.meanEl, 1) +
      row(t('m_energy'), a.energy, b.energy) +
      `<tr><td>${t('m_earthel')}</td><td>${rng(a)}</td><td>${rng(b)}</td><td>—</td></tr>` +
      row(t('m_need'), pa.need, pb.need, 1, -1) + row(t('m_minsoc'), pa.min * 100, pb.min * 100) +
      row(t('m_slope'), fa.slope && fa.slope.mean, fb.slope && fb.slope.mean, 1, -1) +
      row(t('m_safe'), fa.slope && fa.slope.safe * 100, fb.slope && fb.slope.safe * 100) +
      row(t('m_ice'), fa.trap && fa.trap.km, fb.trap && fb.trap.km, 1, -1) + '</tbody>';
  }

  /* ---------- sky panorama + readouts ---------- */
  function buildSky(k) {
    $('#sky-' + k).innerHTML = `
      <div class="scn-head"><div class="scn-title"><span class="badge ${k.toLowerCase()}">${k}</span><b data-name></b></div>
        <span class="mono coord" data-when></span></div>
      <canvas data-sky></canvas>
      <div class="readouts"><div class="ro sun" data-ro="sun"></div><div class="ro earth" data-ro="earth"></div></div>`;
  }
  function drawSky(k) {
    const d = S.data[k], sc = S.sc[k], st = d.stats, i = idxAt(k), hz = horizonFn(sc), terr = hasTerrain(sc);
    const { ctx, w, h } = fit($(`#sky-${k} [data-sky]`));
    const L = 40, R = 10, T = 12, B = 26;
    let hMin = hz(0), hMax = hMin, azMax = 0;
    if (terr) for (let a = 0; a < 360; a += 1) { const v = hz(a); hMin = Math.min(hMin, v); if (v > hMax) { hMax = v; azMax = a; } }
    const lo = Math.max(-90, Math.min(-5, Math.floor(Math.min(st.sMin, st.eMin, hMin) - 2)));
    const hi = Math.min(90, Math.max(8, Math.ceil(Math.max(st.maxEl, st.eMax, Math.min(hMax, 14)) + 3)));
    const X = az => L + az / 360 * (w - L - R), Y = el => T + (hi - el) / (hi - lo) * (h - T - B);
    const skyline = () => {
      ctx.beginPath(); ctx.moveTo(L, Y(hz(0)));
      for (let a = 1; a <= 360; a++) ctx.lineTo(X(a), Math.max(T, Y(hz(a))));
    };
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, w - L - R, h - T - B); ctx.clip();
    // ground
    skyline(); ctx.lineTo(w - R, h - B); ctx.lineTo(L, h - B); ctx.closePath();
    ctx.fillStyle = '#1b1e23'; ctx.fill();
    ctx.restore();
    // grid
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    const stp = niceStep(hi - lo);
    for (let e = Math.ceil(lo / stp) * stp; e <= hi; e += stp) {
      ctx.strokeStyle = e === 0 ? '#4a5262' : '#ffffff12'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, Y(e) + .5); ctx.lineTo(w - R, Y(e) + .5); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText(e + '°', L - 6, Y(e));
    }
    ctx.textAlign = 'center';
    const cp = t('compass');
    for (let a = 0; a <= 8; a++) {
      const x = X(a * 45);
      ctx.strokeStyle = '#ffffff12'; ctx.beginPath(); ctx.moveTo(x + .5, T); ctx.lineTo(x + .5, h - B); ctx.stroke();
      ctx.fillStyle = a % 2 ? C.muted : C.text; ctx.fillText(cp[a], Math.min(w - R - 6, Math.max(L + 6, x)), h - B + 13);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, w - L - R, h - T - B); ctx.clip();
    // local horizon line
    ctx.strokeStyle = '#9aa0ad'; ctx.lineWidth = 1.5; skyline(); ctx.stroke();
    if (terr && hMax > hi) { // the ridge continues above the plot: say how high it really is
      ctx.fillStyle = '#d7dbe3'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('▲ ' + nf(hMax, 1) + '°', Math.min(w - R - 34, Math.max(L + 34, X(azMax))), T + 4); ctx.textBaseline = 'middle';
    }
    if (terr || sc.mask !== 0) {
      ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(terr ? (d.hz === 'lola80' ? 'LOLA 80 m' : 'LOLA 480 m') : t('loc_h'), w - R - 4, Math.max(T + 14, Y(hz(359)) - 3)); ctx.textBaseline = 'middle';
    }
    // paths
    const path = (az, el, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = .55; ctx.setLineDash([2, 4]);
      ctx.beginPath();
      for (let j = 0; j < d.n; j++) {
        if (j === 0 || Math.abs(az[j] - az[j - 1]) > 180) ctx.moveTo(X(az[j]), Y(el[j])); else ctx.lineTo(X(az[j]), Y(el[j]));
      }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    };
    path(d.sunAz, d.sunEl, C.sun); path(d.earthAz, d.earthEl, C.earth);
    const pxDeg = (h - T - B) / (hi - lo);
    const disc = (az, el, rad, col, minR, label, up) => {
      const r = Math.max(minR, rad * pxDeg), x = X(az), y = Y(el);
      ctx.globalAlpha = up ? 1 : 0.45;
      const g = ctx.createRadialGradient(x, y, r * .6, x, y, r * 3.2);
      g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, 7); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.text; ctx.textAlign = x > w - 90 ? 'right' : 'left';
      ctx.fillText(label, x + (x > w - 90 ? -r - 7 : r + 7), Math.max(T + 8, y - r - 6));
    };
    disc(d.earthAz[i], d.earthEl[i], d.earthR, C.earth, 6, t('earth'), d.earthUp[i]);
    disc(d.sunAz[i], d.sunEl[i], d.sunR, C.sun, 5, t('sun'), d.sunUp[i]);
    ctx.restore();
  }
  function countdown(k, body) {
    const d = S.data[k], i = idxAt(k), rs = d.runs[body === 'sun' ? 'sun' : 'earth'];
    const up = (body === 'sun' ? d.sunUp : d.earthUp)[i];
    const keyUp = body === 'sun' ? 'sets_in' : 'earthset_in', keyDn = body === 'sun' ? 'rises_in' : 'earthrise_in';
    if (up) {
      const r = rs.find(r => i >= r[0] && i < r[1]) || rs[rs.length - 1];
      return r[1] >= d.n ? t('until_end') : t(keyUp, { t: fmtDur((r[1] - i) * d.dtH) });
    }
    const nx = rs.find(r => r[0] > i);
    return nx ? t(keyDn, { t: fmtDur((nx[0] - i) * d.dtH) }) : t('never');
  }
  function renderNow(k) {
    const d = S.data[k], sc = S.sc[k], i = idxAt(k), el = $('#sky-' + k), hz = horizonFn(sc);
    el.querySelector('[data-name]').textContent = siteName(k);
    el.querySelector('[data-when]').textContent = fmtDate(sc.start + i * d.dtH * H) + ' UTC';
    const ro = (body, elv, az, up, extra) => `
      <div class="ro-top"><b>${t(body)}</b><span class="${up ? 'up' : ''}">${up ? t('up') : t('down')}</span></div>
      <div class="ro-big">${elv >= 0 ? '+' : '−'}${nf(Math.abs(elv), 2)}°</div>
      <div class="ro-count">${countdown(k, body)}</div>
      <dl><div><dt>${t('azim')}</dt><dd>${nf(az, 1)}°</dd></div>
      <div><dt>${t('mask')}</dt><dd>${nf(hz(az), 1)}°${hasTerrain(sc) ? ' · LOLA' : ''}</dd></div>${extra}</dl>`;
    const flat = d.flux[i] * Math.max(0, Math.sin(d.sunEl[i] * D));
    el.querySelector('[data-ro=sun]').innerHTML = ro('sun', d.sunEl[i], d.sunAz[i], d.sunUp[i],
      `<div><dt>${t('disc')}</dt><dd>${nf(d.frac[i] * 100)}%</dd></div>
       <div><dt>${t('flux')}</dt><dd>${nf(d.flux[i])} W/m²</dd></div>
       <div><dt>${t('flat')}</dt><dd>${nf(flat)} W/m²</dd></div>`);
    el.querySelector('[data-ro=earth]').innerHTML = ro('earth', d.earthEl[i], d.earthAz[i], d.earthUp[i],
      `<div><dt>${t('range')}</dt><dd>${nf(d.stats.eMin, 1)}° … ${nf(d.stats.eMax, 1)}°</dd></div>`);
  }

  /* ---------- elevation charts (one per body, relative to the local horizon) ---------- */
  const chartGeom = { L: 46, R: 14, T: 24, B: 26 };
  function drawElev(id, key, col) {
    const { ctx, w, h } = fit($(id)), { L, R, T, B } = chartGeom, tot = S.dur * 24;
    let lo = -2, hi = 2;
    for (const k of KEYS) { const a = S.data[k][key]; for (let j = 0; j < a.length; j++) { if (a[j] < lo) lo = a[j]; if (a[j] > hi) hi = a[j]; } }
    lo = Math.max(-90, Math.floor(lo - 1)); hi = Math.min(90, Math.ceil(hi + 1));
    const X = hr => L + hr / tot * (w - L - R), Y = el => T + (hi - el) / (hi - lo) * (h - T - B);
    // everything below the horizon line is "not visible"
    ctx.fillStyle = '#ffffff0f'; ctx.fillRect(L, Y(0), w - L - R, h - B - Y(0));
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    const stp = niceStep(hi - lo);
    for (let e = Math.ceil(lo / stp) * stp; e <= hi; e += stp) {
      ctx.strokeStyle = e === 0 ? '#8a92a3' : '#ffffff10'; ctx.lineWidth = e === 0 ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(L, Y(e) + .5); ctx.lineTo(w - R, Y(e) + .5); ctx.stroke();
      ctx.fillStyle = e === 0 ? C.text : C.muted; ctx.textAlign = 'right';
      ctx.fillText(e === 0 ? t('horizon') : (e > 0 ? '+' : '') + e + '°', L - 6, Y(e));
    }
    if (h - B - Y(0) > 18) { ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(t('below_h'), w - R - 6, h - B - 4); ctx.textBaseline = 'middle'; }
    const dStep = S.dur <= 14 ? 1 : S.dur <= 30 ? 5 : 10;
    ctx.textAlign = 'center'; ctx.lineWidth = 1;
    for (let dd = 0; dd <= S.dur; dd += dStep) {
      ctx.strokeStyle = '#ffffff10'; ctx.beginPath(); ctx.moveTo(X(dd * 24) + .5, T); ctx.lineTo(X(dd * 24) + .5, h - B); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.fillText(dd + ' ' + t('d'), X(dd * 24), h - B + 14);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, w - L - R, h - T - B); ctx.clip();
    for (const k of KEYS) {
      const d = S.data[k], arr = d[key];
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash(k === 'B' ? [7, 5] : []);
      ctx.beginPath();
      for (let j = 0; j < d.n; j++) { const x = X(j * d.dtH), y = Y(arr[j]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // label each line directly instead of sending the reader to a legend
    ctx.font = '600 12px "Space Grotesk", sans-serif'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    KEYS.forEach((k, ki) => {
      const d = S.data[k], j = Math.floor((d.n - 1) * (ki ? 0.62 : 0.2)), txt = `${k} · ${siteName(k)}`;
      const x = Math.min(X(j * d.dtH), w - R - ctx.measureText(txt).width - 6);
      const y = Math.max(T + 9, Math.min(h - B - 9, Y(d[key][j]) + (ki ? 15 : -13)));
      ctx.strokeStyle = '#12151a'; ctx.lineWidth = 4; ctx.strokeText(txt, x, y);
      ctx.fillStyle = col; ctx.fillText(txt, x, y);
    });
    const cx = X(S.cur);
    ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(cx, T); ctx.lineTo(cx, h - B); ctx.stroke(); ctx.setLineDash([]);
    for (const k of KEYS) {
      const d = S.data[k], i = idxAt(k);
      ctx.fillStyle = col; ctx.strokeStyle = '#12151a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, Y(d[key][i]), 4.5, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = C.muted; ctx.textBaseline = 'middle';
    const lbl = `${t('sel_time')} · T+${fmtDur(S.cur)}`, right = cx + 8 + ctx.measureText(lbl).width < w - R;
    ctx.textAlign = right ? 'left' : 'right'; ctx.fillText(lbl, cx + (right ? 6 : -6), T - 10);
  }
  // Battery state of charge for both scenarios, on the same time axis as the elevation charts.
  function drawBatt() {
    const { ctx, w, h } = fit($('#chart-batt')), { L, R, T, B } = chartGeom, tot = S.dur * 24;
    const X = hr => L + hr / tot * (w - L - R), Y = v => T + (1 - v) * (h - T - B);
    ctx.fillStyle = '#ff7d6b1f'; ctx.fillRect(L, Y(1 - DOD), w - L - R, Y(0) - Y(1 - DOD)); // reserve band: the last 20%
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= 100; v += 20) {
      ctx.strokeStyle = v === 0 ? '#8a92a3' : '#ffffff10'; ctx.lineWidth = v === 0 ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(L, Y(v / 100) + .5); ctx.lineTo(w - R, Y(v / 100) + .5); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText(v + '%', L - 6, Y(v / 100));
    }
    ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(t('b_reserve'), w - R - 6, Y(0) - 4); ctx.textBaseline = 'middle';
    const dStep = S.dur <= 14 ? 1 : S.dur <= 30 ? 5 : 10;
    ctx.textAlign = 'center'; ctx.lineWidth = 1;
    for (let dd = 0; dd <= S.dur; dd += dStep) {
      ctx.strokeStyle = '#ffffff10'; ctx.beginPath(); ctx.moveTo(X(dd * 24) + .5, T); ctx.lineTo(X(dd * 24) + .5, h - B); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.fillText(dd + ' ' + t('d'), X(dd * 24), h - B + 14);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(L, T - 2, w - L - R, h - T - B + 4); ctx.clip();
    for (const k of KEYS) {
      const d = S.data[k], soc = d.pw.soc;
      ctx.strokeStyle = C.both; ctx.lineWidth = 2.5; ctx.setLineDash(k === 'B' ? [7, 5] : []);
      ctx.beginPath();
      for (let j = 0; j < d.n; j++) { const x = X(j * d.dtH), y = Y(soc[j]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = '600 12px "Space Grotesk", sans-serif'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    KEYS.forEach((k, ki) => {
      const d = S.data[k], j = Math.floor((d.n - 1) * (ki ? 0.62 : 0.2)), txt = `${k} · ${siteName(k)}`;
      const x = Math.min(X(j * d.dtH), w - R - ctx.measureText(txt).width - 6);
      const y = Math.max(T + 9, Math.min(h - B - 9, Y(d.pw.soc[j]) + (ki ? 15 : -13)));
      ctx.strokeStyle = '#12151a'; ctx.lineWidth = 4; ctx.strokeText(txt, x, y);
      ctx.fillStyle = C.both; ctx.fillText(txt, x, y);
    });
    const cx = X(S.cur);
    ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(cx, T); ctx.lineTo(cx, h - B); ctx.stroke(); ctx.setLineDash([]);
    for (const k of KEYS) {
      const d = S.data[k], i = idxAt(k);
      ctx.fillStyle = C.both; ctx.strokeStyle = '#12151a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, Y(d.pw.soc[i]), 4.5, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  // One line per scenario under the battery chart: does it survive, how low does it get, what would be enough.
  function renderBatt() {
    $('#batt-sum').innerHTML = KEYS.map(k => {
      const p = S.data[k].pw;
      return `<div class="bsum"><span class="badge ${k.toLowerCase()}">${k}</span><b>${siteName(k)}</b>
        <span class="pill ${p.state}"><b>${t('b_' + p.state)}</b></span>
        <span>${p.emptyH > 0 ? t('b_empty', { h: nf(Math.max(0.1, p.emptyH), p.emptyH < 10 ? 1 : 0) }) : t('b_min', { p: nf(p.min * 100) })}</span>
        <span>${t('b_need', { c: nf(Math.ceil(p.need * 10 - 1e-9) / 10, 1), m: nf(p.massKg) })}</span></div>`;
    }).join('');
  }
  function setPower(next) {
    for (const f in PWR_LIMITS) {
      const v = parseFloat(next[f]), [lo, hi] = PWR_LIMITS[f];
      if (!isNaN(v)) S.pwr[f] = Math.max(lo, Math.min(hi, v));
    }
    for (const k of KEYS) S.data[k].pw = powerSim(S.data[k], S.pwr);
    syncForms(); renderBatt(); renderTable(); renderCursor(); saveHash(); notify();
  }
  function drawChart() { drawElev('#chart-sun', 'sunM', C.sun); drawElev('#chart-earth', 'earthM', C.earth); drawBatt(); }

  /* ---------- year explorer ---------- */
  let yearTimer = 0;
  function scheduleYear() {
    clearTimeout(yearTimer);
    yearTimer = setTimeout(() => { for (const k of KEYS) { computeYear(k); drawYear(k); } }, 120);
  }
  function computeYear(k) {
    const sc = S.sc[k], st = Ephem.site(sc.lat, sc.lon), day0 = Math.floor(sc.start / DAY) * DAY, hz = horizonFn(sc);
    const key = [sc.lat, sc.lon, sc.mask, sc.site, day0].join('|');
    if (S.year[k] && S.year[k].key === key) return;
    const y = { key, day0, sun: new Float32Array(365), earth: new Float32Array(365), both: new Float32Array(365) };
    for (let dI = 0; dI < 365; dI++) for (let s = 0; s < 12; s++) {
      const o = Ephem.observe(st, day0 + dI * DAY + s * 2 * H);
      const su = o.sun.el > hz(o.sun.az) - o.sun.rad, eu = o.earth.el > hz(o.earth.az);
      if (su) y.sun[dI] += 2; if (eu) y.earth[dI] += 2; if (su && eu) y.both[dI] += 2;
    }
    S.year[k] = y;
  }
  function drawYear(k) {
    const y = S.year[k]; if (!y) return;
    const { ctx, w } = fit($('#year-' + k));
    const rowH = 30, cw = w / 365;
    ctx.fillStyle = '#191d24'; ctx.fillRect(0, 0, w, rowH);
    ctx.fillStyle = C.both;
    for (let i = 0; i < 365; i++) { // one row: hours per day with power AND comms together
      const v = y.both[i] / 24; if (!v) continue;
      ctx.globalAlpha = 0.12 + 0.88 * v; ctx.fillRect(i * cw, 0, Math.ceil(cw), rowH);
    }
    ctx.globalAlpha = 1;
    const off = (S.sc[k].start - y.day0) / DAY;
    ctx.strokeStyle = C.text; ctx.lineWidth = 1.5;
    ctx.strokeRect(off * cw + .75, .75, Math.max(3, S.dur * cw), rowH - 1.5);
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = C.muted; ctx.textBaseline = 'top';
    const d0 = new Date(y.day0);
    for (let m = 0; m < 13; m++) {
      const ms = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1), x = (ms - y.day0) / DAY * cw;
      if (x < 0 || x > w - 26) continue;
      ctx.fillRect(x, rowH, 1, 4);
      ctx.fillText(new Date(ms).toLocaleString(S.lang, { month: 'short', timeZone: 'UTC' }), x + 3, rowH + 4);
    }
  }
  function yearEvents(k) {
    const cv = $('#year-' + k);
    const dayAt = e => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(364, Math.floor((e.clientX - r.left) / r.width * 365))); };
    cv.addEventListener('mousemove', e => {
      const y = S.year[k]; if (!y) return; const i = dayAt(e);
      $('#year-read').textContent = `${k} · ` + t('year_cell', { d: fmtDate(y.day0 + i * DAY, false), s: y.sun[i], e: y.earth[i], b: y.both[i] });
    });
    cv.addEventListener('mouseleave', () => { $('#year-read').textContent = t('year_hint'); });
    cv.addEventListener('click', e => {
      const y = S.year[k]; if (!y) return;
      S.sc[k].start = y.day0 + dayAt(e) * DAY + (S.sc[k].start - y.day0) % DAY;
      refresh(true);
    });
  }

  /* ---------- globe ---------- */
  const G = { size: 760, full: 760, img: null, raf: 0, hits: [], idle: 0 };
  const RIM = 1 - 6 / 380; // disc radius as a fraction of the half-canvas, same at every render size
  const TILES = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/';
  function loadTexture(z) {
    const cols = 2 << z, rows = 1 << z, cv = document.createElement('canvas');
    cv.width = cols * 256; cv.height = rows * 256;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    let left = cols * rows, ok = true;
    function done() {
      if (--left || !ok) return;
      try {
        const px = cx.getImageData(0, 0, cv.width, cv.height).data, g = new Uint8Array(cv.width * cv.height);
        for (let i = 0; i < g.length; i++) g[i] = px[i * 4];
        S.globe.tex = { g, w: cv.width, h: cv.height }; queueGlobe();
        // sharper pass: 4096 x 2048 mosaic on capable devices
        if (z < 3 && (navigator.deviceMemory || 8) >= 4 && window.innerWidth > 700) loadTexture(3);
      } catch (e) { /* keep what we have */ }
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => { cx.drawImage(im, c * 256, r * 256); done(); };
      im.onerror = () => { ok = false; done(); };
      im.src = `${TILES}${z}/${r}/${c}.jpg`;
    }
  }
  // The Moon map embedded in data/moon_texture.js (no network needed); falls back to live NASA tiles.
  function loadEmbeddedTexture() {
    if (!window.MOON_TEXTURE) return false;
    const im = new Image();
    im.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(im, 0, 0);
        const px = cx.getImageData(0, 0, cv.width, cv.height).data, g = new Uint8Array(cv.width * cv.height);
        for (let i = 0; i < g.length; i++) g[i] = px[i * 4];
        S.globe.tex = { g, w: cv.width, h: cv.height }; queueGlobe();
      } catch (e) { loadTexture(2); }
    };
    im.onerror = () => loadTexture(2);
    im.src = window.MOON_TEXTURE;
    return true;
  }
  function globeBasis() {
    const f = S.globe.lat0 * D, l = S.globe.lon0 * D;
    return {
      fw: [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)],
      rt: [-Math.sin(l), Math.cos(l), 0],
      up: [-Math.sin(f) * Math.cos(l), -Math.sin(f) * Math.sin(l), Math.cos(f)]
    };
  }
  const globeTime = () => S.sc[S.globe.target].start + S.cur * H;
  // fast = true renders at half resolution (dragging, zooming, playback) and sharpens once things settle.
  function queueGlobe(fast) {
    clearTimeout(G.idle);
    G.size = fast === true ? G.full / 2 : G.full;
    if (fast === true) G.idle = setTimeout(() => queueGlobe(false), 160);
    if (!G.raf) G.raf = requestAnimationFrame(() => { G.raf = 0; if (S.tab === 'map') drawGlobe(); });
  }
  function drawGlobe() {
    const cv = $('#globe'), N = G.size;
    if (cv.width !== N) { cv.width = N; cv.height = N; }
    const ctx = cv.getContext('2d');
    if (!G.img || G.img.width !== N) G.img = ctx.createImageData(N, N);
    const px = G.img.data, { fw, rt, up } = globeBasis(), zoom = S.globe.zoom, tex = S.globe.tex;
    const fr = Ephem.frame(globeTime()), sp = Ephem.subPoint(fr.sun), ep = Ephem.subPoint(fr.earth);
    const sd = Ephem.site(sp.lat, sp.lon).u, light = S.globe.light;
    const half = N / 2, rad = half * RIM, PI = Math.PI;
    const tg = tex && tex.g, tw = tex && tex.w, th = tex && tex.h;
    // map layers from the LOLA grid: permanent shadow (ice traps) in blue, slope classes in green / amber / red
    // South of 80 S the picture comes from the LOLA grid: shaded relief instead of the stretched mosaic, plus the layers.
    const tmp = S.globe.temp;
    const lay = Polar.ready ? Polar.grid() : null, ice = S.globe.ice, slp = S.globe.slope && !tmp;
    const PN = lay ? lay.n : 0, PH = PN / 2, PQ = lay ? 2 * lay.R / lay.cell : 0, PP = lay && lay.psr, PS = lay && lay.slope, PE = lay && lay.elev, PC = lay ? lay.cell : 1;
    // the same north of 80 N (a coarser pack), and a coarse slope map for everything in between
    const nor = NORTH = Polar.north ? Polar.north() : null, wld = Polar.world ? Polar.world() : null;
    const NN = nor ? nor.n : 0, NH = NN / 2, NQ = nor ? 2 * nor.R / nor.cell : 0, NP = nor && nor.psr, NS = nor && nor.slope, NE = nor && nor.elev, NC = nor ? nor.cell : 1;
    const WS = wld && wld.slope, WW = wld ? wld.w : 0, WH = wld ? wld.h : 0, WP = wld ? wld.ppd : 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = (j * N + i) * 4;
      const sx = (i - half) / rad, sy = (half - j) / rad, s2 = sx * sx + sy * sy;
      if (s2 > 1) { px[o + 3] = 0; continue; }
      const x = sx / zoom, y = sy / zoom, z = Math.sqrt(1 - x * x - y * y);
      const vx = x * rt[0] + y * up[0] + z * fw[0], vy = x * rt[1] + y * up[1] + z * fw[1];
      let vz = x * rt[2] + y * up[2] + z * fw[2];
      vz = vz > 1 ? 1 : vz < -1 ? -1 : vz;
      let g;
      if (tg) { // bilinear sample of the equirectangular mosaic
        const fu = (Math.atan2(vy, vx) / PI + 1) / 2 * tw - 0.5, fv = Math.acos(vz) / PI * th - 0.5;
        let u0 = Math.floor(fu), v0 = Math.floor(fv);
        const du = fu - u0, dv = fv - v0;
        const u1 = (u0 + 1 + tw) % tw; u0 = (u0 + tw) % tw;
        const v1 = v0 + 1 > th - 1 ? th - 1 : v0 + 1; v0 = v0 < 0 ? 0 : v0;
        g = (tg[v0 * tw + u0] * (1 - du) + tg[v0 * tw + u1] * du) * (1 - dv) + (tg[v1 * tw + u0] * (1 - du) + tg[v1 * tw + u1] * du) * dv;
        g = (g - 105) * 1.22 + 118;
      } else {
        const lat = Math.asin(vz) / D, lon = Math.atan2(vy, vx) / D;
        g = (Math.abs(lat % 15) < 0.4 || Math.abs(lon % 15) < 0.4 / Math.max(0.05, Math.cos(lat * D))) ? 120 : 78;
      }
      // cell of the polar grid under this pixel, and how far inside the 80 S circle it is (0 at 80 S, 1 from 81 S)
      let pc = -1, pw = 0;
      if (lay && vz < POLE_EDGE) {
        const q = PQ / (1 - vz), ci = Math.floor(vy * q + PH), cj = Math.floor(PH - vx * q);
        if (ci > 0 && cj > 0 && ci < PN - 1 && cj < PN - 1) {
          pc = cj * PN + ci; pw = (POLE_EDGE - vz) / POLE_FADE; if (pw > 1) pw = 1;
          // shaded relief, blended between the four nearest cells so that close-ups stay smooth
          const fx = vy * q + PH - 0.5, fy = PH - vx * q - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fy), u = fx - i0, v = fy - j0;
          let sh;
          if (i0 > 0 && j0 > 0 && i0 < PN - 2 && j0 < PN - 2) {
            const c0 = j0 * PN + i0, c1 = c0 + 1, c2 = c0 + PN, c3 = c2 + 1;
            sh = (((PE[c0 - 1] - PE[c0 + 1]) - (PE[c0 - PN] - PE[c0 + PN])) * (1 - u) + ((PE[c1 - 1] - PE[c1 + 1]) - (PE[c1 - PN] - PE[c1 + PN])) * u) * (1 - v) +
              (((PE[c2 - 1] - PE[c2 + 1]) - (PE[c2 - PN] - PE[c2 + PN])) * (1 - u) + ((PE[c3 - 1] - PE[c3 + 1]) - (PE[c3 - PN] - PE[c3 + PN])) * u) * v;
          } else sh = (PE[pc - 1] - PE[pc + 1]) - (PE[pc - PN] - PE[pc + PN]);
          const hill = 128 + sh / (2 * PC) * 300;
          g = g * (1 - pw) + (hill < 25 ? 25 : hill > 240 ? 240 : hill) * pw;
        }
      }
      let nc = -1, nw = 0;
      if (nor && vz > -POLE_EDGE) {
        const q = NQ / (1 + vz), ci = Math.floor(vy * q + NH), cj = Math.floor(NH + vx * q);
        if (ci > 0 && cj > 0 && ci < NN - 1 && cj < NN - 1) {
          nc = cj * NN + ci; nw = (vz + POLE_EDGE) / POLE_FADE; if (nw > 1) nw = 1;
          const hill = 128 + ((NE[nc - 1] - NE[nc + 1]) - (NE[nc - NN] - NE[nc + NN])) / (2 * NC) * 300;
          g = g * (1 - nw) + (hill < 25 ? 25 : hill > 240 ? 240 : hill) * nw;
        }
      }
      let k = 1;
      if (light) { const c = vx * sd[0] + vy * sd[1] + vz * sd[2]; k = 0.3 + 0.8 * Math.max(0, Math.min(1, c * 6 + 0.1)) * (0.55 + 0.45 * Math.max(0, c)); }
      k *= 0.8 + 0.2 * Math.sqrt(1 - s2); // gentle limb darkening for depth
      g *= k; g = g < 0 ? 0 : g;
      let cr = g * 1.04, cg = g, cb = g * 0.95;
      if (tmp) { // estimated surface temperature at the selected moment (see surfaceTemp)
        const T = Math.max(0, Math.min(400, Math.round(surfaceTemp(vx, vy, vz, sd, lay)))) * 3;
        cr = cr * 0.22 + TEMP_LUT[T] * 0.78; cg = cg * 0.22 + TEMP_LUT[T + 1] * 0.78; cb = cb * 0.22 + TEMP_LUT[T + 2] * 0.78;
      }
      // slope and shadow under this pixel: the polar packs where they exist (weight lw), the coarse world map elsewhere
      let sv = -1, sh16 = 0, lw = 0;
      if (pc >= 0) { sv = PS[pc]; sh16 = PP[pc] & 31; lw = pw; } else if (nc >= 0) { sv = NS[nc]; sh16 = NP[nc] & 31; lw = nw; }
      if (slp) {
        if (WS && lw < 1) {
          const row = Math.min(WH - 1, Math.floor((90 - Math.asin(vz) / D) * WP)), col = Math.floor(((Math.atan2(vy, vx) / D + 360) % 360) * WP) % WW;
          const s = WS[row * WW + col] * 3, a = 0.42 * (1 - lw);
          cr = cr * (1 - a) + SLOPE_LUT[s] * a * k; cg = cg * (1 - a) + SLOPE_LUT[s + 1] * a * k; cb = cb * (1 - a) + SLOPE_LUT[s + 2] * a * k;
        }
        if (sv >= 0) { const s = sv * 3, a = 0.42 * lw; cr = cr * (1 - a) + SLOPE_LUT[s] * a * k; cg = cg * (1 - a) + SLOPE_LUT[s + 1] * a * k; cb = cb * (1 - a) + SLOPE_LUT[s + 2] * a * k; }
      }
      if (ice && sh16) { const a = (0.3 + 0.5 * sh16 / 16) * lw; cr = cr * (1 - a) + 50 * a; cg = cg * (1 - a) + 150 * a; cb = cb * (1 - a) + 255 * a; }
      px[o] = cr > 255 ? 255 : cr; px[o + 1] = cg > 255 ? 255 : cg; px[o + 2] = cb > 255 ? 255 : cb; px[o + 3] = 255;
    }
    ctx.putImageData(G.img, 0, 0);
    drawOverlay(sp, ep);
    $('#f-sun').textContent = fmtCoord(sp.lat, sp.lon);
    $('#f-earth').textContent = fmtCoord(ep.lat, ep.lon);
    $('#f-dist').textContent = nf(ep.dist) + ' km';
    // the readout respects the terrain horizon of the simulation: no Sun at this moment means night temperature
    const tk0 = S.globe.target, tu = Ephem.site(S.sc[tk0].lat, S.sc[tk0].lon).u, td = S.data[tk0], lit = !td || td.frac[idxAt(tk0)] > 0;
    const tK = lit ? surfaceTemp(tu[0], tu[1], tu[2], sd, Polar.ready ? Polar.grid() : null) : (facts(S.sc[tk0]).shadow >= 0.5 ? T_PSR : T_NIGHT);
    $('#f-temp').textContent = `${S.globe.target} · ${nf(tK)} K (${nf(tK - 273.15)} °C)`;
  }
  /* Surface temperature model for the map layer (K). Radiative equilibrium with the Sun at the selected moment:
     T = Tss * cos(i)^(1/4), Tss = 386 K (albedo 0.12, emissivity 0.95, 1361 W/m2); unlit ground is held at 95 K
     (typical lunar night), permanently shadowed ground at 50 K. Inside the LOLA grid the incidence angle uses the
     local slope of the terrain, so sunlit crater walls come out warm and slopes facing away cold. Shadows cast by
     distant terrain are only known where the NASA permanent-shadow map marks them. A model, not a measurement. */
  const T_SUBSOLAR = Math.pow(1361 * 0.88 / (0.95 * 5.670374e-8), 0.25), T_NIGHT = 95, T_PSR = 50;
  const POLE_EDGE = -Math.sin(80 * D), POLE_FADE = Math.sin(81 * D) - Math.sin(80 * D); // unit-vector z at 80 S, and the 80-81 S blend band
  // slope classes by quarter degree: under 5 deg green, to 8 light green, to 15 amber, above red
  const SLOPE_LUT = new Uint8Array(256 * 3);
  for (let s = 0; s < 256; s++) SLOPE_LUT.set(s <= 20 ? [60, 200, 120] : s <= 32 ? [150, 210, 90] : s <= 60 ? [240, 180, 60] : [235, 90, 70], s * 3);
  let NORTH = null; // the north pack of the current frame, for the permanent shadow in surfaceTemp
  function surfaceTemp(vx, vy, vz, sd, lay) {
    let c = vx * sd[0] + vy * sd[1] + vz * sd[2], shadow = 0;
    if (lay && vz < POLE_EDGE) {
      const w = Math.min(1, (POLE_EDGE - vz) / POLE_FADE), c0 = c;
      const n = lay.n, q = 2 * lay.R / lay.cell / (1 - vz), ci = Math.floor(vy * q + n / 2), cj = Math.floor(n / 2 - vx * q);
      if (ci > 0 && cj > 0 && ci < n - 1 && cj < n - 1) {
        const o = cj * n + ci, E = lay.elev, gx = (E[o + 1] - E[o - 1]) / (2 * lay.cell), gy = (E[o - n] - E[o + n]) / (2 * lay.cell);
        const rho = Math.sqrt(vx * vx + vy * vy) || 1e-9, sl = vy / rho, cl = vx / rho, gN = gx * sl + gy * cl, gE = gx * cl - gy * sl;
        // local surface normal = up - slope along north * north - slope along east * east
        const nx = vx - gN * (-vz * cl) - gE * (-sl), ny = vy - gN * (-vz * sl) - gE * cl, nz = vz - gN * rho;
        c = c0 * (1 - w) + w * (nx * sd[0] + ny * sd[1] + nz * sd[2]) / Math.sqrt(nx * nx + ny * ny + nz * nz);
        shadow = w * (lay.psr[o] & 31) / 16;
      }
    }
    else if (NORTH && vz > -POLE_EDGE) {
      const n = NORTH.n, q = 2 * NORTH.R / NORTH.cell / (1 + vz), ci = Math.floor(vy * q + n / 2), cj = Math.floor(n / 2 + vx * q);
      if (ci >= 0 && cj >= 0 && ci < n && cj < n) shadow = Math.min(1, (vz + POLE_EDGE) / POLE_FADE) * (NORTH.psr[cj * n + ci] & 31) / 16;
    }
    const lit = c > 0 ? Math.max(T_NIGHT, T_SUBSOLAR * Math.sqrt(Math.sqrt(c))) : T_NIGHT;
    return lit * (1 - shadow) + T_PSR * shadow;
  }
  // colour ramp 0..400 K: violet (40 K) - blue (100) - teal (170) - yellow (250) - orange (320) - white-hot (390)
  const TEMP_STOPS = [[0, 30, 10, 60], [40, 60, 30, 130], [100, 40, 100, 220], [170, 40, 190, 170], [250, 245, 215, 70], [320, 245, 120, 40], [390, 255, 245, 235], [400, 255, 255, 255]];
  const TEMP_LUT = new Uint8Array(401 * 3);
  for (let T = 0, s = 0; T <= 400; T++) {
    while (T > TEMP_STOPS[s + 1][0]) s++;
    const a = TEMP_STOPS[s], b = TEMP_STOPS[s + 1], f = (T - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) TEMP_LUT[T * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
  }
  function drawOverlay(sp, ep) {
    const N = G.size, half = N / 2, rad = half * RIM, zoom = S.globe.zoom, { fw, rt, up } = globeBasis();
    const { ctx: oc, w } = fit($('#globe-ov')), sc = w / N;
    const dv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const proj = (lat, lon) => {
      const u = Ephem.site(lat, lon).u, x = dv(u, rt) * zoom, y = dv(u, up) * zoom;
      if (dv(u, fw) <= 0.02 || x * x + y * y > 0.97) return null;
      return [(half + x * rad) * sc, (half - y * rad) * sc];
    };
    oc.strokeStyle = '#ffffff30'; oc.lineWidth = 1; oc.beginPath(); oc.arc(half * sc, half * sc, rad * sc, 0, 7); oc.stroke();
    const placed = [];
    const label = (p, text, font, col, off) => {
      oc.font = font;
      const tw = oc.measureText(text).width, right = p[0] + off + tw < w - 4;
      const x = right ? p[0] + off : p[0] - off - tw, y = p[1];
      const r = [x - 3, y - 8, x + tw + 3, y + 8];
      if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) return;
      placed.push(r);
      oc.textAlign = 'left'; oc.textBaseline = 'middle'; oc.lineJoin = 'round';
      oc.strokeStyle = '#000000cc'; oc.lineWidth = 3.5; oc.strokeText(text, x, y);
      oc.fillStyle = col; oc.fillText(text, x, y);
    };
    const F = '600 12px "Space Grotesk", sans-serif', FI = 'italic 500 11.5px "Space Grotesk", sans-serif';
    // scenario pins
    const pin = (s, col, txt) => {
      const p = proj(s.lat, s.lon); if (!p) return;
      placed.push([p[0] - 12, p[1] - 12, p[0] + 12, p[1] + 12]);
      oc.fillStyle = col; oc.strokeStyle = '#0a0c0f'; oc.lineWidth = 2;
      oc.beginPath(); oc.arc(p[0], p[1], 11, 0, 7); oc.fill(); oc.stroke();
      oc.fillStyle = '#0a0c0f'; oc.font = '600 12px "JetBrains Mono", monospace'; oc.textAlign = 'center'; oc.textBaseline = 'middle';
      oc.fillText(txt, p[0], p[1] + .5);
    };
    G.hits = [];
    const dots = [];
    for (const s of SITES) {
      const p = proj(s.lat, s.lon); if (!p) continue;
      G.hits.push({ x: p[0], y: p[1], id: s.id }); dots.push([p, s]);
    }
    const ring = (pt, col) => {
      const p = proj(pt.lat, pt.lon); if (!p) return;
      oc.strokeStyle = col; oc.lineWidth = 2; oc.beginPath(); oc.arc(p[0], p[1], 9, 0, 7); oc.stroke();
      oc.fillStyle = col; oc.beginPath(); oc.arc(p[0], p[1], 2.5, 0, 7); oc.fill();
    };
    ring(sp, C.sun); ring(ep, C.earth);
    for (const [p, s] of dots) {
      oc.fillStyle = s.g === 'pole' ? C.both : '#ffffff'; oc.strokeStyle = '#000000aa'; oc.lineWidth = 1.5;
      oc.beginPath(); oc.arc(p[0], p[1], 3.6, 0, 7); oc.fill(); oc.stroke();
    }
    // region scan: one dot per scored point, numbered rings on the best ones
    const sct = S.scout && S.globe.heat ? S.scout : null;
    if (sct) {
      const kmPx = rad * zoom * sc / 1737.4;
      oc.globalAlpha = 0.78;
      for (const pt of sct.pts) {
        const p = proj(pt.lat, pt.lon); if (!p) continue;
        oc.fillStyle = heatColor(heatValue(pt));
        oc.beginPath(); oc.arc(p[0], p[1], Math.max(1.6, pt.km * kmPx * 0.5), 0, 7); oc.fill();
      }
      oc.globalAlpha = 1;
      sct.top.forEach((pt, i) => {
        const p = proj(pt.lat, pt.lon); if (!p) return;
        placed.push([p[0] - 11, p[1] - 11, p[0] + 11, p[1] + 11]);
        oc.fillStyle = '#0a0c0f'; oc.strokeStyle = '#ffffff'; oc.lineWidth = 2;
        oc.beginPath(); oc.arc(p[0], p[1], 9.5, 0, 7); oc.fill(); oc.stroke();
        oc.fillStyle = '#ffffff'; oc.font = '600 11px "JetBrains Mono", monospace'; oc.textAlign = 'center'; oc.textBaseline = 'middle';
        oc.fillText(i + 1, p[0], p[1] + .5);
      });
    }
    // NASA study regions (about 15 x 15 km each): gold = on the October 2024 Artemis III list
    if (S.globe.regions) {
      const rPx = 8.46 * rad * zoom * sc / 1737.4;
      for (const r of REGIONS) {
        const p = proj(r.lat, r.lon); if (!p) continue;
        oc.strokeStyle = r.a24 ? '#ffd166' : '#ffffff99'; oc.lineWidth = r.a24 ? 2 : 1.2; oc.setLineDash(r.a24 ? [] : [4, 4]);
        oc.beginPath(); oc.arc(p[0], p[1], Math.max(3, rPx), 0, 7); oc.stroke(); oc.setLineDash([]);
        oc.font = FI; // a region that is also a listed site is already named by its site dot
        if (S.globe.labels && zoom >= 3 && !SITES.some(s => s.name === r.name)) label([p[0], p[1] - Math.max(3, rPx) - 8], r.name, FI, r.a24 ? '#ffd166' : '#ffffffcc', -oc.measureText(r.name).width / 2);
      }
      if (S.regions) for (const row of S.regions.rows) if (row.best) {
        const p = proj(row.best.lat, row.best.lon); if (!p) continue;
        oc.fillStyle = '#ffd166'; oc.strokeStyle = '#0a0c0f'; oc.lineWidth = 1.5; oc.beginPath(); oc.arc(p[0], p[1], 4.2, 0, 7); oc.fill(); oc.stroke();
      }
    }
    // rover route from the selected scenario to the nearest large ice trap
    const rt2 = S.globe.route ? routeFor(S.sc[S.globe.target]) : null;
    if (rt2 && rt2.found && rt2.path.length > 1) {
      oc.strokeStyle = '#0a0c0f'; oc.lineWidth = 5; oc.lineJoin = 'round'; oc.lineCap = 'round';
      for (const pass of [0, 1]) {
        oc.beginPath(); let pen = false;
        for (const [la, lo] of rt2.path) { const p = proj(la, lo); if (!p) { pen = false; continue; } pen ? oc.lineTo(p[0], p[1]) : oc.moveTo(p[0], p[1]); pen = true; }
        oc.stroke(); oc.strokeStyle = rt2.relaxed ? '#ffb648' : '#7fe3ff'; oc.lineWidth = 2.5;
      }
      const end = rt2.path[rt2.path.length - 1], pe = proj(end[0], end[1]);
      if (pe) { oc.fillStyle = '#7fe3ff'; oc.strokeStyle = '#0a0c0f'; oc.lineWidth = 1.5; oc.beginPath(); oc.moveTo(pe[0], pe[1] - 6); oc.lineTo(pe[0] + 6, pe[1]); oc.lineTo(pe[0], pe[1] + 6); oc.lineTo(pe[0] - 6, pe[1]); oc.closePath(); oc.fill(); oc.stroke(); }
    }
    pin(S.sc.B, C.b, 'B'); pin(S.sc.A, C.text, 'A');
    if (S.globe.labels && S.globe.ice && Polar.ready && zoom >= 2)
      for (const [name, la, lo] of Polar.CRATERS) { const p = proj(la, lo); if (p) label([p[0], p[1]], name, FI, '#a9d4ff', 2); }
    if (S.globe.labels) {
      for (const k of KEYS) { const p = proj(S.sc[k].lat, S.sc[k].lon); if (p) label(p, siteName(k), F, '#ffffff', 16); }
      for (const [p, s] of dots) label(p, s.name, F, s.g === 'pole' ? '#c9f5e2' : '#ffffff', 8);
      for (const m of LANDMARKS) { const p = proj(m.lat, m.lon); if (p) label(p, m.name, FI, '#d7dbe4c0', 2); }
    }
  }
  const heatColor = v => v >= 75 ? '#35c98a' : v >= 65 ? '#8fd96a' : v >= 55 ? '#e8d44d' : v >= 45 ? '#f0a03c' : '#e5534b';
  // what the scan dots are coloured by: the score, or the Sun / Earth visibility share rescaled to the same ramp
  const heatValue = pt => S.globe.heatBy === 'sun' ? 35 + pt.sun * 45 : S.globe.heatBy === 'earth' ? 35 + pt.earth * 45 : pt.score;
  const REGIONS = window.REGIONS || [];
  // up to 40x: at the pole the LOLA relief stays sharp enough to follow a rover route (about 90 km across)
  function setZoom(z) { S.globe.zoom = Math.max(1, Math.min(40, z)); queueGlobe(true); }
  function globeEvents() {
    const wrap = $('#globe-wrap'); let drag = null;
    wrap.addEventListener('pointerdown', e => {
      if (e.target.closest('.zoom-btns')) return;
      drag = { x: e.clientX, y: e.clientY, lat: S.globe.lat0, lon: S.globe.lon0, moved: false }; wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, r = wrap.getBoundingClientRect().width / 2 * S.globe.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      S.globe.lon0 = drag.lon - dx / r * 57.3; S.globe.lat0 = Math.max(-90, Math.min(90, drag.lat + dy / r * 57.3));
      queueGlobe(true);
    });
    wrap.addEventListener('pointerup', e => {
      const d = drag; drag = null; if (!d || d.moved) return;
      const r = wrap.getBoundingClientRect(), half = r.width / 2, rad = half * RIM;
      const px = e.clientX - r.left, py = e.clientY - r.top, k = S.globe.target;
      const hit = G.hits.map(h => [Math.hypot(h.x - px, h.y - py), h]).filter(h => h[0] < 13).sort((a, b) => a[0] - b[0])[0];
      if (hit) setSite(k, hit[1].id);
      else {
        const x = (px - half) / rad / S.globe.zoom, y = (half - py) / rad / S.globe.zoom;
        if ((px - half) ** 2 + (py - half) ** 2 > rad * rad) return;
        const z = Math.sqrt(1 - x * x - y * y), { fw, rt, up } = globeBasis();
        const v = [0, 1, 2].map(i => x * rt[i] + y * up[i] + z * fw[i]);
        setPoint(k, Math.asin(Math.max(-1, Math.min(1, v[2]))) / D, Math.atan2(v[1], v[0]) / D);
      }
      refresh();
      if (window.AAssist) window.AAssist.onPick(k);
    });
    wrap.addEventListener('wheel', e => { e.preventDefault(); setZoom(S.globe.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: false });
    $('#zin').addEventListener('click', () => setZoom(S.globe.zoom * 1.4));
    $('#zout').addEventListener('click', () => setZoom(S.globe.zoom / 1.4));
    $('#views').addEventListener('click', e => {
      const v = e.target.dataset.view; if (!v) return;
      const g = S.globe;
      if (v === 'near') Object.assign(g, { lat0: 0, lon0: 0, zoom: 1 });
      else if (v === 'far') Object.assign(g, { lat0: 0, lon0: 180, zoom: 1 });
      else if (v === 'south') Object.assign(g, { lat0: -90, lon0: 0, zoom: 4 });
      else if (v === 'north') Object.assign(g, { lat0: 90, lon0: 0, zoom: 4 });
      else Object.assign(g, { lat0: S.sc[v].lat, lon0: S.sc[v].lon, zoom: 4 });
      queueGlobe();
    });
    $('#target').addEventListener('click', e => { if (e.target.dataset.t) { S.globe.target = e.target.dataset.t; syncForms(); queueGlobe(); notify(); } });
    $('#light').addEventListener('change', e => { S.globe.light = e.target.checked; queueGlobe(); });
    $('#labels').addEventListener('change', e => { S.globe.labels = e.target.checked; queueGlobe(); });
    for (const id of LAYERS) $('#lay-' + id).addEventListener('change', e => {
      S.globe[id] = e.target.checked;
      if (e.target.checked && id === 'temp') S.globe.slope = false; // temperature and slope colour the same ground: one at a time
      if (e.target.checked && id === 'slope') S.globe.temp = false;
      syncForms(); queueGlobe();
    });
    $('#heat-by').addEventListener('click', e => { if (e.target.dataset.by) { S.globe.heatBy = e.target.dataset.by; syncForms(); queueGlobe(); } });
  }

  /* ---------- time bar ---------- */
  function renderCursor() {
    const tot = S.dur * 24;
    $('#scrub').value = Math.round(S.cur / tot * 1000);
    $('#tb-met').textContent = 'T+' + fmtDur(S.cur);
    $('#tb-a').textContent = fmtDate(S.sc.A.start + S.cur * H);
    $('#tb-b').textContent = fmtDate(S.sc.B.start + S.cur * H);
    for (const el of $$('.wcur')) el.style.left = (S.cur / tot * 100) + '%';
    if (S.tab === 'sky') for (const k of KEYS) { drawSky(k); renderNow(k); }
    if (S.tab === 'time') drawChart();
    if (S.tab === 'map' && (S.globe.light || S.globe.temp)) queueGlobe(S.playing); // both follow the mission clock
    if (S.tab === 'resources') renderVerify();
  }
  let last = 0;
  function tick(ts) {
    if (!S.playing) return;
    const dt = Math.min(100, ts - (last || ts)); last = ts;
    const tot = S.dur * 24;
    S.cur += tot * dt / 20000 * parseFloat($('#speed').value);
    if (S.cur >= tot) S.cur = 0;
    renderCursor();
    requestAnimationFrame(tick);
  }
  function setPlaying(p) {
    S.playing = p; last = 0;
    $('#play').textContent = p ? '❚❚' : '▶';
    $('#play').setAttribute('aria-label', t(p ? 'pause' : 'play'));
    if (p) requestAnimationFrame(tick);
  }

  /* ---------- tabs, i18n, resources, state ---------- */
  function showTab(id) {
    S.tab = id;
    $$('main > section').forEach(s => { s.hidden = s.id !== id; });
    $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    window.scrollTo(0, 0);
    redrawVisible();
  }
  function redrawVisible() {
    renderCursor();
    if (S.tab === 'time') for (const k of KEYS) drawYear(k);
    if (S.tab === 'map') queueGlobe();
  }
  function applyLang() {
    document.documentElement.lang = S.lang;
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    for (const g of ['lunar', 'partner'])
      $('#res-' + g).innerHTML = RESOURCES.filter(r => r.g === g).map(r =>
        `<a class="res" href="${r.url}" target="_blank" rel="noopener"><small>${r.org}</small><b>${r.name}</b><span>${r[S.lang]}</span></a>`).join('');
  }
  function saveHash() {
    const enc = k => { const s = S.sc[k]; return [s.site, s.lat, s.lon, toLocal(s.start), s.mask].join('|'); };
    try { history.replaceState(null, '', `#a=${enc('A')}&b=${enc('B')}&d=${S.dur}&l=${S.lang}&p=${S.pwr.load}|${S.pwr.cap}|${S.pwr.area}`); } catch (e) { /* sandboxed viewers refuse it */ }
  }
  function loadHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const k of KEYS) {
      const v = (p.get(k.toLowerCase()) || '').split('|'); if (v.length !== 5) continue;
      const lat = parseFloat(v[1]), lon = parseFloat(v[2]), st = fromLocal(v[3]), mk = v[4] === 'lola' ? 'lola' : parseFloat(v[4]);
      if ([lat, lon, st].some(isNaN) || Math.abs(lat) > 90) continue;
      S.sc[k] = { site: SITES.some(s => s.id === v[0]) ? v[0] : 'custom', lat, lon, start: st, mask: mk === 'lola' || MASKS.some(m => m[0] === mk) ? mk : 0 };
    }
    const d = parseFloat(p.get('d')); if (DURS.includes(d)) S.dur = d;
    if (I18N[p.get('l')]) S.lang = p.get('l');
    const pw = (p.get('p') || '').split('|').map(parseFloat);
    if (pw.length === 3 && !pw.some(isNaN)) ['load', 'cap', 'area'].forEach((f, i) => { S.pwr[f] = Math.max(PWR_LIMITS[f][0], Math.min(PWR_LIMITS[f][1], pw[i])); });
  }
  function csv(k) {
    const d = S.data[k], sc = S.sc[k], rows = ['utc,sun_elevation_deg,sun_azimuth_deg,sun_disc_fraction,earth_elevation_deg,earth_azimuth_deg,earth_visible'];
    for (let i = 0; i < d.n; i++) rows.push([new Date(sc.start + i * d.dtH * H).toISOString(), d.sunEl[i].toFixed(3), d.sunAz[i].toFixed(2), d.frac[i].toFixed(3), d.earthEl[i].toFixed(3), d.earthAz[i].toFixed(2), d.earthUp[i]].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = `astroapex_${k}_${sc.lat}_${sc.lon}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const hooks = [];
  function notify() { if (window.AAssist) window.AAssist.onRefresh(); for (const fn of hooks) fn(); }

  // Which ephemeris produced the numbers on screen.
  function renderSource() {
    const srcs = KEYS.map(k => S.data[k].src), spice = srcs.every(x => x === 'spice'), ae = srcs.every(x => x === 'ae');
    const b = $('#eph-badge');
    b.className = 'eph-badge ' + (spice ? 'spice' : 'ae');
    b.textContent = t(spice ? 'eph_spice' : ae ? 'eph_ae' : 'eph_mixed');
    b.title = t(spice ? 'eph_spice_tip' : 'eph_ae_tip');
  }
  // Live cross-check: the same instant from NASA SPICE (DE440) and from astronomy-engine.
  function renderVerify() {
    const el = $('#verify'); if (!el) return;
    const sgn = v => (v >= 0 ? '+' : '−') + nf(Math.abs(v), 4) + '°';
    let rows = '', worst = 0, have = false;
    for (const k of KEYS) {
      const sc = S.sc[k], st = Ephem.site(sc.lat, sc.lon), c = Ephem.crossCheck(st, sc.start + S.cur * H);
      for (const body of ['sun', 'earth']) {
        const a = c.spice && c.spice[body], b = c.ae && c.ae[body];
        const dEl = a && b ? a.el - b.el : null;
        if (dEl != null) {
          const dAz = ((a.az - b.az + 540) % 360) - 180;
          worst = Math.max(worst, Math.abs(dEl), Math.abs(dAz) * Math.cos(a.el * D)); have = true;
        }
        const f = (o, key, dec) => o ? nf(o[key], dec) + '°' : '—';
        rows += `<tr><td><span class="badge ${k.toLowerCase()}">${k}</span> ${t(body)}</td>
          <td>${f(a, 'el', 4)}</td><td>${f(b, 'el', 4)}</td><td>${dEl == null ? '—' : sgn(dEl)}</td>
          <td>${f(a, 'az', 3)}</td><td>${f(b, 'az', 3)}</td></tr>`;
      }
    }
    el.innerHTML = `<table><thead><tr><th>${t('v_what')}</th><th>${t('v_el')} · SPICE</th><th>${t('v_el')} · astronomy-engine</th><th>Δ</th>
      <th>${t('azim')} · SPICE</th><th>${t('azim')} · astronomy-engine</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="hint">${have ? t('v_sum', { d: nf(worst, 4) }) : t('v_none')}</p>`;
    const m = Ephem.meta;
    $('#verify-meta').textContent = m ? `${m.source} · ${m.ephemeris} · ${m.frame} · ${m.abcorr} · ${new Date(Ephem.range[0]).getUTCFullYear()}–${new Date(Ephem.range[1]).getUTCFullYear()}` : t('v_notable');
  }

  function refresh(keepYear) {
    S.cur = Math.min(S.cur, S.dur * 24);
    for (const k of KEYS) { normalize(S.sc[k]); compute(k); }
    syncForms(); renderVerdict(); renderWindows(); renderTable(); renderBatt(); renderSource(); renderCursor(); saveHash();
    if (S.tab === 'map') queueGlobe();
    if (keepYear) for (const k of KEYS) { computeYear(k); drawYear(k); } else scheduleYear();
    notify();
  }

  function init() {
    if (!Ephem.hasSpice && !Ephem.hasAE) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:20px;color:#ff7d6b">Ephemeris data could not be loaded (data/spice_table.js and js/vendor/astronomy.browser.min.js were not found).</p>'); return; }
    loadHash();
    for (const k of KEYS) { buildScenario(k); buildSky(k); yearEvents(k); }
    fillSelects(); applyLang(); globeEvents(); if (!loadEmbeddedTexture()) loadTexture(2);

    $$('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    // Keyboard: 1-5 tabs, Space play/pause, arrows step the mission clock (Shift = 1 day).
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Typing fields keep every key; buttons, summaries and checkboxes keep Space/Enter; the slider keeps its arrows.
      const a = document.activeElement || document.body, tag = a.tagName, ty = a.type;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && ty !== 'checkbox' && ty !== 'range')) return;
      if ((tag === 'BUTTON' || tag === 'SUMMARY' || ty === 'checkbox') && (e.key === ' ' || e.key === 'Enter')) return;
      if (ty === 'range' && e.key.startsWith('Arrow')) return;
      const tabs = ['compare', 'sky', 'time', 'map', 'resources'];
      if (e.key >= '1' && e.key <= '5') showTab(tabs[+e.key - 1]);
      else if (e.key === ' ') { e.preventDefault(); setPlaying(!S.playing); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        S.cur = Math.max(0, Math.min(S.dur * 24, S.cur + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 24 : 1)));
        renderCursor();
      }
    });
    document.addEventListener('toggle', e => { if (e.target.tagName === 'DETAILS' && e.target.open) redrawVisible(); }, true);
    $('#dur').addEventListener('change', e => { S.dur = parseFloat(e.target.value); refresh(true); });
    $('#presets').addEventListener('click', e => { if (e.target.dataset.preset) applyPreset(e.target.dataset.preset); });
    for (const f of ['load', 'cap', 'area']) $('#pw-' + f).addEventListener('change', e => setPower({ [f]: e.target.value }));
    $('#slips').addEventListener('click', e => {
      const v = e.target.dataset.slip; if (!v) return;
      if (v === 'swap') [S.sc.A, S.sc.B] = [S.sc.B, S.sc.A];
      else S.sc.B = Object.assign({}, S.sc.A, { start: S.sc.A.start + parseFloat(v) * DAY });
      refresh();
    });
    $('#lang').addEventListener('click', e => {
      if (!e.target.dataset.lang) return;
      S.lang = e.target.dataset.lang; fillSelects(); applyLang(); refresh(true);
    });
    $('#share').addEventListener('click', async e => {
      const b = e.currentTarget; let ok = false;
      try { await navigator.clipboard.writeText(location.href); ok = true; } catch (err) { // plain http or a sandbox: old-style copy
        try {
          const ta = document.createElement('textarea'); ta.value = location.href; ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
        } catch (e2) { /* clipboard unavailable */ }
      }
      if (ok) { b.textContent = t('copied'); setTimeout(() => { b.textContent = t('share'); }, 1500); }
    });
    $$('[data-csv]').forEach(b => b.addEventListener('click', () => csv(b.dataset.csv)));
    $('#scrub').addEventListener('input', e => { S.cur = e.target.value / 1000 * S.dur * 24; renderCursor(); });
    $('#play').addEventListener('click', () => setPlaying(!S.playing));
    for (const id of ['#chart-sun', '#chart-earth', '#chart-batt']) { // drag on any chart to move the mission clock
      const ch = $(id); let chDown = false;
      const chSet = e => {
        const r = ch.getBoundingClientRect(), { L, R } = chartGeom;
        S.cur = Math.max(0, Math.min(1, (e.clientX - r.left - L) / (r.width - L - R))) * S.dur * 24; renderCursor();
      };
      ch.addEventListener('pointerdown', e => { chDown = true; ch.setPointerCapture(e.pointerId); chSet(e); });
      ch.addEventListener('pointermove', e => { if (chDown) chSet(e); });
      ch.addEventListener('pointerup', () => { chDown = false; });
    }
    let rz = 0;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(redrawVisible, 100); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawVisible);

    // shared API for the assistant module
    window.AA = {
      S, KEYS, DURS, TERRAIN, Polar, C, t, nf, fmtDur, fmtDate, fmtCoord, fmtDay, siteName, winSummary, idxAt, hasTerrain, terrainOK, horizonSrc, countdown, showTab, refresh,
      simulate, setSite, setPoint, stepMin, facts, powerSim, setPower, applyPreset, queueGlobe, syncForms, heatColor, horizonFn, routeFor, surfaceTemp, REGIONS, ROVER_KMH,
      POWER: { PV_EFF, CHG_EFF, DOD, WH_KG },
      onChange(fn) { hooks.push(fn); } // other modules re-render after every recomputation
    };
    showTab('compare');
    refresh();
    // The terrain pack unpacks a moment after the first paint: recompute once real horizons and ground facts exist.
    // On failure the refresh lets normalize() drop a 'lola' horizon that was kept while waiting.
    if (!Polar.ready && !Polar.failed) Polar.onSettled(() => { if (Polar.ready) { S.year = {}; skyCache.clear(); factCache.clear(); routeCache.clear(); } refresh(); });
  }
  init();
})();
