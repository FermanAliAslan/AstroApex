// Instrument feedback uses the existing mission events. Values are always final;
// the animation shows which value changed, without counting through fictitious data.
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const nav = document.querySelector(".mast nav");
  const indicator = document.createElement("i");
  indicator.className = "nav-tracer";
  indicator.setAttribute("aria-hidden", "true");
  nav.append(indicator);
  const keys = [...document.querySelectorAll(".kpi [data-out]")];
  const readouts = [...document.querySelectorAll("#windows [data-out='sunStatus'],#windows [data-out='earthStatus']")];
  const readings = new WeakMap();
  const effects = new Map();
  const ease = "cubic-bezier(.2,.78,.24,1)";
  let route, activeNav, lastScenario;
  function animate(node, frames, duration, delay = 0) {
    if (!node || reduce.matches || document.hidden || !node.animate) return;
    effects.get(node)?.cancel();
    const effect = node.animate(frames, {duration, delay, easing:ease, fill:"backwards"});
    effects.set(node, effect);
    const release = () => { if (effects.get(node) === effect) effects.delete(node); };
    effect.onfinish = release;
    effect.oncancel = release;
  }
  function stop() {
    effects.forEach(effect => effect.cancel());
    effects.clear();
  }
  function locateNav() {
    const target = nav.querySelector('[aria-current="page"]');
    if (!target) return;
    const width = target.offsetWidth;
    indicator.style.transform = "translateX("+target.offsetLeft+"px)";
    indicator.style.width = width+"px";
    activeNav = target;
    nav.dataset.traced = "true";
  }
  function moveNav() {
    const old = activeNav && indicator.getBoundingClientRect();
    locateNav();
    if (!old?.width) return;
    const end = indicator.getBoundingClientRect();
    animate(indicator, [{transform:"translateX("+ (old.left-nav.getBoundingClientRect().left) +"px) scaleX("+(old.width/end.width)+")"}, {transform:indicator.style.transform}],300);
  }
  function expose(surface) {
    const nodes = surface.querySelectorAll(":scope > .plan-title, :scope > .s-heading, :scope > .kpi-band, .console-grid > article, .s-stations > section, :scope > .s-panel, .s-atlas > *, :scope > .s-split, .s-method > li");
    nodes.forEach((node, i) => animate(node,[{opacity:.55,transform:"translateY(10px)"},{opacity:1,transform:"none"}],310,Math.min(i,5)*32));
    if (surface.id === "plan") {
      const scanner = surface.querySelector(".terrain-scan");
      animate(scanner,[{transform:"translateX(-100%)",opacity:0},{opacity:.8,offset:.2},{opacity:.65,offset:.8},{transform:"translateX(380%)",opacity:0}],790,100);
    }
  }
  function readChanges(elements, highlight) {
    for (const node of elements) {
      const previous = readings.get(node);
      const value = node.textContent;
      readings.set(node,value);
      if (highlight && previous !== undefined && value !== previous) {
        animate(node,[{opacity:.45,transform:"translateY(4px)",color:"#a6f4ff"},{opacity:1,transform:"translateY(0)"}],300);
      }
    }
  }
  window.addEventListener("mission:update", ({detail:s}) => {
    const changedRoute = route !== s.route;
    if (changedRoute) {
      stop();
      route = s.route;
      moveNav();
      expose(document.getElementById(route));
    }
    // Playback ticks leave the navigation, panels and KPI tiles alone.
    if (changedRoute || s.source === "plan") {
      readChanges(keys,!changedRoute && route === "plan" && lastScenario !== s.scenario);
      lastScenario = s.scenario;
    }
    if (route === "windows") readChanges(readouts,!changedRoute && s.source === "time");
    if (route === "compare" && s.source === "pin") {
      const snapshot = document.querySelector(".s-snapshot");
      animate(snapshot,[{boxShadow:"inset 3px 0 #75dceb",backgroundColor:"#213e50"},{boxShadow:"inset 0 0 transparent",backgroundColor:"transparent"}],460);
      if (s.pinned) animate(document.querySelector("#deltaRows"),[{opacity:.35},{opacity:1}],260);
    }
  });
  new ResizeObserver(locateNav).observe(nav);
  document.fonts?.ready.then(locateNav);
  reduce.addEventListener("change", e => {if(e.matches) stop();});
  document.addEventListener("visibilitychange", () => {if(document.hidden) stop();});
})();
