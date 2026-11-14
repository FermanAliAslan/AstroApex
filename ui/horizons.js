// Hourly, airless lunar observer geometry from NASA/JPL Horizons, served offline.
const horizonsCache = (() => {
  "use strict";
  const hour = 3600000;
  const start = Date.UTC(2026, 0, 1), end = Date.UTC(2028, 0, 1);
  const originalStart = Date.UTC(2026, 9, 18), originalEnd = Date.UTC(2026, 10, 1);
  const degrees = 180 / Math.PI;
  const presets = new Map([
    ["Shackleton Rim", {lat:-89.7668,lon:-171.87}],
    ["Connecting Ridge", {lat:-89.4632,lon:-137.49}],
    ["Malapert Massif", {lat:-85.9948,lon:-0.23578}]
  ]);
  const names = [...presets.keys()];
  let original, vectors, pending;

  function customSite(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return null;
    return "Konum ("+Number(lat.toFixed(5))+"°, "+Number(lon.toFixed(5))+"°)";
  }
  function coordinates(site) {
    if (presets.has(site)) return {...presets.get(site)};
    const m = /^Konum \((-?\d+(?:\.\d{1,5})?)°, (-?\d+(?:\.\d{1,5})?)°\)$/.exec(site);
    if (!m) return null;
    const lat = Number(m[1]), lon = Number(m[2]);
    return customSite(lat,lon) === site ? {lat,lon} : null;
  }

  function validateTable(packet) {
    if (Date.parse(packet.startUtc) !== originalStart || Date.parse(packet.endUtcExclusive) !== originalEnd ||
        packet.stepSeconds !== 3600 || packet.columns?.join("/") !== "sunAz/sunEl/earthAz/earthEl")
      throw new Error("Unexpected original observer table");
    for (const name of names) {
      const rows = packet.sites?.[name]?.samples;
      if (!Array.isArray(rows) || rows.length !== (originalEnd-originalStart)/hour || rows.some(row =>
        !Array.isArray(row) || row.length !== 4 || !row.every((angle,i)=>Number.isFinite(angle) &&
        (i%2 ? Math.abs(angle)<=90 : angle>=0 && angle<=360)))) throw new Error("Invalid observer samples");
    }
    return packet;
  }
  function validateVectors(packet) {
    if (Date.parse(packet.startUtc) !== start || Date.parse(packet.endUtcExclusive) !== end ||
        packet.columns?.join("/") !== "sunX/sunY/sunZ/earthX/earthY/earthZ" ||
        packet.radiusKm !== 1737.4 || packet.stepSeconds !== 3600 ||
        !Array.isArray(packet.samples) || packet.samples.length !== (end-start)/hour ||
        packet.samples.some(row=>!Array.isArray(row) || row.length!==6 || !row.every(Number.isFinite)))
      throw new Error("Invalid lunar vector series");
    return packet;
  }
  async function fetchPacket(file, validate) {
    const response = await fetch("assets/"+file);
    if (!response.ok) throw new Error("Missing "+file);
    return validate(await response.json());
  }
  function load() {
    if (!pending) pending = Promise.all([
      fetchPacket("horizons-samples.json", validateTable),
      fetchPacket("lunar-vectors.json", validateVectors)
    ]).then(packets=>{ [original,vectors] = packets; })
      .catch(error=>{ pending = undefined; throw error; });
    return pending;
  }
  function covers(ms, days) {
    return Number.isFinite(ms) && ms%hour === 0 && [7,14,21,28].includes(days) &&
      ms >= start && ms+days*24*hour <= end;
  }
  function observerAt(point) {
    const lat = point.lat / degrees, lon = point.lon / degrees;
    const slat=Math.sin(lat), clat=Math.cos(lat), slon=Math.sin(lon), clon=Math.cos(lon);
    return (row, offset) => {
      const x = row[offset], y = row[offset+1], z = row[offset+2];
      const radial = clon*x + slon*y;
      const east = -slon*x + clon*y;
      const north = -slat*radial + clat*z;
      const up = clat*radial + slat*z - vectors.radiusKm;
      return [(Math.atan2(east,north)*degrees+360)%360, Math.atan2(up,Math.hypot(east,north))*degrees];
    };
  }
  function calculate(plan, ms) {
    const point = coordinates(plan.site);
    if (!vectors || !point || !covers(ms,plan.days)) return null;
    const observe = observerAt(point);
    const direct = original.sites[plan.site]?.samples;
    const first = (ms-start)/hour;
    const samples = Array.from({length:plan.days*24}, (_,offset) => {
      const index = first+offset;
      const local = direct?.[(ms-originalStart)/hour+offset];
      if (local) return {sunAz:local[0],sunAngle:local[1],earthAz:local[2],earthAngle:local[3]};
      const row = vectors.samples[index];
      const [sunAz,sunAngle] = observe(row,0), [earthAz,earthAngle] = observe(row,3);
      return {sunAz,sunAngle,earthAz,earthAngle};
    });
    return summarizeSamples(plan.site,ms,plan.days,plan.terrain,samples,plan.horizonMode);
  }
  return {start,end,names,customSite,coordinates,covers,load,calculate,get ready(){return !!vectors;}};
})();
