(() => {
  const id = key => document.getElementById(key);
  const panel = id("assistPanel"), log = id("assistLog"), scroller = id("assistScroll");
  const input = id("assistQuestion"), opener = id("assistOpen");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let exitAnimation;
  let markAnimation;
  const api = () => window.missionConsole;
  function signature(state) {
    return JSON.stringify([state.plan, state.pinned?.plan || null]);
  }
  const bylineText = state => "Görev özeti · " + (state.plan.dataMode === "horizons" ? "JPL Horizons" : "Demo model");
  function context(state) {
    id("assistContext").textContent = state.plan.site + " · " + (state.plan.date || "Tarih seçilmedi") + " · " + state.plan.days + " gün · " + (state.plan.dataMode === "horizons" ? "JPL Horizons" : "Demo model");
  }
  let lastSignature;
  function refresh(state) {
    const current = signature(state);
    if (current === lastSignature) return;
    lastSignature = current;
    context(state);
    for (const line of log.querySelectorAll("[data-signature]")) {
      const stale = line.dataset.signature !== current;
      line.classList.toggle("stale", stale);
      line.querySelector(".assist-scope").textContent = stale ? "Önceki plan · yeniden sorabilirsiniz" : bylineText(state);
      const button = line.querySelector("button");
      if (button) button.disabled = stale;
    }
  }
  window.addEventListener("mission:update", e => {
    if (e.detail.source === "pin" || e.detail.source === "plan") refresh(e.detail);
  });
  function open() {
    if (panel.open || !api()) return;
    refresh(api().getState()); panel.showModal();
    id("assistClose").focus({preventScroll:true});
  }
  function close(then) {
    if (!panel.open || exitAnimation) return;
    function finish() {
      panel.close(); exitAnimation = null;
      opener.focus({preventScroll:true});
      if (then) then();
    }
    if (reduced.matches || !panel.animate) return finish();
    exitAnimation = panel.animate([{transform:"translateX(0)",opacity:1},{transform:"translateX(28px)",opacity:0}],{duration:140,easing:"ease-in"});
    exitAnimation.onfinish = finish;
    exitAnimation.oncancel = finish;
  }
  opener.addEventListener("click", open);
  id("assistClose").addEventListener("click", () => close());
  panel.addEventListener("cancel", e => {e.preventDefault(); close();});
  panel.addEventListener("click", e => {if(e.target===panel) close();});
  panel.addEventListener("keydown", e => e.stopPropagation());
  function element(tag, cls, text) {
    const el = document.createElement(tag); el.className = cls; el.textContent = text; return el;
  }
  function respond(intent, question) {
    if (!question || exitAnimation) return;
    const state = api().getState();
    refresh(state);
    const reply = window.readBriefing(intent, question, state);
    const turn = element("article","assist-turn","");
    turn.dataset.signature = signature(state);
    const byline = element("div","assist-byline","");
    const trace = opener.querySelector("svg").cloneNode(true);
    byline.append(trace,element("small","assist-scope",bylineText(state)));
    turn.append(element("p","assist-query",question),byline,element("p","assist-answer",reply.text));
    if (reply.action) {
      const act = reply.action;
      const button = element("button","assist-action",act.label);button.type="button";
      button.addEventListener("click", () => {
        if (turn.dataset.signature !== signature(api().getState())) return;
        close(()=>{
          if (act.type === "jump") api().jump(act.hour);
          else if (act.type === "compare") api().navigate("compare");
          else if (act.type === "pin") {api().pin(); api().navigate("compare");}
        });
      });
      turn.append(button);
    }
    log.append(turn);
    if (log.children.length>12) log.firstElementChild.remove();
    input.value="";
    if (!reduced.matches && panel.animate) {
      markAnimation?.cancel();
      markAnimation = panel.querySelector(".assist-orbit .orbit-mark g").animate([
        {transform:"rotate(0) scale(1)"},{transform:"rotate(-16deg) scale(.90,1.1)",offset:.26},
        {transform:"rotate(12deg) scale(1.08,.95)",offset:.56},{transform:"rotate(0) scale(1)"}
      ],{duration:480,easing:"ease-out"});
    }
    turn.scrollIntoView({block:"nearest",behavior:reduced.matches?"instant":"smooth"});
  }
  panel.querySelectorAll("[data-intent]").forEach(button=>button.addEventListener("click",()=>respond(button.dataset.intent,button.textContent)));
  id("assistForm").addEventListener("submit",e=>{e.preventDefault();respond("ask",input.value.trim());});
  panel.addEventListener("close",()=>{markAnimation?.cancel();});
  reduced.addEventListener("change",e=>{if(e.matches){markAnimation?.cancel();exitAnimation?.finish();scroller.scrollTo({top:scroller.scrollTop,behavior:"instant"});}});
})();
