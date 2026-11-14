// Rule-based mission briefings. Answers use the same interval records as the console.
(() => {
  "use strict";
  const utc = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const number = new Intl.NumberFormat("tr-TR", {maximumFractionDigits: 2});
  const length = run => run.end - run.begin;
  const longest = runs => runs.reduce((best, run) =>
    !best || length(run) > length(best) ? run : best, null);
  const jump = run => ({label: "Başlangıcı simülasyonda aç", type: "jump", hour: run.begin});
  const fold = text => String(text || "").toLocaleLowerCase("tr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  const noWindow = "Bu görevde Güneş ve Dünya aynı anda görünmüyor. Başka bir başlangıç tarihi, saha veya arazi eşiği deneyebilirsin.";

  function describeWindow(d, q) {
    const runs = d.intervals.overlap;
    const requirement = q.match(/(-?\d+(?:[.,]\d+)?)\s*(?:saat|hours?|hrs?|h\b)/);
    const minimum = requirement ? Number(requirement[1].replace(",", ".")) : null;
    if (minimum !== null && minimum <= 0) return {text: "Aranan kesintisiz süreyi pozitif bir saat sayısıyla yaz."};
    if (!runs.length) return {text: noWindow};
    const best = longest(runs);
    const match = minimum === null ? best : runs.find(run => length(run) >= minimum);
    if (!match) return {text: `Bu görevde ${number.format(minimum)} saatlik kesintisiz ortak görüş sağlanmıyor. En uzun aralık ${length(best)} saat; görev boyunca ayrı aralıkların toplamı ${d.overlapHours} saat.`, action: jump(best)};
    const stamp = offset => utc.format(d.start + offset * 3600000);
    const lead = minimum === null ? "En uzun kesintisiz ortak görüş aralığı" : "İstenen süreyi karşılayan ilk ortak görüş aralığı";
    const next = d.samples[match.end];
    let reason = "Aralık, görev süresinin sonunda bitiyor.";
    if (next) {
      const body = !next.sun && !next.earth ? "Güneş ve Dünya" : !next.sun ? "Güneş" : "Dünya";
      reason = `${body} arazi eşiğini aşamadığında aralık kapanıyor.`;
    }
    return {text: `${lead} ${length(match)} saat sürüyor: ${stamp(match.begin)} – ${stamp(match.end)} UTC. ${reason}`, action: jump(match)};
  }
  function compare(state) {
    if (!state.pinned) {
      if (!Number.isFinite(state.plan.watts) || state.plan.watts < 50 || state.plan.watts > 2000)
        return {text:"A planını sabitlemek için panel gücünü 50–2.000 W arasında seç."};
      return {text: "Önce bir referans plan seçelim. Bu görevi A olarak sabitle, sonra saha veya tarihi değiştirip B ile karşılaştır.", action: {label:"Bu planı A olarak sabitle",type:"pin"}};
    }
    const a = state.pinned.scenario, b = state.scenario;
    function difference(delta, name) {
      return delta === 0 ? `${name} iki planda eşit.` :
        `B planında ${name.toLocaleLowerCase("tr")} ${Math.abs(delta)} saat daha ${delta > 0 ? "uzun" : "kısa"}.`;
    }
    const durations = a.days === b.days ? "" : `A ${a.days}, B ${b.days} gün sürdüğü için toplamlar farklı görev sürelerini kapsıyor. `;
    return {text: durations + difference(b.overlapHours - a.overlapHours,"Toplam ortak görüş") + " " + difference(b.longestDark - a.longestDark,"En uzun karanlık dönem"),
      action:{label:"Planları yan yana gör",type:"compare"}};
  }
  window.readBriefing = function (intent, question, state) {
    if (!state?.scenario) return {text:state?.plan?.dataMode === "horizons" ?
      "Bu seçim için Horizons kaydı hazır değil. Veri kaynağı bildirimini ve tarih aralığını kontrol et." :
      "Görev hesabı için geçerli bir başlangıç tarihi seçip yeniden sor."};
    const d=state.scenario, q=fold(question);
    if (intent === "compare" || (intent === "ask" && /karsilastir|kiyas|plan b|b plani|a\/b|compare|fark/.test(q))) return compare(state);
    // Direct Earth visibility and joint Sun/Earth visibility are different metrics.
    if (intent === "ask" && /dunya|dte|earth/.test(q) && !/ortak|birlikte|gunes|overlap|both|sunlight/.test(q)) {
      const earth = longest(d.intervals.earth);
      return {text:`Bu görevde Dünya için ${d.windows} geometrik görüş penceresi var. ${earth ? "En uzun Dünya görüşü " + length(earth) + " saat." : "Dünya seçilen arazi eşiğini aşmıyor."} Radyo bağlantısı için anten ve bağlantı koşulları da önemlidir.`};
    }
    if (intent === "window" || (intent === "ask" && /pencere|kesintisiz|deney|aralik|window|continuous|experiment|\d\s*(saat|hours?|hrs?|h\b)/.test(q) && !/karanlik|dark/.test(q))) return describeWindow(d,q);
    if (intent === "ask" && /karanlik|gece|dark/.test(q)) return {text:`${d.site} için bu ${d.days} günlük görevde en uzun kesintisiz karanlık dönem ${d.longestDark} saat. Bu süreyi model, Güneş'in arazi eşiğinin üzerinde görünmediği ardışık saatlerden hesaplıyor.`};
    if (intent === "ask" && /enerji|panel|watt|energy/.test(q)) {
      const w=state.plan.watts;
      if(!Number.isFinite(w) || w<50 || w>2000) return {text:"Enerji tahmini için 50–2.000 W arasında bir panel gücü gir."};
      return {text:`Panel gücü ${number.format(w)} W ve aydınlık süre ${d.sunHours} saat. Modelin 0,72 sistem katsayısıyla tahmini enerji ${number.format(Math.round(w*d.sunHours*netEnergyFactor))} Wh.`};
    }
    if (intent === "ask" && /ortak gorus|birlikte gorun|overlap/.test(q)) {
      const run = longest(d.intervals.overlap);
      return {text:run ? `Görev boyunca toplam ${d.overlapHours} saat ortak görüş var. Bu toplam ${d.intervals.overlap.length} ayrı aralıktan oluşuyor; en uzun aralık ${length(run)} saat.` : noWindow, ...(run ? {action:jump(run)} : {})};
    }
    if (intent === "ask" && /aydinlanma|aydinlik|gunes|sunlight/.test(q)) return {text:`Bu ${d.days} günlük görevde Güneş, seçilen arazi eşiğini ${d.sunHours} saat boyunca aşıyor. Bu, görev süresinin yaklaşık %${d.light}’ine karşılık geliyor.`};
    if (intent === "summary" || (intent === "ask" && /ozet|summary|brief/.test(q))) {
      const run=longest(d.intervals.overlap);
      return {text:`${d.site} için ${d.days} günlük ${state.plan.dataMode === "horizons" ? "Horizons hesabında" : "demo görevinde"} Güneş ve Dünya toplam ${d.overlapHours} saat birlikte görünüyor. ${run ? "En uzun kesintisiz ortak görüş " + length(run) + " saat." : "Kesintisiz ortak görüş aralığı oluşmuyor."} En uzun karanlık dönem ${d.longestDark} saat.`, ...(run ? {action:jump(run)} : {})};
    }
    return {text:"Görev özeti, ortak görüş aralıkları, karanlık süre, panel enerjisi ve A/B farkları hakkında yanıt verebilirim. Örneğin “40 saatlik kesintisiz ortak görüş var mı?” diye sor."};
  };
})();
