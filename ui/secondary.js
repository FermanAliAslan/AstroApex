// Region centers: NASA Lunar Surface Data Book Rev A, table A2-2.
// Observer points: the AstroApex C engine's presets. Longitude is east-positive.
(() => {
  const locations = {
    "Shackleton Rim":   {region:[-89.7668,-171.87,"04"],observer:[-89.9,0,120]},
    "Connecting Ridge": {region:[-89.4632,-137.49,"01"],observer:[-89.45,-137.40,180]},
    "Malapert Massif":  {region:[-85.9948,-0.23578,"23"],observer:[-86,-2.90,450]},
  };
  const source = document.getElementById("atlasSource");
  if (!source) return;
  const latOut = document.getElementById("atlasLat");
  const lonOut = document.getElementById("atlasLon");
  const note = document.getElementById("atlasSourceNote");
  const precision = new Intl.NumberFormat("tr-TR", { maximumFractionDigits:5 });
  const coordinate = (n,positive,negative) => precision.format(Math.abs(n))+"°"+(n===0?"":n<0?" "+negative:" "+positive);
  let previousKey;
  function synchronize(state, force=false) {
    if (!state?.plan) return;
    const name = state.plan.site;
    const active = state.route==="atlas";
    const key = [active,name,source.value].join("|");
    if (!force && previousKey===key) return;
    previousKey=key;
    const point=locations[name]?.[source.value];
    latOut.textContent=point?coordinate(point[0],"K","G"):"—";
    lonOut.textContent=point?coordinate(point[1],"D","B"):"—";
    note.textContent=!point ? "Bu örnek saha için doğrulanmış koordinat bulunmuyor." :
      source.value==="region" ? "NASA bölge "+point[2]+" · Çalışma alanının merkezi." :
      "C motorunun gözlem noktası · "+point[2]+" m referans yüksekliği.";
    const site = point ? {name,lat:point[0],lon:point[1]} : {name};
    window.dispatchEvent(new CustomEvent("astro:globe",{detail:{active,site}}));
  }
  function current() {return window.missionConsole?.getState();}
  window.addEventListener("mission:update", e=>synchronize(e.detail));
  window.addEventListener("astro:globe-ready", ()=>synchronize(current(),true));
  source.addEventListener("change", ()=>synchronize(current()));
  synchronize(current());
})();
