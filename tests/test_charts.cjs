'use strict';
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

let browser, page;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(path.resolve(__dirname, '../navigator/index.html')).href + '#l=en');
  await page.waitForFunction(() => window.AA?.Polar.ready);
});
afterEach(async () => { await page.close(); });

test('actual sky and console distinguish the eclipse above the horizon from the terrain', async () => {
  const result = await page.evaluate(() => {
    AA.setPoint('A', 0, 0);
    AA.S.sc.A.start = Date.UTC(2026, 2, 3, 11, 30);
    AA.S.dur = 7; AA.refresh(); AA.showTab('sky');
    const d = AA.S.data.A;
    const card = document.querySelector('#sky-A [data-ro=sun]');
    const sky = card.querySelector('.ro-big').textContent;
    const state = card.querySelector('.ro-top span').textContent;
    AA.showTab('console');
    return { angle: d.sunEl[0], fraction: d.frac[0], sky, state,
      consoleSun: document.querySelector('#mc-sun-now').textContent,
      time: document.querySelector('#mc-utc').textContent };
  });
  assert.ok(result.angle > 85 && result.angle < 86);
  assert.equal(result.fraction, 0);
  assert.equal(result.state, 'eclipsed');
  assert.match(result.consoleSun, /not visible|eclipsed/i);
  assert.ok(result.consoleSun.includes(result.sky));
  assert.match(result.time, /11:30 UTC/);
});

test('mobile time axes include the exact endpoint, and all cursor markers sit on their drawn lines', async () => {
  const charts = await page.evaluate(() => {
    AA.S.dur = 29.5; AA.refresh();
    const series = AA.S.data.A;
    // Stress the renderer with a beyond-nadir *relative* elevation and steep adjacent samples.
    // These are graphics fixtures; ephemeris values are validated separately.
    series.sunM[0] = -95; series.sunM[1] = -75;
    series.earthM[0] = 0; series.earthM[1] = 10;
    series.pw.soc[0] = 1; series.pw.soc[1] = .8;
    AA.S.cur = series.dtH * .25;
    const result = {};
    for (const id of ['chart-sun', 'chart-earth', 'chart-batt']) {
      const cv = document.getElementById(id), ctx = cv.getContext('2d');
      const seriesPoints = [], markers = [], ticks = [];
      let firstCurve = true;
      const originalStroke = ctx.stroke.bind(ctx), originalMove = ctx.moveTo.bind(ctx),
        originalLine = ctx.lineTo.bind(ctx), originalArc = ctx.arc.bind(ctx), originalText = ctx.fillText.bind(ctx);
      // The first solid 2.5 px stroke in each chart is scenario A's time series.
      function isCurve() { return firstCurve && ctx.lineWidth === 2.5 && !ctx.getLineDash().length; }
      ctx.moveTo = (x, y) => { if (isCurve()) seriesPoints.push([x,y]); originalMove(x,y); };
      ctx.lineTo = (x, y) => { if (isCurve() && seriesPoints.length < 2) seriesPoints.push([x,y]); originalLine(x,y); };
      ctx.stroke = () => { if (isCurve()) firstCurve = false; originalStroke(); };
      ctx.arc = (...args) => { if (args[2] === 4.5) markers.push(args.slice(0,2)); originalArc(...args); };
      ctx.fillText = (str, x, y) => {
        if (/^\d+(?:\.\d+)? d$/.test(str)) {
          const half = ctx.measureText(str).width / 2; ticks.push({ str, left: x - half, right: x + half });
        }
        originalText(str,x,y);
      };
      result[id] = {seriesPoints, markers, ticks};
    }
    AA.showTab('time');
    return result;
  });
  for (const [id, {seriesPoints, markers, ticks}] of Object.entries(charts)) {
    assert.equal(ticks[0].str, '0 d', id);
    assert.equal(ticks.at(-1).str, '29.5 d', id);
    assert.ok(ticks.every((tick, i) => !i || ticks[i-1].right < tick.left), id + ' has distinct tick labels');
    assert.equal(seriesPoints.length, 2);
    assert.equal(markers.length, 2);
    for (const axis of [0, 1]) {
      const expected = seriesPoints[0][axis] * .75 + seriesPoints[1][axis] * .25;
      assert.ok(Math.abs(markers[0][axis] - expected) < .001, id + ' cursor intersects A');
    }
    if (id === 'chart-sun') assert.ok(seriesPoints[0][1] < 230 - 26, '−95° relative sample remains inside plot');
  }
});

test('comparison and console bands conserve visible time, including fractional hours', async () => {
  const result = await page.evaluate(() => {
    const mc = [], compare = [];
    const widths = el => Array.from(el.querySelectorAll('i'), span => parseFloat(span.style.width)).reduce((a,b)=>a+b,0);
    for (const [i,k] of ['A', 'B'].entries()) {
      const d = AA.S.data[k];
      for (const key of ['sun','earth','both']) {
        const expected = Array.from(d[key === 'both' ? key : key + 'Up'].slice(0,-1)).reduce((a,b)=>a+b,0) / (d.n-1) * 100;
        compare.push(widths(document.querySelectorAll('.wcard')[i].querySelector('.track.' + key)) - expected);
        AA.showTab('console'); document.querySelector('[data-mc-site="' + k + '"]').click();
        mc.push(widths(document.querySelector('[data-mc-band="' + key + '"] .mc-track')) - expected);
      }
    }
    return [...mc,...compare];
  });
  assert.equal(result.length, 12);
  assert.ok(result.every(difference => Math.abs(difference) < .001));
});

test('sky marker coordinates match the displayed angle axes and azimuth crossings break the paths', async () => {
  const r = await page.evaluate(() => {
    AA.setPoint('A', -35, 15); AA.S.dur = 90; AA.refresh(); AA.showTab('sky');
    const canvas = document.querySelector('#sky-A canvas'), ctx = canvas.getContext('2d');
    const labels = [], discs = [], segments = [];
    for (const method of ['fillText','arc','moveTo','lineTo']) {
      const original = ctx[method].bind(ctx);
      ctx[method] = (...args) => {
        if (method === 'fillText' && /^-?\d+°$/.test(args[0])) labels.push([parseFloat(args[0]),args[2]]);
        if (method === 'arc') discs.push(args.slice(0,3));
        if (['moveTo','lineTo'].includes(method) && ctx.getLineDash().length) segments.push([method,args[0]]);
        return original(...args);
      };
    }
    const d = AA.S.data.A, i = Math.floor(d.n * .37);
    AA.S.cur = i * d.dtH;
    AA.drawSky('A'); const width = Math.round(canvas.getBoundingClientRect().width);
    return { labels, discs, segments, width, bodies: ['earth','sun'].map(b=>[d[b+'Az'][i],d[b+'El'][i]]) };
  });
  const [[degree, ordinate], [nextDegree, nextOrdinate]] = r.labels;
  const pixelsPerDegree = (nextOrdinate-ordinate)/(nextDegree-degree);
  const span = r.width - 40 - 10;
  assert.equal(r.discs.length,4); // glow and centre marker for each of two bodies
  for (const [i,[az, el]] of r.bodies.entries()) {
    const [x,y] = r.discs[i*2+1];
    assert.ok(Math.abs(x - (40 + az/360*span)) < .01);
    assert.ok(Math.abs(y - (ordinate+(el-degree)*pixelsPerDegree)) < .01);
  }
  assert.ok(r.segments.filter(([type])=>type==='moveTo').length>2, 'fixture crosses the azimuth seam');
  assert.ok(r.segments.every(([type,x],i) => type==='moveTo' || Math.abs(x-r.segments[i-1][1]) <= span/2));
});

test('year explorer brightness and selected date match the day under the pointer', async () => {
  await page.setViewportSize({width:1000,height:800});
  const values = await page.evaluate(() => {
    AA.S.sc.B.start = Date.UTC(2027,0,8,22,45); AA.refresh(true);
    AA.showTab('time');
    const cv=document.querySelector('#year-B'), y=AA.S.year.B;
    // Exclude the mission-outline stroke; index the actual raster at the centre of a day cell.
    const iDark=y.both.indexOf(Math.min(...y.both)), iBright=y.both.indexOf(Math.max(...y.both));
    const rgb = i => Array.from(cv.getContext('2d').getImageData(Math.floor((i+.5)*cv.width / 365),15,1,1).data);
    const dark=rgb(iDark), bright=rgb(iBright);
    const day = 130, rect=cv.getBoundingClientRect(), event={bubbles:true,clientX:rect.left+(day+.5)*rect.width/365};
    cv.dispatchEvent(new MouseEvent('mousemove',event));
    const read=document.querySelector('#year-read').textContent;
    const expected=AA.t('year_cell',{d:AA.fmtDate(y.day0+day*86400000,false),s:y.sun[day],e:y.earth[day],b:y.both[day]});
    cv.dispatchEvent(new MouseEvent('click',event));
    return {hours:[y.both[iDark],y.both[iBright]],green:[dark[1],bright[1]],read,expected,newStart:AA.S.sc.B.start};
  });
  assert.ok(values.hours[1] > values.hours[0]);
  assert.ok(values.green[1] > values.green[0]);
  assert.equal(values.read,'B · '+values.expected);
  assert.equal(values.newStart,Date.UTC(2027,0,8+130,22,45));
});
