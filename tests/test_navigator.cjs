'use strict';
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let browser, page, errors;

before(async () => {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  errors = [];
  page = await browser.newPage({ viewport: { width: 1280, height: 950 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(path.join(root, 'navigator/dist/AstroApex.html')).href + '#l=tr');
  await page.waitForFunction(() => window.AA?.Polar.ready && window.AAScout && window.AAReport);
});
afterEach(async () => {
  await page.close();
  assert.deepEqual(errors, [], 'No unexpected browser exceptions');
});

test('standalone package embeds the exact source and retains six usable pickers', async () => {
  const html = await fs.readFile(path.join(root, 'navigator/dist/AstroApex.html'), 'utf8');
  const index = await fs.readFile(path.join(root, 'navigator/index.html'), 'utf8');
  const scripts = [...index.matchAll(/<script src="(js\/[^"?]+)(?:\?[^"]*)?"><\/script>/g)];
  assert.ok(scripts.length >= 7);
  for (const [,relative] of scripts) {
    const source = await fs.readFile(path.join(root, 'navigator', relative), 'utf8');
    assert.ok(html.includes(source.replaceAll('</script', '<\\/script')), relative + ' is current');
  }
  assert.equal(await page.locator('.ap-picker-trigger').count(), 6);
  await page.locator('.site-reports > summary').click();
  assert.equal(await page.locator('#report-A .score strong').innerText(), '78');
  assert.equal(await page.locator('#report-B .score strong').innerText(), '58');
  const slider = page.locator('#scrub');
  await slider.focus(); await slider.press('End');
  assert.equal(await slider.inputValue(), '1000');
  await slider.press('Home');
  assert.equal(await slider.inputValue(), '0');
});

test('same coordinates select the same horizon regardless of named/custom input', async () => {
  const result = await page.evaluate(() => {
    const named = { ...AA.S.sc.A, start: Date.UTC(2026,9,18) };
    const custom = { ...named, site:'custom' };
    const a = AA.simulate(named,14,AA.stepMin(14));
    const b = AA.simulate(custom,14,AA.stepMin(14));
    return {a:a.stats,b:b.stats,ha:a.hz,hb:b.hz};
  });
  assert.equal(result.ha,'lola80'); assert.equal(result.hb,'lola80');
  assert.deepEqual(result.a,result.b);
});

test('pairwise advice explains why neither scenario meets the preliminary constraints', async () => {
  const result = await page.evaluate(async () => {
    AA.setSite('A','malapert'); AA.setSite('B','shackleton');
    AA.S.dur=7; AA.S.sc.A.start=AA.S.sc.B.start=Date.UTC(2027,9,31);
    Object.assign(AA.S.pwr,{load:200,cap:10,area:2}); AA.refresh();
    const a=AAssist.analyze('A'), b=AAssist.analyze('B'), r=AAssist.recommend(a,b);
    return {lead:r.lead,status:r.status,reasons:r.assessments.map(x=>x.reasons.map(y=>y.code)),empty:a.pw.emptyH,earth:b.stats.earth,slope:b.f.slope.mean,
      text:await AAssist.localAnswer('A ile B karşılaştır')};
  });
  assert.equal(result.lead,null); assert.equal(result.status,'none');
  assert.ok(result.reasons[0].includes('battery_empty'));
  assert.ok(result.reasons[1].includes('no_earth_contact'));
  assert.ok(result.reasons[1].includes('steep_slope'));
  assert.ok(result.empty>23 && result.empty<24); assert.equal(result.earth,0); assert.ok(result.slope>32);
  assert.ok(result.text.length>100);
});

test('a short contact outage remains intermittent in cards, chips and summary', async () => {
  const result = await page.evaluate(() => {
    AA.setSite('B','malapert'); AA.S.sc.B.start=Date.UTC(2027,5,23); AA.S.dur=7; AA.refresh();
    return {gap:AA.S.data.B.stats.nocomm,chip:document.querySelectorAll('.vchip')[1].textContent,
      summary:AA.winSummary('B'),card:document.querySelector('#report-B').textContent};
  });
  assert.ok(Math.abs(result.gap-1/6)<1e-9);
  assert.match(result.chip,/kesintili/); assert.doesNotMatch(result.chip,/kesintisiz/);
  assert.match(result.summary,/10 dk/);
  assert.match(result.card,/10 dk/);
  assert.doesNotMatch(result.card,/kesintisiz doğrudan/);
});

test('short joint windows and multi-day minutes stay visible', async () => {
  const result = await page.evaluate(() => {
    for(const k of ['A','B']) {AA.setSite(k,'ridge'); AA.S.sc[k].start=Date.UTC(2027,0,21,3,10);}
    AA.S.dur=7; AA.refresh();
    return {text:document.querySelector('#verdict-h').textContent,duration:AA.fmtDur(81.5),step:AA.stepMin(14)};
  });
  assert.match(result.text,/30 dk/); assert.match(result.duration,/30 dk/); assert.equal(result.step,10);
});

test('English and Turkish delay phrases preserve duration and match the main sampling', async () => {
  const result = await page.evaluate(async () => {
    const stepCalls=[];
    const original=AA.simulate;
    AA.simulate=(sc,dur,step)=>{stepCalls.push({dur,step,start:sc.start});return original(sc,dur,step);};
    AA.S.lang='en';
    const hyphen=await AAssist.localAnswer('How does a seven-day delay affect scenario B?');
    const normal=await AAssist.localAnswer('delay B by seven days');
    const a=await AAssist.localAnswer('Delay A by seven days');
    AA.S.lang='tr';
    const turkish=await AAssist.localAnswer('B’yi yedi gün ertele');
    const earlier=await AAssist.localAnswer('B’yi yedi gün öne al');
    AA.simulate=original;
    return {hyphen,normal,a,turkish,earlier,stepCalls};
  });
  assert.match(result.hyphen,/Jan 15, 2027/); assert.match(result.normal,/Jan 15, 2027/);
  assert.match(result.a,/start of A/); assert.match(result.turkish,/B başlangıcı 7 gün ertelendi/);
  assert.match(result.earlier,/öne alındı/);
  assert.ok(result.stepCalls.length>=3);
  assert.ok(result.stepCalls.some(x=>x.start===Date.UTC(2027,0,15)));
  assert.ok(result.stepCalls.some(x=>x.start===Date.UTC(2027,0,1)));
  assert.ok(result.stepCalls.every(x=>x.dur===14 && x.step===10));
});

test('invalid dates are rejected and leap days are accepted', async () => {
  const result=await page.evaluate(async()=>{
    AA.S.lang='en';
    return {bad:await AAssist.localAnswer('What if B lands on 2026-02-30?'),
      good:await AAssist.localAnswer('What if B lands on 2028-02-29?')};
  });
  assert.match(result.bad,/invalid|valid date|does not exist/i);
  assert.doesNotMatch(result.bad,/data-action/);
  assert.match(result.good,/Feb 29, 2028/);
});

test('a transient local AI failure can recover on the next request', async () => {
  const html = await fs.readFile(path.join(root, 'navigator/dist/AstroApex.html'), 'utf8');
  let requests = 0;
  await page.route('https://astroapex.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/status') {
      return route.fulfill({ json: { ai: true, model: 'test-provider' } });
    }
    if (pathname === '/api/chat') {
      requests++;
      assert.equal(route.request().headers()['x-astroapex-token'], 'test-session');
      return requests === 1
        ? route.fulfill({ status: 429, json: { error: 'Try again' } })
        : route.fulfill({ json: { answer: 'recovered' } });
    }
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.addInitScript(() => sessionStorage.setItem('astroapex-local-token', 'test-session'));
  await page.goto('https://astroapex.test/');
  await page.waitForFunction(() => window.AAssist?.getProviderSettings().authorized && AA.Polar.ready);
  await page.locator('#assist-open').click();
  const ask = async question => {
    await page.locator('#assist-input').fill(question);
    await page.locator('#assist-input').press('Enter');
  };
  await ask('Compare A and B');
  await page.waitForFunction(() => AAssist.getProviderSettings().lastSource === 'local');
  assert.equal(await page.locator('#assist-log .msg.bot small').first().textContent(), 'Local mission calculation');
  assert.equal(requests, 1);
  await ask('Compare A and B again');
  await page.waitForFunction(() => AAssist.getProviderSettings().lastSource === 'anthropic');
  assert.match(await page.locator('#assist-log .msg.bot').last().innerText(), /recovered/);
  assert.equal(requests, 2);
});

test('year explorer and detailed simulation apply the same eclipse visibility', async () => {
  const r=await page.evaluate(()=>{
    AA.setSite('A','malapert');AA.S.sc.A.start=Date.UTC(2026,2,3);AA.refresh(true);
    const sc=AA.S.sc.A,detail=AA.simulate(sc,1,120);
    const minute=AA.simulate({...sc,start:Date.UTC(2026,2,3,11,30)},1/1440,1);
    return {year:{sun:AA.S.year.A.sun[0],earth:AA.S.year.A.earth[0],both:AA.S.year.A.both[0],eclipse:AA.S.year.A.eclipse[0]},
      detail:detail.stats,flux:minute.flux[0]};
  });
  assert.equal(r.flux,0); assert.ok(r.year.eclipse>0);
  for(const key of ['sun','earth','both','eclipse'])assert.ok(Math.abs(r.year[key]-r.detail[key])<1e-6,key);
});

test('the final sample does not add an interval to an outage', async () => {
  const result = await page.evaluate(() => {
    const original = Ephem.observe;
    const run = elevations => {
      let i = 0;
      Ephem.observe = () => ({
        src: 'spice',
        sun: { el: elevations[i], az: 0, rad: 0.27, dist: Ephem.AU },
        earth: { el: elevations[i++], az: 180, rad: 0.9, dist: 384400 }
      });
      return AA.simulate({ site: 'custom', lat: 0, lon: 0, start: 0, mask: 0 }, 20 / 1440, 10);
    };
    try {
      const endpoint = run([10, 10, -10]);
      const trailing = run([10, -10, -10]);
      return {
        endpoint: endpoint.stats,
        trailing: trailing.stats,
        lastEnd: Math.max(...endpoint.runs.sun.map(r => r[1])),
        intervalCount: endpoint.n - 1
      };
    } finally { Ephem.observe = original; }
  });
  assert.equal(result.endpoint.dark, 0);
  assert.equal(result.endpoint.nocomm, 0);
  assert.ok(Math.abs(result.trailing.dark - 1 / 6) < 1e-9);
  assert.equal(result.lastEnd, result.intervalCount);
});

test('countdowns handle continuous visibility and a rise at the final sample', async () => {
  const result = await page.evaluate(() => {
    const oldData = AA.S.data.A, oldCur = AA.S.cur;
    try {
      AA.S.data.A = {
        n: 3, dtH: 1 / 6, sunUp: [1, 1, 1], earthUp: [0, 0, 1],
        runs: { sun: [[0, 2]], earth: [] }
      };
      AA.S.cur = 0;
      const continuous = AA.countdown('A', 'sun'), lastRise = AA.countdown('A', 'earth');
      AA.S.cur = 1 / 3;
      const endpoint = AA.countdown('A', 'earth');
      return { continuous, lastRise, endpoint, expected: AA.t('until_end'), terminal: AA.t('end_visible') };
    } finally { AA.S.data.A = oldData; AA.S.cur = oldCur; }
  });
  assert.equal(result.continuous, result.expected);
  assert.match(result.lastRise, /20 dk/);
  assert.equal(result.endpoint, result.terminal);
});

test('English possessive scenario names override earlier conversation context', async () => {
  const result = await page.evaluate(async () => {
    AA.S.lang = 'en';
    await AAssist.localAnswer('What is the slope for scenario B?');
    return {
      straight: await AAssist.localAnswer("What is A's slope?"),
      curly: await AAssist.localAnswer('What is A’s battery?')
    };
  });
  assert.match(result.straight, /Connecting Ridge/);
  assert.match(result.curly, /Connecting Ridge/);
});

test('each sample retains its source across the SPICE coverage boundary', async () => {
  const sources = await page.evaluate(() => {
    const sc = { site: 'custom', lat: 0, lon: 0, mask: 0, start: Ephem.range[1] - 3600000 };
    const d = AA.simulate(sc, 0.25, 60);
    return { run: d.src, values: Array.from(d.fromSpice) };
  });
  assert.equal(sources.run, 'mixed');
  assert.ok(sources.values.includes(0));
  assert.ok(sources.values.includes(1));
});

test('rover routes state relaxed limits and report their displayed path distance', async () => {
  const result=await page.evaluate(()=>{
    const distance=(a,b)=>{const rad=Math.PI/180;const h=Math.sin((a[0]-b[0])*rad/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin((a[1]-b[1])*rad/2)**2;return 2*1737.4*Math.asin(Math.min(1,Math.sqrt(h)));};
    return [[-85.310,146.604],[-87.927,-36.041],[-89.4632,-137.49]].map(([lat,lon])=>{
      const r=AA.Polar.route(lat,lon),g=AA.Polar.grid();
      let km=0,corners=0;
      const cell=pt=>{const [x,y]=AA.Polar.toXY(...pt);return [Math.floor(x/g.cell+g.n/2),Math.floor(g.n/2-y/g.cell)];};
      for(let i=1;i<r.path.length;i++){
        km+=distance(r.path[i-1],r.path[i]);const [a,b]=cell(r.path[i-1]),[c,d]=cell(r.path[i]);
        if(a!==c&&b!==d&&(g.slope[b*g.n+c]/4>r.limit||g.slope[d*g.n+a]/4>r.limit))corners++;
      }
      return {found:r.found,limit:r.limit,relaxed:r.relaxed,max:r.maxSlope,km:r.km,drawn:km,corners};
    });
  });
  assert.equal(result[0].relaxed,true);
  for(const r of result){assert.equal(r.found,true);assert.ok(r.max<=r.limit);assert.ok(Math.abs(r.km-r.drawn)<1e-8);assert.equal(r.corners,0);}
});

test('scout winners use the same coordinates, horizon and score as scenario cards', {timeout:90000}, async()=>{
  const result=await page.evaluate(async()=>{
    const r=await AAScout.run('A','pole');
    return r.top.map(p=>{
      const sc={site:'custom',lat:p.lat,lon:p.lon,start:r.start,mask:p.mask};
      const d=AA.simulate(sc,r.dur,AA.stepMin(r.dur)),a=AAssist.evaluate(sc,d);
      return {score:p.score,actual:a.score,both:p.both,actualBoth:d.stats.both};
    });
  });
  assert.equal(result.length,5);
  for(const r of result){assert.equal(r.score,r.actual);assert.equal(r.both,r.actualBoth);}
});

test('PDF has searchable Turkish text and its preview has a semantic transcript', async()=>{
  const bytes=await page.evaluate(async()=>{
    AA.setSite('A','malapert');AA.setSite('B','shackleton');AA.S.dur=7;
    AA.S.sc.A.start=AA.S.sc.B.start=Date.UTC(2027,9,31);AA.refresh();
    await AAReport.open();
    return Array.from(new Uint8Array(await AAReport.toPDF(AAReport.build()).arrayBuffer()));
  });
  assert.ok(await page.locator('.rep-transcript').count());
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'astroapex-pdf-test-'));
  try{
    const file=path.join(folder,'report.pdf');await fs.writeFile(file,Buffer.from(bytes));
    const python=process.env.PDF_TEST_PYTHON || 'python3';
    const output=execFileSync(python,['-c',
      'from pypdf import PdfReader;import json,sys;r=PdfReader(sys.argv[1]);print(json.dumps({"pages":len(r.pages),"text":" ".join(p.extract_text() or "" for p in r.pages)},ensure_ascii=False))',file],{encoding:'utf8'});
    const parsed=JSON.parse(output);assert.equal(parsed.pages,2);
    assert.match(parsed.text,/Güneş/);assert.match(parsed.text,/Dünya/);
    assert.match(parsed.text,/Hiçbir|hiçbiri|karşılamıyor/);
    assert.ok(parsed.text.length>1800);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('PDF altitude chart contains relative-to-horizon samples below minus 90 degrees', async () => {
  const result = await page.evaluate(() => {
    AA.setPoint('A', 0, 120);
    AA.S.sc.A.mask = 5;
    AA.S.dur = 29.5;
    AA.refresh();
    const min = Math.min(...AA.S.data.A.sunM);
    const proto = CanvasRenderingContext2D.prototype;
    const rect = proto.rect, lineTo = proto.lineTo;
    const clips = new WeakMap();
    let samples = 0, cropped = 0;
    try {
      proto.rect = function(x, y, width, height) {
        clips.set(this, [y, y + height]);
        return rect.call(this, x, y, width, height);
      };
      proto.lineTo = function(x, y) {
        const bounds = clips.get(this);
        if (bounds && this.strokeStyle === '#d98a00' && this.lineWidth === 2.5) {
          samples++;
          if (y < bounds[0] - 0.01 || y > bounds[1] + 0.01) cropped++;
        }
        return lineTo.call(this, x, y);
      };
      const pages = AAReport.build();
      const endTicks = pages[1].reportTextRuns.filter(run => run.text === '29,5 g').length;
      return {min, samples, cropped, endTicks};
    } finally {
      proto.rect = rect; proto.lineTo = lineTo;
    }
  });
  assert.ok(result.min < -90);
  assert.ok(result.samples > 1000);
  assert.equal(result.cropped, 0);
  assert.equal(result.endTicks, 3);
});

test('CSV preserves original columns and includes scenario provenance', async()=>{
  await page.locator('#compare > details').last().locator('summary').click();
  const waiting=page.waitForEvent('download');
  await page.locator('[data-csv="A"]').click();const download=await waiting;
  const content=await fs.readFile(await download.path(),'utf8');
  const [header,row]=content.split('\n');
  assert.ok(header.startsWith('utc,sun_elevation_deg,sun_azimuth_deg,sun_disc_fraction,earth_elevation_deg,earth_azimuth_deg,earth_visible'));
  assert.match(header,/ephemeris,horizon_model,horizon_data,terrain_grid_m/);
  assert.match(row,/,spice,lola,lola80,80,/);
  assert.match(download.suggestedFilename(),/20270108T0000Z_14d_lola80/);
});


test('share action round-trips independent dates, coordinates, horizon, language, duration and power', async () => {
  const plan = () => ({ sc: AA.S.sc, lang: AA.S.lang, dur: AA.S.dur, pwr: AA.S.pwr });
  await page.evaluate(() => {
    AA.setPoint('A', 12.345, -91.246);
    AA.S.sc.A.mask = 2;
    AA.S.sc.A.start = Date.UTC(2028, 1, 29, 23, 44);
    AA.S.sc.B.start = Date.UTC(2030, 11, 31, 3, 17);
    AA.S.dur = 7;
    AA.setPower({ load: 120, cap: 12.5, area: 2.5 });
    AA.refresh();
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
      writeText: async (text) => { window.sharedScenario = text; }
    }});
  });
  const expected = await page.evaluate(plan);
  await page.locator('#compare > details').last().locator('summary').click();
  await page.locator('#share').click();
  const url = await page.evaluate(() => window.sharedScenario);
  assert.ok(url && new URL(url).hash.includes('a=custom'));
  await page.goto(url);
  await page.reload();
  await page.waitForFunction(() => window.AA?.Polar.ready);
  assert.deepEqual(await page.evaluate(plan), expected);
});

test('mismatched names and malformed links cannot mislabel a site or break initialization', async () => {
  const base = page.url().split('#')[0];
  const defaults = await page.evaluate(() => AA.S.sc);
  await page.goto(base + '#a=ridge|0|90|2028-02-29T02:30|0&b=custom|2|Infinity|2027-02-30T01:00|0&l=toString');
  await page.reload();
  await page.waitForFunction(() => window.AA?.Polar.ready);
  const actual = await page.evaluate(() => ({ lang: AA.S.lang, a: AA.S.sc.A, b: AA.S.sc.B, name: AA.siteName('A') }));
  assert.equal(actual.a.lat, 0); assert.equal(actual.a.lon, 90);
  assert.equal(actual.a.site, 'custom');
  assert.notEqual(actual.name, 'Connecting Ridge');
  assert.ok(['en', 'tr'].includes(actual.lang));
  assert.deepEqual(actual.b, defaults.B);
});

test('guided tour restores its origin and translated keyboard controls preserve the mission clock', async () => {
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('.nav [data-tab=settings]').click();
  assert.equal(await page.locator('.nav').getAttribute('aria-label'), 'Bölümler');
  assert.equal(await page.locator('#scrub').getAttribute('aria-label'), 'Görev zamanı');
  assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Oynat');

  await page.locator('#tour-open').click();
  await page.locator('.tp-next').click();
  await page.locator('.tp-next').click();
  assert.ok(await page.locator('.preset-menu').evaluate(el => el.open));
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#settings').isVisible());
  assert.equal(await page.locator('.preset-menu').evaluate(el => el.open), false);
  assert.equal(await page.locator(':focus').getAttribute('id'), 'tour-open');

  await page.locator('.nav [data-tab=resources]').click();
  const table = page.locator('#verify');
  await table.focus();
  const cursor = await page.locator('#scrub').inputValue();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#verify').scrollLeft > 0);
  assert.equal(await page.locator('#scrub').inputValue(), cursor);
});

test('eclipse at sunrise clips the same solar disc against both Earth and the horizon', async () => {
  const result = await page.evaluate(() => {
    const lat = 10, lon = -84.1069015, start = Date.UTC(2026, 2, 3, 9, 20);
    const mission = AA.simulate({site: 'custom', lat, lon, start, mask: 0}, 1, 10);
    const sample = Ephem.observe(Ephem.site(lat, lon), start);
    // Independently estimate the visible fraction by counting rays on a fine solar-disc grid.
    const rad = Math.PI / 180, elevation = sample.sun.el * rad, azimuth = sample.sun.az * rad;
    const direction = (a, e) => [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
    const earth = direction(sample.earth.az * rad, sample.earth.el * rad);
    const centre = direction(azimuth, elevation), right = [-Math.sin(azimuth), Math.cos(azimuth), 0];
    const up = direction(azimuth, elevation + Math.PI / 2);
    let total = 0, lit = 0;
    for (let y = -199; y < 200; y += 2) for (let x = -199; x < 200; x += 2) {
      if (x*x + y*y > 200*200) continue;
      const angle = Math.tan(sample.sun.rad * rad) / 200;
      const ray = centre.map((v, j) => v + angle * (x * right[j] + y * up[j]));
      const dot = ray.reduce((sum, v, j) => sum + v * earth[j], 0) / Math.hypot(...ray);
      if (ray[2] > 0 && dot < Math.cos(sample.earth.rad * rad)) lit++;
      total++;
    }
    const last = Ephem.observe(Ephem.site(lat, lon), start + 86400000);
    return {actual: mission.frac[0], expected: lit / total, firstRadius: mission.earthR[0],
      lastRadius: mission.earthR[mission.n - 1], expectedFirst: sample.earth.rad, expectedLast: last.earth.rad};
  });
  assert.ok(Math.abs(result.actual - result.expected) < 0.001);
  assert.ok(Math.abs(result.firstRadius - result.expectedFirst) < 1e-6);
  assert.ok(Math.abs(result.lastRadius - result.expectedLast) < 1e-6);
});

test('two-week polar visibility durations agree with JPL Horizons on the same terrain profiles', async () => {
  // Reproduce using Horizons OBSERVER at coord@301 with QUANTITIES='4,13' (az/el,
  // apparent diameter), UTC 2027-01-08 through 2027-01-22, STEP_SIZE='10m'.
  // Across 2,016 intervals per site, sum Sun upper limb / Earth centre above the
  // interpolated 80 m site skyline; count the final instantaneous sample for 0 h.
  const values = await page.evaluate(() => ['ridge', 'malapert'].map(site => {
    const terrain = AA.TERRAIN[site];
    const d = AA.simulate({site, lat:terrain.lat, lon:terrain.lon, start:Date.UTC(2027,0,8), mask:'lola'}, 14, 10);
    return [d.stats.sun, d.stats.earth, d.stats.both].map(h => Math.round(h * 6));
  }));
  const horizonsCounts = [[1894, 1382, 1260], [913, 1592, 489]];
  values.forEach((counts, site) => counts.forEach((n, metric) => {
    assert.ok(Math.abs(n - horizonsCounts[site][metric]) <= 1, `site ${site} metric ${metric} = ${n} samples`);
  }));
});
