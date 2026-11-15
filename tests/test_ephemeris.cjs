'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({atob});
context.window = context;
for (const file of ['js/vendor/astronomy.browser.min.js', 'data/spice_table.js', 'js/ephem.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'navigator', file), 'utf8'), context);
}
const E = context.Ephem;

// Independent JPL Horizons observer tables: https://ssd-api.jpl.nasa.gov/doc/horizons.html
// CENTER=coord@301, east longitude / latitude / altitude 0 km, UTC, QUANTITIES=4,
// EXTRA_PREC=YES, AIRLESS, targets 10 and 399. Horizons used DE441/MEAN_ME;
// the browser table uses DE440s/IAU_MOON. Columns: lat, lon, UTC, Sun az/el, Earth az/el.
const horizons = [
  [-89.4632, -137.49, "2027-01-08T00:00Z", 315.338097358, 1.285521015, 137.003883766, -4.247828528],
  [-85.9948, -0.23578, "2026-10-29T14:30Z", 314.358323864, 4.238774157, 1.241777579, 9.63225358],
  [-14.813, -15.036, "2027-01-17T20:54Z", 86.129555681, 16.834377029, 46.717198111, 78.402992341],
  [0.67408, 23.47297, "2026-06-17T08:25Z", 87.645159705, -39.540978853, 256.648129538, 70.689811019],
  [12, 172, "2028-12-31T11:19Z", 333.054267257, -76.747859234, 344.367142488, -78.456899342],
  [89.9, 37, "2027-01-08T11:00Z", 44.732217414, -0.967692729, 218.096262567, 2.888945333],
  [-75, 76, "2042-05-07T10:13Z", 254.996883197, -4.534730784, 279.484914798, -2.659207805]
];

function checkDirection(body, az, el, azTolerance, elTolerance) {
  const azDiff = Math.abs(((body.az - az + 540) % 360) - 180);
  assert.ok(azDiff < azTolerance, `azimuth: ${body.az} vs ${az}`);
  assert.ok(Math.abs(body.el - el) < elTolerance, `elevation: ${body.el} vs ${el}`);
}

test('surface sky agrees with independent JPL Horizons observations, including a fallback date', () => {
  for (const [lat, lon, iso, sunAz, sunEl, earthAz, earthEl] of horizons) {
    const obs = E.observe(E.site(lat, lon), Date.parse(iso));
    assert.equal(obs.src, iso.startsWith('2042') ? 'ae' : 'spice');
    checkDirection(obs.sun, sunAz, sunEl, 0.02, 0.005);
    checkDirection(obs.earth, earthAz, earthEl, 0.02, 0.005);
  }
});

test('the first and last interpolated intervals match NAIF CSPICE topocentric reference angles', () => {
  // azlcpo_c("ELLIPSOID", target, ET, "LT+S", false, true, site, "MOON", "IAU_MOON")
  // with DE440s, pck00010, naif0012, spherical observer radius 1737.4 km, site 8 N, 73 E.
  for (const [iso, sunAz, sunEl, earthAz, earthEl] of [
    ['2024-01-01T00:00Z', 274.4409625012, -38.6775074199, 262.7343228587, 15.8978319784],
    ['2024-01-01T00:41Z', 274.5105866524, -39.0187950256, 262.7691302136, 15.8652147062],
    ['2040-12-31T23:21Z', 85.4279152440, -36.6316244993, 270.9095163464, 11.5219787822],
    ['2041-01-01T00:00Z', 85.4934754653, -36.3058456601, 270.9476254070, 11.5626348744],
  ]) {
    const obs = E.observe(E.site(8, 73), Date.parse(iso));
    assert.equal(obs.src, 'spice');
    checkDirection(obs.sun, sunAz, sunEl, 0.0001, 0.0001);
    checkDirection(obs.earth, earthAz, earthEl, 0.0001, 0.0001);
  }
  assert.equal(E.sourceAt(E.range[0] - 1), 'ae');
  assert.equal(E.sourceAt(E.range[1] + 1), 'ae');
});

test('a directly overhead Sun or Earth has a finite 90-degree elevation', () => {
  const ms = Date.UTC(2027, 0, 1, 1);
  for (const target of ['sun', 'earth']) {
    const {lat, lon} = E.subPoint(E.frame(ms)[target]);
    const obs = E.observe(E.site(lat, lon), ms);
    assert.ok(Math.abs(obs[target].el - 90) < 1e-10);
  }
});
