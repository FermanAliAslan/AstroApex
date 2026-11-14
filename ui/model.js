"use strict";

// Illustrative profiles, not ephemerides. Absolute UTC time keeps overlapping
// date ranges consistent when the start or the length of a mission changes.
const sites = {
  "Shackleton Rim": { sunMean: 10, earthMean: 8, phase: 0.8 },
  "Connecting Ridge": { sunMean: 8, earthMean: 12, phase: 1.4 },
  "Malapert Massif": { sunMean: 13, earthMean: 4, phase: 2.7 },
  "Güney Ay (örnek)": { sunMean: 5, earthMean: 5, phase: 3.4 },
  "Doğu Ay (örnek)": { sunMean: 9, earthMean: 6, phase: 4.9 },
};
const hourMs = 3600000;
const referenceEpoch = Date.UTC(2026, 9, 18);
const tau = 2 * Math.PI;
const netEnergyFactor = 0.72;

function buildScenario(site, start, days, terrain) {
  const profile = sites[site];
  const count = days * 24;
  const startHour = (start - referenceEpoch) / hourMs;
  const samples = [];
  for (let hour = 0; hour < count; hour++) {
    const t = startHour + hour;
    const sunPhase = (tau * t) / 114 + profile.phase;
    const earthPhase = (tau * t) / 149 + profile.phase * 0.7 + 0.5;
    // The precision shown in the UI is also the precision used for visibility.
    const sunAngle =
      Math.round(
        (profile.sunMean +
          13 * Math.sin(sunPhase) +
          3 * Math.sin((tau * t) / 41 + profile.phase)) *
          10,
      ) / 10;
    const earthAngle =
      Math.round(
        (profile.earthMean +
          10 * Math.sin(earthPhase) +
          2 * Math.sin((tau * t) / 73)) *
          10,
      ) / 10;
    samples.push({
      sunAngle,
      earthAngle,
      sunX: 30 + 13 * Math.sin(sunPhase * 0.8),
      earthX: 70 + 10 * Math.cos(earthPhase * 0.82),
    });
  }
  return summarizeSamples(site, start, days, terrain, samples);
}

// Each hourly sample owns the following half-open one-hour bin.
function summarizeSamples(site, start, days, terrain, samples) {
  const count = samples.length;
  const intervals = { sun: [], earth: [], overlap: [] };
  let sunHours = 0;
  let overlapHours = 0;
  let darkRun = 0;
  let longestDark = 0;

  for (const [hour, sample] of samples.entries()) {
    const sun = sample.sun = sample.sunAngle > terrain;
    const earth = sample.earth = sample.earthAngle > terrain;
    const overlap = sample.overlap = sun && earth;
    sunHours += Number(sun);
    overlapHours += Number(overlap);
    darkRun = sun ? 0 : darkRun + 1;
    longestDark = Math.max(longestDark, darkRun);

    // Each [begin, end) interval includes the full final visible hour.
    for (const key of ["sun", "earth", "overlap"]) {
      if (!sample[key]) continue;
      const runs = intervals[key];
      const current = runs[runs.length - 1];
      if (current && current.end === hour) current.end++;
      else runs.push({ begin: hour, end: hour + 1 });
    }
  }
  return {
    site,
    start,
    days,
    terrain,
    samples,
    intervals,
    sunHours,
    overlapHours,
    light: Math.round((sunHours * 100) / count),
    windows: intervals.earth.length,
    longestDark,
  };
}
