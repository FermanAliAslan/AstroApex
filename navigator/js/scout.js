/* Region scan: find the best landing points around the south pole instead of only comparing two.

   What it does, for the start date of the selected scenario and the current mission length:
     1. lays an 8 km grid over everything south of 84 S (about 1,600 points);
     2. drops points that cannot be landing sites: mean slope above 12 deg, less than half of the 1 km
        footprint under 8 deg, or ground in permanent shadow;
     3. rounds every candidate to the coordinates accepted by the scenario cards, then uses the card's
        skyline and time sampling to compare all eligible points on the same basis;
     4. repeats step 2-3 on a 2 km grid around the eight best sampled areas;
     5. keeps the five best sampled points that are at least 6 km apart.
   The work is cut into short slices so the page stays responsive, and the result is drawn on the 3D map. */
(function () {
  'use strict';
  const AA = window.AA, AS = window.AAssist;
  if (!AA || !AS) return;
  const { S, KEYS, t, nf } = AA, Polar = AA.Polar;
  const $ = s => document.querySelector(s);
  const LAT_LIMIT = -84, COARSE_KM = 8, FINE_KM = 2, MAX_SLOPE = 12, MIN_SAFE = 0.5, MAX_SHADOW = 0.25;
  const box = $('#scout'), out = $('#scout-out'), bar = $('#scout-bar'), btn = $('#scout-run');
  if (!box) return;
  let token = 0, running = null;

  const pause = () => new Promise(r => setTimeout(r, 0));
  const landable = (lat, lon) => {
    const st = Polar.slopeStats(lat, lon, 1);
    return !!st && st.mean <= MAX_SLOPE && st.safe >= MIN_SAFE && Polar.psr(lat, lon) < MAX_SHADOW;
  };
  // Evaluate the exact coordinates and sampling a scenario card uses after selection.
  function scorePoint(lat, lon, start, dur, km) {
    lat = +lat.toFixed(3); lon = +lon.toFixed(3);
    if (!landable(lat, lon)) return null;
    const sc = { site: 'custom', lat, lon, start, mask: 'lola' };
    const d = AA.simulate(sc, dur, AA.stepMin(dur)), a = AS.evaluate(sc, d), s = d.stats;
    return {
      lat, lon, km, mask: sc.mask, score: a.score, sun: s.sun / s.total, earth: s.earth / s.total, both: s.both, dark: s.dark,
      slope: a.f.slope ? a.f.slope.mean : null, safe: a.f.slope ? a.f.slope.safe : null, trapKm: a.f.trap ? a.f.trap.km : null, trap: a.f.trap ? a.f.trap.name : null
    };
  }
  // great-circle distance in km (valid anywhere on the Moon)
  const RAD = Math.PI / 180;
  const apart = (a, b) => {
    const h = Math.sin((b.lat - a.lat) * RAD / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin((b.lon - a.lon) * RAD / 2) ** 2;
    return 2 * 1737.4 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  // Whole-Moon scan: 2,600 points spread evenly over the sphere (about 120 km apart). South of 82 S a point gets its
  // real skyline and measured ground; everywhere else the horizon is flat and the slope comes from the coarse world map.
  const MOON_POINTS = 2600, MOON_KM = 120, MOON_MAX_SLOPE = 8;
  function scoreCoarse(lat, lon, start, dur) {
    lat = +lat.toFixed(3); lon = +lon.toFixed(3);
    const sc = { site: 'custom', lat, lon, start, mask: 0 }, cs = Polar.coarseSlope ? Polar.coarseSlope(lat, lon) : null;
    if (cs && cs.mean > MOON_MAX_SLOPE) return null;
    const d = AA.simulate(sc, dur, AA.stepMin(dur)), a = AS.evaluate(sc, d), s = d.stats;
    return { lat, lon, km: MOON_KM, mask: sc.mask, score: a.score, sun: s.sun / s.total, earth: s.earth / s.total, both: s.both, dark: s.dark, slope: cs ? cs.mean : null, safe: cs ? cs.safe : null, trapKm: null, trap: null };
  }
  function pickTop(list, count, gapKm) {
    const sorted = [...list].sort((a, b) => b.score - a.score || b.both - a.both || (a.slope || 0) - (b.slope || 0)), pick = [];
    for (const p of sorted) { if (pick.every(q => apart(p, q) >= gapKm)) pick.push(p); if (pick.length === count) break; }
    return pick;
  }

  function progress(v) {
    bar.hidden = v == null; btn.disabled = v != null;
    if (v != null) { bar.firstElementChild.style.width = Math.round(v * 100) + '%'; btn.textContent = t('sct_busy', { p: Math.round(v * 100) }); } else btn.textContent = t(S.scout ? 'sct_again' : 'sct_run');
  }

  // Returns the scan for the scenario's start date and the current duration (cached while those stay the same).
  function run(k, mode) {
    if (!Polar.ready) { // still unpacking: wait for it, then scan; a failed pack gives null
      if (Polar.failed) return Promise.resolve(null);
      return new Promise(res => Polar.onSettled(() => res(Polar.ready ? run(k, mode) : null)));
    }
    k = KEYS.includes(k) ? k : S.globe.target;
    mode = mode === 'moon' || mode === 'pole' ? mode : S.scanMode;
    S.scanMode = mode; syncMode();
    const start = S.sc[k].start, dur = S.dur, key = start + '|' + dur + '|' + mode;
    if (S.scout && S.scout.key === key) { token++; running = null; S.scout.k = k; render(); return Promise.resolve(S.scout); }
    if (running && running.key === key) return running.promise;
    const my = ++token;
    const promise = (async () => {
      const rMax = 2 * Polar.R * Math.tan((90 + LAT_LIMIT) * Math.PI / 360), pts = [], seen = new Set();
      let scanned = 0, rejected = 0, slice = performance.now();
      const visit = async (x, y, km) => {
        const id = Math.round(x / 500) + ',' + Math.round(y / 500);
        if (seen.has(id) || Math.hypot(x, y) > rMax) return;
        seen.add(id); scanned++;
        const [lat, lon] = Polar.toLL(x, y);
        const p = scorePoint(lat, lon, start, dur, km);
        if (p) pts.push(p); else rejected++;
        if (performance.now() - slice > 28) { await pause(); slice = performance.now(); }
      };
      progress(0);
      if (mode === 'moon') {
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < MOON_POINTS; i++) {
          const lat = Math.asin(1 - 2 * (i + 0.5) / MOON_POINTS) / RAD, lon = ((i * golden / RAD) % 360 + 540) % 360 - 180;
          scanned++;
          const p = Polar.covered(lat, lon) ? scorePoint(lat, lon, start, dur, MOON_KM) : scoreCoarse(lat, lon, start, dur);
          if (p) { p.km = MOON_KM; pts.push(p); } else rejected++;
          if (performance.now() - slice > 28) { progress(i / MOON_POINTS); await pause(); slice = performance.now(); if (my !== token) return null; }
        }
        const top = pickTop(pts, 5, 300);
        return { key, k, start, dur, mode, pts, top, scanned, rejected, scored: pts.length };
      }
      const g = COARSE_KM * 1000, m = Math.floor(rMax / g);
      for (let j = -m; j <= m; j++) {
        for (let i = -m; i <= m; i++) { await visit(i * g, j * g, COARSE_KM); if (my !== token) return null; }
        progress(0.75 * (j + m + 1) / (2 * m + 1));
      }
      const seeds = pickTop(pts, 8, 12), f = FINE_KM * 1000;
      for (let n = 0; n < seeds.length; n++) {
        const [x0, y0] = Polar.toXY(seeds[n].lat, seeds[n].lon);
        for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { await visit(x0 + i * f, y0 + j * f, FINE_KM); if (my !== token) return null; }
        progress(0.75 + 0.25 * (n + 1) / seeds.length);
      }
      pts.sort((a, b) => b.km - a.km); // coarse dots first, so the fine ones are drawn on top
      const top = pickTop(pts, 5, 6);
      return { key, k, start, dur, mode, pts, top, scanned, rejected, scored: pts.length };
    })().then(r => {
      if (my !== token) return null;
      running = null; progress(null);
      if (r) { S.scout = r; S.globe.heat = true; AA.syncForms(); AA.queueGlobe(); render(); }
      return r;
    }, () => { if (my === token) { running = null; progress(null); } return null; });
    running = { key, promise };
    return promise;
  }

  function render() {
    const r = S.scout;
    if (!Polar.ready) { btn.disabled = true; btn.textContent = t('sct_run'); out.innerHTML = `<p class="hint">${t(Polar.failed ? 'sct_nodata' : 'sct_wait')}</p>`; return; }
    if (!running) progress(null);
    if (!r) { out.innerHTML = ''; return; }
    // stale = the scenario this scan was made for has moved to another date, or the duration changed
    const k = KEYS.includes(r.k) ? r.k : S.globe.target, stale = r.key !== S.sc[k].start + '|' + S.dur + '|' + S.scanMode;
    const fa = out.contains(document.activeElement) ? document.activeElement : null, keep = fa && fa.dataset.i != null ? `[data-i="${fa.dataset.i}"][data-k="${fa.dataset.k}"]` : null;
    out.innerHTML = `<ol class="scout-list">${r.top.map((p, i) => `<li>
        <span class="sc-n">${i + 1}</span>
        <div><b>${p.score}<small>/100</small></b> <span class="mono">${AA.fmtCoord(p.lat, p.lon)}</span>
          <small>${t('sct_row', { s: nf(p.sun * 100), e: nf(p.earth * 100), sl: p.slope == null ? '—' : nf(p.slope, 1), km: p.trapKm == null ? '—' : nf(p.trapKm, 1) })}</small></div>
        <span class="sc-set"><button data-i="${i}" data-k="A" aria-label="${t('sct_set', { k: 'A' })}">A</button><button data-i="${i}" data-k="B" aria-label="${t('sct_set', { k: 'B' })}">B</button></span>
      </li>`).join('')}</ol>
      <p class="hint">${t('sct_sum', { n: nf(r.scanned), r: nf(r.rejected), s: nf(r.scored), d: AA.fmtDate(r.start, false), dur: nf(r.dur, r.dur % 1 ? 1 : 0) })}${stale ? ' <b>' + t('sct_stale') + '</b>' : ''}</p>`;
    if (keep) { const nb = out.querySelector(keep); if (nb) nb.focus(); }
  }

  const modeBox = $('#scan-mode');
  const syncMode = () => { [...modeBox.querySelectorAll('button')].forEach(b => b.classList.toggle('on', b.dataset.mode === S.scanMode)); $('#scan-lead').textContent = t(S.scanMode === 'moon' ? 'sct_lead_moon' : 'sct_lead') + (S.scanMode === 'moon' ? '' : ' ' + t('sct_caveat')); };
  modeBox.addEventListener('click', e => { if (e.target.dataset.mode) { S.scanMode = e.target.dataset.mode; syncMode(); render(); } });
  AA.onChange(syncMode);
  syncMode();
  btn.addEventListener('click', () => {
    Object.assign(S.globe, S.scanMode === 'moon' ? { lat0: 0, lon0: 0, zoom: 1 } : { lat0: -90, lon0: 0, zoom: 4 });
    AA.queueGlobe(); run(S.globe.target, S.scanMode);
  });
  out.addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (!b || !S.scout) return;
    const p = S.scout.top[+b.dataset.i]; if (!p) return;
    AA.setPoint(b.dataset.k, p.lat, p.lon); S.sc[b.dataset.k].mask = p.mask; AA.refresh();
  });
  /* ---- NASA study regions: the best landable point inside each one ---- */
  // Approximate each NASA 15 x 15 km study box by an equal-area circle around the published centre.
  // Compare candidates every 1.5 km using the same sampling as the scenario cards.
  const REG_R = 8460, REG_STEP = 1500, rbox = $('#regions-out'), rbtn = $('#regions-run');
  let rToken = 0, rRunning = null;
  function rProgress(v) { rbtn.disabled = v != null || !Polar.ready; rbtn.textContent = v != null ? t('reg_busy', { p: Math.round(v * 100) }) : t(S.regions ? 'reg_again' : 'reg_run'); }
  function runRegions(k) {
    if (!Polar.ready) {
      if (Polar.failed) return Promise.resolve(null);
      return new Promise(res => Polar.onSettled(() => res(Polar.ready ? runRegions(k) : null)));
    }
    k = KEYS.includes(k) ? k : S.globe.target;
    const start = S.sc[k].start, dur = S.dur, key = start + '|' + dur;
    if (S.regions && S.regions.key === key) { rToken++; rRunning = null; S.regions.k = k; renderRegions(); return Promise.resolve(S.regions); }
    if (rRunning && rRunning.key === key) return rRunning.promise;
    const my = ++rToken, list = AA.REGIONS;
    const promise = (async () => {
      const rows = []; let slice = performance.now();
      rProgress(0);
      for (let q = 0; q < list.length; q++) {
        const r = list[q], [x0, y0] = Polar.toXY(r.lat, r.lon), m = Math.floor(REG_R / REG_STEP);
        let best = null, tried = 0, ok = 0;
        for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) {
          const dx = i * REG_STEP, dy = j * REG_STEP;
          if (dx * dx + dy * dy > REG_R * REG_R) continue;
          const [lat, lon] = Polar.toLL(x0 + dx, y0 + dy);
          tried++;
          if (!Polar.covered(lat, lon)) continue;
          const p = scorePoint(lat, lon, start, dur, FINE_KM);
          if (p) { ok++; if (!best || p.score > best.score || (p.score === best.score && p.both > best.both)) best = p; }
          if (performance.now() - slice > 28) { await pause(); slice = performance.now(); if (my !== rToken) return null; }
        }
        rows.push({ id: r.id, name: r.name, a24: !!r.a24, lat: r.lat, lon: r.lon, best, tried, ok });
        rProgress((q + 1) / list.length);
        await pause(); if (my !== rToken) return null;
      }
      rows.sort((a, b) => (b.best ? b.best.score : -1) - (a.best ? a.best.score : -1) || (b.best ? b.best.both : 0) - (a.best ? a.best.both : 0));
      return { key, k, start, dur, rows };
    })().then(r => {
      if (my !== rToken) return null;
      rRunning = null; rProgress(null);
      if (r) { S.regions = r; S.globe.regions = true; AA.syncForms(); AA.queueGlobe(); renderRegions(); }
      return r;
    }, () => { if (my === rToken) { rRunning = null; rProgress(null); } return null; });
    rRunning = { key, promise };
    return promise;
  }
  function renderRegions() {
    if (!rRunning) rProgress(null);
    const r = S.regions;
    if (!Polar.ready) { rbtn.disabled = true; rbtn.textContent = t('reg_run'); rbox.innerHTML = ''; return; }
    if (!r) { rbox.innerHTML = ''; return; }
    const rk = KEYS.includes(r.k) ? r.k : S.globe.target, stale = r.key !== S.sc[rk].start + '|' + S.dur;
    const fa = rbox.contains(document.activeElement) ? document.activeElement : null, keep = fa && fa.dataset.r != null ? `[data-r="${fa.dataset.r}"][data-k="${fa.dataset.k}"]` : null;
    rbox.innerHTML = `<ol class="reg-list">${r.rows.map((row, i) => { const b = row.best; return `<li>
        <span class="rs ${b ? '' : 'none'}">${b ? b.score : '—'}</span>
        <div><b>${row.name}</b>${row.a24 ? `<span class="reg-tag">${t('reg_a24')}</span>` : ''}
          <small>${b ? t('reg_row', { c: AA.fmtCoord(row.lat, row.lon), b: AA.fmtCoord(b.lat, b.lon), s: nf(b.sun * 100), e: nf(b.earth * 100), sl: nf(b.slope, 1) }) : t('reg_none')}</small></div>
        <span class="sc-set">${b ? `<button data-r="${i}" data-k="A" aria-label="${t('sct_set', { k: 'A' })}">A</button><button data-r="${i}" data-k="B" aria-label="${t('sct_set', { k: 'B' })}">B</button>` : ''}</span>
      </li>`; }).join('')}</ol>
      <p class="hint">${t('reg_sum', { d: AA.fmtDate(r.start, false), dur: nf(r.dur, r.dur % 1 ? 1 : 0) })}${stale ? ' <b>' + t('sct_stale') + '</b>' : ''}</p>`;
    if (keep) { const nb = rbox.querySelector(keep); if (nb) nb.focus(); }
  }
  rbtn.addEventListener('click', () => { Object.assign(S.globe, { lat0: -90, lon0: 0, zoom: 4 }); AA.queueGlobe(); runRegions(S.globe.target); });
  rbox.addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b || !S.regions) return;
    const row = S.regions.rows[+b.dataset.r]; if (!row || !row.best) return;
    AA.setPoint(b.dataset.k, row.best.lat, row.best.lon); S.sc[b.dataset.k].mask = row.best.mask; AA.refresh();
  });
  AA.onChange(renderRegions);
  Polar.onSettled(renderRegions);
  renderRegions();
  AA.onChange(render);
  Polar.onSettled(render);
  window.AAScout = { run, runRegions, landable, LIMITS: { LAT_LIMIT, COARSE_KM, FINE_KM, MAX_SLOPE, MIN_SAFE, MAX_SHADOW } };
  render();
})();
