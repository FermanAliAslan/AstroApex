// Link the expanded angular readouts to an independent observer query at this site and UTC hour.
(() => {
  const details = document.querySelector('#landerSky .sky-exact');
  if (!details) return;
  const sources = document.createElement('p');
  sources.className = 'sky-sources';
  sources.hidden = true;
  sources.append('JPL Horizons ile doğrula ');
  const bodies = [[10,'Güneş'], [399,'Dünya']].map(([id, name]) => {
    const link = document.createElement('a');
    link.textContent = name + ' ↗';
    link.setAttribute('aria-label', name + ' için JPL Horizons verisini aç');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    sources.append(link);
    return {id,link};
  });
  details.append(sources);

  const utc = ms => new Date(ms).toISOString().slice(0,16).replace('T',' ');
  function update(state) {
    if (!details.open || state?.route !== 'windows') return;
    const point = state.plan.dataMode === 'horizons' && horizonsCache.coordinates(state.plan.site);
    sources.hidden = !point || !state.sample;
    if (sources.hidden) return;
    const time = state.scenario.start + state.hour * 3600000;
    const params = new URLSearchParams({
      format:'text', OBJ_DATA:'NO', CENTER:"'coord@301'", COORD_TYPE:'GEODETIC',
      SITE_COORD:"'" + [((point.lon + 360) % 360).toFixed(5), point.lat, 0].join(',') + "'",
      START_TIME:"'" + utc(time) + "'", STOP_TIME:"'" + utc(time+3600000) + "'",
      STEP_SIZE:"'1h'", EPHEM_TYPE:'OBSERVER', TIME_TYPE:'UT',
      QUANTITIES:"'4'", APPARENT:'AIRLESS', EXTRA_PREC:'YES'
    });
    for (const {id,link} of bodies) {
      params.set('COMMAND',String(id));
      link.href = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + params;
    }
  }
  details.addEventListener('toggle', () => update(window.missionConsole?.getState()));
  window.addEventListener('mission:update', e => update(e.detail));
})();
