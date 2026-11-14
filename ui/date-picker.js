// Shared UTC calendar. The original date fields retain the planner's validation and events.
(() => {
  'use strict';
  const inputs = [...document.querySelectorAll('input[type="date"]')];
  if (!inputs.length) return;
  const dayMs = 86400000;
  const iso = stamp => new Date(stamp).toISOString().slice(0,10);
  const parse = value => value ? Date.parse(value + 'T00:00:00Z') : NaN;
  const fmt = options => new Intl.DateTimeFormat('tr-TR',{timeZone:'UTC',...options});
  const monthName = fmt({month:'long'});
  const titleFormat = fmt({month:'long',year:'numeric'});
  const fullDate = fmt({weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const element = (tag,cls,text) => {
    const node=document.createElement(tag);
    node.className=cls;
    if(text!=null)node.textContent=text;
    return node;
  };
  const button = (cls,text) => {
    const node=element('button',cls,text);
    node.type='button';
    return node;
  };
  function stamp(year,month,day=1){
    const d=new Date(0);
    d.setUTCFullYear(year,month,day);
    return d.getTime();
  }

  const panel=element('div','utc-calendar');
  panel.hidden=true; panel.id='astroUtcCalendar';
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-label','Başlangıç tarihi seç');
  if(typeof panel.showPopover==='function')panel.setAttribute('popover','manual');
  const bar=element('div','utc-cal-head');
  const prev=button('utc-cal-prev','‹'), next=button('utc-cal-next','›');
  const heading=button('utc-cal-month','');
  const body=element('div','utc-cal-body');
  bar.append(heading,prev,next);panel.append(bar,body);document.body.append(panel);
  let active=null, cursor=0, monthView=false;

  function bounds(){
    const min=parse(active.input.min),max=parse(active.input.max);
    return [Number.isFinite(min)?min:stamp(1,0),Number.isFinite(max)?max:stamp(9999,11,31)];
  }
  function limit(value){
    const [min,max]=bounds();
    return Math.max(min,Math.min(max,value));
  }
  function close(restore=false){
    if(!active)return;
    const trigger=active.trigger;
    active=null;
    panel.hidden=true;
    if(panel.hasAttribute('popover') && panel.matches(':popover-open'))panel.hidePopover();
    trigger.setAttribute('aria-expanded','false');
    if(restore)trigger.focus({preventScroll:true});
  }
  function position(){
    if(!active)return;
    const anchor=active.wrap.getBoundingClientRect();
    if(!anchor.height){close();return;}
    const v=window.visualViewport;
    const x=v?.offsetLeft||0, y=v?.offsetTop||0, w=v?.width||innerWidth, h=v?.height||innerHeight;
    const below=y+h-anchor.bottom-12, above=anchor.top-y-12;
    panel.style.width=Math.min(306,w-16)+'px';
    const up=below<panel.scrollHeight+6 && above>below;
    panel.style.maxHeight=Math.max(80,up?above:below)+'px';
    panel.style.left=Math.max(x+8,Math.min(anchor.left,x+w-panel.offsetWidth-8))+'px';
    panel.style.top=(up?anchor.top-panel.offsetHeight-6:anchor.bottom+6)+'px';
  }
  function choose(value){
    const input=active.input;
    const selected=iso(value);
    close(true);
    if(input.value===selected)return;
    input.value=selected;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function render(focus=false){
    const d=new Date(cursor), y=d.getUTCFullYear(), m=d.getUTCMonth(), [min,max]=bounds();
    heading.textContent=monthView?String(y):titleFormat.format(d);
    heading.setAttribute('aria-label',monthView?'Gün seçimine dön':heading.textContent+' · Ay ve yıl seç');
    prev.setAttribute('aria-label',monthView?'Önceki yıl':'Önceki ay');
    next.setAttribute('aria-label',monthView?'Sonraki yıl':'Sonraki ay');
    prev.disabled=(monthView?stamp(y,0):stamp(y,m))<=min;
    next.disabled=(monthView?stamp(y+1,0):stamp(y,m+1))>max;
    body.replaceChildren();
    let focused;
    if(monthView){
      body.className='utc-cal-body utc-cal-months';
      for(let i=0;i<12;i++){
        const first=stamp(y,i);
        const b=button('utc-cal-cell',monthName.format(first));
        b.disabled=stamp(y,i+1)<=min||first>max;
        b.tabIndex=i===m?0:-1;b.dataset.month=String(i);
        if(i===m)focused=b;
        b.addEventListener('click',()=>{cursor=limit(first);monthView=false;render(true);});
        body.append(b);
      }
    } else {
      body.className='utc-cal-body utc-cal-days';
      for(const value of ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz']){
        const cell=element('span','utc-cal-weekday',value);
        cell.setAttribute('aria-hidden','true');body.append(cell);
      }
      const pad=(new Date(stamp(y,m)).getUTCDay()+6)%7;
      const count=new Date(stamp(y,m+1,0)).getUTCDate();
      const today=iso(Date.now());
      for(let day=1;day<=count;day++){
        const value=stamp(y,m,day), key=iso(value);
        const b=button('utc-cal-cell',day);
        if(day===1)b.style.gridColumnStart=String(pad+1);
        b.disabled=value<min||value>max;
        b.tabIndex=cursor===value?0:-1; b.dataset.date=key;
        b.setAttribute('aria-label',fullDate.format(value));
        b.setAttribute('aria-pressed',String(active.input.value===key));
        if(key===today)b.setAttribute('aria-current','date');
        if(value===cursor)focused=b;
        b.addEventListener('click',()=>choose(value));body.append(b);
      }
    }
    position();
    if(focus)focused?.focus({preventScroll:true});
  }
  function shift(size){
    const d=new Date(cursor);
    const month=d.getUTCMonth()+size;
    cursor=limit(stamp(d.getUTCFullYear(),month,Math.min(d.getUTCDate(),new Date(stamp(d.getUTCFullYear(),month+1,0)).getUTCDate())));
  }
  prev.addEventListener('click',()=>{shift(monthView?-12:-1);render();if(prev.disabled)heading.focus();});
  next.addEventListener('click',()=>{shift(monthView?12:1);render();if(next.disabled)heading.focus();});
  heading.addEventListener('click',()=>{monthView=!monthView;render(true);});

  function open(control){
    if(active===control){close(true);return;}
    document.dispatchEvent(new Event('astro:picker-opening'));
    active=control;monthView=false;
    const value=parse(control.input.value);
    cursor=limit(Number.isFinite(value)?value:parse(iso(Date.now())));
    panel.hidden=false;
    if(panel.hasAttribute('popover'))panel.showPopover();
    panel.setAttribute('aria-label',control.trigger.getAttribute('aria-label').replace('takvimini aç','tarihi seç'));
    control.trigger.setAttribute('aria-expanded','true');
    render(true);
  }
  for(const input of inputs){
    const wrap=element('div','utc-date-field');
    input.before(wrap);wrap.append(input);
    const trigger=button('utc-cal-trigger','');
    const scenario=input.closest('.cmp-card')?.querySelector('h2')?.textContent;
    trigger.setAttribute('aria-label',(scenario || 'Görev')+' · Başlangıç takvimini aç');
    trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-controls',panel.id);
    const icon=element('i','utc-cal-icon');icon.setAttribute('aria-hidden','true');
    trigger.append(icon);wrap.append(trigger);
    const control={input,wrap,trigger};
    trigger.addEventListener('click',e=>{e.preventDefault();open(control);});
    input.addEventListener('click',e=>{
      if(matchMedia('(pointer: coarse)').matches){e.preventDefault();open(control);}
    });
    input.addEventListener('keydown',e=>{
      if(e.key==='F4'||(e.altKey&&e.key==='ArrowDown')||e.key===' '){
        e.preventDefault();open(control);
      }
    });
    new MutationObserver(()=>{trigger.disabled=input.disabled;if(active===control){if(input.disabled)close();else{cursor=limit(cursor);render();}}})
      .observe(input,{attributes:true,attributeFilter:['min','max','disabled']});
    trigger.disabled=input.disabled;
  }
  panel.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}
    if(e.key==='Tab'){
      const stops=[...panel.querySelectorAll('button:not(:disabled)')].filter(b=>b.tabIndex>=0);
      if(e.shiftKey&&document.activeElement===stops[0]||!e.shiftKey&&document.activeElement===stops.at(-1)){
        // Restore the tab sequence at the field, whose popup lives at the end of the document.
        if(e.shiftKey){e.preventDefault();close(true);}
        else {active.trigger.focus({preventScroll:true});close();}
      }
      return;
    }
    if(!body.contains(e.target))return;
    const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'];
    if(!keys.includes(e.key))return;
    e.preventDefault();
    if(monthView){
      if(e.key==='Home'||e.key==='End')cursor=limit(stamp(new Date(cursor).getUTCFullYear(),e.key==='Home'?0:11));
      else shift(({ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3,PageUp:-12,PageDown:12})[e.key]);
    }else if(e.key==='PageUp'||e.key==='PageDown'){
      shift((e.key==='PageUp'?-1:1)*(e.shiftKey?12:1));
    }else{
      const weekday=(new Date(cursor).getUTCDay()+6)%7;
      cursor=limit(cursor+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday})[e.key]*dayMs);
    }
    render(true);
  });
  document.addEventListener('astro:picker-opening',()=>close());
  document.addEventListener('pointerdown',e=>{if(active&&!panel.contains(e.target)&&!active.wrap.contains(e.target))close();});
  document.addEventListener('focusin',e=>{if(active&&!panel.contains(e.target)&&!active.wrap.contains(e.target))close();});
  window.addEventListener('hashchange',()=>close());
  window.addEventListener('mission:update',()=>{if(active&&!active.wrap.getClientRects().length)close();});
  window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
  document.addEventListener('scroll',e=>{if(e.target!==panel)position();},true);
})();
