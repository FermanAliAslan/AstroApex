/* Progressive enhancement: the native selects remain the application's state. */
(() => {
  "use strict";
  const selector = "select:not([multiple])";
  const instances = new Map();
  let opened = null;
  let serial = 0;
  const descriptions = {
    dataMode: {
      horizons: "NASA / JPL · saatlik konumlar",
      demo: "Temsili saha profilleri"
    },
    days: { "7": "1 hafta", "14": "2 hafta", "21": "3 hafta", "28": "4 hafta" },
    horizon: {
      flat: "0° referans düzlemi", manual: "Tüm yönler için tek açı", dem: "Yöne göre değişen arazi yüksekliği"
    },
    atlasSource: {region:"NASA çalışma bölgesi merkezi", observer:"Görev motorundaki gözlem noktası"},
    rLayer: {sun:"LROC WAC gözlemleri", earth:"LOLA Dünya görünürlüğü", trek:"Gri kutup haritası"}
  };
  const reliefs = {"Shackleton Rim":"rim", "Connecting Ridge":"ridge", "Malapert Massif":"massif"};
  const degrees = new Intl.NumberFormat("tr-TR",{minimumFractionDigits:2,maximumFractionDigits:2});
  function optionDetails(option, group) {
    if (group !== "site") return option.dataset.description || descriptions[group]?.[option.value] || "";
    if (option.value === "custom") return "Enlem ve boylam girin";
    const point = horizonsCache.coordinates(option.value);
    if (!point) return "Temsili saha";
    const coord = (v, pos, neg) => degrees.format(Math.abs(v)) + "° " + (v<0 ? neg : pos);
    return coord(point.lat,"K","G")+" · "+coord(point.lon,"D","B");
  }
  const groupNames = {
    dataMode:"dataMode", "cmp-source":"dataMode", days:"days", horizonMode:"horizon",
    atlasSource:"atlasSource", rLayer:"rLayer", site:"site"
  };

  function create(select) {
    if (!select.isConnected || instances.has(select) || select.multiple || select.size > 1) return;
    const number = ++serial;
    const labels = [...select.labels];
    const previousLabels = labels.map(label => label.htmlFor);
    const group = groupNames[select.id] || select.id.replace(/^cmp-[ab]-/,"");
    const name = select.getAttribute("aria-label") ||
      labels.map(label => label.querySelector("span")?.textContent || label.textContent).join(" ").trim() || "Seçim";
    const wrap = document.createElement("div");
    wrap.className = "ap-picker";
    const isSitePicker = group === "site";
    const button = document.createElement("button");
    button.type = "button";
    button.id = "ap-picker-" + number;
    button.className = "ap-picker-trigger";
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-label", name);
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const value = document.createElement("span");
    value.className = "ap-picker-value";
    const arrow = document.createElement("i");
    arrow.className = "ap-picker-arrow";
    arrow.setAttribute("aria-hidden", "true");
    value.id = "ap-picker-value-" + number;
    if (!isSitePicker) button.setAttribute("aria-describedby", [value.id,select.getAttribute("aria-describedby")].filter(Boolean).join(" "));
    const nameBlock = document.createElement("span");
    const subtitle = document.createElement("small");
    if (isSitePicker) {
      wrap.classList.add("lunar-site-picker");
      nameBlock.className = "site-picker-name";
      nameBlock.append(value, subtitle);
      button.append(nameBlock, arrow);
    } else button.append(value, arrow);
    const popup = document.createElement("div");
    popup.id = "ap-picker-options-" + number;
    popup.className = "ap-picker-options";
    if (isSitePicker) popup.classList.add("lunar-site-list");
    popup.setAttribute("role", "listbox");
    popup.setAttribute("aria-label", name);
    popup.hidden = true;
    if (typeof popup.showPopover === "function") popup.setAttribute("popover", "manual");
    button.setAttribute("aria-controls", popup.id);
    select.before(wrap);
    wrap.append(select, button);
    document.body.append(popup);
    select.dataset.pickerReady = "true";
    labels.forEach(label => { label.htmlFor = button.id; });
    let focused = -1;
    let search = "";
    let searchAt = 0;
    let signature = "";

    const optionHidden = option => option.hidden || !!option.closest("optgroup[hidden]");
    function enabledIndices() {
      return [...select.options].flatMap((option, index) => optionHidden(option) || option.disabled || option.parentElement.disabled ? [] : [index]);
    }
    function position() {
      if (opened !== instance) return;
      const box = button.getBoundingClientRect();
      if (!box.height || !box.width) { close(); return; }
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0;
      const topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || innerWidth;
      const height = viewport?.height || innerHeight;
      const roomBelow = topEdge + height - box.bottom - 16;
      const roomAbove = box.top - topEdge - 16;
      const above = roomBelow < Math.min(360, popup.scrollHeight + 2) && roomAbove > roomBelow;
      popup.style.width = Math.min(Math.max(box.width, 248), width - 24) + "px";
      popup.style.maxHeight = Math.max(44, Math.min(360, above ? roomAbove : roomBelow)) + "px";
      popup.style.left = Math.max(leftEdge + 12, Math.min(box.left, leftEdge + width - popup.offsetWidth - 12)) + "px";
      const top = above ? box.top - popup.offsetHeight - 8 : box.bottom + 8;
      popup.style.top = Math.max(topEdge+8, Math.min(top,topEdge+height-popup.offsetHeight-8)) + "px";
      popup.dataset.side = above ? "above" : "below";
    }
    function focusOption(index) {
      focused = index;
      [...popup.children].forEach((option, i) => option.classList.toggle("ap-picker-focused", i === index));
      const option = popup.children[index];
      if (option) {
        button.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      } else button.removeAttribute("aria-activedescendant");
    }
    function close() {
      if (opened !== instance) return;
      if (popup.hasAttribute("popover") && popup.matches(":popover-open")) popup.hidePopover();
      popup.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.removeAttribute("aria-activedescendant");
      wrap.classList.remove("ap-picker-open");
      opened = null;
      search = "";
    }
    function sync() {
      wrap.hidden = select.hidden;
      const options = [...select.options];
      const next = JSON.stringify(options.map(option => [option.textContent, option.value, option.dataset.description, optionHidden(option), option.disabled, !!option.parentElement.disabled]));
      if (next !== signature) {
        signature = next;
        popup.replaceChildren(...options.map((option, index) => {
          const row = document.createElement("div");
          row.className = "ap-picker-option";
          row.id = "ap-picker-option-" + number + "-" + index;
          row.hidden = optionHidden(option);
          if (isSitePicker) row.dataset.relief = reliefs[option.value] || (option.value === "custom" || horizonsCache.coordinates(option.value) ? "custom" : "demo");
          row.setAttribute("role", "option");
          row.setAttribute("aria-disabled", String(option.disabled || !!option.parentElement.disabled));
          const text = document.createElement("span");
          text.textContent = option.textContent;
          row.append(text);
          const description = optionDetails(option,group);
          if (description) {
            const detail = document.createElement("small");
            detail.textContent = description;
            row.append(detail);
          }
          row.addEventListener("pointerdown", event => event.preventDefault());
          row.addEventListener("click", () => choose(index));
          row.addEventListener("pointermove", () => {
            if (enabledIndices().includes(index)) focusOption(index);
          });
          return row;
        }));
      }
      const selected = options[select.selectedIndex];
      value.textContent = selected?.textContent || "Uygun seçenek yok";
      if (isSitePicker) {
        button.dataset.relief = popup.children[select.selectedIndex]?.dataset.relief || "custom";
        subtitle.textContent = selected ? optionDetails(selected,group) : "";
        button.setAttribute("aria-label", name + " · " + value.textContent);
      }
      button.disabled = select.matches(":disabled") || !enabledIndices().length;
      button.setAttribute("aria-invalid", select.getAttribute("aria-invalid") || "false");
      [...popup.children].forEach((option, index) => option.setAttribute("aria-selected", String(index === select.selectedIndex)));
      if (button.disabled || wrap.hidden) close();
      if (opened === instance) {
        const indices = enabledIndices();
        focusOption(indices.includes(focused) ? focused : indices[0]);
        position();
      }
    }
    function open() {
      sync();
      if (button.disabled) return;
      document.dispatchEvent(new Event("astro:picker-opening"));
      opened = instance;
      popup.hidden = false;
      if (popup.hasAttribute("popover")) popup.showPopover();
      button.setAttribute("aria-expanded", "true");
      wrap.classList.add("ap-picker-open");
      position();
      const indices = enabledIndices();
      focusOption(indices.includes(select.selectedIndex) ? select.selectedIndex : indices[0]);
    }
    function choose(index) {
      if (!enabledIndices().includes(index)) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      close();
      if (changed) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      sync();
      button.focus({ preventScroll: true });
    }
    const changes = new MutationObserver(sync);
    const listeners = new AbortController();
    function dispose() {
      close();
      changes.disconnect();
      listeners.abort();
      instances.delete(select);
      delete select.value;
      delete select.selectedIndex;
      delete select.dataset.pickerReady;
      labels.forEach((label,i) => {
        if (label.htmlFor === button.id) label.htmlFor = previousLabels[i];
      });
      if (wrap.contains(select)) wrap.replaceWith(select);
      else wrap.remove();
      popup.remove();
    }
    const instance = { sync, close, position, button, popup, dispose, wrap };
    instances.set(select, instance);
    // Keep direct property updates in sync without polling or altering global prototypes.
    for (const property of ["value", "selectedIndex"]) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, property);
      Object.defineProperty(select, property, {
        configurable: true,
        get() { return descriptor.get.call(this); },
        set(next) { descriptor.set.call(this, next); sync(); }
      });
    }
    button.addEventListener("click", () => opened === instance ? close() : open());
    button.addEventListener("keydown", event => {
      const key = event.key;
      if (key === "Tab") { close(); return; }
      if (key === "Escape") { if (opened === instance) { event.preventDefault(); event.stopPropagation(); close(); } return; }
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        if (opened === instance) choose(focused); else open();
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
        event.preventDefault();
        const wasOpen = opened === instance;
        if (!wasOpen) open();
        const indices = enabledIndices();
        let at = indices.indexOf(focused);
        if (key === "Home") at = 0;
        else if (key === "End") at = indices.length - 1;
        else if (wasOpen) at = Math.max(0, Math.min(indices.length - 1, at + (key === "ArrowDown" ? 1 : -1)));
        focusOption(indices[at]);
        return;
      }
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (opened !== instance) open();
        const now = performance.now();
        search = (now - searchAt < 650 ? search : "") + key.toLocaleLowerCase("tr");
        searchAt = now;
        const match = enabledIndices().find(i => select.options[i].textContent.trim().toLocaleLowerCase("tr").startsWith(search));
        if (match !== undefined) focusOption(match);
      }
    });
    button.addEventListener("blur", close);
    select.addEventListener("change", sync, {signal:listeners.signal});
    select.addEventListener("input", sync, {signal:listeners.signal});
    changes.observe(select, { subtree: true, childList: true, attributes: true, characterData: true });
    select.form?.addEventListener("reset", () => setTimeout(sync, 0), {signal:listeners.signal});
    sync();
  }
  window.astroPickers = { enhance: create };
  document.querySelectorAll(selector).forEach(create);
  // Comparison and map controls may be mounted or moved after initial setup.
  new MutationObserver(records => {
    const pending = new Set();
    for (const record of records) {
      for (const node of [...record.addedNodes,...record.removedNodes]) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches("select")) pending.add(node);
        else if (node.childElementCount) node.querySelectorAll("select").forEach(select => pending.add(select));
      }
    }
    for (const select of pending) {
      const existing = instances.get(select);
      if (existing && (!select.isConnected || !existing.wrap.contains(select))) existing.dispose();
      if (select.isConnected) create(select);
    }
  }).observe(document.body, {childList:true,subtree:true});
  window.addEventListener("mission:update", event => {
    if (event.detail?.source !== "time") instances.forEach(picker => picker.sync());
  });
  document.addEventListener("astro:picker-opening", () => opened?.close());
  document.addEventListener("pointerdown", event => {
    if (opened && !opened.button.contains(event.target) && !opened.popup.contains(event.target)) opened.close();
  });
  window.addEventListener("hashchange", () => opened?.close());
  window.addEventListener("resize", () => opened?.position());
  window.visualViewport?.addEventListener("resize", () => opened?.position());
  document.addEventListener("scroll", event => {
    if (opened && event.target !== opened.popup) opened.position();
  }, true);
})();
