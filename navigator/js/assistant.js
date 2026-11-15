/* AstroApex assistant: site analysis (score, propellant, pros/cons), report cards and the chat panel.

   HOW IT ANSWERS
   --------------
   1. Local analysis engine (always available, works offline). It understands the question (scenario,
      site names, dates, durations, masses), runs NEW simulations when needed (best date in the coming
      year, ranking of all sites, region scan for the best point, what-if durations, battery sizing ...)
      and writes the answer from the computed numbers, the LOLA slope grid and the NASA shadow map.
   2. Optional AI model. When the page is opened through server.py and that server has an API key,
      the question goes to the model together with the live mission data AND the local engine's
      computed answer, so the model explains real numbers instead of guessing. If the call fails,
      the local answer is shown.

   CONNECTING YOUR OWN MODEL
   Define window.AstroApexAI = { name, async ask(question, context) { ... return text; } } before this
   file loads. Keep API keys on a server, never in a file shipped to the browser. */
(function () {
  'use strict';
  const AA = window.AA;
  if (!AA) return;
  const { S, KEYS, t, nf } = AA;
  const $ = s => document.querySelector(s);
  const H = 3600000, DAY = 86400000;
  const L = (tr, en) => S.lang === 'tr' ? tr : en;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hrs = v => nf(v) + ' ' + t('h');
  const pct = v => nf(v) + '%';
  const date = (ms, time) => AA.fmtDate(ms, time !== false);

  /* ================= analysis (pure) ================= */
  const TERRAIN_SCORE = { mare: 90, highland: 70, polar: 45, unknown: 60 };
  const HAZARD_DV = { mare: 60, highland: 100, polar: 150, unknown: 100 };
  const G0 = 9.80665, ISP = 320;
  const TC_TR = { mare: 'düz deniz', highland: 'yayla', polar: 'kutup', unknown: 'bilinmeyen arazi' };
  const terrainClass = sc => {
    const site = SITES.find(x => x.id === sc.site);
    return site ? site.tc : (Math.abs(sc.lat) >= 80 ? 'polar' : 'unknown');
  };
  const PARTS = ['power', 'comm', 'thermal', 'light', 'terrain', 'ice'];
  const WEIGHT = { power: 25, comm: 20, thermal: 15, light: 10, terrain: 15, ice: 15 };
  // Terrain: measured slope where the LOLA grid covers the point (share of the 1 km footprint under 8 deg, and the
  // mean slope), otherwise the coarse terrain class of the site.
  // Outside the south-pole pack the coarse whole-Moon slope map is used the same way; the class only when there is no map.
  const terrainScore = (tc, f) => { const s = f && (f.slope || f.coarse); return s ? 100 * (0.6 * s.safe + 0.4 * Math.max(0, 1 - s.mean / 20)) : TERRAIN_SCORE[tc]; };
  // Ice access: full marks within 5 km of a large permanently shadowed trap, none beyond 50 km.
  const iceScore = (f, lat) => f && f.data ? (f.trap ? Math.max(0, Math.min(100, 100 * (1 - (f.trap.km - 5) / 45))) : 0) : (Math.abs(lat) >= 80 ? 50 : 0);
  // Suitability score from the six ingredients. Used for scenarios and for every search below.
  // f = AA.facts() of the point (may be null), lat = its latitude.
  function scoreParts(pSun, pEarth, darkH, sunUp0, el0, tc, f, lat) {
    const parts = {
      power: pSun * 100,
      comm: pEarth * 100,
      thermal: 100 * (1 - Math.min(1, darkH / 336)),          // 336 h = a full two-week lunar night
      light: !sunUp0 ? 0 : el0 >= 5 ? 100 : 40 + 12 * Math.max(0, el0),
      terrain: terrainScore(tc, f),
      ice: iceScore(f, lat || 0)
    };
    const score = Math.round(PARTS.reduce((sum, p) => sum + WEIGHT[p] * parts[p], 0) / 100);
    return { parts, score };
  }
  const hazardDv = (tc, f) => f && f.slope ? Math.round(60 + 90 * Math.min(1, f.slope.mean / 15)) : HAZARD_DV[tc];
  const descentDv = (tc, lightScore, f) => 1870 + hazardDv(tc, f) + (lightScore < 100 ? 30 : 0);
  const trapName = tr => tr.name ? L(tr.name + ' krateri', tr.name + ' crater') : L('adsız gölge', 'an unnamed shadow');
  const compass = deg => t('compass')[Math.round(deg / 45) % 8];
  const propFrac = (dv, isp) => 1 - Math.exp(-dv / ((isp || ISP) * G0));

  function evaluate(sc, d) {
    const s = d.stats, site = SITES.find(x => x.id === sc.site), tc = terrainClass(sc);
    const pSun = s.sun / s.total, pEarth = s.earth / s.total;
    const f = AA.facts(sc);
    const { parts, score } = scoreParts(pSun, pEarth, s.dark, d.sunUp[0], d.sunEl[0], tc, f, sc.lat);
    const dv = descentDv(tc, parts.light, f), frac = propFrac(dv);
    const pros = [], cons = [], P = pSun * 100, E = pEarth * 100;
    if (P >= 95) pros.push(t('pc_sun_full', { p: nf(P) }));
    else if (P < 50) cons.push(t('pc_sun_low', { p: nf(P), d: nf(s.dark) }));
    else cons.push(t('pc_sun_mid', { p: nf(P), d: nf(s.dark) }));
    if (E >= 99.5) pros.push(t('pc_earth_full'));
    else if (E < 0.5) cons.push(t('pc_earth_none'));
    else (E >= 60 ? pros : cons).push(t('pc_earth_part', { p: nf(E), d: nf(s.nocomm) }));
    if (s.both / s.total > 0.5) pros.push(t('pc_both', { h: nf(s.both) }));
    if (!d.sunUp[0]) cons.push(t('pc_darkland'));
    if (s.maxEl < 5) cons.push(t('pc_lowsun', { e: nf(Math.max(0, s.maxEl), 1) }));
    else if (s.maxEl >= 20) pros.push(t('pc_highsun', { e: nf(s.maxEl) }));
    if (f.data) { // measured ground: ice trap distance and slope
      if (f.shadow >= 0.5) cons.push(t('pc_ice_in'));
      else if (f.trap && f.trap.km <= 20) pros.push(t('pc_ice_near', { km: nf(f.trap.km, 1), n: trapName(f.trap) }));
      else if (f.trap) cons.push(t('pc_ice_far', { km: nf(f.trap.km), n: trapName(f.trap) }));
    } else if (Math.abs(sc.lat) >= 80) pros.push(t('pc_ice'));
    if (f.slope) {
      const v = { s: nf(f.slope.mean, 1), p: nf(f.slope.safe * 100) };
      if (f.slope.mean > 15) { // the decisive problem goes first; a NASA region centre also gets the pointer to the region scan
        const hint = AA.REGIONS.some(r => Math.abs(r.lat - sc.lat) < 1e-4 && Math.abs(r.lon - sc.lon) < 1e-4);
        cons.unshift(...[t('pc_slope_bad', v)].concat(hint ? [t('pc_region_hint')] : []));
      }
      else if (f.slope.mean <= 8 && f.slope.safe >= 0.7) pros.push(t('pc_slope_good', v));
      else cons.push(t('pc_slope_mid', v));
    } else if (tc === 'polar') cons.push(t('pc_rough'));
    else if (tc === 'mare') pros.push(t('pc_mare'));
    else if (tc === 'highland') cons.push(t('pc_highland'));
    else cons.push(t('pc_unknown'));
    if (d.pw && d.pw.state === 'bad') cons.unshift(t('pc_batt_bad', { h: nf(d.pw.emptyH, d.pw.emptyH < 100 ? 1 : 0), c: nf(d.pw.need, 1) }));
    if (site && site.her) pros.push(t('pc_heritage'));
    return { k: null, name: site ? site.name : t('custom'), score, parts, dv, frac, tc, pros, cons, lola: AA.hasTerrain(sc), hz: d.hz || AA.horizonSrc(sc), sc, stats: s, src: d.src, f, pw: d.pw || null };
  }
  const analyze = k => Object.assign(evaluate(S.sc[k], S.data[k]), { k });
  // Which scenario to recommend. The score describes the place and the date; the chosen battery is a hard
  // constraint on top of it: a scenario whose battery runs empty is not recommended over one that survives.
  function recommend(a, b) {
    const bad = x => !!(x.pw && x.pw.state === 'bad');
    let lead = a.score === b.score ? null : a.score > b.score ? a : b, forced = false;
    if (bad(a) !== bad(b)) { const ok = bad(a) ? b : a; forced = lead !== ok && lead !== null; lead = ok; }
    return { lead, other: lead === a ? b : a, forced, bothBad: bad(a) && bad(b) };
  }
  const scoreClass = v => v >= 65 ? 'good' : v >= 40 ? 'mid' : 'bad';

  /* ================= report cards ================= */
  const list = (items, cls) => items.length ? `<ul class="pc ${cls}">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  function reportHTML(a, compact) {
    const bars = PARTS.map(p =>
      `<div class="sbar"><span>${t('sc_' + p)}</span><i><b style="width:${Math.round(a.parts[p])}%"></b></i><em>${Math.round(a.parts[p])}</em></div>`).join('');
    return `
      <div class="rep-head">
        <div class="scn-title"><span class="badge ${a.k.toLowerCase()}">${a.k}</span><b>${esc(a.name)}</b></div>
        <span class="k">${t('report')}</span>
      </div>
      <div class="rep-main">
        <div class="score ${scoreClass(a.score)}"><strong>${a.score}</strong><span>/100</span><small>${t('score')}</small></div>
        <div class="rep-side">
          <div class="fuel"><small>${t('fuel')}</small><b>${t('fuel_v', { f: nf(a.frac * 100), dv: nf(a.dv) })}</b></div>
          ${compact ? '' : `<div class="sbars">${bars}</div>`}
        </div>
      </div>
      <div class="pc-cols">
        <div><h4>${t('pros')}</h4>${list(a.pros.slice(0, compact ? 2 : 4), 'pro')}</div>
        <div><h4>${t('cons')}</h4>${list(a.cons.slice(0, compact ? 2 : 4), 'con')}</div>
      </div>
      <button class="ghost ask" data-ask="${a.k}">✦ ${t('ask_ai')}</button>`;
  }
  function renderReports() {
    for (const k of KEYS) $('#report-' + k).innerHTML = reportHTML(analyze(k), false);
    $('#pick').innerHTML = reportHTML(analyze(S.globe.target), true);
  }

  /* ================= understanding the question ================= */
  const norm = s => s.toLocaleLowerCase('tr').replace(/[’'`]/g, ' ')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/é/g, 'e').replace(/[δ∆]/g, 'delta');
  const MONTHS = ['ocak|january|jan', 'subat|february|feb', 'mart|march|mar', 'nisan|april|apr', 'mayis|may', 'haziran|june|jun',
    'temmuz|july|jul', 'agustos|august|aug', 'eylul|september|sep', 'ekim|october|oct', 'kasim|november|nov', 'aralik|december|dec'];
  const num = s => { // 2.500 / 2,500 are thousands, 2,5 / 2.5 are decimals
    s = String(s); if (/^[1-9]\d{0,2}(?:[.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
    return parseFloat(s.replace(',', '.'));
  };

  function parse(q) {
    const x = norm(q), e = { x, scen: [], site: null, days: null, shift: null, date: null, mass: null, watts: null, isp: null, body: null };
    // scenarios A / B
    // In English "a" is also the article, so there the scenario needs a cue word or a capital A before a non-noun.
    const hasA = S.lang === 'en'
      ? /\b(site|scenario|for|of|and|vs|to|is|compare|analy[sz]e|with)\s+a\b(?!\s+(?!(?:and|or|vs|versus|with)\b)[a-z]{3,})/i.test(q) || /\bA\b(?!\s+(?!(?:and|or|vs|versus|with)\b)[a-z])/.test(q)
      : /(^|[^a-z0-9])a($|[^a-z0-9])|senaryo a|scenario a/.test(x);
    if (hasA) e.scen.push('A');
    if (/(^|[^a-z0-9])b($|[^a-z0-9])|senaryo b|scenario b/.test(x)) e.scen.push('B');
    // a named site (longest match wins)
    let best = 0;
    for (const s of SITES) {
      const full = norm(s.name), first = full.split(/\s/)[0];
      // full name, or a distinctive first word: 5+ letters, or a code with a digit such as “IM-1”, “SLIM”
      const short = first.length >= 5 || (first.length >= 3 && /\d/.test(first));
      const hit = x.includes(full) ? full.length : (short && new RegExp('(^|[^a-z0-9])' + first.replace(/[-]/g, '\-') + '($|[^a-z0-9])').test(x) && SITES.filter(o => norm(o.name).split(/[\s]/)[0] === first).length === 1) ? first.length : 0;
      if (hit > best) { best = hit; e.site = s; }
    }
    // duration
    const WORDS = Object.assign({ two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, twenty: 20, thirty: 30,
      iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, yirmi: 20, otuz: 30 }, S.lang === 'en' ? { one: 1, a: 1, an: 1 } : { bir: 1, on: 10 });
    const xd = x.replace(new RegExp('(^|[^a-z0-9])(' + Object.keys(WORDS).join('|') + ')\\s+(?=gunluk|gun|day|hafta|week|aylik|ay(?![a-z])|month)', 'g'), (s, p, w) => p + WORDS[w] + ' ');
    let m = xd.match(/(\d+(?:[.,]\d+)?)\s*(gunluk|gun|day|hafta|week|aylik|ay(?![a-z])|month)/);
    if (m) { const v = num(m[1]); e.days = /^(hafta|week)/.test(m[2]) ? v * 7 : /^(ay|month)/.test(m[2]) ? v * 29.5 : v; }
    // "delay / postpone / ertele ... N days" moves the start and keeps the mission length
    const later = /ertele|otele|gecik|kaydir|sonraya|\bdelay|postpone|\bslip|push(ed)? back|\blater\b/.test(x), sooner = /one al|one cek|erkene|\bearlier\b|bring forward|move up/.test(x);
    if ((later || sooner) && e.days != null) { e.shift = (sooner ? -1 : 1) * e.days; e.days = null; }
    // date: 2027-03-15, 15.03.2027, "15 mart 2027", "march 15 2027", "mart 2027"
    if ((m = x.match(/(20\d\d)-(\d{1,2})-(\d{1,2})/))) e.date = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    else if ((m = x.match(/(\d{1,2})[./](\d{1,2})[./](20\d\d)/))) e.date = Date.UTC(+m[3], +m[2] - 1, +m[1]);
    else MONTHS.forEach((names, mi) => {
      if (e.date) return;
      const r = new RegExp('(?:(\\d{1,2})\\s+)?(?:' + names + ')[a-z]*(?:\\s+(\\d{1,2}))?,?\\s+(20\\d\\d)');
      const mm = x.match(r);
      if (mm) e.date = Date.UTC(+mm[3], mi, +(mm[1] || mm[2] || 1));
    });
    if ((m = x.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(kg|ton)\b/))) e.mass = num(m[1]) * (m[2] === 'ton' ? 1000 : 1);
    if ((m = x.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(kw|w|watt)\b/))) e.watts = num(m[1]) * (m[2] === 'kw' ? 1000 : 1);
    if ((m = x.match(/isp\s*[:=]?\s*(\d{3})/))) e.isp = +m[1];
    if (/gunes|sun|solar/.test(x)) e.body = 'sun';
    else if (/dunya|earth|iletisim|comm|haberles/.test(x)) e.body = 'earth';
    return e;
  }

  const INTENTS = [
    ['help', /yardim|help|ne yapabil|what can you|neler sorabil|komut/],
    ['regions', /(artemis|nasa)[a-z0-9 ]{0,24}(aday|bolge|region|candidate|landing (site|zone))|aday bolge|bolgeleri(ni)? puanla|candidate region|study region|score (the )?[a-z ]*regions/],
    ['moon', /tum ay|butun ay|kuresel|whole moon|entire moon|global|worldwide/],
    ['scout', /en iyi nokta|nokta bul|bolgeyi tara|tarama yap|\bscan\b|best (point|spot|location)|find (a |the )?(best |good )?(point|spot)/],
    ['route', /\brota(?!t)|guzergah|gezici|\brover|\broute|traverse|nasil gid|drive to|how (do|can) (we|i) (get|reach|drive) (to )?(the )?(ice|trap|shadow|psr|crater)/],
    ['pdf', /\bpdf\b|rapor(u|unu)? (indir|olustur|al|hazirla)|gorev raporu|download (the )?report|mission report|export (the )?report/],
    ['ice', /\bbuz|\bice\b|\bpsr\b|kalici golge|golgeli (bolge|krater)|water ice|cold trap|soguk tuzak|permanent(ly)? shadow/],
    ['slope', /\begim|\bslope|\bdik\b|\bsteep|duz mu|engebe|\brough|inis guvenli|landing safety|\btilt/],
    ['glossary', /nedir|ne demek|what is|what does|aciklar misin|tanim|meaning of/],
    ['sources', /spice|kaynak|source|dogru|accura|guvenilir|reliab|trust|horizons|de440|efemeris|ephemeris|verif|hangi veri|veriler|the data/],
    ['method', /nasil hesap|how is|how do you|how are|neye gore|formul|yontem|method/],
    ['bestdate', /en iyi (tarih|zaman|gun|pencere)|en uygun (tarih|zaman|gun)|hangi tarih|ne zaman in|ne zaman gitmeli|best (date|time|day|window)|when should|optimal (date|time)|ideal tarih|tarih oner/],
    ['bestsite', /en iyi (saha|yer|bolge|nokta|konum)|en uygun (saha|yer|bolge)|hangi saha|hangi bolge|best site|which site|best place|sirala|siralama|rank|alternatif|baska saha|other site|saha oner/],
    ['compare', /karsilastir|compare|hangisi|which (one|is)|fark|daha (iyi|guvenli|uygun)|better|safer|\bvs\b|versus/],
    ['recommend', /oneri|oner |tavsiye|recommend|ne yapmali|ne yapalim|what should|risk|tehlike|hazard|onlem|mitigat|sorun|problem|dikkat|karar/],
    ['fuel', /yakit|fuel|propell|delta|dv\b|itki|roket denklemi|rocket equation|\bisp\b/],
    ['battery', /batarya|pil\b|battery|depolama|storage|akumulator|gece.*(enerji|guc)|survive the night|geceyi|hayatta kal|doluluk|state of charge|\bsoc\b/],
    ['thermal', /sicaklik|\bisi\b|isil|isi haritasi|heat ?map|thermal|temperature|soguk(?! tuzak)|cold(?! trap)|donma|freez|isitici|heater/],
    ['windows', /pencere|window|takvim|schedule|liste|hangi saat|ne zaman (gorun|kesil|basla|bit)|araliklar|intervals/],
    ['now', /simdi|su an|su anda|right now|currently|at the moment|imlec|cursor/],
    ['score', /guven|skor|score|safe|yuzde|percent|uygunluk|suitab|puan/],
    ['sun', /gunes|sun\b|sunlight|guc\b|power|enerji|energy|karanlik|dark|gece|night|aydinlan|illuminat/],
    ['earth', /dunya|earth|iletisim|comm|haberles|anten|antenna|relay|role|dte/],
    ['whatif', /olursa|olsaydi|what if|uzat|extend|kisalt|shorten|degistir|yerine/],
    ['report', /analiz|analy[sz]e|rapor|report|anlat|describe|tell me about|ozet|summar|arti|eksi|pros|cons|avantaj|dezavantaj/]
  ];
  const detect = x => INTENTS.filter(([, re]) => re.test(x)).map(([n]) => n);

  /* ================= extra simulations ================= */
  const simCache = new Map();
  function sim(sc, dur, step) {
    const key = [sc.site, sc.lat, sc.lon, sc.start, sc.mask, dur, step, AA.Polar.ready].join('|');
    let d = simCache.get(key);
    if (!d) { if (simCache.size > 60) simCache.clear(); d = AA.simulate(sc, dur, step); simCache.set(key, d); }
    return d;
  }
  const scenarioFor = (site, start) => { const sc = { site: site.id, lat: site.lat, lon: site.lon, start, mask: 0 }; if (AA.terrainOK(sc)) sc.mask = 'lola'; return sc; };

  // Slide a dur-day mission over the next 365 days (1-day steps, hourly samples) and score every start date.
  function scanDates(sc, dur) {
    const span = 365, n = Math.round(dur * 24), d = sim(sc, span + dur, 60), tc = terrainClass(sc), f = AA.facts(sc);
    const pS = new Int32Array(d.n + 1), pE = new Int32Array(d.n + 1), pB = new Int32Array(d.n + 1);
    for (let i = 0; i < d.n; i++) { pS[i + 1] = pS[i] + d.sunUp[i]; pE[i + 1] = pE[i] + d.earthUp[i]; pB[i + 1] = pB[i] + d.both[i]; }
    const out = [];
    for (let day = 0; day < span; day++) {
      const i0 = day * 24, i1 = i0 + n;
      let dark = 0, run = 0;
      for (let i = i0; i < i1; i++) { if (d.sunUp[i]) run = 0; else if (++run > dark) dark = run; }
      const sun = pS[i1] - pS[i0], earth = pE[i1] - pE[i0], both = pB[i1] - pB[i0];
      const { score } = scoreParts(sun / n, earth / n, dark, d.sunUp[i0], d.sunEl[i0], tc, f, sc.lat);
      out.push({ day, start: sc.start + day * DAY, sun, earth, both, dark, score, n });
    }
    return out;
  }
  function topWindows(list, count, gapDays) {
    const sorted = [...list].sort((a, b) => b.score - a.score || b.both - a.both || a.dark - b.dark), pick = [];
    for (const w of sorted) {
      if (pick.every(p => Math.abs(p.day - w.day) >= gapDays)) pick.push(w);
      if (pick.length === count) break;
    }
    return pick;
  }
  function rankSites(start, dur) {
    return SITES.map(site => {
      const sc = scenarioFor(site, start);
      return Object.assign(evaluate(sc, sim(sc, dur, 60)), { site });
    }).sort((a, b) => b.score - a.score || b.stats.both - a.stats.both);
  }

  /* ================= answer builders ================= */
  const act = (label, data) => `<button class="chip-act" data-act="${esc(JSON.stringify(data))}">${esc(label)}</button>`;
  const tag = k => k ? `<span class="badge ${k.toLowerCase()}">${k}</span> ` : '';
  const table = (head, rows) => `<div class="mini-wrap"><table class="mini"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const note = s => `<small>${esc(s)}</small>`;
  const srcNote = a => note(a.src === 'spice' ? L('Efemeris: NASA SPICE · JPL DE440.', 'Ephemeris: NASA SPICE · JPL DE440.')
    : L('Efemeris: astronomy-engine (tarih SPICE tablosu dışında).', 'Ephemeris: astronomy-engine (date outside the SPICE table).'));

  // One line on the measured ground under a point: slope and the nearest ice trap.
  function groundLine(a) {
    const f = a.f; if (!f) return '';
    if (!f.data) return f.coarse ? '<br>' + esc(L(`Kaba eğim (yaklaşık 7,6 km hücre): ${nf(f.coarse.here, 1)}°.`, `Coarse slope (cells of about 7.6 km): ${nf(f.coarse.here, 1)}°.`)) : '';
    const bits = [];
    if (f.slope) bits.push(L(`Eğim: 1 km çevrede ortalama ${nf(f.slope.mean, 1)}°, alanın %${nf(f.slope.safe * 100)}’i 8°’den düz.`, `Slope: ${nf(f.slope.mean, 1)}° mean within 1 km, ${nf(f.slope.safe * 100)}% of the ground under 8°.`));
    if (f.trap) bits.push(f.trap.inside ? L('İniş noktası büyük bir kalıcı gölgenin içinde.', 'The point lies inside a large permanent shadow.')
      : L(`En yakın büyük buz tuzağı: ${trapName(f.trap)}, ${nf(f.trap.km, 1)} km (${compass(f.trap.bearing)}).`, `Nearest large ice trap: ${trapName(f.trap)}, ${nf(f.trap.km, 1)} km (${compass(f.trap.bearing)}).`));
    return bits.length ? '<br>' + esc(bits.join(' ')) : '';
  }
  function fullReport(a) {
    return `${tag(a.k)}<b>${esc(a.name)}</b> · ${esc(AA.fmtCoord(a.sc.lat, a.sc.lon))}<br>
      <span class="score-inline ${scoreClass(a.score)}">${t('a_scoreline', { s: a.score })}</span><br>
      ${t('a_fuelline', { f: nf(a.frac * 100), dv: nf(a.dv), kg: nf(a.frac * 1000) })}${groundLine(a)}
      <h4>${t('pros')}</h4>${list(a.pros, 'pro')}<h4>${t('cons')}</h4>${list(a.cons, 'con')}
      ${note(t(a.hz === 'lola480' ? 'a_note_lola480' : a.lola ? 'a_note_lola' : 'a_note_flat'))} ${srcNote(a)}`;
  }

  function compareAnswer() {
    const a = analyze('A'), b = analyze('B'), sa = a.stats, sb = b.stats;
    const win = (x, y, lowerBetter) => Math.abs(x - y) < 0.5 ? '=' : ((x > y) !== !!lowerBetter ? 'A' : 'B');
    let rows = [
      [t('score'), a.score, b.score, win(a.score, b.score)],
      [t('m_both'), hrs(sa.both), hrs(sb.both), win(sa.both, sb.both)],
      [t('m_sun'), hrs(sa.sun), hrs(sb.sun), win(sa.sun, sb.sun)],
      [t('m_earth'), hrs(sa.earth), hrs(sb.earth), win(sa.earth, sb.earth)],
      [t('m_dark'), hrs(sa.dark), hrs(sb.dark), win(sa.dark, sb.dark, true)],
      [t('m_nocomm'), hrs(sa.nocomm), hrs(sb.nocomm), win(sa.nocomm, sb.nocomm, true)],
      [t('fuel'), pct(a.frac * 100), pct(b.frac * 100), win(a.frac * 100, b.frac * 100, true)]
    ];
    if (a.pw && b.pw) rows.push([t('m_need'), nf(a.pw.need, 1), nf(b.pw.need, 1), win(a.pw.need * 10, b.pw.need * 10, true)]);
    if (a.f.slope && b.f.slope) rows.push([t('m_slope'), nf(a.f.slope.mean, 1), nf(b.f.slope.mean, 1), win(a.f.slope.mean, b.f.slope.mean, true)]);
    if (a.f.trap && b.f.trap) rows.push([t('m_ice'), nf(a.f.trap.km, 1), nf(b.f.trap.km, 1), win(a.f.trap.km, b.f.trap.km, true)]);
    rows = rows.map(r => [esc(r[0]), r[1], r[2], r[3] === '=' ? '=' : `<b>${r[3]}</b>`]);
    const wins = { A: 0, B: 0 }; rows.forEach(r => { const w = r[3].replace(/<[^>]+>/g, ''); if (wins[w] != null) wins[w]++; });
    const pick = recommend(a, b), lead = pick.lead, other = pick.other;
    let verdict;
    if (pick.forced) verdict = L(`Öneri: ${lead.k} · ${lead.name}. Skoru daha düşük (${lead.score}/100, diğeri ${other.score}/100), ama seçili batarya yalnızca burada dayanıyor: ${other.k} senaryosunda batarya ${nf(other.pw.emptyH, 1)} saat boş kalıyor. ${other.k} için en az ${nf(other.pw.need, 1)} kWh gerekir.`,
      `Recommendation: ${lead.k} · ${lead.name}. It scores lower (${lead.score}/100 vs ${other.score}/100), but the chosen battery only survives here: in scenario ${other.k} it is empty for ${nf(other.pw.emptyH, 1)} h. ${other.k} would need at least ${nf(other.pw.need, 1)} kWh.`);
    else if (!lead) verdict = L('İki senaryo aynı skoru alıyor; karar görev önceliğine bağlı.', 'Both scenarios score the same; the choice depends on mission priority.');
    else {
      const why = [];
      if (lead.parts.power - other.parts.power > 8) why.push(L('daha fazla güneş (güç)', 'more sunlight (power)'));
      if (lead.parts.comm - other.parts.comm > 8) why.push(L('daha uzun Dünya görüşü (iletişim)', 'longer Earth visibility (comms)'));
      if (lead.parts.thermal - other.parts.thermal > 8) why.push(L('daha kısa karanlık', 'shorter darkness'));
      if (lead.parts.light - other.parts.light > 8) why.push(L('inişte daha iyi ışık', 'better light at landing'));
      if (lead.parts.terrain - other.parts.terrain > 8) why.push(L('daha düz, daha güvenli arazi', 'flatter, safer ground'));
      if (lead.parts.ice - other.parts.ice > 8) why.push(L('buz tuzağına daha yakın', 'closer to an ice trap'));
      verdict = L(`Öneri: ${lead.k} · ${lead.name} (${lead.score}/100, diğeri ${other.score}/100)`, `Recommendation: ${lead.k} · ${lead.name} (${lead.score}/100 vs ${other.score}/100)`) +
        (why.length ? L(' — başlıca nedenler: ', ' — main reasons: ') + why.join(', ') + '.' : '.');
      const weak = PARTS.filter(p => other.parts[p] - lead.parts[p] > 8).map(p => t('sc_' + p));
      if (weak.length) verdict += ' ' + L(`Ancak ${other.k} şu konularda daha iyi: ${weak.join(', ')}.`, `However ${other.k} is better on: ${weak.join(', ')}.`);
    }
    if (pick.bothBad) verdict += ' ' + L('Uyarı: seçili batarya iki senaryoda da tükeniyor; bu öneri yalnızca saha ve tarih uygunluğuna dayanır.', 'Warning: the chosen battery runs empty in both scenarios; this recommendation rests on site and date suitability only.');
    return `<b>${esc(a.name)}</b> (A) · <b>${esc(b.name)}</b> (B) — ${nf(S.dur, S.dur % 1 ? 1 : 0)} ${t('days')}` +
      table([t('metric'), 'A', 'B', L('Üstün', 'Better')], rows) + `<p>${esc(verdict)}</p>`;
  }

  function bestDateAnswer(k) {
    const sc = S.sc[k], a = analyze(k), all = scanDates(sc, S.dur), top = topWindows(all, 3, 7), worst = [...all].sort((x, y) => x.score - y.score)[0];
    const rows = top.map(w => [`<b>${esc(date(w.start, false))}</b><br>` + act(L(`${k}’ya uygula`, `Apply to ${k}`), { type: 'start', k, ms: w.start }),
      `<b>${w.score}</b>`, hrs(w.both), hrs(w.sun), hrs(w.dark)]);
    const gain = top[0].score - all[0].score;
    return `${tag(k)}<b>${esc(a.name)}</b> — ${L(`önümüzdeki 365 gün içinde ${nf(S.dur, S.dur % 1 ? 1 : 0)} günlük görev için en iyi başlangıç tarihleri (365 tarih, saatlik örnekleme ile tarandı):`,
      `best start dates for a ${nf(S.dur, S.dur % 1 ? 1 : 0)}-day mission in the next 365 days (365 dates scanned, hourly sampling):`)}` +
      table([L('Başlangıç', 'Start'), L('Skor', 'Score'), t('both'), t('sun'), L('Karanlık', 'Dark')], rows) +
      `<p>${esc(L(`Şu anki tarih (${date(sc.start, false)}) skoru ${all[0].score}. ${gain > 0 ? `En iyi tarihe geçmek skoru ${gain} puan artırır.` : 'Seçili tarih zaten en iyiler arasında.'} En kötü tarih ${date(worst.start, false)} (skor ${worst.score}).`,
        `The current date (${date(sc.start, false)}) scores ${all[0].score}. ${gain > 0 ? `Moving to the best date gains ${gain} points.` : 'The selected date is already among the best.'} The worst date is ${date(worst.start, false)} (score ${worst.score}).`))}</p>` + srcNote(a);
  }

  function bestSiteAnswer(k, onlyPole) {
    const sc = S.sc[k], ranked = rankSites(sc.start, S.dur).filter(r => !onlyPole || r.site.g === 'pole');
    const rows = ranked.slice(0, 6).map((r, i) => [`<b>${i + 1}. ${esc(r.name)}</b>${r.lola ? ' · LOLA' : ''}<br>` + act(L(`${k} yap`, `Set as ${k}`), { type: 'site', k, id: r.site.id }),
      `<b>${r.score}</b>`, pct(r.parts.power), pct(r.parts.comm), hrs(r.stats.dark)]);
    const pos = id => ranked.findIndex(r => r.site.id === id) + 1;
    const mine = KEYS.map(x => S.sc[x].site !== 'custom' && pos(S.sc[x].site) ? `${x}: ${pos(S.sc[x].site)}.` : null).filter(Boolean).join(' · ');
    return `${L(`${date(sc.start, false)} başlangıçlı ${nf(S.dur, S.dur % 1 ? 1 : 0)} günlük görev için ${ranked.length} sahanın sıralaması:`,
      `Ranking of ${ranked.length} sites for a ${nf(S.dur, S.dur % 1 ? 1 : 0)}-day mission starting ${date(sc.start, false)}:`)}` +
      table([L('Saha', 'Site'), L('Skor', 'Score'), t('sun'), t('earth'), L('Karanlık', 'Dark')], rows) +
      (mine ? `<p>${esc(L('Mevcut senaryoların sırası — ', 'Current scenarios rank — ') + mine)}</p>` : '') +
      note(L('Gerçek LOLA arazi ufku yalnızca “LOLA” işaretli sahalarda kullanılır; diğerlerinde düz ufuk varsayılır, bu yüzden kutup dışı sahalar olduğundan iyimser görünebilir.',
        'Real LOLA terrain horizons are used only for sites marked “LOLA”; the others assume a flat horizon, so their results may be optimistic.'));
  }

  function fuelAnswer(k, e) {
    const a = analyze(k), isp = e.isp || ISP, frac = propFrac(a.dv, isp), m0 = e.mass || 1000;
    const rows = [
      [L('Yörüngeden çıkış + frenleme (100 km dairesel)', 'De-orbit + braking (100 km circular)'), '1 870 m/s'],
      [a.f.slope ? L(`Tehlike önleme payı (ortalama eğim ${nf(a.f.slope.mean, 1)}°)`, `Hazard-avoidance margin (mean slope ${nf(a.f.slope.mean, 1)}°)`)
        : L(`Tehlike önleme payı (${TC_TR[a.tc]})`, `Hazard-avoidance margin (${a.tc})`), nf(hazardDv(a.tc, a.f)) + ' m/s'],
      [L('Düşük ışıkta iniş payı', 'Low-light landing margin'), (a.parts.light < 100 ? 30 : 0) + ' m/s'],
      [`<b>${L('Toplam Δv', 'Total Δv')}</b>`, `<b>${nf(a.dv)} m/s</b>`]
    ];
    return `${tag(k)}<b>${esc(a.name)}</b> — ${L('iniş yakıtı tahmini', 'descent propellant estimate')}` + table([L('Kalem', 'Item'), 'Δv'], rows) +
      `<p>${esc(L(`Roket denklemi (Isp ${isp} s): yakıt oranı = 1 − e^(−Δv / (Isp·g₀)) = %${nf(frac * 100, 1)}. ${nf(m0)} kg başlangıç kütlesi için ≈ ${nf(frac * m0)} kg yakıt, ${nf((1 - frac) * m0)} kg yüzeye iner.`,
        `Rocket equation (Isp ${isp} s): propellant fraction = 1 − e^(−Δv / (Isp·g₀)) = ${nf(frac * 100, 1)}%. For a ${nf(m0)} kg initial mass that is ≈ ${nf(frac * m0)} kg of propellant, ${nf((1 - frac) * m0)} kg lands.`))}</p>` +
      note(L('Farklı bir kütle veya Isp için yazın: “2500 kg ve Isp 310 için yakıt”.', 'For another mass or Isp, ask: “propellant for 2500 kg and Isp 310”.'));
  }

  // Battery through the mission, from the same power model as the chart in the Time tab.
  function batteryAnswer(k, e) {
    const a = analyze(k), s = a.stats, p = Object.assign({}, S.pwr, e.watts ? { load: Math.max(10, Math.min(5000, e.watts)) } : {}), pw = AA.powerSim(S.data[k], p);
    const state = { good: L('hayatta kalır', 'survives'), mid: L('hayatta kalır, yedek %20’nin altına iner', 'survives, but dips into the 20% reserve'), bad: L('batarya tükenir', 'battery runs flat') }[pw.state];
    return `${tag(k)}<b>${esc(a.name)}</b> — ${L('güç ve batarya', 'power and battery')}: <span class="score-inline ${pw.state}">${esc(state)}</span>` + table([L('Kalem', 'Item'), L('Değer', 'Value')], [
      [L('Sürekli yük', 'Continuous load'), nf(p.load) + ' W'],
      [L('Güneş paneli (güneşi izleyen, %29 hücre)', 'Solar array (Sun-tracking, 29% cells)'), nf(p.area, 1) + ' m²'],
      [L('Batarya', 'Battery'), nf(p.cap, 1) + ' kWh'],
      [L('En uzun kesintisiz karanlık', 'Longest continuous darkness'), hrs(s.dark)],
      [L('En düşük doluluk', 'Lowest state of charge'), pct(pw.min * 100)],
      [L('Bataryanın boş kaldığı süre', 'Time with an empty battery'), hrs(pw.emptyH)],
      [L('Gereken batarya (%80 deşarj ile)', 'Battery needed (at 80% depth of discharge)'), `<b>${nf(pw.need, 1)} kWh</b> · ≈ ${nf(pw.massKg)} kg`],
      [L('Üretim / tüketim', 'Generated / used'), `${nf(pw.gen)} / ${nf(pw.used)} kWh`]
    ]) + `<p>${act(L('Batarya grafiğini aç', 'Open the battery chart'), { type: 'tab', id: 'time' })}${e.watts ? ' ' + act(L(`${nf(p.load)} W yükü uygula`, `Apply the ${nf(p.load)} W load`), { type: 'pwr', load: p.load }) : ''}</p>` +
      `<p>${esc(pw.gen < pw.used ? L('Panel, görev boyunca tüketilenden az üretiyor: daha büyük panel ya da daha düşük yük gerekir. ', 'The array generates less than the mission uses: a larger array or a lower load is needed. ') : '')}${esc(pw.state === 'bad' ? L(`Bu ayarlarla batarya ${nf(pw.emptyH)} saat boş kalır; karanlığı çıkarmak için en az ${nf(pw.need, 1)} kWh gerekir.`, `With these settings the battery is empty for ${nf(pw.emptyH)} h; at least ${nf(pw.need, 1)} kWh is needed to ride out the dark.`) : s.dark < 1 ? L('Bu pencerede Güneş hiç batmıyor; batarya yalnızca tutulma ve manevralar için gerekir.', 'The Sun never sets in this window; a battery is only needed for eclipses and manoeuvres.')
      : s.dark > 150 ? L('Karanlık çok uzun: yalnızca bataryayla hayatta kalmak ağır olur; radyoizotop ısıtıcı (RHU) veya uyku modu düşünülmeli.', 'Darkness is very long: surviving on batteries alone is heavy; consider radioisotope heaters (RHU) or hibernation.')
        : L('Bu karanlık süresi batarya ve ısıtıcıyla yönetilebilir düzeyde.', 'This darkness is manageable with a battery and heaters.'))}</p>` +
      note(L('Model: batarya dolu başlar, şarj verimi %95, panel güneşi izler. Farklı bir yük için yazın: “500 W için batarya”.', 'Model: the battery starts full, 95% charge efficiency, the array tracks the Sun. For another load, ask: “battery for 500 W”.'));
  }

  /* ---- ground: ice traps, slope, region scan, mission report ---- */
  const gridLat = () => nf(Math.abs(AA.Polar.GRID_LAT || -80.2), 1);
  const noGrid = sc => !AA.Polar.ready
    ? (AA.Polar.failed ? L('LOLA güney kutbu verisi bu tarayıcıda açılamadı; ölçülmüş eğim ve kalıcı gölge haritası kullanılamıyor.', 'The LOLA south-pole pack could not be opened in this browser; measured slope and the permanent-shadow map are unavailable.')
      : L('LOLA güney kutbu verisi henüz açılıyor; birkaç saniye sonra tekrar sorun.', 'The LOLA south-pole pack is still unpacking; ask again in a few seconds.'))
    : L(`Bu nokta LOLA güney kutbu verisinin (${gridLat()}°G–90°G) dışında; burada ölçülmüş eğim ve kalıcı gölge haritası yok.${Math.abs(sc.lat) < 80 ? ' Kalıcı gölgeli bölgeler yalnızca kutuplara yakın bulunur.' : ''}`,
      `This point is outside the LOLA south-pole pack (${gridLat()}°S–90°S); there is no measured slope or permanent-shadow map here.${Math.abs(sc.lat) < 80 ? ' Permanently shadowed regions exist only near the poles.' : ''}`);
  function iceAnswer(k) {
    const a = analyze(k), f = a.f, head = `${tag(k)}<b>${esc(a.name)}</b> — ${L('buz erişimi (kalıcı gölgeli bölgeler)', 'ice access (permanently shadowed regions)')}`;
    if (!f.data) return head + `<p>${esc(noGrid(a.sc))}</p>`;
    const tr = f.trap;
    const rows = tr ? [
      [L('En yakın büyük buz tuzağı', 'Nearest large ice trap'), `<b>${esc(trapName(tr))}</b>`],
      [L('Uzaklık', 'Distance'), tr.inside ? L('içinde', 'inside it') : `<b>${nf(tr.km, 1)} km</b>`],
      [L('Yön', 'Direction'), tr.inside ? '—' : `${compass(tr.bearing)} · ${nf(tr.bearing)}°`],
      [L('İniş noktasında kalıcı gölge', 'Permanent shadow at the point'), pct(f.shadow * 100)],
      [L('Buz erişim puanı', 'Ice access score'), `${Math.round(a.parts.ice)}/100`]
    ] : [[L('En yakın büyük buz tuzağı', 'Nearest large ice trap'), L('veri alanında yok', 'none in the data area')]];
    const rt = AA.routeFor(a.sc);
    if (rt && rt.found && !rt.inside) rows.push(
      [L('Gezici rotası (en düşük eğimli yol)', 'Rover route (gentlest path)'), `<b>${nf(rt.km, 1)} km</b>${rt.relaxed ? ' · ' + L(`15° altında yol yok, sınır ${nf(rt.limit)}°`, `no path under 15°, limit ${nf(rt.limit)}°`) : ''}`],
      [L('Rotadaki en dik yer', 'Steepest part of the route'), nf(rt.maxSlope, 1) + '°'],
      [L(`Sürüş süresi (${nf(AA.ROVER_KMH, 1)} km/sa varsayımı)`, `Driving time (assuming ${nf(AA.ROVER_KMH, 1)} km/h)`), `≈ ${nf(rt.km / AA.ROVER_KMH)} ${t('h')}`]);
    else if (rt && !rt.found) rows.push([L('Gezici rotası', 'Rover route'), L(`${nf(rt.limit)}° altında eğimle ulaşılamıyor`, `not reachable on slopes under ${nf(rt.limit)}°`)]);
    // the closing sentence follows the drivable route when there is one, not the straight-line distance
    const reachKm = rt && rt.found && !rt.inside ? rt.km : tr ? tr.km : 0;
    const say = !tr ? '' : rt && !rt.found && !tr.inside ? L(`Buz tuzağı kuş uçuşu yakın, ancak ${nf(rt.limit)}° altındaki eğimlerle gezici ulaşamıyor; daha düz bir iniş noktası seçin.`, `The trap is close in a straight line, but a rover cannot reach it on slopes under ${nf(rt.limit)}°; choose a flatter landing point.`) : tr.inside ? L('Nokta kalıcı gölgenin içinde: buz hemen altınızda olabilir, ama Güneş hiç görünmez; güç ve ısı için başka kaynak gerekir.', 'The point is inside permanent shadow: ice may be right underfoot, but the Sun never appears; power and heat need another source.')
      : reachKm <= 5 ? L('Buz tuzağı kısa bir sürüş mesafesinde: aydınlık bir noktadan inip gölgeye girmek mümkün.', 'The trap is a short drive away: land in sunlight and drive into the shadow.')
        : reachKm <= 20 ? L('Buz tuzağı bir gezicinin ulaşabileceği mesafede.', 'The trap is within reach of a rover.')
          : L('Buz tuzağı uzak: buz bilimi için uzun bir sürüş ya da ayrı bir araç gerekir.', 'The trap is far: ice science would need a long traverse or a separate vehicle.');
    return head + table([L('Kalem', 'Item'), L('Değer', 'Value')], rows) + (say ? `<p>${esc(say)}</p>` : '') +
      `<p>${act(L('Buz katmanını ve rotayı haritada göster', 'Show the ice layer and the route on the map'), { type: 'layer', id: 'route', k })}</p>` +
      note(L('Kaynak: NASA Goddard kalıcı gölge haritası (LOLA, Mazarico ve ark. 2011). “Büyük tuzak” = en az 3 km² bağlantılı gölge. Gölge, buzun kanıtı değil, buzun kalabileceği soğuk bölgedir.', 'Source: NASA Goddard permanently-shadowed-region map (LOLA, Mazarico et al. 2011). A “large trap” is at least 3 km² of connected shadow. Shadow is where ice can survive, not proof of ice.'));
  }
  function slopeAnswer(k) {
    const a = analyze(k), f = a.f, head = `${tag(k)}<b>${esc(a.name)}</b> — ${L('eğim ve iniş güvenliği', 'slope and landing safety')}`;
    if (!f.slope && f.coarse) return head + table([L('Kalem', 'Item'), L('Değer', 'Value')], [
      [L('Kaba eğim (yaklaşık 7,6 km hücre)', 'Coarse slope (cells of about 7.6 km)'), `<b>${nf(f.coarse.here, 1)}°</b>`],
      [L('Çevredeki 3 × 3 hücrenin ortalaması', 'Mean of the surrounding 3 × 3 cells'), nf(f.coarse.mean, 1) + '°'],
      [L('En dik komşu hücre', 'Steepest neighbouring cell'), nf(f.coarse.max, 1) + '°'],
      [L('Arazi puanı', 'Terrain score'), `${Math.round(a.parts.terrain)}/100`]
    ]) + `<p>${act(L('Eğim katmanını haritada göster', 'Show the slope layer on the map'), { type: 'layer', id: 'slope', k })}</p>` +
      note(L('Bu nokta güney kutbu paketinin dışında: eğim, NASA LOLA küresel yükseklik modelinden (16 piksel/derece) türetilen kaba haritadan gelir. Krater duvarlarını ve dağ yamaçlarını gösterir; iniş ölçeğindeki pürüzleri göstermez.',
        'This point is outside the south-pole pack: the slope comes from the coarse map derived from the NASA LOLA global elevation model (16 pixels per degree). It shows crater walls and mountain fronts, not landing-scale roughness.'));
    if (!f.slope) return head + `<p>${esc(noGrid(a.sc))}</p>`;
    const s = f.slope, cls = s.mean > 15 ? 'bad' : s.mean <= 8 && s.safe >= 0.7 ? 'good' : 'mid';
    const say = { good: L('İniş için uygun: alan büyük ölçüde 8° sınırının altında.', 'Suitable for landing: most of the footprint is under the 8° limit.'),
      mid: L('Dikkat gerekir: iniş elipsi küçültülmeli ve tehlike önleme kullanılmalı.', 'Needs care: shrink the landing ellipse and use hazard avoidance.'),
      bad: L('İniş için uygun değil: arazi çok dik. “En iyi noktayı bul” ile daha düz bir yer arayın.', 'Not suitable for landing: the ground is too steep. Ask “find the best point” for flatter ground.') }[cls];
    return head + `: <span class="score-inline ${cls}">${esc(say)}</span>` + table([L('Kalem', 'Item'), L('Değer', 'Value')], [
      [L('Ortalama eğim (1 km yarıçap)', 'Mean slope (1 km radius)'), `<b>${nf(s.mean, 1)}°</b>`],
      [L('İniş noktasındaki eğim', 'Slope at the point'), nf(s.here, 1) + '°'],
      [L('En dik hücre', 'Steepest cell'), nf(s.max, 1) + '°'],
      [L('8°’den düz alan', 'Ground under 8°'), pct(s.safe * 100)],
      [L('Arazi puanı', 'Terrain score'), `${Math.round(a.parts.terrain)}/100`],
      [L('Tehlike önleme Δv payı', 'Hazard-avoidance Δv margin'), nf(hazardDv(a.tc, f)) + ' m/s']
    ]) + `<p>${act(L('Eğim katmanını haritada göster', 'Show the slope layer on the map'), { type: 'layer', id: 'slope', k })}</p>` +
      note(L('Kaynak: NASA LOLA 240 m yükseklik modeli; eğim 480 m taban uzunluğunda ölçülür ve 480 m hücrelerde ortalanır. Kaya ve küçük krater gibi metre ölçeğindeki tehlikeleri göstermez.', 'Source: NASA LOLA 240 m elevation model; slope is measured over a 480 m baseline and averaged in 480 m cells. It does not show metre-scale hazards such as boulders and small craters.'));
  }
  async function scoutAnswer(k, mode) {
    const sct = window.AAScout, r = sct ? await sct.run(k, mode) : null;
    if (!r) return esc(!sct || AA.Polar.failed ? L('Bölge taraması için LOLA güney kutbu verisi gerekli; bu tarayıcıda açılamadı.', 'The region scan needs the LOLA south-pole pack, which could not be opened in this browser.')
      : L('Tarama tamamlanamadı; lütfen tekrar deneyin.', 'The scan did not finish; please try again.'));
    const rows = r.top.map((p, i) => [`<b>${i + 1}.</b> ${esc(AA.fmtCoord(p.lat, p.lon))}<br>` + act(L(`${k} yap`, `Set as ${k}`), { type: 'point', k, lat: p.lat, lon: p.lon }),
      `<b>${p.score}</b>`, pct(p.sun * 100), pct(p.earth * 100), p.slope == null ? '—' : nf(p.slope, 1) + '°', p.trapKm == null ? '—' : nf(p.trapKm, 1) + ' km']);
    const where = r.mode === 'moon' ? L('Tüm Ay yüzeyinde (kaba tarama)', 'Best points over the whole Moon (coarse scan)') : L('Güney kutbu çevresinde (84°G–90°G)', 'Best points around the south pole (84°S–90°S)');
    return `${L(`${where} ${date(r.start, false)} başlangıçlı ${nf(r.dur, r.dur % 1 ? 1 : 0)} günlük görev için en iyi noktalar:`,
      `${where} for a ${nf(r.dur, r.dur % 1 ? 1 : 0)}-day mission starting ${date(r.start, false)}:`)}` +
      table([L('Nokta', 'Point'), L('Skor', 'Score'), t('sun'), t('earth'), L('Eğim', 'Slope'), L('Buz', 'Ice')], rows) +
      `<p>${esc(L(`${nf(r.scanned)} nokta incelendi; ${nf(r.rejected)} tanesi dik ya da kalıcı gölgede olduğu için elendi, ${nf(r.scored)} nokta gerçek LOLA ufkuyla simüle edildi.`,
        `${nf(r.scanned)} points examined; ${nf(r.rejected)} rejected as too steep or permanently shadowed, ${nf(r.scored)} simulated${r.mode === 'moon' ? ' (flat horizon outside the south pole)' : ' with their real LOLA horizon'}.`))}</p>` +
      `<p>${act(L('Haritada göster', 'Show on the map'), { type: 'layer', id: 'heat', k: null })}</p>`;
  }
  async function regionsAnswer(k) {
    const sct = window.AAScout, r = sct && sct.runRegions ? await sct.runRegions(k) : null;
    if (!r) return esc(!sct || AA.Polar.failed ? L('Bölge puanlaması için LOLA güney kutbu verisi gerekli; bu tarayıcıda açılamadı.', 'Scoring the regions needs the LOLA south-pole pack, which could not be opened in this browser.')
      : L('Puanlama tamamlanamadı; lütfen tekrar deneyin.', 'The scoring did not finish; please try again.'));
    const rows = r.rows.map(row => { const b = row.best; return [`<b>${esc(row.name)}</b>${row.a24 ? ' ★' : ''}` + (b ? '<br>' + act(L(`${k} yap`, `Set as ${k}`), { type: 'point', k, lat: b.lat, lon: b.lon }) : ''),
      b ? `<b>${b.score}</b>` : '—', b ? pct(b.sun * 100) : '—', b ? pct(b.earth * 100) : '—', b ? nf(b.slope, 1) + '°' : '—', b && b.trapKm != null ? nf(b.trapKm, 1) + ' km' : '—']; });
    return `${L(`NASA çalışma bölgelerinin her birindeki en iyi iniş noktası — ${date(r.start, false)} başlangıçlı ${nf(r.dur, r.dur % 1 ? 1 : 0)} günlük görev:`,
      `Best landing point inside each NASA study region — ${nf(r.dur, r.dur % 1 ? 1 : 0)}-day mission starting ${date(r.start, false)}:`)}` +
      table([L('Bölge', 'Region'), L('Skor', 'Score'), t('sun'), t('earth'), L('Eğim', 'Slope'), L('Buz', 'Ice')], rows) +
      `<p>${act(L('Bölgeleri haritada göster', 'Show the regions on the map'), { type: 'layer', id: 'regions', k: null })}</p>` +
      note(L('★ = NASA’nın Ekim 2024 Artemis III aday listesinde. Bölge merkezleri: NASA M2M Lunar Surface Data Book (2025), Tablo A2.1-1; her bölge yaklaşık 15 × 15 km. “—” = bölgede inilebilir (12°’den düz, gölgesiz) nokta bulunamadı.',
        '★ = on NASA’s October 2024 list of Artemis III candidates. Region centres: NASA M2M Lunar Surface Data Book (2025), Table A2.1-1; each region is about 15 × 15 km. “—” = no landable point (under 12°, not shadowed) found in the region.'));
  }
  const pdfAnswer = () => `${esc(L('Görev raporu iki senaryonun skorunu, pencerelerini, grafiklerini ve zemin verisini iki sayfada toplar.', 'The mission report gathers the scores, windows, charts and ground data of both scenarios on two pages.'))}<p>${act(L('Görev raporunu aç', 'Open the mission report'), { type: 'report' })}</p>`;

  function thermalAnswer(k) {
    const a = analyze(k), d = S.data[k], i = AA.idxAt(k);
    // radiative equilibrium of a flat regolith patch: T = (S (1-A) sin(el) f / (eps sigma))^(1/4)
    const temp = (el, f) => { const q = 1361 * 0.88 * Math.max(0, Math.sin(el * Math.PI / 180)) * f; return q > 0 ? Math.pow(q / (0.95 * 5.670374e-8), 0.25) : null; };
    const tNow = temp(d.sunEl[i], d.frac[i]), tMax = temp(a.stats.maxEl, 1), tPanel = Math.pow(1361 * 0.88 / (0.95 * 5.670374e-8), 0.25);
    const K = v => v == null ? L('≈ 40–100 K (gölge; yerel ısı akışına bağlı)', '≈ 40–100 K (shadow; depends on local heat flow)') : `${nf(v)} K (${nf(v - 273.15)} °C)`;
    return `${tag(k)}<b>${esc(a.name)}</b> — ${L('ısıl ortam tahmini', 'thermal environment estimate')}` + table([L('Durum', 'Case'), L('Yaklaşık sıcaklık', 'Approx. temperature')], [
      [L('Şu an, yatay zemin', 'Now, level ground'), K(tNow)],
      [L(`Görevdeki en yüksek Güneş (${nf(a.stats.maxEl, 1)}°), yatay zemin`, `Highest Sun in the mission (${nf(a.stats.maxEl, 1)}°), level ground`), K(tMax)],
      [L('Güneşe dik bakan yüzey', 'Surface facing the Sun directly'), K(tPanel)],
      [L('En uzun karanlık', 'Longest darkness'), hrs(a.stats.dark)]
    ]) + note(L('Işınım dengesi yaklaşımı (albedo 0,12, yayıcılık 0,95); topoğrafyadan yansıyan ısı ve regolit ısıl ataleti dahil değildir.',
      'Radiative-equilibrium approximation (albedo 0.12, emissivity 0.95); heat reflected from terrain and regolith thermal inertia are not included.'));
  }

  function windowsAnswer(k, body) {
    const a = analyze(k), d = S.data[k], sc = S.sc[k];
    const kinds = body === 'sun' ? ['sun'] : body === 'earth' ? ['earth'] : ['both', 'sun', 'earth'];
    let html = `${tag(k)}<b>${esc(a.name)}</b> — ${L('görüş pencereleri (UTC)', 'visibility windows (UTC)')}`;
    for (const kind of kinds) {
      const rs = d.runs[kind];
      html += `<h4>${t(kind)} · ${rs.length} ${L('pencere', rs.length === 1 ? 'window' : 'windows')}</h4>`;
      if (!rs.length) { html += `<p>${L('Bu görev süresinde pencere yok.', 'No window in this mission.')}</p>`; continue; }
      html += table([L('Başlangıç', 'Start'), L('Bitiş', 'End'), L('Süre', 'Length')], rs.slice(0, 6).map(r => [
        esc(date(sc.start + r[0] * d.dtH * H)), esc(r[1] >= d.n ? L('görev sonu', 'mission end') : date(sc.start + r[1] * d.dtH * H)), esc(AA.fmtDur((Math.min(r[1], d.n - 1) - r[0]) * d.dtH))]));
      if (rs.length > 6) html += note(L(`…ve ${rs.length - 6} pencere daha (CSV dışa aktarımında tamamı var).`, `…and ${rs.length - 6} more (the CSV export has all of them).`));
    }
    return html;
  }

  function nowAnswer(k) {
    const a = analyze(k), d = S.data[k], sc = S.sc[k], i = AA.idxAt(k);
    const line = (body, el, az, up) => [t(body), `${el >= 0 ? '+' : '−'}${nf(Math.abs(el), 2)}°`, nf(az, 1) + '°', up ? `<b>${t('up')}</b>` : t('down'), esc(AA.countdown(k, body))];
    return `${tag(k)}<b>${esc(a.name)}</b> — ${esc(date(sc.start + i * d.dtH * H))} UTC` +
      table([L('Cisim', 'Body'), L('Yükseklik', 'Elevation'), t('azim'), L('Durum', 'State'), L('Sıradaki olay', 'Next event')],
        [line('sun', d.sunEl[i], d.sunAz[i], d.sunUp[i]), line('earth', d.earthEl[i], d.earthAz[i], d.earthUp[i])]) +
      `<p>${esc(L(`Güneş diskinin %${nf(d.frac[i] * 100)} kadarı görünüyor; güneşe dönük panelde ${nf(d.flux[i])} W/m².`,
        `${nf(d.frac[i] * 100)}% of the Sun’s disc is visible; ${nf(d.flux[i])} W/m² on a Sun-facing panel.`))}</p>`;
  }

  function bodyAnswer(k, body) {
    const s = S.data[k].stats, now = AA.countdown(k, body);
    return esc(body === 'sun'
      ? t('a_sun', { k, p: nf(s.sun / s.total * 100), h: nf(s.sun), mx: nf(s.maxEl, 1), d: nf(s.dark), now })
      : t('a_earth', { k, p: nf(s.earth / s.total * 100), h: nf(s.earth), lo: nf(s.eMin, 1), hi: nf(s.eMax, 1), d: nf(s.nocomm), now }));
  }

  function recommendAnswer(k) {
    const a = analyze(k), s = a.stats, risks = [];
    const add = (sev, risk, fix) => risks.push([sev, risk, fix]);
    if (s.dark > 150) add(3, L(`${nf(s.dark)} saat kesintisiz karanlık`, `${nf(s.dark)} h of continuous darkness`), L('Radyoizotop ısıtıcı veya uyku modu; görev tarihini kaydırın (“en iyi tarih” sorun).', 'Radioisotope heaters or hibernation; shift the mission date (ask “best date”).'));
    else if (s.dark > 24) add(2, L(`${nf(s.dark)} saat karanlık`, `${nf(s.dark)} h of darkness`), L('Batarya ve ısıtıcı boyutlandırması (“batarya” sorun).', 'Size the battery and heaters (ask “battery”).'));
    if (s.earth / s.total < 0.005) add(3, L('Dünya hiç görünmüyor', 'Earth is never visible'), L('Röle uydusu şart (ör. ay yörüngesinde iletişim rölesi); doğrudan iletişim yok.', 'A relay satellite is mandatory (e.g. a lunar-orbit comms relay); no direct link.'));
    else if (s.nocomm > 48) add(2, L(`${nf(s.nocomm)} saat iletişim kesintisi`, `${nf(s.nocomm)} h communication outage`), L('Kritik operasyonları iletişim pencerelerine planlayın; veri depolayıp sonra gönderin veya röle kullanın.', 'Schedule critical operations inside comm windows; store-and-forward or use a relay.'));
    if (!S.data[k].sunUp[0]) add(3, L('İniş anı karanlıkta', 'Touchdown happens in darkness'), L('İniş saatini Güneş’in doğduğu ana kaydırın; optik seyrüsefer karanlıkta çalışmaz.', 'Move touchdown to after sunrise; optical navigation does not work in the dark.'));
    else if (a.parts.light < 100) add(2, L(`İnişte Güneş çok alçak (${nf(S.data[k].sunEl[0], 1)}°)`, `Sun very low at landing (${nf(S.data[k].sunEl[0], 1)}°)`), L('Uzun gölgeler tehlike algılamayı zorlaştırır: lidar tabanlı tehlike önleme ve arazi-bağıl seyrüsefer.', 'Long shadows hinder hazard detection: lidar hazard avoidance and terrain-relative navigation.'));
    if (s.maxEl < 5) add(1, L('Güneş hep ufka yakın', 'Sun always near the horizon'), L('Dikey veya direk üstü güneş panelleri; panel yönü Güneş’in azimutunu izlemeli.', 'Vertical or mast-mounted solar arrays; they must track the Sun in azimuth.'));
    const f = a.f, pw = a.pw;
    if (f.slope && f.slope.mean > 15) add(3, L(`Dik arazi (1 km çevrede ortalama ${nf(f.slope.mean, 1)}°)`, `Steep ground (${nf(f.slope.mean, 1)}° mean within 1 km)`), L('Bu nokta iniş için uygun değil; “en iyi noktayı bul” ile daha düz bir yer seçin.', 'Not suitable for landing; ask “find the best point” for flatter ground.'));
    else if (f.slope && (f.slope.mean > 8 || f.slope.safe < 0.7)) add(2, L(`Eğimli arazi (ortalama ${nf(f.slope.mean, 1)}°, %${nf(f.slope.safe * 100)} düz)`, `Sloping ground (${nf(f.slope.mean, 1)}° mean, ${nf(f.slope.safe * 100)}% flat)`), L('İniş elipsini küçültün; lidar tabanlı tehlike önleme kullanın.', 'Shrink the landing ellipse; use lidar hazard avoidance.'));
    else if (!f.slope && a.tc === 'polar') add(2, L('Engebeli kutup arazisi', 'Rough polar terrain'), L('İniş elipsini küçültün; yüksek çözünürlüklü LOLA/LROC verisiyle eğim ve kaya haritası çıkarın.', 'Shrink the landing ellipse; map slopes and boulders with high-resolution LOLA/LROC data.'));
    if (f.data && f.shadow >= 0.5) add(3, L('İniş noktası kalıcı gölgede', 'The landing point is in permanent shadow'), L('Güneş paneli çalışmaz; aydınlık bir kenara inip gölgeye gezici gönderin.', 'Solar arrays cannot work; land on a sunlit rim and send a rover into the shadow.'));
    else if (f.trap && f.trap.km > 30) add(1, L(`En yakın büyük buz tuzağı ${nf(f.trap.km)} km uzakta`, `The nearest large ice trap is ${nf(f.trap.km)} km away`), L('Buz bilimi hedefse daha yakın bir nokta seçin (“buza ne kadar yakın?” sorun).', 'If ice science is the goal, pick a closer point (ask “how close is the ice?”).'));
    if (pw && pw.state === 'bad') add(3, L(`Batarya ${nf(pw.emptyH)} saat boş kalıyor`, `The battery is empty for ${nf(pw.emptyH)} h`), L(`En az ${nf(pw.need, 1)} kWh batarya gerekir (şu an ${nf(S.pwr.cap, 1)} kWh) ya da yükü düşürün.`, `At least ${nf(pw.need, 1)} kWh is needed (now ${nf(S.pwr.cap, 1)} kWh), or lower the load.`));
    else if (pw && pw.state === 'mid') add(1, L(`Batarya %${nf(pw.min * 100)}’e kadar iniyor`, `The battery drops to ${nf(pw.min * 100)}%`), L(`%20 yedek için ${nf(pw.need, 1)} kWh önerilir.`, `${nf(pw.need, 1)} kWh is recommended to keep a 20% reserve.`));
    if (!a.lola) add(1, L('Gerçek arazi ufku kullanılmıyor', 'No real terrain horizon in use'), L('Sonuçlar düz ufuk varsayar; QuickMap aydınlatma katmanlarıyla doğrulayın.', 'Results assume a flat horizon; verify against QuickMap illumination layers.'));
    risks.sort((x, y) => y[0] - x[0]);
    const sevLabel = v => ['', L('Düşük', 'Low'), L('Orta', 'Medium'), L('Yüksek', 'High')][v];
    const verdict = (pw && pw.state === 'bad' ? L('Seçili batarya bu senaryoda tükeniyor; güç sistemi büyütülmeden uygulanamaz. ', 'The chosen battery runs empty in this scenario; it is not workable without a larger power system. ') : '') + (a.score >= 65 ? L('Bu senaryo görev için uygun görünüyor.', 'This scenario looks suitable for the mission.')
      : a.score >= 40 ? L('Bu senaryo ancak aşağıdaki önlemlerle uygulanabilir.', 'This scenario is workable only with the mitigations below.')
        : L('Bu senaryo riskli; tarih veya saha değiştirmeyi düşünün.', 'This scenario is risky; consider another date or site.'));
    const other = k === 'A' ? 'B' : 'A', o = analyze(other);
    return `${tag(k)}<b>${esc(a.name)}</b> — <span class="score-inline ${scoreClass(a.score)}">${a.score}/100</span><p>${esc(verdict)}</p>` +
      (risks.length ? table([L('Önem', 'Severity'), 'Risk', L('Önlem', 'Mitigation')], risks.map(r => [`<span class="sev s${r[0]}">${sevLabel(r[0])}</span>`, esc(r[1]), esc(r[2])])) : `<p>${L('Belirgin bir risk yok.', 'No significant risk found.')}</p>`) +
      `<p>${esc(o.score > a.score + 4 ? L(`Not: ${other} senaryosu (${o.name}) ${o.score}/100 ile daha yüksek skor alıyor.`, `Note: scenario ${other} (${o.name}) scores higher at ${o.score}/100.`)
        : L('İsterseniz “en iyi tarih” veya “en iyi saha” diyerek alternatifleri tarayabilirim.', 'Ask “best date” or “best site” and I will scan the alternatives.'))}</p>`;
  }

  function whatIfAnswer(k, e) {
    const base = S.sc[k], sc = Object.assign({}, base, e.site ? scenarioFor(e.site, base.start) : {}, e.date ? { start: e.date } : {});
    if (e.shift) sc.start += Math.round(e.shift * DAY);
    const dur = e.days ? Math.max(1, Math.min(180, e.days)) : S.dur;
    const a = evaluate(sc, sim(sc, dur, dur <= 30 ? 20 : 60)), cur = analyze(k), s = a.stats;
    const acts = [];
    if (e.site) acts.push(act(L(`${k} sahasını değiştir`, `Change site ${k}`), { type: 'site', k, id: e.site.id }));
    if (e.date || e.shift) acts.push(act(L(`Tarihi ${k}’ya uygula`, `Apply date to ${k}`), { type: 'start', k, ms: sc.start }));
    if (e.days && AA.DURS.includes(dur)) acts.push(act(L('Süreyi uygula', 'Apply duration'), { type: 'dur', d: dur }));
    const sh = e.shift ? ' ' + esc(L(`(${k} başlangıcı ${nf(Math.abs(e.shift), e.shift % 1 ? 1 : 0)} gün ${e.shift > 0 ? 'ertelendi' : 'öne alındı'}; süre aynı)`, `(start of ${k} moved ${nf(Math.abs(e.shift), e.shift % 1 ? 1 : 0)} days ${e.shift > 0 ? 'later' : 'earlier'}; same length)`)) : '';
    return `<b>${L('Varsayım', 'What-if')}:</b> ${esc(a.name)} · ${esc(date(sc.start, false))} · ${nf(dur, dur % 1 ? 1 : 0)} ${t('days')}${sh}` +
      table([t('metric'), L('Varsayım', 'What-if'), `${L('Şimdiki', 'Current')} ${k}`], [
        [t('score'), `<b>${a.score}</b>`, cur.score],
        [t('sun'), `${hrs(s.sun)} (${pct(s.sun / s.total * 100)})`, `${hrs(cur.stats.sun)} (${pct(cur.stats.sun / cur.stats.total * 100)})`],
        [t('earth'), `${hrs(s.earth)} (${pct(s.earth / s.total * 100)})`, `${hrs(cur.stats.earth)} (${pct(cur.stats.earth / cur.stats.total * 100)})`],
        [t('both'), hrs(s.both), hrs(cur.stats.both)],
        [L('En uzun karanlık', 'Longest dark'), hrs(s.dark), hrs(cur.stats.dark)],
        [t('fuel'), pct(a.frac * 100), pct(cur.frac * 100)]
      ]) + groundLine(a) + (acts.length ? `<p>${acts.join(' ')}</p>` : '') + srcNote(a);
  }

  function sourcesAnswer() {
    const m = Ephem.meta, k = S.globe.target, sc = S.sc[k], st = Ephem.site(sc.lat, sc.lon), c = Ephem.crossCheck(st, sc.start + S.cur * H);
    let diff = '';
    if (c.spice && c.ae) diff = L(`Şu an ${k} sahasında iki bağımsız yöntemin farkı: Güneş ${nf(Math.abs(c.spice.sun.el - c.ae.sun.el), 4)}°, Dünya ${nf(Math.abs(c.spice.earth.el - c.ae.earth.el), 4)}°.`,
      `Right now at site ${k} the two independent methods differ by: Sun ${nf(Math.abs(c.spice.sun.el - c.ae.sun.el), 4)}°, Earth ${nf(Math.abs(c.spice.earth.el - c.ae.earth.el), 4)}°.`);
    return `<b>${L('Veri kaynakları ve doğruluk', 'Data sources and accuracy')}</b>` + list([
      m ? L(`Güneş/Dünya konumu: ${m.source}, ${m.ephemeris}, ${m.frame} çerçevesi, ${m.abcorr} düzeltmesi. NASA’nın görev planlamada kullandığı araç ve veri.`, `Sun/Earth position: ${m.source}, ${m.ephemeris}, ${m.frame} frame, ${m.abcorr} correction — the tool and data NASA uses for mission planning.`)
        : L('SPICE tablosu yüklü değil; astronomy-engine kullanılıyor.', 'The SPICE table is not loaded; astronomy-engine is in use.'),
      L('Bağımsız çapraz kontrol: astronomy-engine (VSOP87/ELP). ' + diff, 'Independent cross-check: astronomy-engine (VSOP87/ELP). ' + diff),
      L('Arazi ufku: Shackleton Rim, Connecting Ridge ve Malapert Massif merkezleri için LOLA 80 m modelinden (Barker ve ark. 2023) hazır profil; 82°G’nin güneyindeki diğer her nokta için 480 m’lik LOLA ızgarasından tarayıcıda hesaplanan profil; bu alanın dışında sabit ufuk açısı.',
        'Terrain horizon: a precomputed LOLA 80 m profile (Barker et al. 2023) for the Shackleton Rim, Connecting Ridge and Malapert Massif centres; a profile computed in the browser from the 480 m LOLA grid for every other point south of 82°S; a fixed horizon angle outside that area.'),
      L('Eğim: NASA LOLA 240 m yükseklik modeli. Kalıcı gölge (buz tuzakları): NASA Goddard PGDA haritası (Mazarico ve ark. 2011).', 'Slope: NASA LOLA 240 m elevation model. Permanent shadow (ice traps): NASA Goddard PGDA map (Mazarico et al. 2011).'),
      L('Saha koordinatları: NASA Lunar Surface Data Book ve görev kayıtları. Harita: LRO WAC mozaiği (NASA Moon Trek).', 'Site coordinates: NASA Lunar Surface Data Book and mission records. Map: LRO WAC mosaic (NASA Moon Trek).'),
      L('Skor, yakıt, batarya ve sıcaklık değerleri ön tasarım göstergeleridir; sertifikalı güvenlik analizi değildir.', 'Score, propellant, battery and temperature figures are preliminary-design indicators, not a certified safety analysis.')
    ], 'pro') + `<p>${act(L('Doğrulama panelini aç', 'Open the verification panel'), { type: 'tab', id: 'resources' })}</p>`;
  }

  const GLOSSARY = [
    [/\bdte\b|dogrudan iletisim|direct.to.earth/, 'DTE', 'Direct-to-Earth: röle uydusu olmadan, iniş aracının antenini doğrudan Dünya’ya çevirerek kurduğu iletişim. Dünya ufkun üstündeyken mümkündür.', 'Direct-to-Earth: a link from the lander straight to Earth with no relay satellite. It works only while Earth is above the local horizon.'],
    [/\bpsr\b|kalici golge|permanently shadowed/, 'PSR', 'Kalıcı gölgeli bölge: Güneş’i hiç görmeyen krater tabanları. 40 K’e kadar soğurlar ve su buzu barındırabilirler; kutup görevlerinin ana bilimsel hedefidir.', 'Permanently shadowed region: crater floors that never see the Sun. They cool to ~40 K and can hold water ice, the main science target of polar missions.'],
    [/soguk tuzak|cold trap|buz tuzagi|ice trap/, ['Buz tuzağı', 'Ice trap'], 'Kalıcı gölgede kalan ve su buzunun milyarlarca yıl buharlaşmadan kalabileceği kadar soğuk (yaklaşık 110 K altı) bölge. Bu sitede “büyük tuzak”, en az 3 km² bağlantılı kalıcı gölge demektir.', 'A permanently shadowed area cold enough (below about 110 K) for water ice to survive for billions of years. On this site a “large trap” means at least 3 km² of connected permanent shadow.'],
    [/\blola\b/, 'LOLA', 'Lunar Orbiter Laser Altimeter: LRO uydusundaki lazer yükseklikölçer. Ay’ın en hassas yükseklik haritasını üretti; buradaki arazi ufukları bu veriden gelir.', 'Lunar Orbiter Laser Altimeter on LRO. It produced the most precise elevation map of the Moon; the terrain horizons here come from it.'],
    [/\bspice\b|\bnaif\b/, 'SPICE', 'NASA NAIF ekibinin görev geometrisi sistemi: “şu anda Güneş, Dünya ve araç nerede?” sorusunu JPL efemerisleriyle (burada DE440) yanıtlar. Bu sitedeki açılar SPICE ile hesaplanmıştır.', 'NASA NAIF’s mission-geometry system: it answers “where are the Sun, Earth and spacecraft right now?” from JPL ephemerides (DE440 here). The angles on this site are computed with SPICE.'],
    [/librasyon|libration/, ['Librasyon', 'Libration'], 'Ay’ın Dünya’dan bakınca hafifçe sallanması. Bu yüzden kutuplardan bakıldığında Dünya ufkun birkaç derece altına inip çıkar; iletişim pencerelerini belirler.', 'The Moon’s slow wobble as seen from Earth. From the poles it makes Earth bob a few degrees above and below the horizon, which sets the communication windows.'],
    [/azimut|azimuth/, ['Azimut', 'Azimuth'], 'Ufuk düzlemindeki yön açısı: kuzey 0°, doğu 90°, güney 180°, batı 270°.', 'The compass direction along the horizon: north 0°, east 90°, south 180°, west 270°.'],
    [/ufuk maske|ufuk acisi|horizon mask|mask angle/, ['Ufuk maskesi', 'Horizon mask'], 'Bir cismin “görünür” sayılması için aşması gereken yükseklik açısı. Dağlar ufku yükseltir (pozitif), yüksek bir tepede durmak ufku alçaltır (negatif).', 'The elevation a body must exceed to count as visible. Mountains raise it (positive); standing on a peak lowers it (negative).'],
    [/delta.?v|\bdv\b/, 'Δv', 'Bir manevranın gerektirdiği hız değişimi. Yakıt miktarını roket denklemi belirler: daha büyük Δv üstel olarak daha fazla yakıt demektir.', 'The velocity change a manoeuvre needs. The rocket equation turns it into propellant: more Δv means exponentially more propellant.'],
    [/\bisp\b|ozgul itki|specific impulse/, 'Isp', 'Özgül itki: motorun yakıt verimliliği (saniye). Yüksek Isp, aynı Δv için daha az yakıt demektir. Burada 320 s (depolanabilir çift yakıtlı motor) varsayılır.', 'Specific impulse: engine efficiency in seconds. Higher Isp means less propellant for the same Δv. 320 s (storable bipropellant) is assumed here.'],
    [/toposentrik|topocentric/, ['Toposentrik', 'Topocentric'], 'Ay’ın merkezinden değil, yüzeydeki gözlemcinin bulunduğu noktadan ölçülen açı. Kutupta Dünya için 0,27°’ye varan fark yaratır.', 'Measured from the observer on the surface rather than from the Moon’s centre. At the poles it changes Earth’s elevation by up to 0.27°.'],
    [/efemeris|ephemeris/, ['Efemeris', 'Ephemeris'], 'Gök cisimlerinin zamana göre konum tablosu. JPL DE440, NASA’nın güncel gezegen ve Ay efemerisidir.', 'A table of where celestial bodies are over time. JPL DE440 is NASA’s current planetary and lunar ephemeris.'],
    [/artemis/, 'Artemis', 'NASA’nın insanlı Ay programı. NASA 2022’de güney kutbu çevresinde 13 aday iniş bölgesi açıkladı (Connecting Ridge bunlardandı) ve Ekim 2024’te Artemis III için listeyi dokuza indirdi; Malapert Massif, Haworth, Nobile Rim 1 ve 2 ile de Gerlache Rim 2 bu dokuzun içindedir. Sıralamak için “Artemis bölgelerini puanla” yazın.', 'NASA’s crewed lunar programme. In 2022 NASA named 13 candidate landing regions near the south pole (Connecting Ridge was one) and in October 2024 narrowed them to nine for Artemis III, including Malapert Massif, Haworth, Nobile Rim 1 and 2 and de Gerlache Rim 2. Type “Score the Artemis regions” to rank them.'],
    [/\bclps\b/, 'CLPS', 'Commercial Lunar Payload Services: NASA’nın ticari şirketlere Ay’a yük taşıtma programı (ör. IM-1 Odysseus, Blue Ghost).', 'Commercial Lunar Payload Services: NASA’s programme buying lunar deliveries from companies (e.g. IM-1 Odysseus, Blue Ghost).']
  ];
  function glossaryAnswer(x) {
    const hits = GLOSSARY.filter(g => g[0].test(x));
    return hits.length ? hits.map(g => `<b>${esc(Array.isArray(g[1]) ? L(g[1][0], g[1][1]) : g[1])}</b> — ${esc(L(g[2], g[3]))}`).join('<br><br>') : null;
  }

  function helpAnswer() {
    return `<b>${L('Neler sorabilirsiniz', 'What you can ask')}</b>` + list([
      L('“A sahasını analiz et”, “B’nin riskleri neler?”, “A ile B’yi karşılaştır”', '“Analyse site A”, “what are the risks of B?”, “compare A and B”'),
      L('“A için en iyi tarih ne?” — önümüzdeki 365 günü tarar', '“Best date for A?” — scans the next 365 days'),
      L(`“En iyi saha hangisi?” — ${SITES.length} sahayı sıralar`, `“Which site is best?” — ranks all ${SITES.length} sites`),
      L('“Artemis bölgelerini puanla” — NASA’nın 14 çalışma bölgesinde en iyi noktayı bulur', '“Score the Artemis regions” — finds the best point in each of NASA’s 14 study regions'),
      L('“Buza nasıl gideriz?” — 15°’den dik yerlerden kaçınan gezici rotası; “sıcaklık haritası”', '“How do we reach the ice?” — a rover route that avoids slopes over 15°; “temperature map”'),
      L('“En iyi noktayı bul” — kutup çevresini gerçek LOLA arazisiyle tarar', '“Find the best point” — scans the polar region with real LOLA terrain'),
      L('“Buza ne kadar yakın?”, “eğim nasıl?” — NASA gölge haritası ve LOLA eğimi', '“How close is the ice?”, “how steep is it?” — NASA shadow map and LOLA slope'),
      L('“Görev raporu” — iki sayfalık PDF özeti', '“Mission report” — a two-page PDF summary'),
      L('“Malapert’i 15 Mart 2027’de 30 gün için değerlendir” — yeni bir varsayım hesaplar', '“Evaluate Malapert on 15 March 2027 for 30 days” — runs a new what-if'),
      L('“2500 kg ve Isp 310 için yakıt”, “500 W için batarya”, “sıcaklık ne olur?”', '“Propellant for 2500 kg and Isp 310”, “battery for 500 W”, “how cold does it get?”'),
      L('“İletişim pencerelerini listele”, “şu an Güneş nerede?”', '“List the comm windows”, “where is the Sun right now?”'),
      L('“SPICE nedir?”, “veriler ne kadar doğru?”, “skor nasıl hesaplanıyor?”', '“What is SPICE?”, “how accurate is the data?”, “how is the score computed?”')
    ], 'pro');
  }

  /* ================= router ================= */
  const mem = { k: null, intent: null, history: [] };
  async function localAnswer(q) {
    const e = parse(q), x = e.x;
    let intents = detect(x);
    // a site named without a letter refers to the scenario that already uses it (“Malapert’te eğim nasıl?”)
    const named = !e.scen.length && e.site ? KEYS.find(x => S.sc[x].site === e.site.id) : null;
    const k = e.scen[0] || named || mem.k || S.globe.target;
    // follow-up such as "and for B?": reuse the previous topic
    if (!intents.length && mem.intent && (e.scen.length || e.site || e.date || e.days || e.shift) && x.length < 40) intents = [mem.intent];
    const has = n => intents.includes(n);
    const out = [];
    const push = html => { if (html) out.push(html); };

    if (has('help') && intents.length <= 2) push(helpAnswer());
    // a definition alone, unless the question also asks for measured data (“nearest ice trap”, “how steep”)
    if (has('glossary')) { const g = glossaryAnswer(x); if (g) { push(g); if (!has('ice') && !has('slope') && !has('regions') && !has('route')) intents = intents.filter(n => n === 'glossary'); } }
    if (!out.length || intents.length > 1) {
      if (has('sources') && !has('glossary')) push(sourcesAnswer());
      if (has('method') && (has('score') || has('fuel'))) push(esc(t(has('fuel') && !has('score') ? 'a_fuel_how' : 'a_safe_how')));
      else if (has('method') && !out.length) push(esc(t('a_safe_how')) + '<br><br>' + esc(t('a_fuel_how')));
      if (has('pdf')) push(pdfAnswer());
      if (has('scout') && !has('regions')) push(await scoutAnswer(k, has('moon') ? 'moon' : 'pole'));
      if (has('regions')) push(await regionsAnswer(k));
      if (has('bestdate')) push(bestDateAnswer(k));
      if (has('bestsite') && !has('scout') && !has('regions')) push(bestSiteAnswer(k, /kutup|polar|pole|guney|south|artemis/.test(x)));
      const whatIf = !has('bestdate') && !has('bestsite') && !has('scout') && !has('regions') && !has('pdf') && (e.date || e.days || e.shift || (e.site && e.site.id !== S.sc[k].site && !has('compare')));
      if (whatIf) push(whatIfAnswer(k, e));
      else {
        if (has('compare') && !has('bestsite')) push(compareAnswer());
        if (has('recommend')) push(recommendAnswer(k));
        if (has('fuel') && !has('method')) push(fuelAnswer(k, e));
        if (has('battery')) push(batteryAnswer(k, e));
        if (has('ice') || has('route')) push(iceAnswer(k));
        if (has('slope')) push(slopeAnswer(k));
        if (has('thermal')) push(thermalAnswer(k) + `<p>${act(L('Sıcaklık haritasını aç', 'Open the temperature map'), { type: 'layer', id: 'temp', k })}</p>`);
        if (has('windows')) push(windowsAnswer(k, e.body));
        if (has('now')) push(nowAnswer(k));
        if (has('score') && !has('method') && !has('compare') && !has('recommend') && !has('regions') && !has('scout')) {
          const a = analyze(k);
          push(`${tag(k)}<span class="score-inline ${scoreClass(a.score)}">${esc(a.name + ': ' + t('a_scoreline', { s: a.score }))}</span>` +
            table([L('Bileşen', 'Component'), L('Ağırlık', 'Weight'), L('Puan', 'Points')], PARTS.map(p => [t('sc_' + p), L('%' + WEIGHT[p], WEIGHT[p] + '%'), Math.round(a.parts[p])])) + note(t('a_safe_how')));
        }
        if (!out.length && (has('sun') || has('earth'))) { if (has('sun')) push(bodyAnswer(k, 'sun')); if (has('earth')) push(bodyAnswer(k, 'earth')); }
        if (has('report') && !has('pdf') && !out.length) {
          if (e.scen.length === 2) { push(fullReport(analyze('A'))); push(fullReport(analyze('B'))); }
          else push(fullReport(analyze(k)));
        }
      }
    }
    if (!out.length) {
      if (e.scen.length || e.site) push(e.site && e.site.id !== S.sc[k].site ? whatIfAnswer(k, e) : fullReport(analyze(k)));
      else push(`${L('Bu soruyu tam anlayamadım. Görev verileriyle ilgili şunlara yanıt verebilirim:', 'I did not fully understand that. Here is what I can answer from the mission data:')}` + helpAnswer());
    }
    // remember the topic so that "and for B?" repeats it; general topics (help, glossary, method) are not repeated
    const topic = intents.find(n => !['help', 'glossary', 'sources', 'method', 'whatif'].includes(n));
    mem.k = k; mem.intent = topic || 'report';
    return out.slice(0, 3).join('<hr>');
  }

  /* ================= AI model bridge ================= */
  // Everything a model needs to answer about the current scenarios, as plain JSON.
  function buildContext() {
    const out = {
      language: S.lang, missionDays: S.dur, cursorHours: S.cur, activeScenario: S.globe.target,
      ephemeris: Ephem.meta ? `${Ephem.meta.source}, ${Ephem.meta.ephemeris}, ${Ephem.meta.frame}, ${Ephem.meta.abcorr}` : 'astronomy-engine',
      scenarios: {}
    };
    for (const k of KEYS) {
      const sc = S.sc[k], d = S.data[k], s = d.stats, a = analyze(k), i = AA.idxAt(k);
      const win = kind => d.runs[kind].slice(0, 8).map(r => ({ startUTC: new Date(sc.start + r[0] * d.dtH * H).toISOString(), hours: +((Math.min(r[1], d.n - 1) - r[0]) * d.dtH).toFixed(1) }));
      out.scenarios[k] = {
        site: a.name, latitude: sc.lat, longitude: sc.lon, startUTC: new Date(sc.start).toISOString(),
        horizon: a.hz === 'lola80' ? 'LOLA 80 m precomputed profile' : a.hz === 'lola480' ? 'LOLA 480 m grid (coarser: can miss narrow nearby ridges)' : sc.mask + ' deg fixed', ephemerisSource: d.src,
        hours: { total: s.total, sun: s.sun, earth: s.earth, both: s.both, longestDarkness: s.dark, longestCommOutage: s.nocomm },
        sunElevationDeg: { min: s.sMin, max: s.maxEl }, earthElevationDeg: { min: s.eMin, max: s.eMax },
        atCursor: { sunElevationDeg: d.sunEl[i], sunAzimuthDeg: d.sunAz[i], sunVisible: !!d.sunUp[i], earthElevationDeg: d.earthEl[i], earthAzimuthDeg: d.earthAz[i], earthVisible: !!d.earthUp[i] },
        windows: { sun: win('sun'), earth: win('earth'), both: win('both') },
        solarEnergyKWhPerM2: s.energy, suitabilityScore: a.score, scoreParts: a.parts,
        descentDeltaVms: a.dv, propellantFraction: a.frac, terrainClass: a.tc, pros: a.pros, cons: a.cons,
        ground: a.f.data ? {
          source: 'NASA LOLA 240 m DEM (slope) and NASA GSFC permanently-shadowed-region map',
          meanSlopeDegWithin1km: a.f.slope && +a.f.slope.mean.toFixed(1), shareOfGroundUnder8deg: a.f.slope && +a.f.slope.safe.toFixed(2),
          nearestLargeIceTrapKm: a.f.trap && +a.f.trap.km.toFixed(1), nearestLargeIceTrapCrater: a.f.trap && a.f.trap.name, pointInPermanentShadow: a.f.shadow >= 0.5
        } : AA.Polar.ready ? 'outside the LOLA south-pole pack (80.2S-90S): no measured slope or shadow data' : 'LOLA south-pole pack not loaded: no measured slope or shadow data',
        power: a.pw ? {
          assumedLoadW: S.pwr.load, batteryKWh: S.pwr.cap, solarArrayM2: S.pwr.area, lowestStateOfCharge: +a.pw.min.toFixed(2), hoursWithEmptyBattery: +a.pw.emptyH.toFixed(1),
          batteryNeededKWh: +a.pw.need.toFixed(1), verdict: { good: 'survives', mid: 'survives but uses the 20% reserve', bad: 'battery runs flat' }[a.pw.state]
        } : null
      };
    }
    return out;
  }
  const toText = html => { const d = document.createElement('div'); d.innerHTML = html.replace(/<\/(tr|p|li|h4)>|<br>|<hr>/g, '$&\n').replace(/<\/t[dh]>/g, ' | '); return d.textContent.replace(/\n\s*\n+/g, '\n').trim(); };
  // Minimal, safe formatting of model text: escape everything, then allow **bold**, lists and line breaks.
  const fmtModel = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/^\s*[-•]\s+/gm, '• ').replace(/\n/g, '<br>');

  async function respond(q) {
    const local = await localAnswer(q), ai = window.AstroApexAI;
    if (ai && typeof ai.ask === 'function') {
      try {
        const ctx = buildContext();
        ctx.localAnalysis = toText(local);
        ctx.history = mem.history.slice(-6);
        const text = await ai.ask(q, ctx);
        if (text && String(text).trim()) {
          mem.history.push({ role: 'user', content: q }, { role: 'assistant', content: String(text) });
          return fmtModel(String(text)) + `<details class="calc"><summary>${L('Hesaplanan veriler', 'Computed data')}</summary>${local}</details>`;
        }
      } catch (err) { /* fall back to the local engine */ }
    }
    return local;
  }
  // When served by server.py, ask it whether a model is configured.
  if (!window.AstroApexAI && /^https?:$/.test(location.protocol)) {
    fetch('api/status').then(r => r.ok ? r.json() : null).then(st => {
      if (!st || !st.ai || window.AstroApexAI) return;
      window.AstroApexAI = {
        name: L('Yapay zekâ bağlı · ', 'AI connected · ') + st.model,
        async ask(question, context) {
          const r = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, context }) });
          if (!r.ok) throw new Error('chat ' + r.status);
          return (await r.json()).answer;
        }
      };
      setModelLabel();
    }).catch(() => { /* static hosting or file://: local engine only */ });
  }

  /* ================= chat panel ================= */
  const panel = $('#assist'), log = $('#assist-log'), input = $('#assist-input'), opener = $('#assist-open');
  function setModelLabel() { $('#assist-model').textContent = window.AstroApexAI ? (window.AstroApexAI.name || t('a_model_on')) : t('a_model'); }
  function addMsg(role, html) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function open(focus = true) {
    panel.hidden = false; document.body.classList.add('assist-on'); opener.setAttribute('aria-expanded', 'true');
    setModelLabel();
    if (focus) input.focus();
  }
  function close() { panel.hidden = true; document.body.classList.remove('assist-on'); opener.setAttribute('aria-expanded', 'false'); opener.focus(); }
  let busy = false;
  async function ask(q) {
    q = q.trim(); if (!q || busy) return;
    busy = true;
    addMsg('user', esc(q));
    const wait = addMsg('bot typing', '<i></i><i></i><i></i>');
    let html;
    try { html = await respond(q); } catch (err) { html = esc(L('Bu soruyu işlerken bir hata oluştu. Lütfen farklı bir şekilde sorun.', 'Something went wrong while answering. Please rephrase the question.')); }
    wait.className = 'msg bot'; wait.innerHTML = html;
    wait.scrollIntoView({ block: 'start', behavior: 'smooth' });
    busy = false;
  }
  // Buttons inside answers that change the scenario.
  log.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    let a; try { a = JSON.parse(b.dataset.act); } catch (err) { return; }
    if (a.type === 'start' && KEYS.includes(a.k)) { S.sc[a.k].start = a.ms; AA.refresh(); addMsg('note', esc(L(`${a.k} başlangıcı ${date(a.ms)} UTC olarak ayarlandı.`, `Start of ${a.k} set to ${date(a.ms)} UTC.`))); }
    else if (a.type === 'site' && KEYS.includes(a.k)) { AA.setSite(a.k, a.id); AA.refresh(); addMsg('note', esc(L(`${a.k} sahası ${AA.siteName(a.k)} olarak değiştirildi.`, `Site ${a.k} changed to ${AA.siteName(a.k)}.`))); }
    else if (a.type === 'dur' && AA.DURS.includes(a.d)) { S.dur = a.d; AA.refresh(true); addMsg('note', esc(L(`Görev süresi ${nf(a.d, a.d % 1 ? 1 : 0)} gün olarak ayarlandı.`, `Mission duration set to ${nf(a.d, a.d % 1 ? 1 : 0)} days.`))); }
    else if (a.type === 'tab') AA.showTab(a.id);
    else if (a.type === 'point' && KEYS.includes(a.k) && isFinite(a.lat) && isFinite(a.lon)) { AA.setPoint(a.k, +a.lat, +a.lon); AA.refresh(); addMsg('note', esc(L(`${a.k} noktası ${AA.fmtCoord(S.sc[a.k].lat, S.sc[a.k].lon)} olarak ayarlandı.`, `Point ${a.k} set to ${AA.fmtCoord(S.sc[a.k].lat, S.sc[a.k].lon)}.`))); }
    else if (a.type === 'layer' && ['ice', 'slope', 'heat', 'temp', 'regions', 'route'].includes(a.id)) {
      S.globe[a.id] = true;
      if (a.id === 'route') S.globe.ice = true;        // the route ends at an ice trap, so show them
      if (a.id === 'temp') S.globe.slope = false;      // temperature and slope colour the same ground: one at a time
      if (a.id === 'slope') S.globe.temp = false;
      const sc = KEYS.includes(a.k) ? S.sc[a.k] : null;
      if (sc) S.globe.target = a.k;                    // the map's route and temperature readout follow this scenario
      Object.assign(S.globe, sc && sc.lat < -60 ? { lat0: sc.lat, lon0: sc.lon, zoom: a.id === 'route' ? 24 : 6 } : { lat0: -90, lon0: 0, zoom: 4 }); // close in for a route
      AA.showTab('map'); AA.syncForms(); AA.queueGlobe();
    }
    else if (a.type === 'pwr' && isFinite(a.load)) { AA.setPower({ load: a.load }); addMsg('note', esc(L(`Yük ${nf(S.pwr.load)} W olarak ayarlandı.`, `Load set to ${nf(S.pwr.load)} W.`))); }
    else if (a.type === 'report' && window.AAReport) window.AAReport.open();
  });

  opener.addEventListener('click', () => panel.hidden ? open() : close());
  $('#assist-close').addEventListener('click', close);
  $('#assist-form').addEventListener('submit', e => { e.preventDefault(); if (busy) return; const q = input.value; input.value = ''; ask(q); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#assist-form').requestSubmit(); } });
  $('#assist-quick').addEventListener('click', e => { const q = e.target.dataset.q; if (q) ask(t(q)); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ask]'); if (!b) return;
    open(); ask(t(b.dataset.ask === 'B' ? 'q_b' : 'q_a'));
  });
  // Shortcuts: "/" or Ctrl/Cmd+K opens the assistant, Esc closes it.
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); open(); }
    else if (e.key === 'Escape' && !panel.hidden) close();
  });

  window.AAssist = {
    analyze, evaluate, recommend, buildContext, localAnswer, scanDates, rankSites, scoreParts, PARTS, WEIGHT, trapName, compass,
    onRefresh() { renderReports(); input.placeholder = t('a_place'); if (!panel.hidden) setModelLabel(); },
    onPick(k) { // a point was chosen on the 3D map
      open(false);
      addMsg('note', esc(t('a_picked', { k })));
      addMsg('bot', fullReport(analyze(k)));
    }
  };
  input.placeholder = t('a_place');
  addMsg('bot', esc(t('a_hello')));
  renderReports();
})();
