// One mission clock drives the map readouts, charts and sky view.
(() => {
  'use strict';
  const card = document.querySelector('#plan .terrain-image');
  const mission = window.missionConsole;
  if (!card || !mission) return;
  const atlasLink = card.querySelector('.photo-action');
  card.id = 'planSurface';
  card.classList.add('plan-surface');
  card.innerHTML = `
    <div class="plan-map">
      <div class="plan-map-sheet" aria-hidden="true"><i class="plan-map-marker"></i></div>
      <header><h2></h2><span class="plan-coordinates"></span></header>
      <div class="plan-map-caption"><a class="plan-credit" target="_blank" rel="noopener noreferrer"></a><span class="plan-scale"></span></div>
    </div>
    <div class="plan-sample">
      <div class="plan-clock-line"><label for="planSurfaceHour">Görev saati</label><time id="planSurfaceClock"></time></div>
      <div class="plan-transport"><button id="planSurfacePlay" type="button" aria-label="Görev saatini oynat" aria-pressed="false" disabled></button><input type="range" id="planSurfaceHour" min="0" max="0" value="0" step="1" disabled></div>
      <div class="plan-bodies"><span class="plan-sun-state"></span><span class="plan-earth-state"></span></div>
      <div class="plan-actions"><button id="planSurfaceNext" type="button">Sonraki değişim →</button><a id="planSurfaceSky" href="#windows">Gökyüzünde aç ↗</a></div>
    </div>`;
  const get = selector => card.querySelector(selector);
  const title = get('h2'), location = get('.plan-coordinates'), map = get('.plan-map-sheet');
  const credit = get('.plan-credit'), scale = get('.plan-scale');
  const clock = get('#planSurfaceClock'), scrub = get('#planSurfaceHour');
  const play = get('#planSurfacePlay');
  const sun = get('.plan-sun-state'), earth = get('.plan-earth-state');
  const next = get('#planSurfaceNext'), sky = get('#planSurfaceSky');
  atlasLink.className = 'plan-atlas';
  atlasLink.textContent = '3B atlas ↗';
  get('.plan-map').append(atlasLink);
  const relief = ['Shackleton Rim','Connecting Ridge','Malapert Massif'];
  const clockFormat = new Intl.DateTimeFormat('tr-TR',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const decimal = new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2});
  let lastSite, lastMode, lastScenario, changes = [], jump = null;

  function renderMap(plan) {
    if (lastSite===plan.site && lastMode===plan.dataMode) return;
    lastSite=plan.site;
    lastMode=plan.dataMode;
    const index=relief.indexOf(plan.site), point=horizonsCache.coordinates(plan.site);
    title.textContent = index>=0 || !point ? plan.site : 'Özel iniş sahası';
    location.textContent = point ? decimal.format(Math.abs(point.lat))+'° '+(point.lat<0?'G':'K')+' · '+decimal.format(Math.abs(point.lon))+'° '+(point.lon<0?'B':'D') : 'Temsili saha';
    card.dataset.background = index>=0 ? 'regional' : point ? 'global' : 'demo';
    atlasLink.hidden = !point;
    credit.hidden = !point;
    scale.hidden=index<0;
    if (index>=0) {
      map.style.backgroundPositionX=index*50+'%';
      map.style.setProperty('--pin-x','50%');map.style.setProperty('--pin-y','50%');
      credit.href='https://pgda.gsfc.nasa.gov/products/90';credit.textContent='LOLA · Arazi kabartması ↗';
      scale.textContent='10 km';
    } else if (point) {
      map.style.backgroundPositionX='center';
      map.style.setProperty('--pin-x',((point.lon+180)/360*100)+'%');
      map.style.setProperty('--pin-y',((90-point.lat)/180*100)+'%');
      credit.href='https://svs.gsfc.nasa.gov/4720/';credit.textContent='LROC · Ay yüzeyi ↗';
    }
  }
  function render(state) {
    if (state.route!=='plan') return;
    const {plan,scenario,sample,hour}=state;
    renderMap(plan);
    if (lastScenario!==scenario) {
      lastScenario=scenario;
      changes=[];
      if (scenario) for(let i=1;i<scenario.samples.length;i++) {
        const a=scenario.samples[i-1], b=scenario.samples[i];
        if(a.sun!==b.sun || a.earth!==b.earth) changes.push(i);
      }
    }
    const ready=!!(sample && scenario);
    scrub.disabled=!ready;
    play.disabled=!ready;
    showPlaying(state.isPlaying);
    scrub.max=ready?String(scenario.samples.length-1):'0';
    scrub.value=ready?String(hour):'0';
    scrub.style.setProperty('--elapsed',ready?(hour/Math.max(1,scenario.samples.length-1)*100)+'%':'0%');
    const time=ready?new Date(scenario.start+hour*3600000):null;
    clock.textContent=time?clockFormat.format(time)+' UTC':'Saat verisi yok';
    if(time)clock.dateTime=time.toISOString();else clock.removeAttribute('datetime');
    scrub.setAttribute('aria-valuetext',clock.textContent);
    sun.dataset.visible=String(ready && sample.sun);
    earth.dataset.visible=String(ready && sample.earth);
    sun.textContent=ready?(sample.sun?'Güneş görünür':'Güneş ufkun altında'):'Güneş: veri yok';
    earth.textContent=ready?(sample.earth?'Dünya görünür':'Dünya ufkun altında'):'Dünya: veri yok';
    jump=ready?changes.find(i=>i>hour):undefined;
    next.disabled=jump===undefined;
    next.textContent=!ready?'Sonraki değişim →':jump===undefined?'Kalan sürede değişim yok':'Sonraki değişim →';
    sky.hidden=!ready;
  }
  function showPlaying(playing) {
    const on=!!playing;
    play.setAttribute('aria-pressed', String(on));
    play.title=on?'Görev saatini duraklat':'Görev saatini oynat';
    play.setAttribute('aria-label',play.title);
  }
  play.addEventListener('click',()=>mission.setPlayback(!mission.getState().isPlaying));
  window.addEventListener('mission:playback',e=>showPlaying(e.detail.playing));
  scrub.addEventListener('input',()=>mission.setHour(Number(scrub.value)));
  next.addEventListener('click',()=>{if(jump!==undefined)mission.setHour(jump);});
  sky.addEventListener('click',e=>{
    if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    e.preventDefault();mission.navigate('windows');
    const target=document.getElementById('landerSky');
    if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
  });
  window.addEventListener('mission:update',e=>render(e.detail));
  render(mission.getState());
})();
