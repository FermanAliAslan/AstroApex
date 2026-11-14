// Panoramic azimuth/elevation projection; clockwise azimuth starts at lunar north.
// Event times are bracketed by adjacent hourly visibility samples.
(() => {
  'use strict';
  const station = document.querySelector('#windows .s-playback');
  if (!station) return;
  station.id = 'landerSky';
  station.classList.add('s-span-two', 'lander-sky');
  station.querySelector('h2').textContent = 'İniş sahasından gökyüzü';
  const body = station.querySelector('.s-body');
  const existingAngles = body.querySelector('.s-vectors');
  const exact = document.createElement('details');
  exact.className = 'sky-exact';
  const exactLabel = document.createElement('summary');
  exactLabel.textContent = 'Açısal konumlar';
  existingAngles.before(exact);
  exact.append(exactLabel, existingAngles);

  const figure = document.createElement('figure');
  figure.className = 'sky-figure';
  figure.innerHTML = '<div class="sky-graphic"><svg role="img" aria-label="Güneş ve Dünya, yerel ufka göre"></svg></div>' +
    '<figcaption><span class="sky-horizon-key" data-horizon-label></span><span class="sky-flat-key" hidden>Yatay düzlem · 0°</span><span data-projection-label></span></figcaption>';
  const readouts = document.createElement('div');
  readouts.className = 'sky-readings';
  figure.prepend(readouts);
  body.prepend(figure);
  const svg = figure.querySelector('svg');
  const graph = svg.parentElement;
  const horizonLabel = figure.querySelector('[data-horizon-label]');
  const projectionLabel = figure.querySelector('[data-projection-label]');
  const eventList = document.createElement('div');
  eventList.className = 'sky-events';
  exact.before(eventList);
  const note = document.createElement('p');
  note.className = 'sky-sampling-note';
  note.textContent = 'Konumlar saatlik örneklerdir. Oynatırken ara hareket yaklaşık gösterilir.';
  exact.before(note);
  const number = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1});
  const utc = new Intl.DateTimeFormat('tr-TR', {
    timeZone:'UTC', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  });
  const hourMs = 3600000;
  const bodies = [{key:'sun', name:'Güneş'}, {key:'earth', name:'Dünya'}];

  function svgNode(tag, attrs, value) {
    const item = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key,val] of Object.entries(attrs)) item.setAttribute(key, val);
    if (value != null) item.textContent = value;
    return item;
  }
  function eventColumn({name, key}) {
    const section = document.createElement('section');
    section.className = 'sky-body sky-' + key;
    const heading = document.createElement('h3');
    heading.textContent = name;
    const status = document.createElement('span');
    status.className = 'sky-body-state';
    heading.append(status);
    section.append(heading);
    const list = document.createElement('dl');
    section.append(list);
    eventList.append(section);
    const labels = key === 'sun' ? ['Işık kesilir', 'Işık geri gelir'] : ['Görüş kapanır', 'Görüş açılır'];
    const rows = labels.map(label => {
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      const when = document.createElement('button');
      when.type = 'button';
      when.className = 'sky-event-jump';
      when.addEventListener('click', () => window.missionConsole?.setHour(Number(when.dataset.sample)));
      const absent = document.createElement('span');
      const clock = document.createElement('small');
      value.append(when, absent, clock);
      list.append(term,value);
      return {when,absent,clock,label};
    });
    return {key,name,status,rows};
  }
  const cards = bodies.map(eventColumn);
  const signed = n => (n > 0 ? '+' : '') + number.format(n).replace('-', '−') + '°';
  const readingNodes = bodies.map(({key,name}) => {
    const reading = document.createElement('div');
    reading.className = 'sky-reading';
    reading.dataset.body = key;
    const label = document.createElement('strong');
    label.textContent = name;
    const level = document.createElement('b');
    const state = document.createElement('span');
    reading.append(label,level,state);
    readouts.append(reading);
    return {level,state};
  });

  let displayedScenario;
  let profile = [];
  let ticks = [];
  let extent = 5;
  let physical = true;
  let scene = null;
  let lastWidth = 0;
  let markerNodes = [];

  function prepare(state) {
    const scenario = state.scenario;
    physical = state.plan.dataMode !== 'demo';
    const derived = scenario.horizonMode === 'dem';
    const getAngle = az => derived ? window.lunarHorizon.angle(scenario.site,az) : scenario.terrain;
    // Match the native half-degree spacing of the local skyline.
    profile = Array.from({length:721}, (_,i) => getAngle(i/2));
    let largest = Math.max(...profile.map(Math.abs));
    for (const s of scenario.samples) largest = Math.max(largest, Math.abs(s.sunAngle), Math.abs(s.earthAngle));
    // Keep one scale over the entire playback so changes in height remain comparable.
    extent = [3,6,10,20,30,45,60,90].find(n => n >= largest * 1.1) || 90;
    ticks = [-extent,-extent / 2,0,extent / 2,extent];
    horizonLabel.textContent = derived ? 'Yerel ufuk · LOLA arazisi' : 'Yerel ufuk · ' + signed(scenario.terrain) + ' sabit';
    figure.querySelector('.sky-flat-key').hidden=!(derived || scenario.terrain!==0);
    projectionLabel.textContent = physical ? 'Yükseklik 0° yatay düzleme göre ölçülür.' : 'Demo modeli yalnızca yüksekliği gösterir.';
    displayedScenario = scenario;
  }
  function plotBase(width) {
    const compact = width < 560;
    const h = compact ? 246 : 272;
    const x0 = 52, x1 = width - (compact ? 16 : 28);
    const top = 31, bottom = h - (physical ? 48 : 25);
    const x = bearing => x0 + (x1-x0)*bearing/360;
    const y = elevation => top + (bottom-top)*(extent-elevation)/(2*extent);
    svg.setAttribute('viewBox','0 0 '+width+' '+h);
    svg.style.height = h+'px';

    const nodes = [];
    const text = (cls,px,py,anchor,label) => svgNode('text',{class:cls,x:px,y:py,'text-anchor':anchor},label);
    const line = (cls,ax,ay,bx,by) => svgNode('line',{class:cls,x1:ax,y1:ay,x2:bx,y2:by});
    const defs = svgNode('defs',{});
    const stripe = svgNode('pattern',{id:'sky-soil',width:10,height:10,patternUnits:'userSpaceOnUse'});
    stripe.append(svgNode('path',{d:'M-2 2 L2 -2 M0 10 L10 0 M8 12 L12 8',fill:'none',stroke:'#ab99b8','stroke-opacity':'.055'}));
    const floor = svgNode('linearGradient',{id:'sky-depth',x1:0,y1:0,x2:0,y2:1,gradientUnits:'objectBoundingBox'});
    floor.append(svgNode('stop',{offset:0,'stop-color':'#2c2536'}),svgNode('stop',{offset:1,'stop-color':'#1a1621'}));
    defs.append(stripe,floor);
    nodes.push(defs);
    const skyline = profile.map((e,i)=>(i?'L':'M')+x(i/2).toFixed(2)+' '+y(e).toFixed(2)).join(' ');
    const skyClip=svgNode('clipPath',{id:'sky-air-clip'});
    skyClip.append(svgNode('path',{d:skyline+' L'+x1+' '+top+' H'+x0+' Z'}));
    defs.append(skyClip);
    nodes.push(svgNode('image',{href:'assets/galaxy-field.webp',x:x0,y:top,width:x1-x0,height:bottom-top,
      preserveAspectRatio:'xMidYMid slice',opacity:.12,'clip-path':'url(#sky-air-clip)','aria-hidden':'true'}));
    const terrain = skyline+' L'+x1+' '+bottom+' H'+x0+' Z';
    nodes.push(svgNode('path',{d:terrain,fill:'url(#sky-depth)'}),svgNode('path',{d:terrain,fill:'url(#sky-soil)'}));
    nodes.push(text('sky-axis-title',x0,18,'start','Yükseklik (°)'));
    for (const tick of ticks) {
      const cls=tick===0 && !figure.querySelector('.sky-flat-key').hidden ? 'sky-reference-flat' : 'sky-grid';
      nodes.push(line(cls,x0,y(tick),x1,y(tick)),text('sky-tick',x0-7,y(tick)+4,'end',signed(tick)));
    }
    if (physical) {
      for (const [i,dir] of ['Kuzey','Doğu','Güney','Batı','Kuzey'].entries()) {
        const bearing = i*90;
        const anchor = i===0?'start':i===4?'end':'middle';
        nodes.push(line('sky-guide',x(bearing),top,x(bearing),bottom),
          text('sky-direction',x(bearing),bottom+19,anchor,dir),
          text('sky-bearing',x(bearing),bottom+33,anchor,bearing+'°'));
      }
    }
    nodes.push(svgNode('path',{d:skyline,class:'sky-horizon'}));

    markerNodes = bodies.map(({key,name}) => {
      const marker = svgNode('g',{class:'sky-object sky-mark-'+key});
      if (key==='sun') {
        for(let i=0;i<8;i++) {
          const ray = line('sky-ray',0,-9,0,-12);
          ray.setAttribute('transform','rotate('+i*45+')');
          marker.append(ray);
        }
      }
      marker.append(svgNode('circle',{r:6.5,class:'sky-disc'}));
      if(key==='earth') marker.append(svgNode('path',{d:'M-4 -4 Q1 -2 -2 5 M1 -6 Q4 -3 6 -1',class:'sky-earth-land'}));
      const tag = svgNode('g',{class:'sky-tag sky-tag-'+key});
      tag.append(svgNode('rect',{width:48,height:21,rx:5}),text('sky-object-name',24,14.5,'middle',name));
      nodes.push(marker,tag);
      return {marker,tag};
    });
    svg.replaceChildren(...nodes);
    lastWidth=width;
    return {x,y,left:x0,right:x1,top,bottom};
  }

  function paintSample(sample) {
    if (!scene || !sample) return;
    const points = bodies.map(({key},i)=>({
      x:scene.x(physical? sample[key+'Az']:i?270:90),
      y:scene.y(sample[key+'Angle']),
      visible:sample[key]
    }));
    const used = [];
    for(const [i,p] of points.entries()) {
      const {marker,tag}=markerNodes[i];
      marker.setAttribute('transform','translate('+p.x+' '+p.y+')');
      marker.classList.toggle('sky-hidden-object',!p.visible);
      // Labels stay in the plot even at the north seam. Resolve the two
      // nameplates independently from the positions of their measured symbols.
      const w=48,h=21;
      const left = n=>Math.max(scene.left,Math.min(scene.right-w,n));
      const top = n=>Math.max(scene.top,Math.min(scene.bottom-h,n));
      const options=[[p.x+15,p.y-h/2],[p.x-w-15,p.y-h/2],
        [p.x-w/2,p.y-h-15],[p.x-w/2,p.y+15],
        [p.x-w/2,p.y-h-40],[p.x-w/2,p.y+40]];
      const taken=[...used,...points.map(q=>({x:q.x-11,y:q.y-11,w:22,h:22}))];
      const candidates=options.map(([sx,sy])=>({x:left(sx),y:top(sy),w,h}));
      const choice=candidates.find(c=>taken.every(rect=>
        c.x+w+2<=rect.x || rect.x+rect.w+2<=c.x ||
        c.y+h+2<=rect.y || rect.y+rect.h+2<=c.y)) || candidates[0];
      used.push(choice);
      tag.setAttribute('transform','translate('+choice.x+' '+choice.y+')');
    }
  }

  const motion = window.createLunarSkyMotion(paintSample);
  function updateEvents(state) {
    const {scenario,hour,sample} = state;
    const timeAt = index => scenario.start + index*hourMs;
    for (const {key,name,status,rows} of cards) {
      status.textContent = sample[key] ? 'Görünür' : 'Ufkun altında';
      const spans = scenario.intervals[key];
      // The window's open-ended final interval is not evidence of an observed loss.
      const loss = spans.find(span => span.end > hour && span.end < scenario.samples.length)?.end;
      const rise = spans.find(span => span.begin > hour)?.begin;
      rows.forEach(({when,absent,clock,label},i) => {
        const index = i ? rise : loss;
        const known = index !== undefined;
        when.hidden = !known; absent.hidden = known; clock.hidden = !known;
        if (!known) {
          absent.textContent = 'Kalan sürede gözlenmedi';
          return;
        }
        const hours = index-hour;
        const bracket = utc.formatRange(new Date(timeAt(index-1)), new Date(timeAt(index))) + ' UTC';
        when.dataset.sample = String(index);
        const duration = hours===1 ? '1 saat içinde' : (hours-1)+'–'+hours+' saat sonra';
        when.textContent = duration + ' →';
        when.setAttribute('aria-label', name+' · '+ label.toLocaleLowerCase('tr-TR') + ', '+duration+'. Sonraki örneğe git.');
        clock.textContent = bracket;
      });
    }
  }

  function render(state) {
    if (!state || state.route !== 'windows') { motion.update(state); return; }
    const {scenario,sample} = state;
    if (!sample || !scenario) {
      figure.querySelector('.sky-flat-key').hidden=true;
      motion.update(state);
      readouts.hidden=true;
      svg.replaceChildren();
      svg.setAttribute('aria-label','Seçilen görev için gökyüzü verisi yok.');
      horizonLabel.textContent='Gökyüzü verisi bekleniyor'; projectionLabel.textContent='';
      displayedScenario=null; scene=null; eventList.hidden=true; note.hidden=true;
      return;
    }
    eventList.hidden=false; note.hidden=false; readouts.hidden=false;
    const width = Math.round(graph.clientWidth);
    if (width < 1) return;
    if (displayedScenario !== scenario) { prepare(state); scene = null; }
    if (!scene || lastWidth !== width) scene = plotBase(width);
    const readings = [];
    bodies.forEach(({key,name},i) => {
      const elevation = sample[key+'Angle'];
      const azimuth = sample[key+'Az'];
      readingNodes[i].level.textContent=signed(elevation);
      const above=sample[key]?'Ufkun üstünde':'Ufkun altında';
      readingNodes[i].state.textContent=above;
      readings.push(name+' '+signed(elevation)+(physical?', azimut '+number.format(azimuth)+'°':'')+', '+(sample[key]?'görünür':'ufkun altında'));
    });
    svg.setAttribute('aria-label',readings.join('. '));
    motion.update(state);
    updateEvents(state);
  }
  window.addEventListener('mission:update',event => render(event.detail));
  new ResizeObserver(()=>render(window.missionConsole?.getState())).observe(graph);
  render(window.missionConsole?.getState());
})();
