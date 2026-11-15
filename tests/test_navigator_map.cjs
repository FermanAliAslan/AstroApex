'use strict';

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
let browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

async function openMap(options) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 880 }, reducedMotion: 'reduce', ...options });
  await page.route(/^https?:/, route => route.abort());
  await page.addInitScript(() => {
    window.mapPixelsDrawn = 0;
    window.mapPins = {};
    const put = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (...args) {
      if (this.canvas.id === 'globe') window.mapPixelsDrawn++;
      return put.apply(this, args);
    };
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      if (this.canvas.id === 'globe-ov' && (text === 'A' || text === 'B')) window.mapPins[text] = [x, y - 0.5];
      return fillText.call(this, text, x, y, ...rest);
    };
  });
  await page.goto(pathToFileURL(path.resolve(__dirname, '../navigator/index.html')).href);
  await page.waitForFunction(() => window.AA?.Polar.globalReady && window.AA.S.globe.tex);
  await page.locator('.inspect-launch').click();
  await page.waitForFunction(() => window.mapPixelsDrawn > 0);
  return page;
}

test('changing mission time updates subpoints and range even when the underlying mosaic is static', async () => {
  const page = await openMap();
  try {
    const before = await page.locator('#f-sun').textContent();
    await page.locator('#scrub').focus();
    await page.locator('#scrub').press('End');
    await page.waitForFunction(old => document.querySelector('#f-sun').textContent !== old, before);
    const facts = await page.evaluate(() => {
      const { S, fmtCoord, nf } = AA;
      const frame = Ephem.frame(S.sc.A.start + S.dur * 86400000);
      const solar = Ephem.subPoint(frame.sun), earth = Ephem.subPoint(frame.earth);
      return [fmtCoord(solar.lat, solar.lon), fmtCoord(earth.lat, earth.lon), nf(earth.dist) + ' km'];
    });
    assert.deepEqual(await page.locator('#f-sun,#f-earth,#f-dist').allTextContents(), facts);
    // Wait for the initial camera sizing/ResizeObserver pass to finish.
    await page.evaluate(() => new Promise(resolve => {
      let stableSince = performance.now(), count = window.mapPixelsDrawn;
      function settled(now) {
        if (count !== window.mapPixelsDrawn) { count = window.mapPixelsDrawn; stableSince = now; }
        if (now - stableSince >= 120) resolve();
        else requestAnimationFrame(settled);
      }
      requestAnimationFrame(settled);
    }));
    const previous = await page.evaluate(() => window.mapPixelsDrawn);
    await page.locator('#scrub').press('Home');
    await page.waitForFunction(old => document.querySelector('#f-sun').textContent === old, before);
    assert.equal(await page.evaluate(() => window.mapPixelsDrawn), previous, 'clock updates only the overlay');
  } finally { await page.close(); }
});

test('orthographic touch picking and A pin agree at a known point near the visible limb', async () => {
  const page = await openMap({ hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    await page.locator('[data-view="near"]').click();
    await page.waitForFunction(() => document.querySelector('#inspect-coords').textContent === AA.fmtCoord(0, 0));
    const wrap = page.locator('#globe-wrap');
    await wrap.scrollIntoViewIfNeeded();
    const r = await wrap.boundingBox(), scale = 1 - 6 / 380;
    // At equatorial aspect an orthographic projection gives x=cos(lat)*sin(lon), y=sin(lat).
    const rad = r.width * scale / 2, cy = r.y + r.height / 2, cx = r.x + r.width / 2;
    const x = Math.round(cx + rad * .987), y = Math.round(cy - rad * .06);
    const original = await page.evaluate(() => AA.S.sc.A.site);
    await page.mouse.click(x, y, { button: 'right' });
    assert.equal(await page.evaluate(() => AA.S.sc.A.site), original, 'secondary click leaves the plan intact');
    await page.touchscreen.tap(x, y);
    await page.waitForFunction(() => AA.S.sc.A.site === 'custom');
    const delta = (cy - y) / rad, latitude = Math.asin(delta), longitude = Math.asin((x - cx) / rad / Math.cos(latitude));
    const selected = await page.evaluate(() => [AA.S.sc.A.lat, AA.S.sc.A.lon]);
    assert.ok(Math.abs(selected[0] - latitude * 180 / Math.PI) < .01);
    assert.ok(Math.abs(selected[1] - longitude * 180 / Math.PI) < .01);
    await page.waitForFunction(({x, y}) => {
      const pin = window.mapPins.A;
      return pin && Math.abs(pin[0] - x) < 1 && Math.abs(pin[1] - y) < 1;
    }, { x: x - r.x, y: y - r.y });
    assert.equal(await page.locator('#globe').evaluate(c => c.width), 760);
  } finally { await page.close(); }
});

test('the map hides rankings that belong to a different mission date or scan area', async () => {
  const page = await openMap();
  try {
    await page.evaluate(() => {
      const { S } = AA;
      S.sc.B.start = S.sc.A.start + 86400000;
      S.scout = { k: 'A', start: S.sc.A.start, dur: S.dur, mode: 'pole', key: S.sc.A.start + '|' + S.dur + '|pole',
        pts: [], top: [], scanned: 0, rejected: 0, scored: 0 };
      S.globe.heat = true;
      AA.refresh();
    });
    const active = () => page.evaluate(() => ({
      enabled: !document.querySelector('#lay-heat').disabled,
      legend: !document.querySelector('[data-leg="heat"]').hidden,
      active: AA.scanMatchesMap(AA.S.scout)
    }));
    const yes = { enabled: true, legend: true, active: true }, no = { enabled: false, legend: false, active: false };
    assert.deepEqual(await active(), yes);
    await page.locator('[data-t="B"]').click();
    assert.deepEqual(await active(), no);
    await page.locator('[data-t="A"]').click();
    assert.deepEqual(await active(), yes);
    await page.locator('[data-inspector="search"]').click();
    await page.locator('[data-mode="moon"]').click();
    assert.deepEqual(await active(), no);
  } finally { await page.close(); }
});
