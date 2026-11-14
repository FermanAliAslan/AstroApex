/* Two independently editable mission scenarios share the planner's calculation engine. */
(() => {
  'use strict';
  const view = document.getElementById('compare');
  const mission = window.missionConsole;
  if (!view || !mission) return;
  const labels = { a:'A', b:'B' };
  const dayMs = 86400000;
  const sourceSelect = document.getElementById('dataMode');
  const legacyHead = view.querySelector('.s-heading');
  const pin = document.getElementById('pin');
  const initial = mission.getState();
  let focusArm = null;
  let openingSky = false;
  let previousMode;
  let previousPlan;
  let pinnedKey;
  let currentSummary = null;
  let lastSignature;
  let evaluation = null;
  let undoDraft = null;
  let lastAction = null;
  let resultAnimation;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const arms = {};
  const records = {};
  const edited = {};
  const metrics = [
    ['overlap','Güneş ve Dünya birlikte', s => s.overlapHours],
    ['sun','Güneş görünür', s => s.sunHours],
    ['earth','Dünya görünür', s => s.intervals.earth.reduce((sum,r)=>sum+r.end-r.begin,0)],
    ['dark','En uzun kesintisiz karanlık', s => s.longestDark]
  ];
  const iso = time => new Date(time).toISOString().slice(0,10);
  const hourFormat = new Intl.NumberFormat('tr-TR',{maximumFractionDigits:1});
  const el = (tag,cls,text) => {
    const n=document.createElement(tag);
    if (cls) n.className=cls;
    if (text!==undefined) n.textContent=text;
    return n;
  };
  const panel=el('div','cmp-workbench');
  const sourceLabel=el('label','cmp-source');
  sourceLabel.htmlFor='cmp-source';
  const sourceProxy=el('select');
  sourceProxy.id='cmp-source';
  for (const opt of sourceSelect.options) sourceProxy.add(new Option(opt.textContent,opt.value));
  sourceLabel.append(el('span','','Hesap kaynağı'),sourceProxy);
  const panels=el('div','cmp-editors');
  const result=el('section','cmp-result');
  result.setAttribute('aria-labelledby','cmp-verdict');
  const verdict=el('h2');
  verdict.id='cmp-verdict';
  const note=el('p','cmp-result-note');
  const rows=el('tbody');
  const timeline=el('div','cmp-timelines');
  timeline.setAttribute('aria-label','Görev başlangıcından itibaren ortak görüş saatleri');
  const table=el('table','cmp-table');
  table.setAttribute('aria-label','A ve B senaryolarının süreleri, saat');
  const thead=table.createTHead().insertRow();
  for (const title of ['Ölçüm (saat)','A','B','B − A']) {
    const th=el('th','',title);
    th.scope='col';
    thead.append(th);
  }
  const siteLabels = [1,2].map(i=>{
    const label=el('span','cmp-column-site');
    thead.cells[i].append(label);
    return label;
  });
  thead.cells[3].setAttribute('aria-label','Fark: B eksi A');
  table.append(rows);
  const resultHead=el('div','cmp-result-head');
  resultHead.append(el('span','cmp-caption','Ortak görüş'),verdict,note);
  result.append(resultHead,timeline,table);
  const tryBar = el('section','cmp-try');
  const tryTitle = el('h2','cmp-try-title','A’yı B’de dene');
  tryTitle.id = 'cmp-try-title';
  tryBar.setAttribute('aria-labelledby',tryTitle.id);
  const tryControls = el('div','cmp-try-controls');
  function tryButton(id, label, action) {
    const button = el('button','cmp-try-button',label);
    button.id = id;
    button.type = 'button';
    button.addEventListener('click',action);
    tryControls.append(button);
    return button;
  }
  const delayButton = tryButton('cmp-delay-btn','Aynı saha · 7 gün sonra',()=>applyAlternative('date'));
  const siteButton = tryButton('cmp-site-btn','Aynı tarih · Başka saha',()=>applyAlternative('site'));
  const undoButton = tryButton('cmp-undo-btn','Geri al',undoAlternative);
  undoButton.hidden = true;
  undoButton.setAttribute('aria-label','Önceki B senaryosunu geri getir');
  const tryStatus = el('p','cmp-try-status');
  tryStatus.setAttribute('role','status');
  tryBar.append(tryTitle,tryControls,tryStatus);
  panel.append(panels,tryBar,result);
  legacyHead.after(panel);
  legacyHead.append(sourceLabel);
  document.body.classList.add('has-compare-workbench');

  // Keep the original pinned-plan and site ranking tools accessible on demand.
  const legacy=el('details','cmp-legacy');
  const legacySummary=el('summary','','Görev konsolundaki plan ve saha sıralaması');
  const legacyTools=el('div','cmp-legacy-tools');
  legacyTools.append(el('span','','Konsolda açık olan görevi A senaryosuna kopyalayın.'),pin);
  legacy.append(legacySummary,legacyTools);
  for(const block of [...view.children]) {
    if(block!==legacyHead && block!==panel) legacy.append(block);
  }
  view.append(legacy);
  const pinShortcut=el('button','cmp-copy','Konsol planını A’ya al');
  pinShortcut.type='button';
  pinShortcut.addEventListener('click',()=>mission.pin());

  function field(key,arm,title,type) {
    const label=el('label','cmp-field cmp-field-'+key);
    const input=el(type==='select'?'select':'input');
    input.id='cmp-'+arm+'-'+key;
    label.htmlFor=input.id;
    if(type==='select') input.setAttribute('aria-label', labels[arm]+' senaryosu · '+title);
    else input.type=type;
    label.append(el('span','',title),input);
    return {label,input};
  }

  function makeEditor(arm) {
    const card=el('section','cmp-card cmp-'+arm);
    const title=el('h2','cmp-caption','Senaryo '+labels[arm]);
    title.id='cmp-'+arm+'-heading';
    card.setAttribute('aria-labelledby',title.id);
    const heading=el('div','cmp-card-heading');
    heading.append(title);
    if (arm==='a') heading.append(pinShortcut);
    const fields={};
    for (const [key,title,type] of [
      ['site','İniş sahası','select'],['date','Başlangıç · UTC','date'],['days','Görev süresi','select'],
      ['horizon','Yerel ufuk','select'],['lat','Enlem (°)','number'],['lon','Doğu boylamı (°)','number'],['angle','Ufuk eşiği (°)','number']
    ]) fields[key]=field(key,arm,title,type);
    for(const [key,min,max] of [['lat',-90,90],['lon',-180,180],['angle',0,20]]){
      const input=fields[key].input;
      input.min=min;input.max=max;input.step=key==='angle'?'1':'any';input.required=true;
    }
    fields.date.input.required=true;
    for(const [value,label] of [['flat','Düz ufuk · 0°'],['manual','Sabit açı'],['dem','Yerel arazi · LOLA']]) {
      fields.horizon.input.add(new Option(label,value));
    }
    const coordinates=el('div','cmp-coordinate-fields');
    coordinates.append(fields.lat.label,fields.lon.label);
    const dateLine=el('div','cmp-date-fields');
    dateLine.append(fields.date.label,fields.days.label);
    const horizonLine=el('div','cmp-horizon-fields');
    horizonLine.append(fields.horizon.label,fields.angle.label);
    const sky=el('button','cmp-sky','Gökyüzünü incele →');
    sky.type='button';sky.id='cmp-'+arm+'-sky';
    sky.setAttribute('aria-label',labels[arm]+' senaryosunun gökyüzünü incele');
    const status=el('p','cmp-state');status.setAttribute('role','status');
    card.append(heading,fields.site.label,coordinates,dateLine,horizonLine,status,sky);
    panels.append(card);
    const editor=Object.fromEntries(Object.entries(fields).map(([key,f])=>[key,f.input]));
    Object.assign(editor,{coordinates,angleLabel:fields.angle.label,sky,status});
    for(const key of Object.keys(fields)) {
      editor[key].addEventListener('change',()=>{
        clearAlternative();
        edited[arm]=true;
        if (key==='site' && editor.site.value==='custom' && editor.lat.value==='') {
          editor.lat.value='-89.5';editor.lon.value='0';
        }
        if(key==='horizon' && editor.horizon.value==='manual' && Number(editor.angle.value)===0) editor.angle.value='2';
        if(key==='site'||key==='lat'||key==='lon') updateTerrain(editor);
        render();
      });
    }
    sky.addEventListener('click',()=>openSky(arm,0));
    return editor;
  }

  function openSky(arm,hour=0) {
    if(!arms[arm] || !Number.isInteger(hour)) return;
    const current=read(arm);
    if(!current.scenario || hour<0 || hour>=current.scenario.samples.length) return;
    focusArm=arm;
    openingSky=true;
    try {
      mission.setPlan(current.plan);
      mission.setHour(hour);
      mission.navigate('windows');
    } finally {
      openingSky=false;
    }
    const skyView=document.getElementById('landerSky');
    if(skyView) {skyView.tabIndex=-1;skyView.focus({preventScroll:true});skyView.scrollIntoView({block:'start'});}
  }

  function siteFor(editor) {
    if(editor.site.value!=='custom') return editor.site.value;
    if(!editor.lat.validity.valid||!editor.lon.validity.valid) return null;
    return horizonsCache.customSite?.(editor.lat.valueAsNumber,editor.lon.valueAsNumber) ?? null;
  }
  function updateTerrain(editor) {
    const supported=sourceProxy.value==='horizons' && !!window.lunarHorizon?.has(siteFor(editor));
    const option=editor.horizon.querySelector('option[value="dem"]');
    option.disabled=!supported;
    if(!supported && editor.horizon.value==='dem') editor.horizon.value='flat';
  }
  function updateOptions(editor,mode) {
    const names=mode==='horizons'?horizonsCache.names:Object.keys(sites);
    editor.site.replaceChildren(...names.map(name=>new Option(name,name)));
    if(mode==='horizons') {
      const custom = new Option('Özel koordinatlar…','custom');
      editor.site.add(custom);
    }
    const days=Array.from(document.getElementById('days').options).filter(opt=>!opt.disabled);
    editor.days.replaceChildren(...days.map(opt=>new Option(opt.textContent,opt.value)));
    editor.date.min=mode==='horizons'?iso(horizonsCache.start):'';
  }
  function setFields(arm,plan) {
    const e=arms[arm];
    const has=[...e.site.options].some(opt=>opt.value===plan.site);
    if(!has && plan.dataMode==='horizons'){
      const coords=horizonsCache.coordinates?.(plan.site);
      e.site.value='custom';
      e.lat.value=coords?.lat ?? '';e.lon.value=coords?.lon ?? '';
    }else e.site.value=plan.site;
    e.date.value=plan.date;e.days.value=String(plan.days);
    e.angle.value=plan.terrain ?? 0;
    e.horizon.value=plan.horizonMode==='dem'?'dem':plan.terrain>0?'manual':'flat';
    updateTerrain(e);
  }
  function read(arm) {
    const e=arms[arm], mode=sourceProxy.value;
    updateTerrain(e);
    e.coordinates.hidden=e.site.value!=='custom';
    e.angleLabel.hidden=e.horizon.value!=='manual';
    const days=Number(e.days.value);
    e.date.max=mode==='horizons'?iso(horizonsCache.end-days*dayMs):'';
    const site=siteFor(e);
    const manual=e.horizon.value==='manual';
    let issue='';
    if(!site) issue='Geçerli enlem (−90…90°) ve boylam (−180…180°) girin.';
    else if(!e.date.validity.valid) issue=mode==='horizons'?'Başlangıç tarihini '+e.date.min+' – '+e.date.max+' aralığından seçin.':'Geçerli bir başlangıç tarihi girin.';
    else if(manual && !e.angle.validity.valid) issue='0–20° arasında tam sayı girin.';
    const plan={...mission.getState().plan,dataMode:mode,site,date:e.date.value,days,
      terrain:manual?e.angle.valueAsNumber:0,horizonMode:e.horizon.value==='dem'?'dem':'manual'};
    let scenario=null;
    if(!issue) {
      scenario=mission.evaluate(plan);
      if(!scenario) issue=mode==='horizons' && !horizonsCache.ready?document.getElementById('sourceNotice').textContent:'Bu görev için hesaplanabilir veri yok.';
    }
    e.status.textContent=issue;e.status.hidden=!issue;e.sky.disabled=!scenario;
    return {plan,scenario};
  }

  function band(arm,scenario,maxHours) {
    const row=el('div','cmp-timeline');
    const label=el('span','cmp-arm-letter',labels[arm]);
    const rail=el('div','cmp-band-track');
    const span=el('div','cmp-band-span');
    span.style.width=100*scenario.samples.length/maxHours+'%';
    for(const run of scenario.intervals.overlap) {
      const segment=el('i');
      segment.style.left=100*run.begin/scenario.samples.length+'%';
      segment.style.width=100*(run.end-run.begin)/scenario.samples.length+'%';
      span.append(segment);
    }
    rail.append(span);
    const hours=el('strong','',scenario.overlapHours+' sa');
    row.append(label,rail,hours);
    return row;
  }
  function resultRow(key,title,readValue,a,b) {
    const tr=el('tr');tr.id='cmp-metric-'+key;
    const head=el('th','',title);head.scope='row';
    const x=readValue(a),y=readValue(b),d=y-x;
    tr.append(head,el('td','',hourFormat.format(x)),el('td','',hourFormat.format(y)),
      el('td','cmp-delta',(d<0?'−':d>0?'+':'')+hourFormat.format(Math.abs(d))));
    return tr;
  }
  function render() {
    const a=read('a'), b=read('b');
    evaluation = {a,b};
    siteButton.textContent='Aynı tarih · '+nextSite(a.plan.site,b.plan.site);
    delayButton.disabled = siteButton.disabled = !a.scenario;
    if(!a.scenario || !b.scenario) {
      currentSummary=null;
      verdict.textContent='Karşılaştırma için iki geçerli senaryo seçin.';
      note.textContent='';rows.replaceChildren();if(!window.astroWindowLens) timeline.replaceChildren();table.hidden=true;
      notifyComparisonChange();
      return;
    }
    const x=a.scenario,y=b.scenario,delta=y.overlapHours-x.overlapHours;
    const differentLength=a.plan.days!==b.plan.days;
    const hours=Math.abs(delta);
    const winner=delta>0?'B':'A';
    const difference=hours?winner+' senaryosunda '+hourFormat.format(hours)+' saat daha fazla ortak görüş':'İki senaryoda ortak görüş eşit';
    verdict.textContent=difference;
    const source=sourceProxy.value==='demo'?'Temsili hesap. ':'';
    const share=scenario=>hourFormat.format(100*scenario.overlapHours/scenario.samples.length);
    const durationNote=differentLength?'Görev süreleri farklı. Ortak görüş A süresinin %'+share(x)+', B süresinin %'+share(y)+' kadarını kapsıyor. ':'';
    note.textContent=source+durationNote+
      'Güneş ve Dünya aynı anda yerel ufkun üzerindeyken geçen süre.';
    currentSummary=difference+'. A: '+a.plan.site+', '+a.plan.date+', '+x.overlapHours+'/'+(a.plan.days*24)+
      ' saat. B: '+b.plan.site+', '+b.plan.date+', '+y.overlapHours+'/'+(b.plan.days*24)+' saat.'+
      (differentLength?' '+durationNote.trim():'');
    if(!window.astroWindowLens) {
      const endHours=Math.max(x.samples.length,y.samples.length);
      const axis=el('div','cmp-axis');
      axis.append(el('span','','Başlangıç'),el('span','',endHours/24+'. gün sonu'));
      timeline.replaceChildren(band('a',x,endHours),band('b',y,endHours),axis);
    }
    siteLabels[0].textContent=a.plan.site;
    siteLabels[1].textContent=b.plan.site;
    table.hidden=false;
    rows.replaceChildren(...metrics.map(([key,title,fn])=>resultRow(key,title,fn,x,y)));
    notifyComparisonChange();
  }

  function draft(arm) {
    const e=arms[arm];
    return Object.fromEntries(['site','lat','lon','date','days','angle','horizon'].map(k=>[k,e[k].value]));
  }
  function restoreDraft(arm,fields) {
    const editor=arms[arm];
    for (const [key,value] of Object.entries(fields)) editor[key].value=value;
  }

  function nextSite(site,currentB) {
    const alternatives=horizonsCache.names.filter(name=>name!==site);
    const next=(alternatives.indexOf(currentB)+1)%alternatives.length;
    return alternatives[next];
  }

  function clearAlternative() {
    undoDraft=null;
    undoButton.hidden=true;
    tryStatus.textContent='';
  }

  function signalResult(message) {
    tryStatus.textContent=message;
    resultAnimation?.cancel();
    if(!reduceMotion.matches && result.animate) {
      resultAnimation=result.animate([
        {borderColor:'#ab81ca',boxShadow:'inset 0 0 0 1px #a57bc950'},
        {borderColor:getComputedStyle(result).borderColor,boxShadow:'inset 0 0 0 1px #a57bc900'}
      ],{duration:520,easing:'ease-out'});
    }
  }

  function applyAlternative(kind) {
    const a=read('a'), b=read('b');
    if(!a.scenario) return;
    const plan={...a.plan};
    if(kind==='date') {
      const later=a.scenario.start+7*dayMs;
      if ((plan.dataMode==='horizons' && later+plan.days*dayMs>horizonsCache.end) ||
          later>=Date.UTC(10000,0,1)) {
        tryStatus.textContent='B için yedi gün sonrasına veri yok. A’da daha erken bir başlangıç tarihi seçin.';
        return;
      }
      plan.date=iso(later);
    } else plan.site=nextSite(plan.site,b.plan.site);

    const previous=draft('b');
    const candidate={...draft('a'),date:plan.date};
    if(kind==='site') candidate.site=plan.site;
    if (b.scenario && b.plan.site===plan.site && b.plan.date===plan.date &&
        b.plan.days===plan.days && b.plan.terrain===plan.terrain && b.plan.horizonMode===plan.horizonMode) {
      tryStatus.textContent='B zaten bu seçimi gösteriyor.';
      return;
    }
    undoDraft=previous;
    lastAction=kind==='date'?delayButton:siteButton;
    edited.b=true;
    restoreDraft('b',candidate);
    render();
    undoButton.hidden=false;
    const date = dateLabel(plan.date);
    const change=kind==='date'?'Başlangıç yedi gün ertelendi.':'İniş sahası değiştirildi.';
    signalResult('B: '+plan.site+' · '+date+'. '+change);
  }
  const dateFormat=new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const dateLabel=isoDate=>dateFormat.format(Date.parse(isoDate+'T00:00:00Z'));

  function undoAlternative() {
    if(!undoDraft) return;
    restoreDraft('b',undoDraft);
    clearAlternative();
    render();
    signalResult('Önceki B senaryosu geri getirildi.');
    lastAction?.focus({preventScroll:true});
  }

  function comparisonSignature() {
    return JSON.stringify([sourceProxy.value,draft('a'),draft('b'),currentSummary]);
  }
  function notifyComparisonChange() {
    const signature=comparisonSignature();
    if(signature===lastSignature) return;
    lastSignature=signature;
    window.dispatchEvent(new CustomEvent('astro:comparison-change',{detail:evaluation}));
  }
  function loadMode(state) {
    clearAlternative();
    const mode=state.plan.dataMode;
    if(previousMode) records[previousMode]={a:draft('a'),b:draft('b')};
    previousMode=mode; sourceProxy.value=mode;
    focusArm=null;
    for(const arm of Object.keys(labels)) {
      updateOptions(arms[arm],mode);
      const saved=records[mode]?.[arm];
      if(saved) for(const [key,value] of Object.entries(saved)) arms[arm][key].value=value;
      else setFields(arm,{...state.plan,site:arm==='a'?'Shackleton Rim':'Malapert Massif'});
      edited[arm]=!!saved;
    }
  }
  function synchronize(state) {
    if(!state || state.source==='time'||state.source==='interval') return;
    const changedMode=previousMode!==state.plan.dataMode;
    if(changedMode) loadMode(state);
    const pinKey=state.pinned?JSON.stringify(state.pinned.plan):null;
    if(state.pinned && (state.source==='pin' || (pinKey!==pinnedKey && !edited.a))) {
      clearAlternative();
      setFields('a',state.pinned.plan);
    }
    pinnedKey=pinKey;
    const key=JSON.stringify(state.plan);
    if(!changedMode&&!openingSky&&key!==previousPlan&&state.source==='plan') {
      clearAlternative();
      setFields(focusArm||'b',state.plan);
    }
    previousPlan=key;
    if(state.route==='compare') render();
  }
  for(const arm of Object.keys(labels)) arms[arm]=makeEditor(arm);
  sourceProxy.addEventListener('change',()=>{
    sourceSelect.value=sourceProxy.value;
    sourceSelect.dispatchEvent(new Event('change',{bubbles:true}));
  });
  window.astroComparison={briefing(){ render(); return currentSummary; },signature:comparisonSignature,snapshot:()=>evaluation,openSky};
  window.addEventListener('mission:update',event=>synchronize(event.detail));
  synchronize(initial);
})();
