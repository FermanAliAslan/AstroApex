/* AstroApex presentation layer: the rotating Moon backdrop, the opening sequence and the guided tour.
   Purely visual. Nothing here changes a calculation; if this file fails, the app still works. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const root = document.documentElement;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lang = () => (window.AA && window.AA.S.lang === 'en') ? 'en' : 'tr';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode or sandbox */ } }
  };

  /* ---------- rotating Moon backdrop ---------- */
  // The sphere is precomputed once per size: every pixel stores its texture row, its base column, its shading
  // and its rim light. A frame is then one table lookup per pixel, so the spin costs a few milliseconds.
  const M = { cv: $('#bg-moon'), N: 0, idx: null, row: null, col: null, shade: null, rim: null, alpha: null, img: null,
    tex: null, spin: 0, speed: 0, target: 0, last: 0, lastShift: -1 };
  const SPIN = 4096 / 170; // texture columns per second at full speed: one turn in about 170 s

  function buildSphere() {
    const css = M.cv.getBoundingClientRect().width || 800;
    const N = Math.max(320, Math.min(880, Math.round(css * Math.min(window.devicePixelRatio || 1, 1.5) / 2) * 2));
    if (N === M.N && M.tex === M.builtFor) return;
    const tex = M.tex, tw = tex.w, th = tex.h, half = N / 2, rad = half - 1.5;
    const idx = [], row = [], col = [], shade = [], rim = [], alpha = [];
    // axis tilt: roll about the view axis, then pitch toward the viewer
    const roll = -0.36, pitch = 0.3, cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
    let lx = -0.62, ly = 0.42, lz = 0.66; const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + 0.5 - half) / rad, y = (half - j - 0.5) / rad, s2 = x * x + y * y;
      if (s2 >= 1) continue;
      const z = Math.sqrt(1 - s2);
      const x1 = x * cr - y * sr, y1 = x * sr + y * cr;           // roll
      const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp;         // pitch
      const lat = Math.asin(Math.max(-1, Math.min(1, y2))), lon = Math.atan2(x1, z2);
      const v = Math.min(th - 1, Math.max(0, Math.round((0.5 - lat / Math.PI) * th - 0.5)));
      const u = Math.round((lon / (2 * Math.PI) + 0.5) * tw);
      const lam = Math.max(0, x * lx + y * ly + z * lz);
      idx.push(j * N + i); row.push(v * tw); col.push(((u % tw) + tw) % tw);
      shade.push(0.05 + 1.28 * Math.pow(lam, 0.78));
      rim.push(Math.pow(1 - z, 3.2));
      alpha.push(Math.round(255 * Math.min(1, (1 - Math.sqrt(s2)) * rad))); // soft one-pixel edge
    }
    M.N = N; M.cv.width = N; M.cv.height = N; M.builtFor = tex;
    M.idx = Int32Array.from(idx); M.row = Int32Array.from(row); M.col = Int32Array.from(col);
    M.shade = Float32Array.from(shade); M.rim = Float32Array.from(rim); M.alpha = Uint8Array.from(alpha);
    M.img = M.cv.getContext('2d').createImageData(N, N); M.lastShift = -1;
  }
  function drawMoon() {
    const { idx, row, col, shade, rim, alpha, tex } = M, tg = tex.g, tw = tex.w, px = M.img.data;
    const shift = ((Math.floor(M.spin) % tw) + tw) % tw;
    if (shift === M.lastShift) return;
    M.lastShift = shift;
    for (let n = 0; n < idx.length; n++) {
      let u = col[n] + shift; if (u >= tw) u -= tw;
      const g = ((tg[row[n] + u] - 105) * 1.25 + 120) * shade[n], r = rim[n], o = idx[n] * 4;
      const R = g * 1.03 + 40 * r, Gc = g + 105 * r, B = g * 0.97 + 235 * r;
      px[o] = R > 255 ? 255 : R < 0 ? 0 : R; px[o + 1] = Gc > 255 ? 255 : Gc < 0 ? 0 : Gc; px[o + 2] = B > 255 ? 255 : B < 0 ? 0 : B;
      px[o + 3] = alpha[n];
    }
    M.cv.getContext('2d').putImageData(M.img, 0, 0);
  }
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!M.tex || document.hidden) { M.last = ts; return; }
    const dt = Math.min(0.1, (ts - (M.last || ts)) / 1000); M.last = ts;
    M.speed += (M.target - M.speed) * Math.min(1, dt * 0.7); // ease into the spin
    M.spin += M.speed * SPIN * dt * (M.tex.w / 4096);
    drawMoon();
  }
  function startBackdrop() {
    if (!M.cv) return;
    let tries = 0;
    (function wait() { // the app decodes the Moon map (embedded, or NASA tiles as a fallback); reuse it
      const tex = window.AA && window.AA.S.globe.tex;
      if (tex && tex !== M.tex) {
        if (M.tex) M.spin *= tex.w / M.tex.w;
        M.tex = tex;
        try { buildSphere(); drawMoon(); M.cv.classList.add('on'); } catch (e) { M.tex = null; return; }
      }
      if (++tries < 600) setTimeout(wait, M.tex ? 4000 : 100); // keeps watching for the sharper NASA pass
    })();
    let rz = 0;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (M.tex) { try { buildSphere(); drawMoon(); } catch (e) { /* keep the old frame */ } } }, 250); });
    requestAnimationFrame(frame);
  }

  /* ---------- opening sequence ---------- */
  const PHASES = ['pre-moon', 'pre-bar', 'pre-ui'];
  let introTimers = [], introDone = false;
  function finishIntro(fast) {
    if (introDone) return;
    introDone = true;
    introTimers.forEach(clearTimeout); introTimers = [];
    if (reduce) root.classList.remove('anim'); else if (fast) root.classList.add('intro-skip');
    root.classList.remove(...PHASES);
    M.target = reduce ? 0 : 1;
    document.removeEventListener('pointerdown', skipIntro, true);
    document.removeEventListener('keydown', skipIntro, true);
    setTimeout(() => { root.classList.remove('anim', 'intro-skip'); }, fast ? 500 : 1900);
    setTimeout(offerTour, fast ? 700 : 2100);
  }
  function skipIntro() { finishIntro(true); }
  function runIntro() {
    if (!root.classList.contains('anim') || reduce) { finishIntro(true); return; }
    const at = (ms, fn) => introTimers.push(setTimeout(fn, ms));
    document.addEventListener('pointerdown', skipIntro, true);
    document.addEventListener('keydown', skipIntro, true);
    at(120, () => root.classList.remove('pre-moon'));           // the Moon glides down
    at(3300, () => { M.target = 1; });                           // ...and starts to turn
    at(4000, () => root.classList.remove('pre-bar'));           // bar, logo and buttons drop in
    at(5200, () => finishIntro(false));                          // panels settle over the Moon
  }

  /* ---------- guided tour ---------- */
  const TXT = {
    tr: {
      toast_from: 'AstroApex Asistan', toast_t: 'Gezinme rehberi',
      toast_b: 'Merhaba, ben gezinme rehberiyim. Siteyi iki dakikada adım adım gezdirebilirim. Başlayalım mı?', toast_go: 'Rehberi başlat', toast_no: 'Geç',
      next: 'Sonraki', back: 'Geri', skip: 'Turu geç', done: 'Bitir', of: '/', open: 'Gezinme rehberi',
      keys: '← → ile ilerle · Esc ile çık',
      s: [
        ['AstroApex’e hoş geldiniz', 'Bu site, Ay’ın güney kutbunda iki iniş senaryosunu yan yana karşılaştırır: Güneş ne kadar görünüyor, Dünya ile iletişim ne zaman var, zemin ne kadar düz, buz ne kadar yakın. Kısa bir tur ile her bölümü göstereyim.'],
        ['Beş bölüm', 'Üst menüden bölümler arasında geçilir: Karşılaştır, Gökyüzü, Zaman, 3B Harita ve Kaynaklar. Klavyede 1–5 tuşları da aynı işi yapar.'],
        ['Hazır senaryolar', 'Tek tıkla gerçek iniş bölgelerini yükleyin: NASA çalışma bölgeleri, krater kenarları, ticari inişler ya da kutup ile ekvatorun karşılaştırması. Koordinat yazmanıza gerek kalmaz.'],
        ['Senaryo A ve B', 'Her senaryo için iniş bölgesini, başlangıç tarihini ve ufuk modelini buradan seçersiniz. Bir değeri değiştirdiğinizde bütün sayfa anında yeniden hesaplanır.'],
        ['Sonuç ve görev raporu', 'Hangi senaryoda güç ve iletişimin daha uzun süre birlikte olduğu tek cümleyle yazılır. “Görev raporu” tuşu her şeyi iki sayfalık bir PDF’te toplar.'],
        ['Saha raporu ve puan', '0–100 uygunluk puanı altı bileşenden oluşur: güç, iletişim, karanlık, iniş ışığı, arazi ve buz erişimi. Arazi puanı gerçek LOLA eğiminden, buz puanı NASA’nın kalıcı gölge haritasından gelir.'],
        ['Görüş pencereleri', 'Renkli şeritler görev boyunca Güneş’in, Dünya’nın ve ikisinin birlikte göründüğü zamanları gösterir. Boşluklar karanlık ya da iletişimsiz süredir.'],
        ['Görev saati', 'Oynat tuşu zamanı ilerletir, sürgü istediğiniz ana götürür. Tüm bölümler bu saate bağlıdır. Boşluk tuşu oynatır, ok tuşları bir saat ilerletir.'],
        ['Gökyüzü', 'İniş noktasından bakıldığında Güneş ve Dünya’nın ufka göre konumu. Gri çizgi LOLA arazi ufkudur; cismin görünmesi için bu çizginin üstünde olması gerekir.'],
        ['Zaman', 'Güneş ve Dünya yüksekliğinin görev boyunca değişimi. Grafikte sürükleyerek saati değiştirebilirsiniz. Alttaki yıllık şerit en iyi başlangıç tarihini bulmaya yarar.'],
        ['Batarya dayanımı', 'Araç karanlığı atlatabilir mi? Yükü, bataryayı ve panel alanını girin; grafik doluluğu saat saat gösterir ve gereken en küçük bataryayı hesaplar.'],
        ['3B Harita ve buz tuzakları', 'Ay küresini sürükleyip yakınlaştırın. Mavi alanlar buzun kalabildiği kalıcı gölgeler, altın halkalar NASA’nın Artemis III aday bölgeleridir. Sıcaklık haritası ve buza giden gezici rotası da buradadır; bir noktaya tıklamak orayı iniş noktası yapar.'],
        ['En iyi noktayı bul', '“Bölgeyi tara” kutup çevresindeki yaklaşık 1.600 noktayı inceler: dik ve gölgeli olanları eler, kalanları gerçek arazi ufkuyla simüle eder ve en iyi beşini haritada numaralar.'],
        ['NASA SPICE doğrulaması', 'Konumlar NASA SPICE (JPL DE440) verisinden gelir. Bu tablo aynı anı bağımsız ikinci bir hesapla karşılaştırır ve aradaki farkı gösterir.'],
        ['Asistan', 'Sorunuzu yazın: “En iyi noktayı bul”, “Buza ne kadar yakın?”, “Batarya yeter mi?”, “A ile B’yi karşılaştır”. Asistan gerçek simülasyonu çalıştırıp yanıtlar. Tur bitti, iyi keşifler!']
      ]
    },
    en: {
      toast_from: 'AstroApex Assistant', toast_t: 'Guided tour',
      toast_b: 'Hi, I am the guided tour. I can walk you through the site in two minutes. Shall we start?', toast_go: 'Start the tour', toast_no: 'Skip',
      next: 'Next', back: 'Back', skip: 'Skip tour', done: 'Finish', of: '/', open: 'Guided tour',
      keys: '← → to move · Esc to exit',
      s: [
        ['Welcome to AstroApex', 'This site compares two landing scenarios at the lunar south pole side by side: how much Sun each one gets, when Earth is in view, how flat the ground is and how close the ice is. Let me show you each part.'],
        ['Five sections', 'Use the top menu to move between Compare, Sky, Time, 3D Map and Resources. Keys 1–5 do the same.'],
        ['Ready-made scenarios', 'Load real landing regions with one click: NASA study regions, crater rims, commercial landings, or the pole against the equator. No coordinates to type.'],
        ['Scenario A and B', 'Choose the landing site, start date and horizon model for each scenario here. Change any value and the whole page recalculates at once.'],
        ['Verdict and mission report', 'One sentence says which scenario has power and comms together for longer. The “Mission report” button gathers everything into a two-page PDF.'],
        ['Site report and score', 'The 0–100 suitability score has six parts: power, comms, darkness, landing light, terrain and ice access. Terrain comes from the real LOLA slope, ice from NASA’s map of permanent shadow.'],
        ['Visibility windows', 'The coloured bars show when the Sun, the Earth and both together are visible during the mission. Gaps are dark time or time without a link.'],
        ['Mission clock', 'Play moves time forward and the slider jumps to any moment. Every section follows this clock. Space plays, arrow keys step one hour.'],
        ['Sky', 'Where the Sun and Earth sit relative to the horizon, seen from the landing point. The grey line is the LOLA terrain skyline; a body must be above it to be visible.'],
        ['Time', 'Sun and Earth elevation across the mission. Drag on a chart to move the clock. The yearly strip below helps you find the best start date.'],
        ['Battery endurance', 'Can the lander ride out the dark? Enter the load, battery and array size; the chart shows the charge hour by hour and works out the smallest battery that is enough.'],
        ['3D Map and ice traps', 'Drag and zoom the Moon. Blue areas are permanent shadow where ice can survive; gold rings are NASA’s Artemis III candidate regions. The temperature map and the rover route to the ice live here too. Click a point to make it the landing point.'],
        ['Find the best point', '“Scan the region” examines about 1,600 points around the pole: it drops steep and shadowed ground, simulates the rest with their real terrain horizon and numbers the best five on the map.'],
        ['NASA SPICE cross-check', 'Positions come from NASA SPICE (JPL DE440). This table compares the same instant against an independent second calculation and shows the difference.'],
        ['Assistant', 'Type a question: “Find the best point”, “How close is the ice?”, “Is the battery enough?”, “Compare A and B”. The assistant runs the real simulation to answer. That is the tour. Enjoy!']
      ]
    }
  };
  // [tab, target selector]; a missing target shows the step centred
  const STEPS = [
    ['compare', null], ['compare', '.nav'], ['compare', '#presets'], ['compare', '#scn-A'], ['compare', '.verdict-top'], ['compare', '#report-A'],
    ['compare', '#win-rows'], ['compare', '.timebar'], ['sky', '#sky-A'], ['time', '#chart-sun'], ['time', '#chart-batt'], ['map', '#globe-wrap'],
    ['map', '#scout'], ['resources', '#verify'], ['resources', '#assist-open']
  ];
  const T = { on: false, i: 0, hole: null, pop: null, toast: null, prevFocus: null };

  function offerTour() {
    const btn = $('#tour-open');
    if (btn) { btn.title = TXT[lang()].open; btn.setAttribute('aria-label', TXT[lang()].open); }
    // offered on every visit, once the page has settled; skipping only closes it for this visit
    if (T.on || T.toast || T.asked || !window.AA) return;
    T.asked = true;
    const x = TXT[lang()], el = document.createElement('div');
    el.className = 'tour-toast'; el.setAttribute('role', 'status');
    el.innerHTML = `<span class="tt-av" aria-hidden="true">✦</span>
      <div class="tt-body"><small>${x.toast_from}</small><b>${x.toast_t}</b><p>${x.toast_b}</p>
      <div class="tt-acts"><button class="tt-go" type="button">${x.toast_go}</button><button class="tt-no" type="button">${x.toast_no}</button></div></div>
      <button class="tt-x" type="button" aria-label="${x.toast_no}">×</button>`;
    const bar = $('.top'); if (bar) el.style.top = Math.round(bar.getBoundingClientRect().height + 12) + 'px'; // clear the header at any width
    document.body.appendChild(el); T.toast = el;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    el.querySelector('.tt-go').addEventListener('click', () => { closeToast(); startTour(); });
    const no = () => { store.set('aa_tour', 'dismissed'); closeToast(); };
    el.querySelector('.tt-no').addEventListener('click', no);
    el.querySelector('.tt-x').addEventListener('click', no);
  }
  function closeToast() {
    const el = T.toast; if (!el) return;
    T.toast = null; el.classList.remove('in'); setTimeout(() => el.remove(), 450);
  }

  function startTour() {
    if (T.on || !window.AA) return;
    if (!introDone) finishIntro(true);
    closeToast();
    if (window.AAReport) window.AAReport.close();
    if (document.body.classList.contains('assist-on')) { const c = $('#assist-close'); if (c) c.click(); }
    T.on = true; T.i = 0; T.prevFocus = document.activeElement;
    T.hole = document.createElement('div'); T.hole.className = 'tour-hole';
    T.pop = document.createElement('div'); T.pop.className = 'tour-pop';
    T.pop.setAttribute('role', 'dialog'); T.pop.setAttribute('aria-modal', 'true'); T.pop.setAttribute('aria-labelledby', 'tour-title');
    const shield = document.createElement('div'); shield.className = 'tour-shield'; T.shield = shield;
    document.body.append(shield, T.hole, T.pop);
    root.classList.add('tour-on');
    T.pop.addEventListener('click', e => {
      const a = e.target.closest('[data-tour]'); if (!a) return;
      if (a.dataset.tour === 'next') go(T.i + 1); else if (a.dataset.tour === 'back') go(T.i - 1); else endTour();
    });
    document.addEventListener('keydown', tourKeys, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    go(0);
  }
  function endTour() {
    if (!T.on) return;
    T.on = false; store.set('aa_tour', 'done');
    document.removeEventListener('keydown', tourKeys, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    for (const el of [T.hole, T.pop, T.shield]) if (el) el.remove();
    T.hole = T.pop = T.shield = null;
    root.classList.remove('tour-on');
    if (window.AA.S.tab !== 'compare') window.AA.showTab('compare'); else window.scrollTo(0, 0);
    const f = $('#tour-open') || T.prevFocus; if (f && f.focus) f.focus();
  }
  function tourKeys(e) {
    if (!T.on) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation(); go(T.i + (e.key === 'ArrowRight' ? 1 : -1)); return;
    }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...T.pop.querySelectorAll('button')].filter(b => b.getClientRects().length), first = f[0], lastB = f[f.length - 1];
      if (!T.pop.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastB.focus(); }
      else if (!e.shiftKey && document.activeElement === lastB) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key !== 'Enter') e.stopPropagation(); // the app's shortcuts (1-5, Space, /) rest during the tour
    if (e.key === ' ' && !T.pop.contains(document.activeElement)) e.preventDefault();
  }
  function go(i) {
    if (!T.on) return;
    if (i >= STEPS.length) { endTour(); return; }
    T.i = Math.max(0, i);
    const [tab, sel] = STEPS[T.i], x = TXT[lang()], s = x.s[T.i], lastStep = T.i === STEPS.length - 1;
    if (window.AA.S.tab !== tab) window.AA.showTab(tab);
    const target = sel && $(sel), d = target && target.closest('details');
    if (d && !d.open) d.open = true;
    T.target = target && target.getClientRects().length ? target : null;
    if (T.target) {
      const r = T.target.getBoundingClientRect(), fixed = T.target.closest('.top, .timebar');
      if (!fixed) window.scrollTo(0, Math.max(0, window.scrollY + r.top - Math.max(90, (window.innerHeight - Math.min(r.height, window.innerHeight * 0.5)) / 2 - 60)));
    } else window.scrollTo(0, 0);
    T.pop.innerHTML = `<div class="tp-top"><span class="tp-step">${T.i + 1} ${x.of} ${STEPS.length}</span>${lastStep ? '' : `<button type="button" class="tp-skip" data-tour="skip">${x.skip}</button>`}</div>
      <h3 id="tour-title">${s[0]}</h3><p>${s[1]}</p>
      <div class="tp-dots" aria-hidden="true">${STEPS.map((_, n) => `<i class="${n === T.i ? 'on' : n < T.i ? 'past' : ''}"></i>`).join('')}</div>
      <div class="tp-acts"><span class="tp-keys">${x.keys}</span>
      ${T.i ? `<button type="button" class="tp-back" data-tour="back">${x.back}</button>` : ''}
      <button type="button" class="tp-next" data-tour="${lastStep ? 'end' : 'next'}">${lastStep ? x.done : x.next}</button></div>`;
    place();
    T.pop.querySelector('.tp-next').focus({ preventScroll: true });
  }
  function place() {
    if (!T.on) return;
    const vw = window.innerWidth, vh = window.innerHeight, pad = 8, pop = T.pop, hole = T.hole;
    const pw = Math.min(380, vw - 24); pop.style.width = pw + 'px';
    const ph = pop.offsetHeight;
    if (!T.target) {
      hole.classList.add('none'); hole.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0`;
      pop.style.left = (vw - pw) / 2 + 'px'; pop.style.top = Math.max(12, (vh - ph) / 2) + 'px';
      return;
    }
    const r = T.target.getBoundingClientRect();
    const x0 = Math.max(4, r.left - pad), y0 = Math.max(4, r.top - pad);
    const x1 = Math.min(vw - 4, r.right + pad), y1 = Math.min(vh - 4, r.bottom + pad);
    hole.classList.remove('none'); hole.style.cssText = `left:${x0}px;top:${y0}px;width:${Math.max(0, x1 - x0)}px;height:${Math.max(0, y1 - y0)}px`;
    // prefer below, then above, then beside, else pinned inside the bottom of the viewport
    let top, left = Math.max(12, Math.min(vw - pw - 12, (x0 + x1) / 2 - pw / 2));
    if (y1 + 14 + ph <= vh - 12) top = y1 + 14;
    else if (y0 - 14 - ph >= 12) top = y0 - 14 - ph;
    else if (x1 + 14 + pw <= vw - 12) { left = x1 + 14; top = Math.max(12, Math.min(vh - ph - 12, (y0 + y1) / 2 - ph / 2)); }
    else if (x0 - 14 - pw >= 12) { left = x0 - 14 - pw; top = Math.max(12, Math.min(vh - ph - 12, (y0 + y1) / 2 - ph / 2)); }
    else top = Math.max(12, vh - ph - 12);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }

  /* ---------- wiring ---------- */
  function init() {
    startBackdrop();
    const btn = $('#tour-open');
    if (btn) { btn.title = TXT[lang()].open; btn.setAttribute('aria-label', TXT[lang()].open); }
    if (btn) btn.addEventListener('click', () => { if (T.on) endTour(); else startTour(); });
    const lg = $('#lang');
    if (lg) lg.addEventListener('click', () => { // app.js has already switched S.lang on this same click
      if (btn) { btn.title = TXT[lang()].open; btn.setAttribute('aria-label', TXT[lang()].open); }
      if (T.toast) { T.toast.remove(); T.toast = null; T.asked = false; offerTour(); } // redraw it in the new language
    });
    runIntro();
  }
  window.AATour = { start: startTour, end: endTour };
  try { init(); } catch (e) { root.classList.remove('anim', 'pre-moon', 'pre-bar', 'pre-ui'); }
})();
