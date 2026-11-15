/* Mission report: a two-page A4 summary of both scenarios, previewed on screen and saved as a PDF.

   The pages are drawn on canvases (so Turkish characters and the charts look the same everywhere), shown in a
   dialog, and written into a PDF with a Unicode text layer for search and selection. Everything runs in the browser. */
(function () {
  'use strict';
  const AA = window.AA, AS = window.AAssist;
  if (!AA || !AS) return;
  const { S, KEYS, t, nf } = AA, Polar = AA.Polar;
  const $ = s => document.querySelector(s);
  const L = (tr, en) => S.lang === 'tr' ? tr : en;
  const W = 1240, H = 1754, M = 70, H_MS = 3600000;                 // A4 at 150 dpi
  const INK = '#111827', MUTED = '#5b6472', LINE = '#d9dee7', SOFT = '#f3f5f9';
  const SUN = '#d98a00', EARTH = '#1f6fd0', BOTH = '#0f9d6b', BAD = '#d1433a', COL = { A: '#111827', B: '#c2338a' };
  const sans = (w, px) => `${w} ${px}px "Space Grotesk", "Segoe UI", system-ui, sans-serif`;
  const mono = px => `500 ${px}px "JetBrains Mono", Consolas, monospace`;
  const days = d => nf(d, d % 1 ? 1 : 0);

  /* ---------- drawing helpers ---------- */
  function text(c, s, x, y, font, color, align) {
    c.font = font; c.fillStyle = color || INK; c.textAlign = align || 'left'; c.textBaseline = 'alphabetic';
    c.fillText(s, x, y);
  }
  // Word-wrapped paragraph; returns the y of the line after the last one.
  function wrap(c, s, x, y, maxW, lh, font, color, maxLines) {
    c.font = font; c.fillStyle = color || INK; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    let line = '', lines = 0;
    for (const w of String(s).split(/\s+/)) {
      const next = line ? line + ' ' + w : w;
      if (c.measureText(next).width > maxW && line) {
        if (maxLines && lines === maxLines - 1) { line += '…'; break; }
        c.fillText(line, x, y); y += lh; lines++; line = w;
      } else line = next;
    }
    if (line) { c.fillText(line, x, y); y += lh; }
    return y;
  }
  function fitText(c, s, maxW) { // shorten with an ellipsis until it fits (font must be set)
    if (c.measureText(s).width <= maxW) return s;
    while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }
  function box(c, x, y, w, h, fill, stroke, r) {
    c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r || 0) : c.rect(x, y, w, h);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
  }
  function badge(c, k, x, y, r) {
    c.fillStyle = COL[k]; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    c.font = mono(r * 1.05); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(k, x, y + 1);
  }
  function slopeDescription(f) {
    const slope = f.slope || f.coarse;
    if (!slope) return L('Veri yok', 'No data');
    const area = f.slope ? L('1 km yarıçap', '1 km radius') : L('kaba 3×3 hücre', 'coarse 3×3 cells');
    return nf(slope.mean, 1) + '° · ' + area;
  }
  const scoreColor = v => v >= 65 ? BOTH : v >= 40 ? SUN : BAD;

  function newPage() {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    cv.reportLanguage = S.lang;
    const runs = cv.reportTextRuns = [];
    const fillText = c.fillText.bind(c);
    c.fillText = function (value, x, y, maxWidth) {
      const valueText = String(value), metrics = c.measureText(valueText);
      const baseline = c.textBaseline;
      c.textBaseline = 'alphabetic';
      const alphabetic = c.measureText(valueText);
      c.textBaseline = baseline;
      const width = maxWidth == null ? metrics.width : Math.min(metrics.width, maxWidth);
      const left = c.textAlign === 'center' ? x - width / 2 : c.textAlign === 'right' || c.textAlign === 'end' ? x - width : x;
      const size = parseFloat((c.font.match(/([\d.]+)px/) || [0, 16])[1]);
      runs.push({ text: valueText, x: left, y: y + alphabetic.actualBoundingBoxAscent - metrics.actualBoundingBoxAscent, width, size });
      if (maxWidth == null) fillText(valueText, x, y); else fillText(valueText, x, y, maxWidth);
    };
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    return { cv, c };
  }
  function header(c, no, total, h) {
    c.fillStyle = '#0b0e14'; c.fillRect(0, 0, W, h);
    const cy = h / 2, r = Math.min(26, h * 0.3);
    c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(M + r, cy, r, 0, 7); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(M + r, cy, r, Math.PI / 2, Math.PI * 1.5); c.ellipse(M + r, cy, r * 0.62, r, 0, Math.PI * 1.5, Math.PI / 2, true); c.fill();
    c.strokeStyle = '#ffb648'; c.lineWidth = 3; c.beginPath(); c.moveTo(M, cy + r * 0.48); c.lineTo(M + 2 * r, cy + r * 0.48); c.stroke();
    const big = h > 100;
    text(c, 'AstroApex', M + 2 * r + 20, cy + (big ? -2 : 9), sans(700, big ? 36 : 26), '#fff');
    if (big) text(c, L('Görev Raporu · Ay İniş Sahası Gezgini', 'Mission Report · Lunar Landing Site Navigator'), M + 2 * r + 20, cy + 28, sans(500, 17), '#b9c0cc');
    const now = new Date().toLocaleString(S.lang, { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
    text(c, L('Oluşturuldu: ', 'Generated: ') + now, W - M, cy - (big ? 6 : -6), mono(14), '#b9c0cc', 'right');
    if (big) text(c, $('#eph-badge').textContent + (Polar.ready ? ' · NASA LOLA' : ''), W - M, cy + 20, mono(14), '#ffb648', 'right');
    // footer
    c.strokeStyle = LINE; c.lineWidth = 1.5; c.beginPath(); c.moveTo(M, H - 62); c.lineTo(W - M, H - 62); c.stroke();
    text(c, 'NASA Space Apps Challenge 2026 · AstroApex', M, H - 36, sans(500, 14), MUTED);
    text(c, `${no} / ${total}`, W - M, H - 36, mono(14), MUTED, 'right');
  }
  function section(c, s, y) {
    text(c, s.toLocaleUpperCase(S.lang), M, y, mono(14), MUTED);
    c.strokeStyle = LINE; c.lineWidth = 1.5; c.beginPath(); c.moveTo(M + c.measureText(s.toLocaleUpperCase(S.lang)).width + 14, y - 5); c.lineTo(W - M, y - 5); c.stroke();
    return y + 28;
  }

  /* ---------- page 1 ---------- */
  function scenarioCard(c, a, x, y, w) {
    const k = a.k, sc = a.sc, s = a.stats, f = a.f, pw = a.pw, h = 668;
    box(c, x, y, w, h, '#fff', LINE, 14);
    badge(c, k, x + 34, y + 38, 17);
    c.font = sans(700, 24); text(c, fitText(c, a.name, w - 90), x + 62, y + 46, sans(700, 24));
    text(c, AA.fmtCoord(sc.lat, sc.lon), x + 22, y + 82, mono(14), MUTED);
    text(c, L('Başlangıç ', 'Start ') + AA.fmtDate(sc.start) + ' UTC', x + 22, y + 104, mono(14), MUTED);
    text(c, L('Ufuk: ', 'Horizon: ') + (a.hz === 'lola80' ? L('LOLA 80 m profili', 'LOLA 80 m profile') : a.hz === 'lola480' ? L('LOLA 480 m ızgara (kaba)', 'LOLA 480 m grid (coarse)') : L('sabit açı ', 'fixed angle ') + nf(+sc.mask || 0, 1) + '°'), x + 22, y + 126, mono(14), MUTED);
    // score ring
    const cx = x + 82, cy = y + 212, col = scoreColor(a.score);
    c.strokeStyle = SOFT; c.lineWidth = 10; c.beginPath(); c.arc(cx, cy, 52, 0, 7); c.stroke();
    c.strokeStyle = col; c.lineCap = 'round'; c.beginPath(); c.arc(cx, cy, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a.score / 100); c.stroke(); c.lineCap = 'butt';
    text(c, String(a.score), cx, cy + 12, sans(700, 40), INK, 'center');
    text(c, '/100', cx, cy + 32, mono(12), MUTED, 'center');
    text(c, t('score'), cx, cy + 82, sans(500, 13), MUTED, 'center');
    // six score bars
    AS.PARTS.forEach((p, i) => {
      const by = y + 162 + i * 24, bx = x + 262, bw = w - 262 - 62, v = Math.round(a.parts[p]);
      text(c, t('sc_' + p), x + 164, by + 5, sans(500, 13.5), MUTED);
      box(c, bx, by - 5, bw, 9, SOFT, null, 4); if (v > 0) box(c, bx, by - 5, Math.max(4, bw * v / 100), 9, INK, null, 4);
      text(c, String(v), x + w - 22, by + 5, mono(13), INK, 'right');
    });
    // facts
    const pctOf = v => {
      const percent = v / s.total * 100;
      const label = percent > 99.9 && percent < 100 ? '>' + nf(99.9, 1)
        : percent > 0 && percent < 0.1 ? '<' + nf(0.1, 1) : nf(percent, percent % 1 ? 1 : 0);
      return `${AA.fmtDur(v)} · ${label}%`;
    };
    const rows = [
      [L('Güneş görünür', 'Sun visible'), pctOf(s.sun)], [L('Dünya görünür', 'Earth visible'), pctOf(s.earth)],
      [L('İkisi birlikte', 'Both together'), pctOf(s.both)],
      [L('En uzun karanlık', 'Longest darkness'), AA.fmtDur(s.dark)], [L('En uzun iletişim kesintisi', 'Longest comm outage'), AA.fmtDur(s.nocomm)],
      [f.slope ? L('Eğim (1 km yarıçap)', 'Slope (1 km radius)') : L('Ortalama eğim', 'Mean slope'), f.slope ? `${nf(f.slope.mean, 1)}° · ${nf(f.slope.safe * 100)}% < 8°` : slopeDescription(f)],
      [L('En yakın buz tuzağı', 'Nearest ice trap'), !f.data ? L('veri yok', 'no data') : !f.trap ? '—' : f.trap.inside ? L('içinde', 'inside') : `${nf(f.trap.km, 1)} km${f.trap.name ? ' · ' + f.trap.name : ''}`],
      [L('İniş yakıtı', 'Landing propellant'), `${nf(a.frac * 100)}% · Δv ${nf(a.dv)} m/s`],
      [L('Batarya', 'Battery'), pw ? `${t('b_' + pw.state)} · min ${nf(pw.min * 100)}%` : '—'],
      [L('Gereken batarya', 'Battery needed'), pw ? `≥ ${nf(Math.ceil(pw.need * 10 - 1e-9) / 10, 1)} kWh · ≈ ${nf(pw.massKg)} kg` : '—']
    ];
    rows.forEach((r, i) => {
      const ry = y + 344 + i * 31;
      c.strokeStyle = LINE; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 22, ry - 21); c.lineTo(x + w - 22, ry - 21); c.stroke();
      text(c, r[0], x + 22, ry, sans(500, 15), MUTED);
      c.font = mono(14.5); text(c, fitText(c, r[1], w - 250), x + w - 22, ry, mono(14.5), i === 8 && pw ? ({ good: BOTH, mid: SUN, bad: BAD }[pw.state]) : INK, 'right');
    });
    return y + h;
  }
  function windowsBlock(c, a, y) {
    const d = S.data[a.k], N = d.n - 1, x0 = M + 150, w = W - M - x0, sc = a.sc;
    badge(c, a.k, M + 14, y + 4, 13);
    c.font = sans(700, 18); text(c, fitText(c, a.name, 520), M + 38, y + 10, sans(700, 18));
    text(c, `${AA.fmtDay(sc.start)} – ${AA.fmtDate(sc.start + S.dur * 24 * H_MS, false)}`, W - M, y + 10, mono(14), MUTED, 'right');
    y = wrap(c, AA.winSummary(a.k), M, y + 40, W - 2 * M, 22, sans(400, 15.5), MUTED, 2) - 6;
    [['sun', SUN, t('w_sun')], ['earth', EARTH, t('w_earth')], ['both', BOTH, t('w_both')]].forEach(([b, col, label], i) => {
      const by = y + i * 36;
      text(c, label, M, by + 18, sans(500, 14), MUTED);
      box(c, x0, by, w, 24, SOFT, null, 5);
      c.fillStyle = col;
      for (const r of d.runs[b]) { const a0 = r[0] / N, a1 = Math.min(r[1], N) / N; if (a1 > a0) c.fillRect(x0 + a0 * w, by, Math.max(1.5, (a1 - a0) * w), 24); }
    });
    for (let i = 0; i <= 4; i++) text(c, AA.fmtDay(sc.start + i / 4 * S.dur * 24 * H_MS), x0 + i / 4 * w, y + 126, mono(12.5), MUTED, i === 0 ? 'left' : i === 4 ? 'right' : 'center');
    return y + 160;
  }
  function pageOne(a, b, total) {
    const { cv, c } = newPage();
    header(c, 1, total, 136);
    let y = section(c, L('Özet', 'Summary'), 190);
    const pick = AS.recommend(a, b), lead = pick.lead;
    const verdict = pick.status === 'none'
      ? L('Hiçbir senaryo ön değerlendirme koşullarını birlikte karşılamıyor.', 'Neither scenario meets the preliminary conditions together.')
      : lead ? L(`Ön değerlendirmede öne çıkan: ${lead.k} · ${lead.name}, ${lead.score}/100.`, `Preliminary preference: ${lead.k} · ${lead.name}, ${lead.score}/100.`)
        : L(`İki uygun senaryo aynı skoru alıyor (${a.score}/100); seçim görev önceliğine bağlı.`, `Both eligible scenarios score the same (${a.score}/100); choose according to mission priorities.`);
    const reasons = (pick.assessments || []).filter(item => item.reasons.length).map(item =>
      item.k + ' · ' + item.reasons.map(reason => reason.text).join(' ')).join(' ');
    y = wrap(c, verdict, M, y + 4, W - 2 * M, 32, sans(700, 24), INK);
    if (reasons) y = wrap(c, reasons, M, y + 2, W - 2 * M, 22, sans(400, 15), BAD, 3);
    y = wrap(c, $('#verdict-h').textContent + '. ' + L(`Görev süresi ${days(S.dur)} gün. Yük ${nf(S.pwr.load)} W, batarya ${nf(S.pwr.cap, 1)} kWh, güneş paneli ${nf(S.pwr.area, 1)} m².`,
      `Mission length ${days(S.dur)} days. Load ${nf(S.pwr.load)} W, battery ${nf(S.pwr.cap, 1)} kWh, solar array ${nf(S.pwr.area, 1)} m².`), M, y + 2, W - 2 * M, 25, sans(400, 17), MUTED);
    y = section(c, L('Senaryolar', 'Scenarios'), y + 22);
    const cw = (W - 2 * M - 28) / 2;
    scenarioCard(c, a, M, y - 6, cw);
    y = scenarioCard(c, b, M + cw + 28, y - 6, cw);
    y = section(c, L('Görüş pencereleri · güç ve iletişim ne zaman var?', 'Visibility windows · when are power and comms available?'), y + 44);
    y = windowsBlock(c, a, y + 4);
    windowsBlock(c, b, y + 8);
    return cv;
  }

  /* ---------- page 2 ---------- */
  function chart(c, x, y, w, h, title, key, col, opts) {
    const padL = 58, padB = 26, pw = w - padL, ph = h - padB - 30, tot = S.dur * 24, top = y + 30;
    text(c, title, x, y + 16, sans(700, 17), INK);
    KEYS.forEach((k, i) => { // legend: A solid, B dashed
      const lx = x + w - 150 + i * 80;
      c.strokeStyle = col; c.lineWidth = 3; c.setLineDash(k === 'B' ? [7, 5] : []); c.beginPath(); c.moveTo(lx, y + 11); c.lineTo(lx + 34, y + 11); c.stroke(); c.setLineDash([]);
      text(c, k, lx + 42, y + 16, mono(14), INK);
    });
    let lo = opts.lo, hi = opts.hi;
    if (lo == null) {
      lo = -2; hi = 2;
      for (const k of KEYS) { const arr = opts.get(k); for (let j = 0; j < arr.length; j++) { if (arr[j] < lo) lo = arr[j]; if (arr[j] > hi) hi = arr[j]; } }
      lo = Math.max(-90, Math.floor(lo - 1)); hi = Math.min(90, Math.ceil(hi + 1));
    }
    const X = hr => x + padL + hr / tot * pw, Y = v => top + (hi - v) / (hi - lo) * ph;
    box(c, x + padL, top, pw, ph, '#fff', LINE);
    if (opts.zero) { c.fillStyle = '#eef0f4'; c.fillRect(x + padL, Y(0), pw, top + ph - Y(0)); }
    if (opts.band != null) { c.fillStyle = '#fbe9e7'; c.fillRect(x + padL, Y(opts.band), pw, top + ph - Y(opts.band)); }
    const stp = opts.step || [1, 2, 5, 10, 15, 30, 45].find(s => (hi - lo) / s <= 6) || 45;
    for (let v = Math.ceil(lo / stp) * stp; v <= hi + 1e-9; v += stp) {
      c.strokeStyle = v === 0 && opts.zero ? '#8a92a3' : '#e6e9ef'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + padL, Y(v)); c.lineTo(x + w, Y(v)); c.stroke();
      text(c, opts.fmt(v), x + padL - 8, Y(v) + 5, mono(12.5), MUTED, 'right');
    }
    const dStep = S.dur <= 14 ? 1 : S.dur <= 30 ? 5 : 10;
    for (let dd = 0; dd <= S.dur; dd += dStep) text(c, dd + ' ' + t('d'), X(dd * 24), top + ph + 19, mono(12.5), MUTED, dd === 0 ? 'left' : 'center');
    c.save(); c.beginPath(); c.rect(x + padL, top, pw, ph); c.clip();
    for (const k of KEYS) {
      const d = S.data[k], arr = opts.get(k), sc = opts.scale || 1;
      c.strokeStyle = col; c.lineWidth = 2.5; c.setLineDash(k === 'B' ? [7, 5] : []); c.beginPath();
      for (let j = 0; j < d.n; j++) { const px = X(j * d.dtH), py = Y(arr[j] * sc); j ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.stroke();
    }
    c.setLineDash([]); c.restore();
  }
  // inside the +-190 km square the pole map shows
  const onMap = sc => { if (sc.lat > -80) return false; const [mx, my] = Polar.toXY(sc.lat, sc.lon); return Math.abs(mx) <= 184000 && Math.abs(my) <= 184000; };
  function poleMap(c, x, y, size, a, b) {
    const span = 190, off = document.createElement('canvas'); off.width = off.height = 380;
    const oc = off.getContext('2d'); oc.putImageData(Polar.relief(oc.createImageData(380, 380), span), 0, 0);
    c.save(); c.beginPath(); c.roundRect ? c.roundRect(x, y, size, size, 12) : c.rect(x, y, size, size); c.clip();
    c.imageSmoothingEnabled = true; c.drawImage(off, x, y, size, size);
    const at = (lat, lon) => { const [mx, my] = Polar.toXY(lat, lon); return [x + size / 2 + mx / (span * 2000) * size, y + size / 2 - my / (span * 2000) * size]; };
    c.font = sans(500, 12.5); c.textAlign = 'center';
    for (const [name, la, lo] of Polar.CRATERS) {
      const p = at(la, lo); if (p[0] < x + 30 || p[0] > x + size - 30 || p[1] < y + 14 || p[1] > y + size - 8) continue;
      c.lineWidth = 3; c.strokeStyle = '#000000b0'; c.strokeText(name, p[0], p[1]); c.fillStyle = '#d6ebff'; c.fillText(name, p[0], p[1]);
    }
    for (const s of [b, a]) {
      if (!onMap(s.sc)) continue;
      const p = at(s.sc.lat, s.sc.lon);
      c.fillStyle = s.k === 'A' ? '#fff' : '#ff7ab8'; c.strokeStyle = '#0a0c0f'; c.lineWidth = 2.5; c.beginPath(); c.arc(p[0], p[1], 12, 0, 7); c.fill(); c.stroke();
      c.font = mono(13); c.fillStyle = '#0a0c0f'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s.k, p[0], p[1] + 1); c.textBaseline = 'alphabetic';
    }
    c.restore();
    box(c, x, y, size, size, null, LINE, 12);
    text(c, L('Güney kutbu çevresi, 380 × 380 km · mavi: kalıcı gölge (buz tuzakları)', 'Around the south pole, 380 × 380 km · blue: permanent shadow (ice traps)'), x, y + size + 22, sans(500, 13), MUTED);
  }
  function prosCons(c, a, x, y, w) {
    badge(c, a.k, x + 13, y - 5, 13);
    c.font = sans(700, 17); text(c, fitText(c, a.name, w - 40), x + 34, y, sans(700, 17));
    y += 28;
    for (const [items, mark, col] of [[a.pros.slice(0, 3), '+', BOTH], [a.cons.slice(0, 3), '−', BAD]]) for (const it of items) {
      text(c, mark, x + 4, y, sans(700, 17), col);
      y = wrap(c, it, x + 24, y, w - 24, 21, sans(400, 14.5), INK, 3) + 4;
    }
    return y;
  }
  function pageTwo(a, b, total) {
    const { cv, c } = newPage();
    header(c, 2, total, 76);
    let y = section(c, L('Görev boyunca değişim', 'Change over the mission'), 126);
    const deg = v => (v > 0 ? '+' : '') + v + '°';
    chart(c, M, y - 8, W - 2 * M, 250, L('Güneş merkezi, yerel ufkun kaç derece üstünde? (gri: merkez ufkun altında; güç azalır ya da kesilir)', 'Sun’s centre above the local horizon (grey: centre below it; power is reduced or none)'), 'sunM', SUN, { get: k => S.data[k].sunM, zero: true, fmt: deg });
    chart(c, M, y + 262, W - 2 * M, 250, L('Dünya, yerel ufkun kaç derece üstünde? (gri: iletişim yok)', 'Earth above the local horizon (grey: no direct link)'), 'earthM', EARTH, { get: k => S.data[k].earthM, zero: true, fmt: deg });
    chart(c, M, y + 532, W - 2 * M, 250, L(`Batarya doluluğu · ${nf(S.pwr.load)} W yük, ${nf(S.pwr.cap, 1)} kWh batarya, ${nf(S.pwr.area, 1)} m² panel (kırmızı: %20 yedek)`, `Battery state of charge · ${nf(S.pwr.load)} W load, ${nf(S.pwr.cap, 1)} kWh battery, ${nf(S.pwr.area, 1)} m² array (red: 20% reserve)`),
      'soc', BOTH, { get: k => S.data[k].pw.soc, scale: 100, lo: 0, hi: 100, step: 20, band: 20, fmt: v => v + '%' });
    y = section(c, L('Zemin ve değerlendirme', 'Ground and assessment'), y + 836);
    const map = Polar.ready && (onMap(a.sc) || onMap(b.sc)), mapSize = 392, tx = map ? M + mapSize + 34 : M, tw = W - M - tx, cw = (tw - 26) / 2;
    if (map) poleMap(c, M, y - 6, mapSize, a, b);
    const y1 = prosCons(c, a, tx, y + 12, cw), y2 = prosCons(c, b, tx + cw + 26, y + 12, cw);
    let ny = Math.max(y1, y2, map ? y + mapSize + 44 : 0) + 14;
    ny = section(c, L('Yöntem ve sınırlar', 'Method and limits'), Math.min(ny, H - 250));
    // name the ephemeris that was really used: outside the SPICE table (2024-2040) the fallback does the work
    const spice = Ephem.meta ? `${Ephem.meta.source}, ${Ephem.meta.ephemeris}, ${Ephem.meta.frame}, ${Ephem.meta.abcorr}` : '', srcs = [a.src, b.src];
    const eph = spice && srcs.every(v => v === 'spice') ? spice
      : !spice || srcs.every(v => v === 'ae') ? L('astronomy-engine (VSOP87 / ELP); bu tarihler NASA SPICE tablosunun (2024–2040) dışında', 'astronomy-engine (VSOP87 / ELP); these dates are outside the NASA SPICE table (2024–2040)')
        : spice + L(' (tablo aralığında) ve astronomy-engine (aralık dışında)', ' (inside the table range) and astronomy-engine (outside it)');
    ny = wrap(c, L(`Güneş ve Dünya konumları: ${eph}. Arazi ufku, eğim ve kalıcı gölge: NASA LOLA 240 m yükseklik modeli (480 m ızgara; üç bölge merkezinde 80 m profil) ve NASA Goddard kalıcı gölge haritası (80°G–90°G). Uygunluk skoru altı bileşenin ağırlıklı ortalamasıdır: güç %25, iletişim %20, karanlık %15, iniş ışığı %10, arazi %15, buz erişimi %15.`,
      `Sun and Earth positions: ${eph}. Terrain horizon, slope and permanent shadow: NASA LOLA 240 m elevation model (480 m grid; an 80 m profile at three region centres) and the NASA Goddard permanently-shadowed-region map (80°S–90°S). The suitability score is a weighted mean of six parts: power 25%, comms 20%, darkness 15%, landing light 10%, terrain 15%, ice access 15%.`), M, ny, W - 2 * M, 22, sans(400, 15), INK);
    wrap(c, L('Skor, yakıt ve batarya değerleri ön tasarım göstergeleridir; sertifikalı güvenlik analizi değildir. Kesin görev tasarımı için sonuçları JPL Horizons ve LROC QuickMap ile doğrulayın.',
      'Score, propellant and battery figures are preliminary-design indicators, not a certified safety analysis. For definitive mission design, verify the results against JPL Horizons and LROC QuickMap.'), M, ny + 4, W - 2 * M, 22, sans(400, 15), MUTED);
    return cv;
  }
  function build() { const a = AS.analyze('A'), b = AS.analyze('B'); return [pageOne(a, b, 2), pageTwo(a, b, 2)]; }

  /* ---------- PDF ---------- */
  function decodeBase64(value) {
    const bin = atob(value), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function unicodeHex(value) {
    let hex = '';
    for (let i = 0; i < value.length; i++) hex += value.charCodeAt(i).toString(16).padStart(4, '0');
    return hex;
  }

  // Preserve the page artwork and add exact Unicode text at the original drawing positions.
  // The embedded OFL font and ToUnicode map make selection independent of installed fonts.
  function toPDF(pages) {
    const font = window.REPORT_FONT;
    if (!font) throw new Error('Report text font is unavailable.');
    const chars = [...new Set(pages.flatMap(page => (page.reportTextRuns || []).flatMap(run => [...run.text])))];
    const codes = new Map(chars.map((char, i) => [char, i + 1]));
    const widths = chars.map(char => {
      const glyph = font.glyphs[char.codePointAt(0)];
      return Math.round((glyph ? glyph[1] : font.unitsPerEm * 0.6) * 1000 / font.unitsPerEm);
    });
    const glyphMap = new Uint8Array((chars.length + 1) * 2);
    chars.forEach((char, i) => {
      const glyph = font.glyphs[char.codePointAt(0)], id = glyph ? glyph[0] : 0;
      glyphMap[(i + 1) * 2] = id >> 8;
      glyphMap[(i + 1) * 2 + 1] = id & 255;
    });
    let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /AstroApexUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < chars.length; i += 100) {
      const group = chars.slice(i, i + 100);
      cmap += group.length + ' beginbfchar\n';
      group.forEach((char, j) => { cmap += '<' + (i + j + 1).toString(16).padStart(4, '0') + '> <' + unicodeHex(char) + '>\n'; });
      cmap += 'endbfchar\n';
    }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';

    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const open = n => { offs[n] = len; push(n + ' 0 obj\n'); }, close = () => push('\nendobj\n');
    const stream = (id, data, extra) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      open(id); push('<< /Length ' + bytes.length + (extra || '') + ' >>\nstream\n'); push(bytes); push('\nendstream'); close();
    };
    const PW = 595.28, PH = 841.89, count = pages.length, kids = pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ');
    const fontId = 3 + count * 3, cidId = fontId + 1, descId = fontId + 2, fileId = fontId + 3, cmapId = fontId + 4, glyphId = fontId + 5, info = fontId + 6;
    push('%PDF-1.4\n'); push(new Uint8Array([37, 226, 227, 207, 211, 10]));
    open(1); push('<< /Type /Catalog /Pages 2 0 R /Lang (' + (pages[0].reportLanguage === 'tr' ? 'tr-TR' : 'en-US') + ') >>'); close();
    open(2); push('<< /Type /Pages /Kids [' + kids + '] /Count ' + count + ' >>'); close();
    pages.forEach((cv, i) => {
      const pg = 3 + i * 3, jpg = decodeBase64(cv.toDataURL('image/jpeg', 0.9).split(',')[1]);
      let content = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q\n';
      for (const run of cv.reportTextRuns || []) {
        if (!run.text || !run.width) continue;
        const ids = [...run.text].map(char => codes.get(char));
        const advance = ids.reduce((sum, id) => sum + widths[id - 1], 0) / 1000;
        const size = run.size * PW / W, x = run.x * PW / W, y = PH - run.y * PH / H;
        const stretch = run.width / (advance * run.size) * 100;
        const hex = ids.map(id => id.toString(16).padStart(4, '0')).join('');
        content += 'BT /F0 ' + size.toFixed(4) + ' Tf 3 Tr ' + stretch.toFixed(4) + ' Tz 1 0 0 1 ' + x.toFixed(4) + ' ' + y.toFixed(4) + ' Tm <' + hex + '> Tj ET\n';
      }
      open(pg); push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 ' + (pg + 2) + ' 0 R >> /Font << /F0 ' + fontId + ' 0 R >> >> /Contents ' + (pg + 1) + ' 0 R >>'); close();
      stream(pg + 1, content);
      stream(pg + 2, jpg, ' /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    });
    open(fontId); push('<< /Type /Font /Subtype /Type0 /BaseFont /' + font.name + ' /Encoding /Identity-H /DescendantFonts [' + cidId + ' 0 R] /ToUnicode ' + cmapId + ' 0 R >>'); close();
    open(cidId); push('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + font.name + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + descId + ' 0 R /DW 600 /W [1 [' + widths.join(' ') + ']] /CIDToGIDMap ' + glyphId + ' 0 R >>'); close();
    const scale = n => Math.round(n * 1000 / font.unitsPerEm);
    open(descId); push('<< /Type /FontDescriptor /FontName /' + font.name + ' /Flags 33 /FontBBox [' + font.bbox.map(scale).join(' ') + '] /ItalicAngle 0 /Ascent ' + scale(font.ascent) + ' /Descent ' + scale(font.descent) + ' /CapHeight 700 /StemV 80 /FontFile2 ' + fileId + ' 0 R >>'); close();
    const fontBytes = decodeBase64(font.bytes);
    stream(fileId, fontBytes, ' /Length1 ' + fontBytes.length);
    stream(cmapId, cmap);
    stream(glyphId, glyphMap);
    open(info); push('<< /Title (AstroApex Mission Report) /Creator (AstroApex) >>'); close();
    const xref = len;
    push('xref\n0 ' + (info + 1) + '\n0000000000 65535 f \n');
    for (let n = 1; n <= info; n++) push(String(offs[n]).padStart(10, '0') + ' 00000 n \n');
    push('trailer\n<< /Size ' + (info + 1) + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }

  function download(pages) {
    const a = document.createElement('a'), d = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(toPDF(pages)); a.download = `AstroApex_${L('gorev_raporu', 'mission_report')}_${d}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function transcript(a, b) {
    const details = document.createElement('details');
    details.className = 'rep-transcript';
    const summary = document.createElement('summary');
    summary.textContent = L('Raporu metin ve tablo olarak oku', 'Read the report as text and table');
    details.appendChild(summary);
    const body = document.createElement('div');
    const add = (tag, content, parent) => {
      const node = document.createElement(tag);
      node.textContent = content;
      (parent || body).appendChild(node);
      return node;
    };
    const pick = AS.recommend(a, b);
    add('h3', L('Görev karşılaştırması', 'Mission comparison'));
    add('p', pick.status === 'none'
      ? L('Hiçbir senaryo ön değerlendirme koşullarını birlikte karşılamıyor.', 'Neither scenario meets the preliminary conditions together.')
      : pick.lead ? L('Ön değerlendirmede öne çıkan: ', 'Preliminary preference: ') + pick.lead.k + ' · ' + pick.lead.name
        : L('İki uygun senaryo aynı skoru alıyor.', 'Both eligible scenarios have the same score.'));
    const table = document.createElement('table');
    const caption = document.createElement('caption');
    caption.textContent = L('İki senaryonun sayısal özeti', 'Numerical summary of both scenarios');
    table.appendChild(caption);
    const head = table.createTHead().insertRow();
    [L('Ölçüm', 'Measure'), a.k + ' · ' + a.name, b.k + ' · ' + b.name].forEach(value => {
      const th = add('th', value, head); th.scope = 'col';
    });
    const rows = [
      [L('Koordinatlar', 'Coordinates'), x => AA.fmtCoord(x.sc.lat, x.sc.lon)],
      [L('Başlangıç (UTC)', 'Start (UTC)'), x => AA.fmtDate(x.sc.start)],
      [L('Görev süresi', 'Mission duration'), () => days(S.dur) + ' ' + t('days')],
      [L('Ufuk kaynağı', 'Horizon source'), x => x.hz === 'lola80' ? 'LOLA 80 m' : x.hz === 'lola480' ? 'LOLA 480 m' : L('Sabit açı ', 'Fixed angle ') + x.sc.mask + '°'],
      [L('Konum hesabı', 'Ephemeris'), x => x.src === 'spice' ? 'NASA SPICE / DE440' : x.src === 'ae' ? 'astronomy-engine' : 'NASA SPICE / astronomy-engine'],
      [t('score'), x => x.score + ' / 100'],
      [L('Güneş görünür', 'Sun visible'), x => AA.fmtDur(x.stats.sun)],
      [L('Dünya görünür', 'Earth visible'), x => AA.fmtDur(x.stats.earth)],
      [L('Ortak görüş', 'Joint visibility'), x => AA.fmtDur(x.stats.both)],
      [L('En uzun karanlık', 'Longest darkness'), x => AA.fmtDur(x.stats.dark)],
      [L('En uzun iletişim kesintisi', 'Longest communication outage'), x => AA.fmtDur(x.stats.nocomm)],
      [L('Ortalama eğim', 'Mean slope'), x => slopeDescription(x.f)],
      [L('Batarya boş kalma süresi', 'Time with an empty battery'), x => x.pw ? AA.fmtDur(x.pw.emptyH) : '—'],
      [L('En düşük batarya doluluğu', 'Minimum battery charge'), x => x.pw ? nf(x.pw.min * 100, 1) + '%' : '—'],
      [L('Gereken batarya', 'Required battery capacity'), x => x.pw ? nf(Math.ceil(x.pw.need * 10) / 10, 1) + ' kWh' : '—']
    ];
    const tbody = table.createTBody();
    rows.forEach(([label, value]) => {
      const tr = tbody.insertRow(), th = add('th', label, tr); th.scope = 'row';
      add('td', value(a), tr); add('td', value(b), tr);
    });
    body.appendChild(table);
    add('p', L('Donanım varsayımları: ', 'Hardware assumptions: ') + nf(S.pwr.load) + ' W · ' + nf(S.pwr.cap, 1) + ' kWh · ' + nf(S.pwr.area, 1) + ' m²');
    [a, b].forEach(item => {
      add('h4', item.k + ' · ' + item.name);
      const assessment = (pick.assessments || []).find(x => x.k === item.k);
      if (assessment) {
        assessment.reasons.forEach(reason => add('p', reason.text));
        if (assessment.qualification) add('p', assessment.qualification);
      }
      const list = document.createElement('ul');
      [...item.pros, ...item.cons].forEach(value => add('li', value, list));
      body.appendChild(list);
    });
    add('h4', L('Grafikler ve yöntem', 'Charts and method'));
    add('p', L('İkinci sayfa Güneş ve Dünya merkezlerinin yerel ufka göre yüksekliğini ve batarya doluluğunu görev boyunca gösterir. Negatif Güneş merkezi yüksekliğinde diskin bir kısmı hâlâ görünebilir.',
      'Page two shows Sun and Earth centre elevations relative to the local horizon and battery charge throughout the mission. Part of the solar disc may remain visible at a negative centre elevation.'));
    add('p', L('480 m arazi ızgarası dar sırtları ve küçük kraterleri kaçırabilir. Kaba küresel eğim, 3×3 hücrenin ortalamasıdır (ekvatorda hücre başına yaklaşık 7,6 km). Doğrudan Dünya görüşü geometrik bir fırsattır; bağlantı bütçesi ayrıca incelenmelidir. Puan, sıcaklık ve yakıt sonuçları ön tasarım tahminleridir.',
      'The 480 m terrain grid can miss narrow ridges and small craters. Coarse global slope is a 3×3-cell mean (about 7.6 km per cell at the equator). Direct Earth visibility is a geometric opportunity; the radio link budget needs a separate assessment. Score, temperature and fuel results are preliminary design estimates.'));
    details.appendChild(body);
    return details;
  }



  /* ---------- dialog ---------- */
  let modal = null, pages = null, prevFocus = null;
  function keys(e) {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const f = [...modal.querySelectorAll('button, .rep-pages, summary')].filter(b => !b.disabled && b.getClientRects().length), first = f[0], last = f[f.length - 1];
      if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    const act = e.key === 'Enter' || e.key === ' ', el = document.activeElement;
    if (act && modal.contains(el) && el.tagName === 'BUTTON') return; // activates the focused button
    e.stopPropagation(); // the app's shortcuts rest while the report is open; Space and arrows still scroll the preview
    if (act && !modal.contains(el)) e.preventDefault();
  }
  async function open() {
    if (modal) return;
    if (window.AATour) window.AATour.end();
    prevFocus = document.activeElement;
    modal = document.createElement('div');
    modal.className = 'rep-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'rep-title');
    modal.innerHTML = `<div class="rep-box">
      <header><div><b id="rep-title">${t('rep_t')}</b><small>${t('rep_sub')}</small></div>
        <span class="rep-acts"><button type="button" class="tt-go" id="pdf-dl">${t('rep_dl')}</button><button type="button" class="ghost" id="rep-close">${t('a_close')}</button></span></header>
      <div class="rep-pages" tabindex="0" role="region" aria-label="${t('rep_t')}"><p class="hint">${t('computing')}</p></div></div>`;
    document.body.appendChild(modal); document.documentElement.classList.add('rep-on');
    document.addEventListener('keydown', keys, true);
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('#rep-close')) close(); else if (e.target.closest('#pdf-dl') && pages) download(pages); });
    modal.querySelector('#rep-close').focus();
    try { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* draw with fallback fonts */ }
    if (!modal) return;
    const holder = modal.querySelector('.rep-pages');
    try {
      pages = build(); holder.innerHTML = '';
      pages.forEach((cv, i) => { cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', t('rep_page', { n: i + 1 })); holder.appendChild(cv); });
      holder.appendChild(transcript(AS.analyze('A'), AS.analyze('B')));
    } catch (err) { pages = null; holder.innerHTML = `<p class="hint">${t('rep_err')}</p>`; modal.querySelector('#pdf-dl').disabled = true; }
  }
  function close() {
    if (!modal) return;
    document.removeEventListener('keydown', keys, true);
    modal.remove(); modal = null; pages = null; document.documentElement.classList.remove('rep-on');
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-report]')) open(); });
  window.AAReport = { open, close, build, toPDF };
})();
