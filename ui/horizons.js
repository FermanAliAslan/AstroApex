// Local hourly NASA/JPL Horizons ephemeris cache. No interpolation or extrapolation.
const horizonsCache = (() => {
  const start = Date.UTC(2026, 9, 18), end = Date.UTC(2026, 10, 1);
  const names = ["Shackleton Rim", "Connecting Ridge", "Malapert Massif"];
  let data, pending;
  function validate(packet) {
    const size = (end - start) / 3600000;
    if (Date.parse(packet.startUtc) !== start || Date.parse(packet.endUtcExclusive) !== end ||
        packet.stepSeconds !== 3600 || packet.columns?.join("/") !== "sunAz/sunEl/earthAz/earthEl") {
      throw new Error("Unexpected Horizons coverage");
    }
    for (const name of names) {
      const rows = packet.sites?.[name]?.samples;
      if (!Array.isArray(rows) || rows.length !== size || rows.some(row =>
        !Array.isArray(row) || row.length !== 4 || !row.every((angle, i) =>
          Number.isFinite(angle) && (i % 2 ? Math.abs(angle) <= 90 : angle >= 0 && angle <= 360)))) {
        throw new Error("Invalid Horizons sample series");
      }
    }
    return packet;
  }
  function load() {
    if (!pending) pending = fetch("assets/horizons-samples.json")
      .then(res => { if (!res.ok) throw new Error("Horizons asset unavailable"); return res.json(); })
      .then(packet => { data = validate(packet); })
      .catch(error => { pending = undefined; throw error; });
    return pending;
  }
  function covers(ms, days) {
    return Number.isFinite(ms) && [7,14].includes(days) && ms >= start && ms + days*24*3600000 <= end;
  }
  function calculate(plan, ms) {
    if (!data || !covers(ms, plan.days) || !names.includes(plan.site)) return null;
    const begin = (ms-start)/3600000;
    const samples = data.sites[plan.site].samples.slice(begin, begin+plan.days*24)
      .map(([sunAz,sunAngle,earthAz,earthAngle]) => ({sunAz,sunAngle,earthAz,earthAngle}));
    return summarizeSamples(plan.site, ms, plan.days, plan.terrain, samples);
  }
  return {start,end,names,covers,load,calculate,get ready(){return !!data;}};
})();
