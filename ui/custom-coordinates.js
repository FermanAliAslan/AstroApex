// A custom coordinate is stored in the site value so saved plans remain portable.
(() => {
  "use strict";
  const select = document.getElementById("site");
  const label = select?.closest("label");
  if (!label || !window.missionConsole) return;
  const field = document.createElement("div");
  field.className = "custom-site-field";
  label.before(field);
  field.append(label);
  const open = document.createElement("button");
  open.type = "button";
  open.id = "customSiteOpen";
  open.textContent = "+";
  open.title = "Koordinat gir";
  open.setAttribute("aria-label","Özel saha koordinatlarını gir");
  open.setAttribute("aria-haspopup","dialog");
  field.append(open);

  const dialog = document.createElement("dialog");
  dialog.id = "customSiteDialog";
  dialog.setAttribute("aria-labelledby","customSiteTitle");
  dialog.setAttribute("aria-describedby","customSiteHelp");
  dialog.innerHTML = `
    <form>
      <h2 id="customSiteTitle">Koordinatla saha seç</h2>
      <p id="customSiteHelp">Ay yüzeyindeki konumu ondalık dereceyle girin. Güney enlemi ve batı boylamı için eksi işareti kullanın.</p>
      <div class="custom-coordinate-pair">
        <label>Enlem (°)<input id="customLatitude" required type="number" min="-90" max="90" step="any" inputmode="decimal" placeholder="−89,77" autofocus></label>
        <label>Doğu boylamı (°)<input id="customLongitude" required type="number" min="-180" max="180" step="any" inputmode="decimal" placeholder="−171,87"></label>
      </div>
      <p class="custom-site-note">Bu saha için ufuk açısını siz seçersiniz.</p>
      <div class="custom-coordinate-actions">
        <button type="button" id="customSiteCancel" class="s-button">Vazgeç</button>
        <button type="submit" id="customSiteApply" class="s-button s-accent">Sahayı kullan</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form");
  const latitude = dialog.querySelector("#customLatitude");
  const longitude = dialog.querySelector("#customLongitude");
  open.addEventListener("click", () => {
    const site = window.missionConsole.getState().plan.site;
    const point = horizonsCache.coordinates(site);
    latitude.value = point?.lat ?? "";
    longitude.value = point?.lon ?? "";
    dialog.showModal();
    latitude.focus();
    latitude.select();
  });
  dialog.querySelector("#customSiteCancel").addEventListener("click", ()=> dialog.close());
  dialog.addEventListener("close", ()=> open.focus({preventScroll:true}));
  form.addEventListener("submit", event => {
    event.preventDefault();
    const site = horizonsCache.customSite(latitude.valueAsNumber,longitude.valueAsNumber);
    if (!site || !form.reportValidity()) return;
    window.missionConsole.setPlan({site,horizonMode:"manual"});
    dialog.close();
  });
  function sync(plan) {
    open.hidden = plan.dataMode !== "horizons";
    if (open.hidden && dialog.open) dialog.close();
  }
  window.addEventListener("mission:update", e=>sync(e.detail.plan));
  sync(window.missionConsole.getState().plan);
})();
