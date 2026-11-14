// The native range is the input. The ruler presents the same sampled UTC hours.
(() => {
  "use strict";
  const range = document.querySelector("#landerSky #scrub");
  if (!range) return;
  const transport = range.closest(".s-transport");
  const play = transport.querySelector("#play");
  const create = (tag, className) => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  };

  const playLabel = create("span", "time-play-label");
  playLabel.dataset.playLabel = "";
  playLabel.textContent = play.textContent;
  play.replaceChildren(playLabel);
  play.title = "Oynat / duraklat";
  transport.classList.add("time-transport");

  const scale = create("div", "time-scale");
  const rail = create("div", "time-rail");
  rail.setAttribute("aria-hidden", "true");
  rail.append(create("i", "time-progress"), create("i", "time-pointer"));

  const bounds = create("div", "time-bounds");
  const first = create("time", "time-first");
  const last = create("time", "time-last");
  bounds.setAttribute("aria-hidden", "true");
  bounds.append(first, last);
  range.before(scale);
  scale.append(rail, range, bounds);

  const format = new Intl.DateTimeFormat("tr-TR", {
    day:"numeric", month:"short", hour:"2-digit", minute:"2-digit",
    hourCycle:"h23", timeZone:"UTC"
  });
  function setStamp(node, millis) {
    const date = new Date(millis);
    node.dateTime = date.toISOString();
    node.textContent = format.format(date);
  }

  let scenario, finalHour = 0;
  function ticks() {
    const width = rail.clientWidth;
    if (!width || finalHour < 1) return;
    // Increase spacing for long missions and narrow screens. Every tick falls on a sample.
    const interval = [1,2,3,6,12,24,48,96].find(hours => width * hours / finalHour >= 6) || 168;
    rail.style.setProperty("--minor-step", (100 * interval / finalHour) + "%");
    rail.style.setProperty("--major-step", (100 * interval * 4 / finalHour) + "%");
  }
  function update(state) {
    if (!state || state.route !== "windows") return;
    if (scenario !== state.scenario) {
      scenario = state.scenario;
      finalHour = scenario ? scenario.samples.length - 1 : 0;
      bounds.hidden = !scenario;
      if (scenario) {
        setStamp(first, scenario.start);
        setStamp(last, scenario.start + finalHour * 3600000);
        ticks();
      }
    }
    rail.style.setProperty("--progress", (finalHour ? 100 * state.hour / finalHour : 0) + "%");
  }
  new ResizeObserver(ticks).observe(rail);
  window.addEventListener("mission:update", event => update(event.detail));
  update(window.missionConsole?.getState());
})();
