// Smooth only adjacent hourly samples during playback. Calculations always use the samples.
(() => {
  'use strict';
  const duration = 145; // Leave room to settle before the next 160 ms playback tick.
  const radians = Math.PI / 180;

  function interpolate(from, to, fraction, scenario) {
    const frame = {};
    for (const key of ['sun', 'earth']) {
      const elevation = from[key+'Angle'] + fraction * (to[key+'Angle'] - from[key+'Angle']);
      const a = from[key+'Az'], b = to[key+'Az'];
      let horizon = to[key+'Horizon'];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        // Position is periodic at lunar north. A 359° → 1° step travels through 0°.
        const arc = Math.atan2(Math.sin((b-a)*radians), Math.cos((b-a)*radians)) / radians;
        const azimuth = (a + fraction * arc + 360) % 360;
        frame[key+'Az'] = azimuth;
        if (scenario.horizonMode === 'dem') horizon = window.lunarHorizon.angle(scenario.site, azimuth);
      }
      frame[key+'Angle'] = elevation;
      frame[key+'Horizon'] = horizon;
      frame[key] = elevation > horizon;
    }
    return frame;
  }

  window.createLunarSkyMotion = function (paint) {
    const play = document.getElementById('play');
    const graph = document.querySelector('#landerSky .sky-graphic');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true, state = null, flight = null, request = 0;

    function cancel() {
      if (request) cancelAnimationFrame(request);
      request = 0;
      flight = null;
    }
    function settle() {
      if (!flight) return;
      cancel();
      if (state) paint(state.sample);
    }
    function animating() {
      return play.dataset.playing === 'true' && !reduced.matches && !document.hidden && visible;
    }
    function draw(time) {
      request = 0;
      if (!flight) return;
      const t = Math.max(0, (time - flight.start) / duration);
      if (t >= 1 || !animating()) { settle(); return; }
      paint(interpolate(flight.from, state.sample, t, state.scenario));
      request = requestAnimationFrame(draw);
    }
    function update(next) {
      if (next?.route !== 'windows' || !next.scenario || !next.sample) {
        cancel();
        state = null;
        return;
      }
      const previous = state;
      state = next;
      // A resize/pin refresh may rebuild the drawing surface while the hour is in flight.
      if (flight && previous?.sample === next.sample && animating()) {
        cancelAnimationFrame(request);
        draw(performance.now());
        return;
      }
      cancel();
      if (next.source === 'time' && previous?.scenario === next.scenario &&
          previous.hour + 1 === next.hour && animating()) {
        flight = {from:previous.sample, start:performance.now()};
        paint(previous.sample);
        request = requestAnimationFrame(draw);
      } else {
        paint(next.sample);
      }
    }

    // Pausing the clock doesn't emit another mission sample.
    new MutationObserver(() => { if (!animating()) settle(); })
      .observe(play, {attributes:true, attributeFilter:['data-playing']});
    document.addEventListener('visibilitychange', () => { if (document.hidden) settle(); });
    reduced.addEventListener('change', () => { if (reduced.matches) settle(); });
    if (graph && 'IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        visible = entries[entries.length-1].isIntersecting;
        if (!visible) settle();
      }).observe(graph);
    }
    return {update};
  };
})();
