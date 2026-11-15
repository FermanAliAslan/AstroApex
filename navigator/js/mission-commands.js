// Typed directives from the analyst. Unrecognized text stays in the normal question flow.
(() => {
  'use strict';
  const views = {
    compare: ['compare', 'comparison', 'site comparison', 'karsilastirma', 'karsilastirmayi', 'saha karsilastirmasini'],
    time: ['timeline', 'simulation', 'zaman cizelgesi', 'zaman cizelgesini', 'simulasyonu'],
    sky: ['sky', 'gokyuzu', 'gokyuzunu'],
    map: ['map', '3d moon', 'moon inspector', 'haritayi', '3b ay', '3b ayi'],
    resources: ['resources', 'method', 'kaynaklar', 'kaynaklari', 'yontemi'],
    settings: ['settings', 'ayarlar', 'ayarlari'],
    console: ['mission console', 'overview', 'gorev konsolunu', 'genel gorunumu']
  };
  const normalize = text => text.trim().toLowerCase().replace(/ı/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

  // Select the same enabled option a human could select; its existing handler updates every view.
  function selectOption(control, value) {
    const option = Array.from(control.options).find(o => o.value === value && !o.disabled);
    if (!option) return false;
    if (control.value !== value) {
      control.value = value;
      control.dispatchEvent(new Event('change', {bubbles: true}));
    }
    return true;
  }

  function run(raw, scope) {
    const { AA } = window;
    if (!AA || !AA.KEYS.includes(scope) || raw.length > 160 || /[?\r\n]/.test(raw)) return null;
    const q = normalize(raw).replace(/[.!]+$/, '').replace(/^(?:please|lutfen) /, '');
    const local = (tr, en) => AA.S.lang === 'tr' ? tr : en;
    const navigation = q.match(/^(?:open|go to) (?:the )?(.+)$/) || q.match(/^(.+) ac$/);
    if (navigation) {
      const view = Object.keys(views).find(id => views[id].includes(navigation[1]));
      const heading = view && document.querySelector('#' + view + ' h1');
      if (heading) return {view, message: local(heading.textContent + ' açıldı.', 'Opened ' + heading.textContent + '.')};
    }

    const start = /^(?:(?:play|start|resume)(?: (?:the )?(?:clock|simulation|playback))?|(?:(?:simulasyonu|saati) )?(?:baslat|oynat))$/.test(q);
    const stop = /^(?:(?:stop|pause)(?: (?:the )?(?:clock|simulation|playback))?|(?:(?:simulasyonu|saati) )?(?:durdur|duraklat))$/.test(q);
    if (start || stop) {
      if (AA.S.playing !== start) AA.setPlaying(start);
      return {message: start ? local('Görev saati çalışıyor.', 'Mission clock is running.')
        : local('Görev saati duraklatıldı.', 'Mission clock is paused.')};
    }

    const duration = q.match(/^set (?:mission )?duration to ([\d.,]+) days?$/) ||
      q.match(/^(?:gorev )?sure(?:sini|yi) ([\d.,]+) gun (?:yap|olarak ayarla)$/);
    if (duration) {
      const days = Number(duration[1].replace(',', '.'));
      const allowed = AA.DURS.map(n => n.toLocaleString(AA.S.lang)).join(' / ');
      if (!selectOption(document.querySelector('#dur'), String(days)))
        return {message: local('Kullanılabilir görev süreleri (gün): ', 'Available mission durations (days): ') + allowed + '.'};
      return {message: local('Görev süresi: ' + days.toLocaleString('tr') + ' gün.', 'Mission duration: ' + days + ' days.')};
    }

    let site = q.match(/^set (?:(?:scenario )?([ab]) )?(?:landing )?site to (.+)$/) ||
      q.match(/^set scenario ([ab]) to (.+)$/) ||
      q.match(/^(?:(?:senaryo )?([ab]) (?:icin )?)?(?:inis )?sahasini (.+?) (?:yap|olarak ayarla|sec)$/);
    const explicitSite = Boolean(site);
    if (!site) {
      site = q.match(/^(?:(?:senaryo )?([ab]) icin )?(.+) sec$/);
      const pick = q.match(/^select (.+?)(?: for (?:scenario )?([ab]))?$/);
      if (pick) site = [pick[0], pick[2], pick[1]];
    }
    if (site) {
      const target = (site[1] || scope).toUpperCase();
      const name = site[2].replace(/'(?:yi|yu|i|u)$/, '');
      const location = window.SITES.find(s => normalize(s.name) === name || s.id === name);
      if (!location && !explicitSite) return null;
      if (!location) return {message: local('İniş sahasının listedeki tam adını kullanın.', 'Use the full name from the landing-site list.')};
      const control = document.querySelector('#scn-' + target + ' [data-f="site"]');
      if (selectOption(control, location.id)) return {message: local(target + ' iniş sahası: ', 'Landing site ' + target + ': ') + location.name + '.'};
      return null;
    }

    const terrain = q.match(/^set (?:(?:scenario )?([ab]) )?(?:terrain|horizon) to (lola|[-+−]?[\d.,]+)(?:°| degrees?)?$/) ||
      q.match(/^(?:(?:senaryo )?([ab]) (?:icin )?)?(?:ufku|ufkunu|araziyi|arazi esigini) (lola|[-+−]?[\d.,]+)(?:°| derece)? (?:yap|olarak ayarla)$/);
    if (terrain) {
      const target = (terrain[1] || scope).toUpperCase();
      const control = document.querySelector('#scn-' + target + ' [data-f="mask"]');
      const value = terrain[2] === 'lola' ? 'lola' : String(Number(terrain[2].replace(',', '.').replace('−', '-')));
      if (!selectOption(control, value)) {
        const options = Array.from(control.options).filter(o => !o.disabled)
          .map(o => o.value === 'lola' ? 'LOLA' : Number(o.value).toLocaleString(AA.S.lang) + '°');
        return {message: local(target + ' için kullanılabilir ufuklar: ', 'Available horizons for ' + target + ': ') + options.join(' / ') + '.'};
      }
      return {message: local(target + ' senaryosunun ufku: ', 'Horizon for ' + target + ': ') + control.selectedOptions[0].textContent + '.'};
    }
    return null;
  }
  window.AAMissionCommands = {run};
})();
