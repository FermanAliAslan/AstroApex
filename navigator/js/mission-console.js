/* A single-scenario overview of the same samples shown in Compare and Sky. */
(() => {
  'use strict';
  const root = document.getElementById('console');
  const { AA } = window;
  if (!root || !AA) return;
  const { S, nf, fmtDate, fmtCoord, idxAt, siteName, t } = AA;
  const get = id => document.getElementById('mc-' + id);
  const copy = {
    en: {
      title: 'Mission console', lead: 'Follow one landing scenario from local sky conditions to mission-wide visibility.',
      settings: 'Settings', scenarios: 'Scenario', edit: 'Edit landing scenarios', sky: 'Local sky', conditions: 'Mission conditions',
      lit: 'Time in sunlight', contact: 'Earth visibility windows', joint: 'Sun and Earth together', dark: 'Longest darkness',
      ask: 'Ask about this site', windows: 'Visibility windows', sunBand: 'Sunlight', earthBand: 'Earth visibility',
      power: 'Timeline and power', method: 'Data and assumptions', sample: 'Sample interval', elev: 'Elevation', hidden: 'not visible'
    },
    tr: {
      title: 'Görev konsolu', lead: 'Bir iniş senaryosunun gökyüzünü ve görev boyunca görüş pencerelerini inceleyin.',
      settings: 'Ayarlar', scenarios: 'Senaryo', edit: 'İniş senaryolarını düzenle', sky: 'Yerel gökyüzü', conditions: 'Görev koşulları',
      lit: 'Güneş ışığı alan süre', contact: 'Dünya ile görüş penceresi', joint: 'Güneş ve Dünya birlikte', dark: 'En uzun karanlık',
      ask: 'Bu sahayı analiste sor', windows: 'Görüş pencereleri', sunBand: 'Güneş ışığı', earthBand: 'Dünya ile görüş',
      power: 'Zaman çizelgesi ve enerji', method: 'Veriler ve varsayımlar', sample: 'Örnekleme aralığı', elev: 'Yükselim', hidden: 'görünmüyor'
    }
  };
  let selected = 'A';
  let previousData, previousLang, previousScenario, previousSample = -1;
  const buttons = [...root.querySelectorAll('[data-mc-site]')];
  const hours = h => nf(h, h && h < 1 ? 2 : Number.isInteger(h) ? 0 : 1) + ' ' + t('h');

  function renderConditions(data, labels) {
    const sc = S.sc[selected], stats = data.stats;
    get('range').textContent = fmtDate(sc.start, false) + ' – ' + fmtDate(sc.start + stats.total * 3600000, false) + ' · UTC';
    get('place').textContent = siteName(selected) + ' · ' + fmtCoord(sc.lat, sc.lon);
    get('lit').textContent = new Intl.NumberFormat(S.lang, {style: 'percent', maximumFractionDigits: 2}).format(stats.sun / stats.total);
    get('contact').textContent = nf(data.runs.earth.length);
    get('joint').textContent = hours(stats.both);
    get('dark').textContent = hours(stats.dark);
    get('ask').dataset.openAnalyst = selected;
    for (const button of buttons) {
      const key = button.dataset.mcSite;
      button.setAttribute('aria-pressed', String(key === selected));
      button.lastElementChild.textContent = siteName(key);
    }
    get('sampling').textContent = labels.sample + ' · ' + nf(data.dtH * 60) + ' ' + t('m');
    for (const band of root.querySelectorAll('[data-mc-band]')) {
      const body = band.dataset.mcBand;
      const tracks = document.createDocumentFragment();
      for (const [start, end] of data.runs[body]) {
        const segment = document.createElement('i');
        segment.style.left = (100 * start / (data.n - 1)) + '%';
        segment.style.width = (100 * (end - start) / (data.n - 1)) + '%';
        tracks.append(segment);
      }
      band.querySelector('.mc-track').replaceChildren(tracks);
      band.querySelector('b').textContent = hours(stats[body]);
    }
  }

  function update(forceSky = false) {
    if (S.tab !== 'console' || !S.data[selected]) return;
    const labels = copy[S.lang], data = S.data[selected], sample = idxAt(selected);
    const changed = previousData !== data || previousLang !== S.lang || previousScenario !== selected;
    if (previousLang !== S.lang) {
      for (const el of root.querySelectorAll('[data-mc]')) el.textContent = labels[el.dataset.mc];
      root.querySelector('.mc-sites').setAttribute('aria-label', labels.scenarios);
      get('sky').setAttribute('aria-label', labels.sky);
    }
    if (changed) renderConditions(data, labels);
    if (changed || sample !== previousSample || forceSky) {
      get('utc').textContent = fmtDate(S.sc[selected].start + sample * data.dtH * 3600000) + ' UTC';
      for (const body of ['sun', 'earth']) {
        const angle = data[body + 'El'][sample];
        get(body + '-now').textContent = labels.elev + ' ' + (angle > 0 ? '+' : '') + nf(angle, 2) + '° · ' + (data[body + 'Up'][sample] ? t('up') : labels.hidden);
      }
      AA.drawSky(selected, get('sky'));
    }
    previousData = data; previousLang = S.lang; previousScenario = selected; previousSample = sample;
  }

  buttons.forEach(button => button.addEventListener('click', () => {
    selected = button.dataset.mcSite; update();
  }));
  if ('ResizeObserver' in window) new ResizeObserver(() => update(true)).observe(get('sky'));
  window.AAMissionConsole = { update };
  update();
})();
