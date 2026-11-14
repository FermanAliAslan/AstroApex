/* The atlas keeps exploration separate from the mission until a place is applied. */
(() => {
  'use strict';
  const root = document.getElementById('atlas');
  const stage = root?.querySelector('.globe-stage');
  if (!stage) return;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className || '';
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (label, action, className = '') => {
    const node = make('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const coord = (value, latitude) => Math.abs(value).toLocaleString('tr-TR', {maximumFractionDigits:5}) + '°' + (value === 0 ? '' : ' ' + (latitude ? value < 0 ? 'G' : 'K' : value < 0 ? 'B' : 'D'));
  const fmt = value => value == null ? 'Veri yok' : '%' + value.toLocaleString('tr-TR', {maximumFractionDigits:2});
  const descriptions = {
    'Shackleton Rim': 'Shackleton çevresindeki NASA çalışma bölgesinin merkezi. Krater kenarı ve kutup çevresini birlikte inceleyin.',
    'Connecting Ridge': 'Güney kutbuna yakın NASA çalışma bölgesi. Aydınlanma ve Dünya görüşü katmanlarını aynı merkezde karşılaştırın.',
    'Malapert Massif': 'Kutbun daha uzağındaki NASA çalışma bölgesi. Mevcut 100 km kutup kesitinin dışında kalır.'
  };
  // IAU feature centers, planetographic degrees east, from the USGS Gazetteer.
  const landmarks = [
    {name:'Tycho', type:'Çarpma krateri', lat:-43.30, lon:-11.22, zoom:7, id:6163,
      description:'Kraterin dışına doğru uzanan açık renkli çizgileri takip edin. Bunlar çarpışma sırasında çevreye saçılan malzemenin izleri.'},
    {name:'Mare Imbrium', type:'Lav ovası', lat:34.72, lon:-14.91, zoom:1.9, id:3678, alias:'Yağmurlar Denizi',
      description:'Dağlarla çevrili geniş, koyu düzlüğü bulun. Eski bir çarpma havzasına yayılan lavlar soğuyarak bu ovayı oluşturdu.'},
    {name:'Montes Apenninus', type:'Sıradağ', lat:19.87, lon:0.03, zoom:3.4, id:4004, alias:'Apenin Dağları',
      description:'Imbrium havzasının güneydoğu kenarında kıvrılan dağ sırasını izleyin. Bir yanında koyu renkli ova, öbür yanında engebeli yüksek arazi var.'},
    {name:'Vallis Alpes', type:'Vadi', lat:49.21, lon:3.63, zoom:7.5, id:6290, alias:'Alp Vadisi',
      description:'Ay Alpleri’ni çapraz kesen ince, düz şeridi bulun. İki yamaç arasındaki açık koridor vadinin tabanı.'},
    {name:'Tsiolkovskiy', type:'Çarpma krateri', lat:-20.38, lon:128.97, zoom:6, id:6108, alias:'Tsiolkovsky',
      description:'Ay’ın uzak yüzündeki bu kraterin tabanını koyu lavlar kaplar. Ortadaki açık renkli yükselti, çarpışmada yukarı itilen kayaçlardan oluşur.'},
    {name:'Mare Orientale', type:'Lav ovası', lat:-19.87, lon:-94.67, zoom:2.35, id:3685, alias:'Doğu Denizi',
      description:'Koyu lav ovasından dışarı doğru bakın. Çevresindeki iç içe dağ halkaları, Orientale çarpma havzasının sınırlarını gösterir.'}
  ];
  const landmarkByName = new Map(landmarks.map(place => [place.name, place]));
  const normalizeSearch = text => text.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replaceAll('ı','i');
  let maps = null, selected = null, view = 'globe', loadPromise = null;
  let lastRegion = null, tourIndex = 0;
  let mapZoom = 1, mapX = 0, mapY = 0, drag = null;
  let measuring = false, endpoints = [];
  let cameraView = null;
  let missionSite = null, followMissionOnReturn = false;
  function customPoint(name) {
    if (!name || maps?.sites[name] || landmarkByName.has(name)) return null;
    const point = horizonsCache.coordinates(name);
    if (!point) return null;
    // Same stereographic projection and 100 km extent as mapPoint().
    const r = Math.PI/180;
    const distance = 2*1737.4*Math.tan((90+point.lat)*r/2);
    const x = 50+distance*Math.sin(point.lon*r), y = 50-distance*Math.cos(point.lon*r);
    const inMap = x>=0 && x<=100 && y>=0 && y<=100;
    return {...point,x:inMap?x:null,y:inMap?y:null,custom:true};
  }
  function placePoint(name) {
    return landmarkByName.get(name) || maps?.sites[name] || customPoint(name);
  }
  function pickCoordinate(point) {
    if (measuring) { measure(point); return; }
    const name = horizonsCache.customSite(point.lat,point.lon);
    if (name) selectPlace(name, false);
  }
  root.classList.add('atlas-enhanced');
  const oldLayout = root.querySelector('.s-atlas');
  const globePanel = stage.closest('.s-panel');
  const oldParams = root.querySelector('.s-atlas-params');
  const workspace = make('div', 'atlas-workspace');
  const sidebar = make('aside', 'atlas-sidebar');
  sidebar.setAttribute('aria-label', 'Ay üzerinde yer keşfi');
  const searchBox = make('div', 'atlas-search-box');
  const searchLabel = make('label', 'atlas-search-label', 'Ay’da bir yer bulun');
  const input = make('input', 'atlas-search');
  input.type = 'search'; input.id = 'atlasSearch'; input.placeholder = 'Yer adı veya türüyle ara…'; input.autocomplete = 'off';
  searchLabel.htmlFor = input.id;
  const modes = make('div', 'atlas-discovery-modes');
  modes.setAttribute('role','group'); modes.setAttribute('aria-label','Keşif biçimi');
  const missionMode = button('Görev bölgeleri', () => { input.value = ''; selectPlace(lastRegion); });
  const tourMode = button('Yüzey turu', () => { input.value = ''; selectPlace(landmarks[tourIndex].name); });
  modes.append(missionMode,tourMode);
  searchBox.append(searchLabel, input, modes);
  const results = make('div', 'atlas-results');
  const status = make('p', 'atlas-status', 'Bölge verileri yükleniyor…');
  status.setAttribute('role', 'status');
  const detail = make('section', 'atlas-place-detail');
  detail.setAttribute('aria-label', 'Seçili bölge ayrıntıları');
  const tourCard = make('section','atlas-tour-card');
  tourCard.hidden = true;
  tourCard.setAttribute('aria-label','Yüzey turu durağı');
  const tourHeader = make('div','atlas-tour-header');
  const tourProgress = make('span','atlas-tour-progress');
  const tourNav = make('div','atlas-tour-nav');
  const changeStop = offset => {
    const next = (tourIndex + offset + landmarks.length) % landmarks.length;
    input.value = '';
    selectPlace(landmarks[next].name);
  };
  const prevStop = button('←', () => changeStop(-1)), nextStop = button('→', () => changeStop(1));
  prevStop.setAttribute('aria-label','Önceki durak'); nextStop.setAttribute('aria-label','Sonraki durak');
  tourNav.append(prevStop, nextStop); tourHeader.append(tourProgress, tourNav);
  const tourTitle = make('h2'), tourDescription = make('p','atlas-tour-description');
  const tourSource = make('a','atlas-source-link');
  tourSource.target = '_blank'; tourSource.rel = 'noopener noreferrer';
  tourCard.append(tourHeader, tourTitle, tourDescription, tourSource);
  sidebar.append(searchBox, results, status, tourCard, detail);
  oldLayout.before(workspace);
  workspace.append(sidebar, globePanel);
  globePanel.classList.add('atlas-viewport');
  const contextDetails = make('details', 'atlas-context');
  contextDetails.append(make('summary', '', 'Görev koordinatları ve model bilgisi'), oldParams);
  oldLayout.replaceWith(contextDetails);
  const archivePanel = root.querySelector('.r-map-panel');
  if (archivePanel) {
    const archives = make('details', 'atlas-context');
    archives.append(make('summary', '', 'Katman kaynakları, dönemler ve veri kapsamı'));
    archivePanel.before(archives); archives.append(archivePanel);
  }
  const mapFrame = make('div', 'atlas-map-frame'); mapFrame.hidden = true;
  const fallback = stage.querySelector('.s-map-fallback');
  const flatGuide = make('div','atlas-flat-guide');
  const flatPin = make('i','atlas-flat-pin');
  flatGuide.setAttribute('aria-hidden','true'); flatGuide.append(flatPin);
  fallback.append(flatGuide);
  mapFrame.tabIndex = 0; mapFrame.setAttribute('aria-label', 'Kutup haritası. Yön tuşlarıyla kaydırın, artı ve eksi ile yakınlaştırın.');
  const mapContent = make('div', 'atlas-map-content');
  const image = make('img', 'atlas-map-image'); image.draggable = false;
  const mapPins = make('div', 'atlas-map-pins');
  mapContent.append(image, mapPins); mapFrame.append(mapContent); stage.append(mapFrame);
  const viewBar = make('div', 'atlas-viewbar');
  viewBar.setAttribute('aria-label', 'Atlas görünümü');
  const views = new Map();
  for (const [id, title] of [['globe','3B Ay'],['trek','Yüzey'],['sun','Aydınlanma'],['earth','Dünya görüşü']]) {
    const item = button(title, () => setView(id), 'atlas-layer-button');
    item.dataset.atlasLayer = id; item.setAttribute('aria-pressed', String(id === view));
    views.set(id, item); viewBar.append(item);
  }
  globePanel.prepend(viewBar);
  const overlays = make('div', 'atlas-overlay-tools');
  const ruler = button('↔  Mesafe ölç', () => {
    measuring = !measuring;
    ruler.setAttribute('aria-pressed', String(measuring));
    measurement.hidden = !measuring;
    stage.classList.toggle('atlas-measuring', measuring);
    clearMeasurement();
  }, 'atlas-tool');
  ruler.setAttribute('aria-pressed', 'false');
  const resetMap = button('Görünümü sıfırla', () => {
    if (view === 'globe') window.astroGlobe?.reset();
    else { mapZoom = 1; mapX = 0; mapY = 0; transformMap(); }
  }, 'atlas-tool');
  const lighting = button('Eşit ışık', () => {
    const enabled = lighting.getAttribute('aria-pressed') !== 'true';
    lighting.setAttribute('aria-pressed',String(enabled));
    window.astroGlobe?.setLighting(enabled ? 'atlas' : 'relief');
  }, 'atlas-tool');
  lighting.setAttribute('aria-pressed','false');
  lighting.title = 'Yüzey renklerini karşılaştırmak için yönlü ışığı kapat';
  overlays.append(lighting, ruler, resetMap); stage.append(overlays);
  const measurement = make('div', 'atlas-measurement'); measurement.hidden = true;
  const measureStatus = make('p','atlas-ruler-status');
  measureStatus.setAttribute('role','status');
  const measureActions = make('div','atlas-ruler-actions');
  const addPlace = button('Seçili yeri ekle', () => {
    const point = placePoint(selected);
    if (point) measure(point);
  },'atlas-tool');
  const clearRuler = button('Ölçümü temizle', clearMeasurement, 'atlas-tool');
  measureActions.append(addPlace,clearRuler);
  measurement.append(measureStatus,measureActions); stage.after(measurement);
  const trace = window.createLunarMeasurement(stage);
  const mapControls = make('div', 'atlas-map-controls'); mapControls.hidden = true;
  mapControls.append(button('+', () => zoomMap(1.4), 'atlas-tool'), button('−', () => zoomMap(1 / 1.4), 'atlas-tool'));
  mapControls.children[0].setAttribute('aria-label','Haritayı yakınlaştır');
  mapControls.children[1].setAttribute('aria-label','Haritayı uzaklaştır');
  stage.append(mapControls);
  const mapFooter = make('div', 'atlas-map-footer');
  const layerText = make('span', '', 'LROC yüzey dokusu · 3B görselleştirme');
  const pointerText = make('span', '', 'Sürükle · yakınlaştır · keşfet');
  mapFooter.append(layerText, pointerText); globePanel.append(mapFooter);
  const legend = make('div', 'atlas-mini-legend'); legend.hidden = true;
  stage.append(legend);
  const normalControls = globePanel.querySelector('.s-globe-controls');
  const help = globePanel.querySelector('.s-atlas-help');

  function syncGlobeAvailability() {
    const unavailable = stage.dataset.globeState === 'unavailable';
    const staticView = unavailable && view === 'globe';
    views.get('globe').textContent = unavailable ? '2B Ay' : '3B Ay';
    normalControls.hidden = view !== 'globe' || unavailable;
    help.hidden = normalControls.hidden;
    lighting.hidden = normalControls.hidden;
    if (staticView) {
      document.getElementById('globeStatus').textContent = '2B yüzey haritası · Halka seçili yeri gösterir.';
    }
    drawMeasurement();
  }
  new MutationObserver(syncGlobeAvailability).observe(stage,{attributes:true,attributeFilter:['data-globe-state']});

  function transformMap() {
    const max = (mapZoom - 1) * mapContent.offsetWidth / 2;
    mapX = Math.max(-max, Math.min(max, mapX)); mapY = Math.max(-max, Math.min(max, mapY));
    mapContent.style.transform = `translate(${mapX}px, ${mapY}px) scale(${mapZoom})`;
    mapContent.style.setProperty("--atlas-pin-scale", 1 / mapZoom);
    pointerText.textContent = `${mapZoom.toFixed(1)}× · 100 × 100 km kesit · 512 px önizleme`;
    drawMeasurement();
  }
  function zoomMap(factor) { mapZoom = Math.max(1, Math.min(6, mapZoom * factor)); transformMap(); }
  function setView(id) {
    view = id;
    for (const [key, node] of views) node.setAttribute('aria-pressed', String(id === key));
    const isMap = id !== 'globe';
    stage.classList.toggle('atlas-raster-active', isMap);
    mapFrame.hidden = !isMap; mapControls.hidden = !isMap; resetMap.hidden = !isMap; pointerText.hidden = !isMap;
    syncGlobeAvailability();
    legend.hidden = !isMap || id === 'trek';
    if (isMap && maps) {
      const layer = id === 'trek' ? maps.trekBrowse : maps.layers[id];
      image.src = layer.image; image.alt = `${layer.name}, Ay güney kutbu, 100 × 100 km`;
      layerText.textContent = id === 'trek' ? 'Moon Trek · özgün gri görünüm' : layer.source + ' · ' + layer.period;
      legend.replaceChildren(make('span','','%0'),make('i'),make('span','','%100'));
      if (id !== 'trek') legend.querySelector('i').style.background = `linear-gradient(90deg,${layer.colors.join(',')})`;
      transformMap();
    } else {
      layerText.textContent = 'NASA SVS · LROC yüzey rengi / LOLA yükseklikleri';
    }
    if (isMap && landmarkByName.has(selected)) {
      input.value = '';
      selectPlace(lastRegion);
    } else if (selected) renderDetail();
  }
  function selectPlace(name, fly = true) {
    if (!maps) return;
    const landmark = landmarkByName.get(name);
    const loc = placePoint(name);
    if (!loc) return;
    const updateMarkers = name !== selected;
    selected = name;
    if (landmark) {
      tourIndex = landmarks.indexOf(landmark);
      if (view !== 'globe') setView('globe');
    } else lastRegion = name;
    if (updateMarkers) window.astroGlobe?.setMarkers([{name,...loc}]);
    flatPin.style.left = (loc.lon+180)/360*100 + '%';
    flatPin.style.top = (90-loc.lat)/180*100 + '%';
    fallback.setAttribute('aria-label','Ay yüzeyinin düz haritası. İşaretli yer: '+name);
    addPlace.setAttribute('aria-label','Seçili yeri ekle: '+name);
    addPlace.title = name;
    renderResults(); renderPins(); renderDetail();
    if (fly) window.astroGlobe?.flyTo({name,...loc});
    if (fly && view !== 'globe' && loc.x != null) {
      mapZoom = Math.max(2,mapZoom);
      const size = mapContent.offsetWidth;
      mapX = -(loc.x / 100 - .5) * size * mapZoom;
      mapY = -(loc.y / 100 - .5) * size * mapZoom;
      transformMap();
    }
  }
  function renderResults() {
    if (!maps) return;
    const query = normalizeSearch(input.value.trim());
    const onTour = landmarkByName.has(selected);
    missionMode.setAttribute('aria-pressed',String(!onTour));
    tourMode.setAttribute('aria-pressed',String(onTour));
    const regions = Object.entries(maps.sites).map(([name,loc]) => ({name,...loc,type:'NASA çalışma bölgesi'}));
    for (const name of new Set([selected,missionSite])) {
      const point = customPoint(name);
      if (point) regions.unshift({name,...point,type:name===missionSite?'Görev konumu':'Seçili koordinat'});
    }
    const options = query ? [...regions,...landmarks].filter(place => normalizeSearch([place.name,place.alias,place.type].join(' ')).includes(query)) : onTour ? [] : regions;
    results.hidden = !options.length;
    const previousFocus = results.contains(document.activeElement) ? document.activeElement.dataset.place : null;
    results.replaceChildren(...options.map(place => {
      const item = button('', () => selectPlace(place.name), 'atlas-result');
      item.dataset.place = place.name;
      item.setAttribute('aria-pressed', String(selected === place.name));
      const symbol = make('span','atlas-result-symbol',landmarkByName.has(place.name) ? '◉' : '⌖');
      symbol.setAttribute('aria-hidden','true');
      item.append(symbol,make('span','atlas-result-copy',place.name));
      item.lastChild.append(make('small','',place.type + ' · ' + coord(place.lat,true)));
      return item;
    }));
    if (previousFocus) Array.from(results.children).find(item => item.dataset.place === previousFocus)?.focus({preventScroll:true});
    status.textContent = query ? options.length ? options.length+' yer bulundu' : 'Eşleşen yer yok. Başka bir ad veya tür deneyin.' : onTour ? selected + ' · ' + (tourIndex+1) + '. durak' : regions.some(place=>place.custom) ? regions.length+' konum' : regions.length + ' çalışma bölgesi · Ay güney kutbu';
    status.classList.toggle('atlas-status-sr',onTour && !query);
  }
  function renderPins() {
    const entries = Object.entries(maps.sites);
    const custom = customPoint(selected);
    if (custom) entries.push([selected,custom]);
    mapPins.replaceChildren(...entries.filter(([,p]) => p.x != null).map(([name,loc]) => {
      const pin = button('', event => { event.stopPropagation(); if (measuring) measure(loc); else selectPlace(name); }, 'atlas-location');
      pin.classList.toggle('is-selected', selected === name);
      pin.setAttribute('aria-label', loc.custom?'Seçili konum · '+name:name + ' bölgesini seç');
      pin.style.left = loc.x + '%'; pin.style.top = loc.y + '%';
      pin.append(make('span','atlas-location-dot'),make('span','atlas-location-name',loc.custom?'Seçili konum':name));
      return pin;
    }));
  }
  function renderDetail() {
    const landmark = landmarkByName.get(selected);
    detail.hidden = !!landmark;
    tourCard.hidden = !landmark;
    if (landmark) {
      tourProgress.textContent = (tourIndex+1) + ' / ' + landmarks.length + ' · ' + landmark.type;
      tourTitle.textContent = landmark.name;
      tourDescription.textContent = landmark.description;
      tourSource.textContent = coord(landmark.lat,true) + ' · ' + coord(landmark.lon,false) + ' ↗';
      tourSource.href = 'https://planetarynames.wr.usgs.gov/Feature/' + landmark.id;
      tourSource.setAttribute('aria-label', tourSource.textContent + ' · ' + landmark.name + ', IAU ve USGS kaydı');
      return;
    }
    const loc = placePoint(selected);
    const title = make('h2','',selected);
    const coordinates = make('p','atlas-coordinates',coord(loc.lat,true) + ' · ' + coord(loc.lon,false));
    if (loc.custom) {
      title.textContent = selected === missionSite ? 'Görev konumu' : 'Seçili konum';
      const current = window.missionConsole?.getState()?.plan;
      const label = current?.dataMode==='demo' ? 'Horizons ile burada görev planla →' : 'Bu konumda görev planla →';
      const apply = button(label,() => {
        const planner = window.missionConsole;
        planner.setPlan({dataMode:'horizons',site:selected});
        if (planner.getState().plan.site===selected) planner.navigate('plan');
      },'atlas-plan-button');
      const context = make('p','atlas-data-note',view!=='globe' && loc.x==null
        ? 'Bu koordinat güney kutbu kesitinin dışında.' : 'Bu koordinatın Güneş ve Dünya görünürlüğünü görev planında inceleyin.');
      detail.replaceChildren(title,coordinates,context,apply);
      return;
    }
    const text = make('p','atlas-description',descriptions[selected]);
    const metrics = make('dl','atlas-place-metrics');
    for (const [label,value,note] of [
      ['Aydınlanma',fmt(loc.sun),'WAC · 2010–2011 gözlemleri'],
      ['Dünya görünürlüğü',fmt(loc.earth),'LOLA · 18,6 yıllık ortalama']
    ]) {
      const pair = make('div'), definition = make('dd','',value); definition.append(make('small','',note)); pair.append(make('dt','',label),definition); metrics.append(pair);
    }
    const note = make('p','atlas-data-note','Bölge merkezine en yakın kaynak pikseli. Tarihli görev tahminleri için görev planını kullanın.');
    if (view !== 'globe' && loc.x == null) note.prepend(make('strong','','Bu bölge mevcut kutup kesitinin dışında. '));
    const actions = make('div','atlas-place-actions');
    const apply = button('Bu bölgede görev planla →', () => {
      const field = document.getElementById('site');
      if (!Array.from(field.options).some(o => o.value === selected && !o.disabled)) return;
      field.value = selected; field.dispatchEvent(new Event('change',{bubbles:true}));
      location.hash = 'plan';
    },'atlas-plan-button');
    actions.append(apply);
    const source = make('a','atlas-source-link','NASA bölge koordinatları ↗');
    source.href = 'https://ntrs.nasa.gov/citations/20230007818'; source.target = '_blank'; source.rel = 'noopener noreferrer';
    const coverage = make('small','atlas-point-note','İşaret, çalışma bölgesinin merkezini gösterir.');
    detail.replaceChildren(make('span','atlas-place-kicker','KEŞFEDİLEN BÖLGE'),title,coordinates,text,metrics,note,actions,source,coverage);
  }
  function mapPoint(event) {
    const rect = image.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    const east = (x - .5) * 100, north = (.5 - y) * 100;
    return {lat:-90 + 2 * Math.atan(Math.hypot(east,north) / (2 * 1737.4)) * 180 / Math.PI,
      lon:Math.atan2(east,north) * 180 / Math.PI};
  }
  function measure(point) {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon) || Math.abs(point.lat)>90) return;
    if (endpoints.length === 2) endpoints = [];
    endpoints.push({lat:point.lat,lon:point.lon});
    const route=trace.setEndpoints(endpoints);
    clearRuler.disabled=false;
    if (route) {
      const distance = route.km>0 && route.km<1
        ? (route.km*1000).toLocaleString('tr-TR',{maximumFractionDigits:1})+' m'
        : route.km.toLocaleString('tr-TR',{maximumFractionDigits:1})+' km';
      measureStatus.textContent = 'A → B · '+distance+' · Ay küresindeki en kısa yay. Arazi eğimi hesaba katılmaz.'+
        (route.antipodal?' Karşıt noktalar için eşit uzunluktaki yaylardan biri gösterilir.':'');
    } else measureStatus.textContent='A seçildi. B için ikinci konumu seçin.';
    drawMeasurement();
  }
  function clearMeasurement() {
    endpoints=[];
    trace.setEndpoints(endpoints);
    clearRuler.disabled=true;
    measureStatus.textContent='A ve B için yüzeyde iki noktaya dokunun veya seçili yeri ekleyin.';
    drawMeasurement();
  }
  function drawMeasurement() {
    if (view!=='globe') trace.draw('polar',mapContent);
    else if (stage.dataset.globeState==='unavailable') trace.draw('flat',flatGuide);
    else trace.draw('globe',stage.querySelector('#moonGlobe'),cameraView);
  }
  window.addEventListener('astro:camera',e=>{
    cameraView=e.detail;
    if (measuring && view==='globe') drawMeasurement();
  });
  new ResizeObserver(()=>{if(measuring)drawMeasurement()}).observe(stage);
  fallback.addEventListener('click',e=>{
    const rect=flatGuide.getBoundingClientRect();
    const x=(e.clientX-rect.left)/rect.width, y=(e.clientY-rect.top)/rect.height;
    if (x>=0 && x<=1 && y>=0 && y<=1) pickCoordinate({lat:90-180*y,lon:360*x-180});
  });
  stage.querySelector('#moonGlobe').addEventListener('keydown',e=>{
    if (e.key==='Enter' && cameraView) {
      e.preventDefault(); pickCoordinate(cameraView);
    }
  });
  mapFrame.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    drag = {id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY}; mapFrame.setPointerCapture(e.pointerId);
  });
  mapFrame.addEventListener('pointermove', e => {
    const point = mapPoint(e);
    if (point) pointerText.textContent = coord(point.lat,true) + ' · ' + coord(point.lon,false);
    if (!drag || drag.id !== e.pointerId) return;
    mapX += e.clientX-drag.x; mapY += e.clientY-drag.y;
    drag.x=e.clientX; drag.y=e.clientY; transformMap();
  });
  mapFrame.addEventListener('pointerup', e => {
    if (drag && Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5) {
      const point = mapPoint(e); if (point) pickCoordinate(point);
    }
    drag = null;
  });
  for (const event of ['pointercancel','lostpointercapture']) mapFrame.addEventListener(event,()=>{drag=null});
  mapFrame.addEventListener('wheel', e => { if (document.activeElement !== mapFrame) return; e.preventDefault(); zoomMap(e.deltaY < 0 ? 1.12 : 1/1.12); },{passive:false});
  mapFrame.addEventListener('keydown', e => {
    if (e.target!==mapFrame) return;
    if (e.key==='Enter') {
      const bounds=mapFrame.getBoundingClientRect();
      const point=mapPoint({clientX:bounds.left+bounds.width/2,clientY:bounds.top+bounds.height/2});
      if (point) pickCoordinate(point);
      e.preventDefault(); return;
    }
    const actions = {'+':()=>zoomMap(1.4),'=':()=>zoomMap(1.4),'-':()=>zoomMap(1/1.4),ArrowLeft:()=>{mapX+=35},ArrowRight:()=>{mapX-=35},ArrowUp:()=>{mapY+=35},ArrowDown:()=>{mapY-=35}};
    if (actions[e.key]) { e.preventDefault(); actions[e.key](); transformMap(); }
  });
  input.addEventListener('input',renderResults);
  input.addEventListener('keydown', e => { if(e.key==='Escape') {input.value='';renderResults();} if(e.key==='ArrowDown') {e.preventDefault();results.querySelector('button')?.focus();} });
  window.addEventListener('astro:place', e => { if(measuring) measure(e.detail); else selectPlace(e.detail.name,false); });
  window.addEventListener('astro:mission-focus', e => {
    const point = e.detail;
    if (!placePoint(point?.name)) return;
    input.value = '';
    selectPlace(point.name, false);
    window.astroGlobe?.setMarkers([point]);
  });
  window.addEventListener('astro:coordinate',e=>{
    pointerText.textContent=coord(e.detail.lat,true)+' · '+coord(e.detail.lon,false);
    pickCoordinate(e.detail);
  });
  async function load() {
    if (maps || loadPromise) return;
    loadPromise = fetch('assets/resources-maps.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{
      maps=data;
      const initialSite = missionSite || document.getElementById('site').value;
      selectPlace(placePoint(initialSite) ? initialSite : Object.keys(maps.sites)[0],!!customPoint(initialSite));
      setView(view);
    }).catch(()=>{status.textContent='Bölge verileri yüklenemedi.'; results.replaceChildren(button('Yeniden dene',()=>{loadPromise=null;load()},'atlas-tool'));});
  }
  window.addEventListener('mission:update',e=>{
    const nextSite = e.detail.plan.site;
    if (missionSite && nextSite !== missionSite) followMissionOnReturn = true;
    missionSite = nextSite;
    if(e.detail.route === 'atlas') {
      load();
      if(maps && followMissionOnReturn && placePoint(nextSite)) {
        selectPlace(nextSite,true);
        followMissionOnReturn = false;
      }
    }
  });
  new ResizeObserver(()=>{if(view!=='globe')transformMap()}).observe(mapFrame);
  load();
})();
