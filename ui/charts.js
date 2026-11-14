// SVG paths are rebuilt only when their data or plot width changes.
(() => {
  "use strict";
  const ns = "http://www.w3.org/2000/svg";
  const hourMs = 3600000;
  const dateLabel = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  });
  const timeLabel = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const number = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
  const prettyAngle = (v) => number.format(v) + "°";
  const series = [
    ["sun", "Güneş"],
    ["earth", "Dünya"],
    ["overlap", "Ortak görüş"],
  ];
  const labels = {
    angles: "Güneş ve Dünya yükseklikleri",
    sunlight: "Günlük aydınlanma",
    lanes: "Görüş aralıkları",
  };

  function element(tag, cls, text) {
    const el = document.createElement(tag);
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function shape(parent, tag, attrs, text) {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs))
      el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    parent.append(el);
    return el;
  }
  function draw(chart, reveal) {
    const { svg, kind, scenario, width } = chart;
    svg.replaceChildren();
    chart.dots = [];
    const n = scenario.samples.length;
    const left = kind === "lanes" ? 71 : 36;
    const top = 12,
      bottom = kind === "lanes" ? 91 : 119,
      right = width - 9;
    const x = (h) => left + ((right - left) * h) / n;
    const y = (v) =>
      bottom - ((v - chart.min) * (bottom - top)) / (chart.max - chart.min);
    svg.setAttribute("viewBox", "0 0 " + width + " " + (bottom + 24));
    svg.style.height = bottom + 24 + "px";
    chart.range.style.left = left + "px";
    chart.range.style.width = right - left + "px";
    chart.range.style.bottom = "24px";
    chart.range.max = n - 1;
    chart.x = x;
    chart.y = y;
    const tickCount = width < 355 ? 2 : 4;
    for (let i = 0; i <= tickCount; i++) {
      const h = Math.round((n * i) / tickCount),
        px = x(h);
      shape(svg, "line", {
        x1: px,
        x2: px,
        y1: top,
        y2: bottom,
        class: "dc-grid dc-vgrid",
      });
      const anchor = i === 0 ? "start" : i === tickCount ? "end" : "middle";
      shape(
        svg,
        "text",
        { x: px, y: bottom + 17, "text-anchor": anchor, class: "dc-tick" },
        dateLabel.format(scenario.start + h * hourMs),
      );
    }
    const traces = shape(svg, "g", { id: chart.traceId });
    // Keep the grid behind the plots and the cursor above them.
    if (kind === "lanes") {
      series.forEach(([key, label], i) => {
        const base = top + i * 30;
        shape(svg, "text", { x: 0, y: base + 10, class: "dc-tick" }, label);
        shape(svg, "rect", {
          x: left,
          y: base,
          width: right - left,
          height: 13,
          class: "dc-rail",
          rx: 1.5,
        });
        scenario.intervals[key].forEach(({ begin, end }) => {
          shape(traces, "rect", {
            x: x(begin),
            y: base,
            width: x(end) - x(begin),
            height: 13,
            class: "dc-band dc-" + key,
            rx: 1.5,
          });
        });
      });
    } else {
      const ticks = kind === "sunlight" ? [0, 25, 50, 75, 100] : [];
      if (kind === "angles")
        for (let v = chart.min; v <= chart.max; v += 10) ticks.push(v);
      ticks.forEach((v) => {
        shape(svg, "line", {
          x1: left,
          x2: right,
          y1: y(v),
          y2: y(v),
          class: "dc-grid",
        });
        shape(
          svg,
          "text",
          { x: left - 7, y: y(v) + 3, "text-anchor": "end", class: "dc-tick" },
          v + (kind === "angles" ? "°" : "%"),
        );
      });
      if (kind === "angles") {
        const dem = scenario.horizonMode === "dem";
        if (!dem) {
          shape(svg, "line", {
            x1: left, x2: right, y1: y(scenario.terrain), y2: y(scenario.terrain), class: "dc-mask"
          });
        }
        for (const [key] of series.slice(0, 2)) {
          for (const field of dem ? ["Horizon", "Angle"] : ["Angle"]) {
            const d = scenario.samples.map((sample, i) =>
              (i ? "L" : "M") + x(i).toFixed(2) + " " + y(sample[key + field]).toFixed(2)
            ).join(" ");
            const style = field === "Horizon" ? "dc-terrain-curve" : "dc-curve";
            shape(traces, "path", { d, class: style + " dc-" + key });
          }
        }
      } else {
        const d = chart.days
          .map(
            (v, i) =>
              (i ? "L" : "M") +
              x(i * 24).toFixed(2) +
              " " +
              y(v).toFixed(2) +
              " H" +
              x((i + 1) * 24).toFixed(2),
          )
          .join(" ");
        shape(traces, "path", {
          d: d + " V" + bottom + " H" + left + " Z",
          class: "dc-area",
        });
        shape(traces, "path", { d, class: "dc-curve dc-sun" });
      }
    }
    svg.append(traces);
    // A short highlight retraces the real geometry; the data stays visible below.
    chart.glint = shape(svg, "use", {
      href: "#" + chart.traceId,
      class: "dc-glint" + (reveal ? " dc-enter" : ""),
    });
    chart.line = shape(svg, "line", {
      x1: 0,
      x2: 0,
      y1: top - 2,
      y2: bottom,
      class: "dc-cursor",
    });
    if (kind === "angles" || kind === "sunlight") {
      const lines = kind === "sunlight" ? ["sun"] : ["sun", "earth"];
      chart.dots = lines.map((key) =>
        shape(svg, "circle", { r: 3.4, class: "dc-dot dc-" + key }),
      );
    }
  }

  function update(chart, state) {
    const { scenario, hour } = state;
    const width = chart.host.clientWidth;
    if (!width) {
      chart.glint?.classList.remove("dc-enter");
      chart.visible = false;
      chart.lastHour = null;
      return;
    }
    const entered = !chart.visible;
    chart.visible = true;
    chart.empty.hidden = Boolean(scenario);
    chart.frame.hidden = !scenario;
    chart.legend.hidden = !scenario;
    if (!scenario) {
      chart.scenario = null;
      chart.lastHour = null;
      chart.read.textContent = "";
      return;
    }
    const newData = chart.scenario !== scenario;
    const resized = chart.width !== width;
    if (newData || resized) {
      chart.scenario = scenario;
      chart.width = width;
      const samples = scenario.samples;
      if (chart.kind === "angles") {
        const dem = scenario.horizonMode === "dem";
        chart.legend.querySelector(".dc-legend-mask").textContent = dem ? "Noktalı çizgiler: yönsel arazi ufku" : "Arazi eşiği";
        let lo = 0,
          hi = dem ? 10 : Math.max(10, scenario.terrain);
        for (const sample of samples) {
          lo = Math.min(lo, sample.sunAngle, sample.earthAngle, sample.sunHorizon, sample.earthHorizon);
          hi = Math.max(hi, sample.sunAngle, sample.earthAngle, sample.sunHorizon, sample.earthHorizon);
        }
        chart.min = Math.floor(lo / 10) * 10;
        chart.max = Math.ceil(hi / 10) * 10;
      } else if (chart.kind === "sunlight") {
        chart.min = 0;
        chart.max = 100;
        chart.days = [];
        for (let i = 0; i < samples.length; i += 24) {
          let count = 0;
          const end = Math.min(i + 24, samples.length);
          for (let j = i; j < end; j++) if (samples[j].sun) count++;
          chart.days.push((100 * count) / (end - i));
        }
      }
      draw(chart, newData || entered);
    } else if (entered) {
      chart.glint.classList.add("dc-enter");
    }
    const sample = scenario.samples[hour];
    const px = chart.x(hour);
    const step =
      !newData &&
      !resized &&
      !entered &&
      state.source === "time" &&
      hour === chart.lastHour + 1 &&
      document.getElementById("play")?.dataset.playing === "true";
    chart.frame.classList.toggle("dc-playing", step);
    const offset = "translateX(" + px + "px)";
    chart.line.style.transform = offset;
    chart.lastHour = hour;
    const values =
      chart.kind === "angles"
        ? [sample.sunAngle, sample.earthAngle]
        : chart.kind === "sunlight"
          ? [chart.days[Math.floor(hour / 24)]]
          : [];
    chart.dots.forEach((dot, i) => {
      if (chart.kind === "angles") {
        dot.style.transform =
          offset + " translateY(" + chart.y(values[i]) + "px)";
      } else {
        dot.style.transform = offset;
        dot.setAttribute("cy", chart.y(values[i]));
      }
    });
    const stamp = timeLabel.format(scenario.start + hour * hourMs) + " UTC";
    const summary =
      chart.kind === "angles"
        ? "Güneş " +
          prettyAngle(sample.sunAngle) +
          " · Dünya " +
          prettyAngle(sample.earthAngle)
        : chart.kind === "sunlight"
          ? "Günlük aydınlanma %" + number.format(values[0])
          : "Güneş " +
            (sample.sun ? "görünür" : "gizli") +
            " · Dünya " +
            (sample.earth ? "görünür" : "gizli");
    chart.read.textContent = summary;
    chart.range.value = String(hour);
    chart.range.setAttribute("aria-valuetext", stamp + " · " + summary);
    chart.range.title = stamp + " · " + summary;
  }

  let current;
  const charts = [];
  const observer = new ResizeObserver((entries) => {
    if (!current) return;
    for (const entry of entries) {
      const chart = charts.find((c) => c.host === entry.target);
      if (chart) update(chart, current);
    }
  });
  document.querySelectorAll("[data-chart]").forEach((host) => {
    const kind = host.dataset.chart;
    if (!labels[kind]) return;
    const frame = element("div", "dc-frame");
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("aria-hidden", "true");
    const range = element("input", "dc-range");
    range.type = "range";
    range.min = 0;
    range.step = 1;
    range.setAttribute("aria-label", labels[kind] + " · görev saati");
    range.addEventListener("input", () =>
      window.missionConsole?.setHour(Number(range.value)),
    );
    frame.append(svg, range);
    const legend = element("div", "dc-legend");
    const keys =
      kind === "angles"
        ? [
            ["sun", "Güneş"],
            ["earth", "Dünya"],
            ["mask", "Arazi eşiği"],
          ]
        : kind === "sunlight"
          ? [["sun", "Aydınlık saat oranı"]]
          : [];
    keys.forEach(([key, label]) =>
      legend.append(element("span", "dc-legend-" + key, label)),
    );
    const read = element("div", "dc-read");
    const empty = element(
      "p",
      "dc-empty",
      "Grafiği görmek için başlangıç tarihini seçin.",
    );
    empty.hidden = true;
    host.append(legend, frame, read, empty);
    charts.push({
      host,
      kind,
      svg,
      range,
      frame,
      read,
      empty,
      legend,
      traceId: "mission-traces-" + charts.length,
    });
    observer.observe(host);
  });
  function render(state) {
    if (!state) return;
    current = state;
    for (const c of charts) update(c, state);
  }
  window.addEventListener("mission:update", (e) => render(e.detail));
  render(window.missionConsole?.getState());
})();
