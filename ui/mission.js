// One state feeds the Plan, Windows, Comparison and Atlas views.
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const all = selector => Array.from(document.querySelectorAll(selector));
  const routes = ["plan", "windows", "compare", "atlas", "method"];
  const defaultPlan = {site: "Shackleton Rim", date: "2026-10-18", days: 14, terrain: 6, watts: 500};
  const siteNames = Object.keys(sites);
  const durations = [7, 14, 21, 28];
  const demoPinKey = "astroapex.console.pin.v1";
  const modeKey = "astroapex.console.mode";
  const pinKey = () => plan.dataMode === "horizons" ? "astroapex.console.pin.horizons.v1" : demoPinKey;
  const sourceLabel = () => plan.dataMode === "horizons" ? "JPL Horizons" : "Demo model";
  const sourceSelect = byId("dataMode");
  const formatDate = new Intl.DateTimeFormat("tr-TR", {timeZone: "UTC", year: "numeric", month: "short", day: "numeric"});
  const formatClock = new Intl.DateTimeFormat("tr-TR", {timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"});
  const formatNumber = new Intl.NumberFormat("tr-TR", {maximumFractionDigits: 1});
  const ephemerisAngle = new Intl.NumberFormat("tr-TR", {maximumFractionDigits: 4});
  const dash = "—";
  let initialMode = sourceSelect ? "horizons" : "demo";
  try { if (sessionStorage.getItem(modeKey) === "demo") initialMode = "demo"; } catch {}
  let plan = {...defaultPlan, dataMode: initialMode, terrain: initialMode === "horizons" ? 0 : defaultPlan.terrain};
  let scenario = null, pinned = null, loadFailed = false;
  const previousPlans = {};
  let hour = 0, intervalIndex = 0, timer = null;
  let route = routes.includes(location.hash.slice(1)) ? location.hash.slice(1) : "plan";

  const controls = new Map(Object.keys(defaultPlan).map(key => [
    key, Array.from(new Set([byId(key), ...all('[data-control="' + key + '"]')].filter(Boolean)))
  ]));
  const readouts = new Map();
  for (const el of all("[data-out]")) {
    const key = el.dataset.out;
    if (!readouts.has(key)) readouts.set(key, []);
    readouts.get(key).push(el);
  }
  const out = (key, value) => {
    for (const el of readouts.get(key) || []) {
      const next = String(value ?? dash);
      if (el.textContent !== next) el.textContent = next;
    }
  };
  function validDate(date) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return false;
    const ms = Date.parse(date + "T00:00:00Z");
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
  }
  function validWatts(watts) { return Number.isFinite(watts) && watts >= 50 && watts <= 2000; }
  function inCoverage(p) {
    if (!validDate(p.date)) return false;
    return p.dataMode !== "horizons" || horizonsCache.covers(Date.parse(p.date + "T00:00:00Z"), p.days);
  }
  function availableSites(p) { return p.dataMode === "horizons" ? horizonsCache.names : siteNames; }
  function calculate(p) {
    const ms = Date.parse(p.date + "T00:00:00Z");
    return p.dataMode === "horizons" ? horizonsCache.calculate(p, ms) : buildScenario(p.site, ms, p.days, p.terrain);
  }
  function validateStored(p) {
    return p && siteNames.includes(p.site) && validDate(p.date) && durations.includes(p.days)
      && Number.isInteger(p.terrain) && p.terrain >= 0 && p.terrain <= 20 && validWatts(p.watts);
  }
  function restorePin() {
    pinned = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(pinKey()));
      if (!validateStored(saved) || (saved.dataMode || "demo") !== plan.dataMode ||
          !availableSites(plan).includes(saved.site) || !inCoverage(saved)) return;
      const result = calculate(saved);
      if (result) pinned = {plan:{...saved, dataMode:plan.dataMode}, scenario:result};
    } catch {}
  }

  function sourceFields() {
    const real = plan.dataMode === "horizons";
    if (sourceSelect) sourceSelect.value = plan.dataMode;
    out("sourceLabel", sourceLabel());
    for (const [type, allowed] of [["site",availableSites(plan)],["days", real ? [7,14] : durations]]) {
      for (const field of controls.get(type)) {
        if (!(field instanceof HTMLSelectElement)) continue;
        for (const opt of field.options) opt.disabled = !allowed.includes(type === "days" ? Number(opt.value) : opt.value);
      }
    }
    for (const date of controls.get("date")) {
      date.min = real ? "2026-10-18" : "";
      date.max = real ? new Date(horizonsCache.end - plan.days*24*hourMs).toISOString().slice(0,10) : "";
    }
    const notice = !real ? "Demo: saatlik temsili saha profilleri kullanılıyor." :
      loadFailed ? "JPL Horizons kayıtları yüklenemedi. Yeniden denemek için demo kaynağına geçip JPL Horizons’ı seçin." :
      !horizonsCache.ready ? "JPL Horizons saatlik kayıtları yükleniyor…" :
      "JPL Horizons · 18–31 Eki 2026 UTC · NASA bölge merkezleri, 0 km referans yüksekliği. Arazi eşiği kullanıcı varsayımıdır.";
    tell("sourceNotice",notice);
  }
  function setMode(name) {
    if (!["demo","horizons"].includes(name)) return;
    if (plan.dataMode !== name) {
      previousPlans[plan.dataMode] = plan;
      const first = name === "horizons" ? {...defaultPlan, terrain:0} : defaultPlan;
      plan = {...(previousPlans[name] || first), dataMode:name};
      try { sessionStorage.setItem(modeKey,name); } catch {}
    }
    setPlayback(false); hour=0; intervalIndex=0; loadFailed=false;
    function refresh() {
      sourceFields();restorePin();syncFields();recalculate();instant();emit("plan");
    }
    refresh();
    if (name === "horizons" && !horizonsCache.ready) {
      horizonsCache.load().then(() => { if (plan.dataMode === name) refresh(); })
        .catch(() => { if (plan.dataMode === name) { loadFailed = true; refresh(); } });
    }
  }

  function state(source) {
    return {plan, scenario, hour, sample: scenario?.samples[hour] || null, pinned, route, intervalIndex, source};
  }
  function emit(source) {
    window.dispatchEvent(new CustomEvent("mission:update", {detail: state(source)}));
  }
  function tell(id, message) {
    const el = byId(id);
    if (el) { el.textContent = message; el.hidden = !message; }
  }
  function syncFields() {
    for (const [key, fields] of controls) for (const field of fields) {
      const value = String(plan[key] ?? "");
      if (field.type === "radio") field.checked = field.value === value;
      else if (field.value !== value) field.value = value;
      if (key === "date") field.setAttribute("aria-invalid", String(!inCoverage(plan)));
      if (key === "watts") field.setAttribute("aria-invalid", String(!validWatts(plan.watts)));
    }
    tell("dateError", !validDate(plan.date) ? "Görevi hesaplamak için geçerli bir başlangıç tarihi seçin." :
      inCoverage(plan) ? "" : "Görev JPL Horizons kayıtlarının dışına taşıyor. Tarihi veya süreyi değiştirin (18 Ekim–1 Kasım 2026 UTC).");
    tell("wattError", validWatts(plan.watts) ? "" : "50 ile 2.000 W arasında bir panel gücü girin.");
  }
  function setPlayback(running) {
    if (timer !== null) clearInterval(timer);
    timer = null;
    const button = byId("play");
    if (running && route === "windows" && scenario) {
      if (hour === scenario.samples.length - 1) setHour(0, false);
      timer = setInterval(() => {
        setHour(hour + 1, false);
        if (hour === scenario.samples.length - 1) setPlayback(false);
      }, 160);
    }
    if (button) {
      const on = timer !== null;
      button.setAttribute("aria-pressed", String(on));
      button.dataset.playing = String(on);
      const label = button.querySelector("[data-play-label]") || button;
      label.textContent = on ? "Duraklat" : "Başlat";
    }
  }
  function instant() {
    const sample = scenario?.samples[hour];
    const timestamp = sample ? formatClock.format(scenario.start + hour * hourMs) + " UTC" : dash;
    out("now", timestamp);
    out("missionHour", sample ? hour : dash);
    const angleFormat = plan.dataMode === "horizons" ? ephemerisAngle : formatNumber;
    out("sunAzimuth", sample && Number.isFinite(sample.sunAz) ? angleFormat.format(sample.sunAz) + "°" : dash);
    out("earthAzimuth", sample && Number.isFinite(sample.earthAz) ? angleFormat.format(sample.earthAz) + "°" : dash);
    out("sunAngle", sample ? angleFormat.format(sample.sunAngle) + "°" : dash);
    out("earthAngle", sample ? angleFormat.format(sample.earthAngle) + "°" : dash);
    out("sunStatus", sample ? (sample.sun ? "Ufuk üstünde" : "Ufuk altında") : dash);
    out("earthStatus", sample ? (sample.earth ? "Görünür" : "Görüş kapalı") : dash);
    const scrub = byId("scrub");
    if (scrub) {
      scrub.disabled = !sample; scrub.max = String(scenario ? scenario.samples.length - 1 : 0);
      scrub.value = String(hour); scrub.setAttribute("aria-valuetext", timestamp);
    }
    if (byId("play")) byId("play").disabled = !sample;
  }
  function setHour(value, pause = true) {
    if (!scenario || !Number.isFinite(Number(value))) return;
    if (pause) setPlayback(false);
    hour = Math.min(scenario.samples.length - 1, Math.max(0, Math.round(Number(value))));
    instant(); emit("time");
  }
  function setPlan(patch) {
    if (patch.dataMode && patch.dataMode !== plan.dataMode) setMode(patch.dataMode);
    const next = {...plan};
    for (const key of Object.keys(defaultPlan)) {
      if (!(key in patch)) continue;
      const raw = patch[key];
      if (key === "site" && availableSites(plan).includes(raw)) next.site = raw;
      if (key === "date") next.date = validDate(raw) ? raw : "";
      if (key === "days" && (plan.dataMode === "horizons" ? [7,14] : durations).includes(Number(raw))) next.days = Number(raw);
      if (key === "terrain" && Number.isInteger(Number(raw)) && Number(raw)>=0 && Number(raw)<=20) next.terrain = Number(raw);
      if (key === "watts") next.watts = raw === null || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
    }
    const geometryChanged = ["site","date","days","terrain"].some(k => next[k] !== plan[k]);
    const rangeChanged = next.date !== plan.date || next.days !== plan.days;
    plan = next;
    if (geometryChanged) { sourceFields(); setPlayback(false); if (rangeChanged) hour = 0; intervalIndex = 0; }
    syncFields();
    if (geometryChanged) recalculate();
    else summary();
    instant(); emit("plan");
  }
  function row(values, header = true) {
    const tr = document.createElement("tr");
    values.forEach((v,i) => {
      const cell = document.createElement(i===0 && header ? "th" : "td");
      if (i===0 && header) cell.scope = "row";
      if (v instanceof Node) cell.append(v); else cell.textContent = String(v);
      tr.append(cell);
    });
    return tr;
  }
  function unavailablePlan() {
    if (plan.dataMode !== "horizons") return "Geçerli bir başlangıç tarihi seçin.";
    if (loadFailed) return "Horizons kayıtları yüklenemedi; veri kaynağı bildirimini kontrol edin.";
    if (!horizonsCache.ready) return "Horizons kayıtları yükleniyor…";
    return "Seçili görev, Horizons verisinin tarih kapsamı dışında.";
  }
  function windowsTable() {
    const runs = scenario?.intervals.overlap || [];
    const select = byId("intervalSelect"), table = byId("windowRows");
    const options = [], rows = [];
    runs.forEach(({begin,end}, i) => {
      const startUTC = formatClock.format(scenario.start + begin*hourMs);
      const endUTC = formatClock.format(scenario.start + end*hourMs);
      options.push(new Option(startUTC + " – " + endUTC + " UTC · " + (end-begin) + " sa", String(i)));
      const button = document.createElement("button");
      button.type = "button"; button.className = "window-link"; button.textContent = startUTC;
      button.setAttribute("aria-label", startUTC + " UTC zamanını simülasyonda aç");
      button.addEventListener("click", () => { chooseWindow(i); jump(begin); });
      rows.push(row([button,endUTC,end-begin]));
    });
    if (!runs.length) {
      const tr=row([scenario ? "Bu görevde ortak görüş penceresi yok." : unavailablePlan()],false);
      tr.firstChild.colSpan=3; rows.push(tr);
    }
    table?.replaceChildren(...rows);
    if (select) {select.replaceChildren(...options); select.disabled=!runs.length;}
    chooseWindow(Math.min(intervalIndex,Math.max(0,runs.length-1)));
  }
  function chooseWindow(index) {
    intervalIndex = index;
    const run = scenario?.intervals.overlap[index];
    if (byId("intervalSelect")) byId("intervalSelect").selectedIndex = run ? index : -1;
    if (byId("intervalJump")) byId("intervalJump").disabled = !run;
    if (!run) { out("windowDetail",scenario ? "Ortak görüş yok. Başka saha veya tarih seçin." : unavailablePlan()); return; }
    const next = scenario.samples[run.end];
    const closing = next ? (!next.sun && !next.earth ? "Güneş ve Dünya" : !next.sun ? "Güneş" : "Dünya") + " arazi eşiğinin gerisine geçiyor." : "Görev bu saatte bitiyor.";
    out("windowDetail",(run.end-run.begin) + " saat kesintisiz ortak görüş. " + closing);
  }
  function description(p) {
    return [validDate(p.date) ? formatDate.format(Date.parse(p.date+"T00:00:00Z")) : dash, p.days+" gün", "Ufuk "+p.terrain+"°"].join(" · ");
  }
  function compare() {
    all("[data-show]").forEach(el=>{
      if (el.dataset.show === "pinned") el.hidden=!pinned;
      if (el.dataset.show === "unpinned") el.hidden=!!pinned;
    });
    if (byId("pin")) byId("pin").disabled=!scenario || !validWatts(plan.watts);
    if (byId("unpin")) byId("unpin").disabled=!pinned;
    out("pinLabel",pinned ? "A planını güncelle" : "Planı A olarak sabitle");
    out("pinnedSite",pinned?.plan.site);out("pinnedSettings",pinned ? description(pinned.plan) : dash);out("liveSettings",description(plan));
    const table=byId("deltaRows");
    if (!pinned || !scenario) {
      out("compareSummary",pinned ? "B için veri kapsamındaki bir tarih seçin." : "Referans seçmek için mevcut planı A olarak sabitleyin.");
      table?.replaceChildren();return;
    }
    const a=pinned.scenario,b=scenario, delta=b.overlapHours-a.overlapHours;
    const same = ["date","days","terrain","site"].every(key=>pinned.plan[key]===plan[key]);
    const note = same ? "Planlar aynı. B için sahayı, tarihi, süreyi veya eşiği değiştirin." :
      delta===0 ? "Ortak görünürlük süresi iki planda eşit." :
      "B planında " + Math.abs(delta) + " saat daha " + (delta>0 ? "fazla" : "az") + " ortak görüş var.";
    out("compareSummary",note+(pinned.plan.days!==plan.days ? " Toplamlar farklı görev sürelerini kapsıyor." : ""));
    const metrics=[["Ortak görüş","overlapHours","sa"],["En uzun karanlık","longestDark","sa"],["Aydınlanma","light","%"],["Dünya görüş penceresi","windows",""]];
    table?.replaceChildren(...metrics.map(([name,key,unit])=>{
      const d=b[key]-a[key], suffix=unit==="%" ? " puan" : unit ? " "+unit : "";
      const show=n=>unit==="%" ? "%"+n : String(n)+suffix;
      return row([name,show(a[key]),show(b[key]),(d>0?"+":"")+d+suffix]);
    }));
  }
  function summary() {
    const d=scenario;
    const values={site:plan.site,date:d?formatDate.format(d.start):dash,days:plan.days,terrain:plan.terrain,
      watts:plan.watts,sunPct:d?.light,earthWindows:d?.windows,overlapHours:d?.overlapHours,longestDark:d?.longestDark,
      energy:d && validWatts(plan.watts) ? formatNumber.format(Math.round(d.sunHours*plan.watts*netEnergyFactor))+" Wh":dash,
      sampleCount:d?.samples.length,sunHours:d?.sunHours};
    Object.entries(values).forEach(([k,v])=>out(k,v));
    compare();
  }
  function recalculate() {
    const ranked = inCoverage(plan) ? availableSites(plan).map(site=>calculate({...plan,site})).filter(Boolean).sort((a,b)=>b.overlapHours-a.overlapHours) : [];
    scenario=ranked.find(s=>s.site===plan.site) || null;
    const table=byId("rankRows");
    table?.replaceChildren(...ranked.map(s=>{
      const tr=row([s.site,"%"+s.light,s.windows,s.overlapHours+" sa",s.longestDark+" sa"]);
      if (s.site===plan.site) tr.classList.add("selected-row");
      return tr;
    }));
    windowsTable();summary();
  }
  function savePin(drop) {
    if (!drop && (!scenario || !validWatts(plan.watts))) return;
    pinned = drop ? null : {plan:{...plan},scenario};
    try {if (pinned) sessionStorage.setItem(pinKey(),JSON.stringify(pinned.plan));else sessionStorage.removeItem(pinKey());} catch {}
    compare();emit("pin");
  }
  function applyRoute(name,focus) {
    route=routes.includes(name) ? name : "plan";
    if (route!=="windows") setPlayback(false);
    for (const key of routes) { const section=byId(key); if(section) section.hidden=key!==route; }
    document.body.dataset.route=route;
    all("a[data-route],button[data-route]").forEach(link=>{
      const current=link.dataset.route===route;
      link.classList.toggle("active",current);
      if(current) link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
    });
    if (focus) {
      const heading=byId(route)?.querySelector("h1, h2");
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
      window.scrollTo(0,0);
    }
    emit("route");
  }
  function navigate(name) {
    if (!routes.includes(name)) return;
    if(location.hash!=="#"+name) history.pushState(null,"","#"+name);
    applyRoute(name,true);
  }
  function jump(value) { navigate("windows"); setHour(value); }
  for (const [key,fields] of controls) for (const field of fields) {
    if(field instanceof HTMLSelectElement && !field.options.length) {
      if (key==="site") field.append(...siteNames.map(site=>new Option(site,site)));
      if (key==="days") field.append(...durations.map(days=>new Option(days+" gün",String(days))));
      if (key==="terrain") field.append(...Array.from({length:21}, (_,n)=>new Option(n+"°",String(n))));
    }
    const event=key==="terrain" || key==="watts" ? "input":"change";
    field.addEventListener(event,()=>{if(field.type!=="radio" || field.checked) setPlan({[key]:field.value});});
  }
  byId("pin")?.addEventListener("click",()=>savePin(false));
  byId("unpin")?.addEventListener("click",()=>savePin(true));
  byId("play")?.addEventListener("click",()=>setPlayback(timer===null));
  byId("scrub")?.addEventListener("input",e=>setHour(e.target.value));
  byId("intervalSelect")?.addEventListener("change",e=>{chooseWindow(e.target.selectedIndex);emit("interval");});
  byId("intervalJump")?.addEventListener("click",()=>{const run=scenario?.intervals.overlap[intervalIndex];if(run)jump(run.begin);});
  all("a[data-route],button[data-route]").forEach(link=>link.addEventListener("click",e=>{
    if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.button!==0)return;
    e.preventDefault();navigate(link.dataset.route);
  }));
  window.addEventListener("hashchange",()=>applyRoute(location.hash.slice(1),true));
  document.addEventListener("visibilitychange",()=>{if(document.hidden)setPlayback(false);});
  document.addEventListener("keydown",e=>{
    if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.target.closest("input,select,textarea,button,[contenteditable=true]"))return;
    const i=["1","2","3","4","5"].indexOf(e.key);
    if(i>=0)navigate(routes[i]);else if(e.key==="Escape")navigate("plan");
  });
  window.missionConsole={setPlan,setHour,pin:()=>savePin(false),unpin:()=>savePin(true),navigate,jump,getState:()=>state("read")};
  sourceSelect?.addEventListener("change",()=>setMode(sourceSelect.value));
  setMode(plan.dataMode);applyRoute(route,false);
})();
