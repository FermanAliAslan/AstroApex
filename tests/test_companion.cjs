const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ui = path.resolve(__dirname, '../ui');
const start = Date.UTC(2026, 9, 18);
let horizons, terrain;

before(async () => {
  const context = vm.createContext({
    window: {},
    document: {querySelector: () => null},
    fetch: async file => ({ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(ui, file), 'utf8'))})
  });
  for (const script of ['horizons.js', 'assets/terrain-profiles.js', 'terrain.js', 'model.js']) {
    vm.runInContext(fs.readFileSync(path.join(ui, script), 'utf8'), context, {filename: script});
  }
  horizons = vm.runInContext('horizonsCache', context);
  terrain = context.window.lunarHorizon;
  await horizons.load();
});

function calculate(site, horizonMode) {
  return horizons.calculate({site, days: 14, terrain: 0, horizonMode}, start);
}

test('companion custom coordinates at each measured centre use the same observer table and terrain skyline as the preset', () => {
  for (const name of horizons.names) {
    const {lat, lon} = horizons.coordinates(name);
    const custom = horizons.customSite(lat, lon);
    assert.equal(terrain.has(custom), true);
    const a = calculate(name, 'dem');
    const b = calculate(custom, 'dem');
    assert.equal(b.horizonMode, 'dem');
    assert.deepEqual(b.samples, a.samples);
    assert.deepEqual(b.intervals, a.intervals);
    assert.equal(b.overlapHours, a.overlapHours);
  }
});

test('companion projected Sun and Earth angles one coordinate increment from the reference centres agree with the observer tables', () => {
  for (const name of horizons.names) {
    const {lat, lon} = horizons.coordinates(name);
    const nearby = horizons.customSite(lat + 0.00001, lon);
    assert.equal(terrain.has(nearby), false);
    const direct = calculate(name, 'manual').samples;
    const projected = calculate(nearby, 'manual').samples;
    assert.equal(direct.length, 336);
    for (let i = 0; i < direct.length; i++) {
      for (const body of ['sun', 'earth']) {
        const elevationError = Math.abs(projected[i][body+'Angle'] - direct[i][body+'Angle']);
        const azimuthError = Math.abs((projected[i][body+'Az'] - direct[i][body+'Az'] + 540) % 360 - 180);
        assert.ok(elevationError < 0.0002 && azimuthError < 0.0002, name + ' ' + body + ' hour ' + i);
      }
    }
  }
});
