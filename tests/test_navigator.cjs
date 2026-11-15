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
  for (const name of ['app', 'assistant', 'polar', 'scout', 'report', 'fx', 'pickers']) {
    const source = await fs.readFile(path.join(root, 'navigator/js', name + '.js'), 'utf8');
    assert.ok(html.includes(source.replaceAll('</script', '<\\/script')), name + ' is current');
  }
  assert.equal(await page.locator('.ap-picker-trigger').count(), 6);
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
  await page.waitForFunction(() => window.AstroApexAI && window.AA?.Polar.ready);
  const result = await page.evaluate(async () => {
    let failed = false;
    try { await AstroApexAI.ask('first', {}); } catch (_) { failed = true; }
    const availableForRetry = !!window.AstroApexAI;
    const recovered = availableForRetry ? await AstroApexAI.ask('second', {}) : null;
    return { failed, availableForRetry, recovered };
  });
  assert.deepEqual(result, { failed: true, availableForRetry: true, recovered: 'recovered' });
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

