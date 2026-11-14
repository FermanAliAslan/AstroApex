// Compare visibility at the same elapsed mission hour, with each site's own UTC clock.
(() => {
  'use strict';
  const host = document.querySelector('#compare .cmp-timelines');
  const comparison = window.astroComparison;
  if (!host || !comparison) return;
  const hourMs = 3600000;
  const clock = new Intl.DateTimeFormat('tr-TR', {
    day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit',
    hourCycle:'h23', timeZone:'UTC'
  });
  const arms = ['a','b'];
  const modes = {overlap:'Birlikte', sun:'Güneş', earth:'Dünya'};
  let mode = 'overlap';
  let frame = null;
  let maxHours = 0;
  let cursor = 0;
  let boundaries = [];

  function node(tag, className, text) {
    const n = document.createElement(tag);
    n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(className, text) {
    const n = node('button',className,text);
    n.type = 'button';
    return n;
  }

  const top = node('div','lens-top');
  const title = node('h3','lens-title','Görüş pencereleri');
  title.id = 'cmp-lens-title';
  const filter = node('div','lens-filter');
  filter.setAttribute('role','group');
  filter.setAttribute('aria-label','Zaman çizelgesinde gösterilen görünürlük');
  for (const [key,label] of Object.entries(modes)) {
    const toggle = button('lens-mode',label);
    toggle.dataset.mode = key;
    toggle.addEventListener('click',() => {
      if (key===mode) return;
      mode = key;
      drawWindows();
    });
    filter.append(toggle);
  }
  top.append(title,filter);

  const plots = node('div','lens-plots');
  const chart = node('div','lens-chart');
  const labels = node('div','lens-letters');
  labels.setAttribute('aria-hidden','true');
  const tracks = {};
  for (const arm of arms) {
    labels.append(node('span','lens-letter lens-letter-'+arm,arm.toUpperCase()));
    const track = node('div','lens-track lens-track-'+arm);
    track.setAttribute('aria-hidden','true');
    tracks[arm] = track;
    chart.append(track);
  }
  const marker = node('span','lens-marker');
  marker.setAttribute('aria-hidden','true');
  const scrub = node('input','lens-scrub');
  scrub.id = 'cmp-time-scrub';
  scrub.type = 'range'; scrub.min = '0'; scrub.step = '1';
  scrub.setAttribute('aria-label','Görev başlangıcından geçen süre');
  scrub.addEventListener('input',() => setHour(scrub.valueAsNumber));
  chart.append(marker,scrub);
  const axis = node('div','lens-axis');
  axis.setAttribute('aria-hidden','true');
  const right = node('span','');
  axis.append(node('span','','Başlangıç'),right);
  plots.append(labels,chart,axis);

  const context = node('div','lens-context');
  const timeReadout = node('div','lens-time-readout');
  const hour = node('span','lens-hour');
  const availability = node('strong','lens-availability');
  timeReadout.append(hour,availability);
  const controls = node('div','lens-window-nav');
  function jumpControl(step,label) {
    const b = button('lens-jump',step<0?'‹':'Sonraki geçiş ›');
    b.title = label;
    if (step < 0) b.setAttribute('aria-label',label);
    b.addEventListener('click',()=>{
      const index = step < 0 ? boundaries.findLast(t=>t<cursor) : boundaries.find(t=>t>cursor);
      if (index!==undefined) setHour(index);
    });
    return b;
  }
  const prev = jumpControl(-1,'Önceki pencere sınırına git');
  const next = jumpControl(1,'Sonraki pencere sınırına git');
  controls.append(prev,next);
  context.append(timeReadout,controls);

  const readings = node('div','lens-readings');
  const details = {};
  for (const arm of arms) {
    const letter = arm.toUpperCase();
    const row = node('section','lens-status lens-status-'+arm);
    row.setAttribute('aria-label','Senaryo '+letter);
    const stamp = node('time','lens-stamp');
    const name = node('span','lens-row-name',letter);
    const heading = node('div','lens-row-head');
    heading.append(name,stamp);
    const sun = node('span','lens-state');
    sun.dataset.sun='';
    const earth = node('span','lens-state');
    earth.dataset.earth='';
    const states = node('div','lens-states');
    states.append(sun,earth);
    const open = button('lens-open','↗');
    open.title = letter+' senaryosunun bu saatteki gökyüzü';
    open.addEventListener('click',()=>comparison.openSky(arm,cursor));
    row.append(heading,states,open);
    readings.append(row);
    details[arm] = {row,stamp,states,sun,earth,open};
  }
  host.classList.add('window-lens');
  host.setAttribute('role','region');
  host.setAttribute('aria-labelledby',title.id);
  host.removeAttribute('aria-label');
  host.replaceChildren(top,plots,context,readings);
  window.astroWindowLens = true;

  function setHour(value) {
    if (!frame) return;
    cursor = Math.min(maxHours-1,Math.max(0,Math.round(value)));
    scrub.value = cursor;
    // Each sample owns a full one-hour bin. Center the pointer inside that bin.
    chart.style.setProperty('--lens-position', (cursor+.5)/maxHours*100+'%');
    hour.textContent = cursor ? 'Başlangıçtan '+cursor+' saat sonra' : 'Görev başlangıcı';
    prev.disabled = !boundaries.some(t=>t<cursor);
    next.disabled = !boundaries.some(t=>t>cursor);
    const active = arms.filter(a => frame[a].scenario.samples[cursor]?.[mode]);
    const condition = {overlap:'ortak görüş',sun:'güneş ışığı',earth:'Dünya görüşü'}[mode];
    if (arms.some(a=>!frame[a].scenario.samples[cursor])) {
      const remaining = arms.find(a=>frame[a].scenario.samples[cursor]);
      availability.textContent = 'Yalnız '+remaining.toUpperCase()+' görevi sürüyor';
    } else {
      availability.textContent = active.length===2 ? 'İki senaryoda da '+condition+' var'
        : active.length===1 ? 'Yalnız '+(active[0]==='a'?'A’da':'B’de')+' '+condition+' var'
        : 'İki senaryoda da '+condition+' yok';
    }
    const spoken = [hour.textContent, availability.textContent];
    for (const arm of arms) {
      const view = details[arm], {scenario} = frame[arm];
      const sample = scenario.samples[cursor];
      const ended = !sample;
      view.row.dataset.ended = String(ended);
      view.states.hidden = ended;
      view.open.disabled = ended;
      if (ended) {
        view.sun.removeAttribute('data-visible');
        view.earth.removeAttribute('data-visible');
        view.stamp.removeAttribute('datetime');
        view.stamp.textContent = 'Görev sona erdi';
        view.open.setAttribute('aria-label',arm.toUpperCase()+' görevi sona erdi');
        spoken.push(arm.toUpperCase()+' görevi sona erdi.');
        continue;
      }
      const time = new Date(scenario.start+cursor*hourMs);
      const stamp = clock.format(time)+' UTC';
      view.stamp.dateTime = time.toISOString();
      view.stamp.textContent = stamp;
      view.sun.dataset.visible = String(sample.sun);
      view.earth.dataset.visible = String(sample.earth);
      view.sun.textContent = sample.sun?'Güneş görünür':'Güneş ufuk altında';
      view.earth.textContent = sample.earth?'Dünya görünür':'Dünya ufuk altında';
      view.open.setAttribute('aria-label',arm.toUpperCase()+' senaryosunun gökyüzünü '+stamp+' için incele');
      spoken.push(arm.toUpperCase()+', '+stamp+', '+view.sun.textContent+', '+view.earth.textContent+'.');
    }
    scrub.setAttribute('aria-valuetext',spoken.join(' '));
  }

  function drawWindows() {
    if (!frame) return;
    host.dataset.lensMode = mode;
    for (const b of filter.children) b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
    const times = new Set();
    for (const arm of arms) {
      const {scenario} = frame[arm];
      const span = node('div','lens-span');
      span.style.width = scenario.samples.length/maxHours*100+'%';
      for (const interval of scenario.intervals[mode]) {
        const segment = node('i','lens-window');
        segment.style.left = interval.begin/scenario.samples.length*100+'%';
        segment.style.width = (interval.end-interval.begin)/scenario.samples.length*100+'%';
        span.append(segment);
        times.add(interval.begin);
        if (interval.end<scenario.samples.length) times.add(interval.end);
      }
      if (scenario.samples.length < maxHours) times.add(scenario.samples.length);
      tracks[arm].replaceChildren(span);
    }
    boundaries = [...times].sort((a,b)=>a-b);
    right.textContent = maxHours/24+'. gün sonu';
    setHour(cursor);
  }

  function apply(evaluation) {
    frame = evaluation?.a?.scenario && evaluation?.b?.scenario ? evaluation : null;
    host.hidden = !frame;
    if (!frame) return;
    maxHours = Math.max(...arms.map(a=>frame[a].scenario.samples.length));
    scrub.max = String(maxHours-1);
    drawWindows();
  }
  window.addEventListener('astro:comparison-change',e=>apply(e.detail));
  apply(comparison.snapshot?.());
})();
