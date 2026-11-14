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
  const customOption = new Option("Görev koordinatları","custom");
  customOption.hidden = true;
  source.add(customOption);
  let namedSource = source.value;
  const precision = new Intl.NumberFormat("tr-TR", { maximumFractionDigits:5 });
  const coordinate = (n,positive,negative) => precision.format(Math.abs(n))+"°"+(n===0?"":n<0?" "+negative:" "+positive);
  const settings = document.querySelector("#atlasMissionSettings");
  settings.addEventListener("click", () => {
    settings.setAttribute("aria-expanded", String(settings.getAttribute("aria-expanded") !== "true"));
  });

  const expand = document.querySelector("#moonExpand");
  const viewport = expand.closest(".s-panel");
  if (document.fullscreenEnabled && viewport.requestFullscreen) {
    // The layer footer is shared by the globe and the three polar maps.
    document.addEventListener("DOMContentLoaded", () => {
      const footer = viewport.querySelector(".atlas-map-footer");
      if (footer) footer.append(expand);
      expand.hidden = false;
    }, {once:true});
    expand.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement === viewport) await document.exitFullscreen();
        else await viewport.requestFullscreen();
      } catch {
        // An embedding browser may refuse fullscreen for the current frame.
        expand.hidden = true;
      }
    });
    document.addEventListener("fullscreenchange", () => {
      const full = document.fullscreenElement === viewport;
      expand.setAttribute("aria-pressed", String(full));
      expand.setAttribute("aria-label", full ? "Tam ekrandan çık" : "Atlası tam ekranda aç");
      expand.title = full ? "Tam ekrandan çık" : "Tam ekran";
    });
  }
  const center = document.querySelector("#moonCameraCenter");
  const scale = document.querySelector(".moon-distance-scale");
  const scaleText = scale.querySelector("span");
  const scaleBar = scale.querySelector("i");
  window.addEventListener("astro:camera", ({detail: {lat, lon, diameter}}) => {
    const position = coordinate(Math.round(lat * 10) / 10, "K", "G") + " · " +
      coordinate(Math.round(lon * 10) / 10, "D", "B");
    if (center.textContent !== position) center.textContent = position;
    center.parentElement.hidden = false;
    // At the center of an orthographic globe, local scale is 2R / screen diameter.
    const kmPerPixel = 2 * 1737.4 / diameter;
    const targetKm = 85 * kmPerPixel;
    const magnitude = 10 ** Math.floor(Math.log10(targetKm));
    const unit = targetKm / magnitude;
    const km = magnitude * (unit >= 5 ? 5 : unit >= 2 ? 2 : 1);
    const label = "≈ " + precision.format(km) + " km";
    if (scaleText.textContent !== label) scaleText.textContent = label;
    scaleBar.style.width = Math.round(km / kmPerPixel) + "px";
    scale.hidden = false;
  });
  let previousKey;
  function synchronize(state, force=false) {
    if (!state?.plan) return;
    const name = state.plan.site;
    const active = state.route==="atlas";
    const custom = !locations[name] && horizonsCache.coordinates(name);
    if (custom && source.value !== 'custom') {
      namedSource = source.value;
      customOption.hidden = false;
      source.value = 'custom';
    } else if (!custom && source.value === 'custom') {
      source.value = namedSource;
      customOption.hidden = true;
    }
    source.disabled = !!custom;
    const key = [active,name,source.value].join("|");
    if (!force && previousKey===key) return;
    previousKey=key;
    const point=custom ? [custom.lat,custom.lon] : locations[name]?.[source.value];
    latOut.textContent=point?coordinate(point[0],"K","G"):"—";
    lonOut.textContent=point?coordinate(point[1],"D","B"):"—";
    note.textContent=custom ? "Görevde seçilen Ay yüzeyi koordinatları." :
      !point ? "Bu örnek saha için doğrulanmış koordinat bulunmuyor." :
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
