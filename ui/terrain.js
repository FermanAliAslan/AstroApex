/* Directional local horizons of three NASA study-region centers, derived from
   Barker et al.'s 80 m LOLA DEM. See assets/terrain-horizon-source.txt. */
(() => {
  "use strict";
  const sites = window.astroTerrainProfiles || {};
  const has = site => Object.hasOwn(sites, horizonsCache.referenceSite(site));
  function angle(site, azimuth) {
    if (!has(site) || !Number.isFinite(azimuth)) return null;
    const angles = sites[horizonsCache.referenceSite(site)].angles;
    const position = ((azimuth % 360 + 360) % 360) * angles.length / 360;
    const index = Math.floor(position);
    const fraction = position - index;
    return angles[index] * (1 - fraction) + angles[(index + 1) % angles.length] * fraction;
  }
  window.lunarHorizon = Object.freeze({has, angle});
  const mask = document.querySelector('#terrain');
  if (!mask) return;
  const fixedField = mask.closest('label');
  const horizonField = document.createElement('label');
  const label = document.createElement('span');
  label.textContent = 'Ufuk modeli';
  const selector = document.createElement('select');
  selector.id = 'horizonMode';
  selector.dataset.nativeSelect = '';
  selector.append(new Option('Sabit açı', 'manual'),new Option('LOLA arazi profili', 'dem'));
  horizonField.htmlFor = selector.id;
  horizonField.append(label,selector);
  fixedField.before(horizonField);
  const context = document.createElement('p');
  context.id = 'horizonContext';
  context.className = 'terrain-horizon-context';
  context.hidden = true;
  horizonField.closest('section').after(context);
  selector.addEventListener('change', () => window.missionConsole?.setPlan({horizonMode:selector.value}));
  const update = ({detail: {plan,scenario,source}}) => {
    if (source === 'time') return;
    const supported = plan.dataMode === 'horizons' && has(plan.site);
    const active = supported && plan.horizonMode === 'dem';
    selector.value = active ? 'dem' : 'manual';
    selector.options[1].disabled = !supported;
    fixedField.hidden = active;
    context.hidden = supported && !active;
    if (active) {
      const flatHours = scenario?.samples.reduce((sum,sample) =>
        sum + Number(sample.sunAngle > 0 && sample.earthAngle > 0),0);
      const comparison = scenario ? ' Ortak görüş süresi düz ufukta ' + flatHours +
        ' sa, araziyle ' + scenario.overlapHours + ' sa.' : '';
      context.textContent = 'LOLA · ' + plan.site + ' bölge merkezinin 2 m üzerinden yerel ufuk.' + comparison;
    } else if (!supported) {
      context.textContent = 'LOLA ufuk profili üç NASA bölge merkezinde JPL verileriyle kullanılabilir. Bu seçim sabit açı kullanır.';
    }
  };
  window.addEventListener('mission:update', update);
})();
