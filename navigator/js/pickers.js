/* Progressive dropdowns. The original selects remain the application's state and event source. */
(function () {
  'use strict';
  if (!window.AA) return;

  const pickers = [];
  const sites = new Map((window.SITES || []).map(site => [site.id, site]));
  let active = null;
  let sequence = 0;
  const language = () => AA.S.lang === 'tr';
  const phrase = (tr, en) => language() ? tr : en;
  const normalize = value => value.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  function label(picker) {
    return picker.label ? picker.label.textContent.trim() : phrase('Oynatma hızı', 'Playback speed');
  }

  function coordinates(picker, value) {
    if (!picker.site) return '';
    const site = sites.get(value);
    const scenario = picker.source.closest('.scn');
    const point = site || (scenario && AA.S.sc[scenario.id.slice(-1)]);
    return point ? AA.fmtCoord(point.lat, point.lon) : '';
  }

  function options(picker) {
    return Array.from(picker.source.options).map(option => ({
      value: option.value,
      text: option.textContent,
      group: option.parentElement.tagName === 'OPTGROUP' ? option.parentElement.label : '',
      disabled: option.disabled || (option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled),
      detail: coordinates(picker, option.value)
    }));
  }

  function close(restoreFocus) {
    if (!active) return;
    const picker = active;
    active = null;
    picker.trigger.setAttribute('aria-expanded', 'false');
    picker.trigger.removeAttribute('aria-activedescendant');
    picker.menu.remove();
    picker.menu = null;
    picker.search = null;
    picker.list = null;
    if (restoreFocus && picker.trigger.isConnected) picker.trigger.focus({preventScroll: true});
  }

  function sync(picker) {
    const selected = picker.source.selectedOptions[0];
    picker.value.textContent = selected ? selected.textContent : '';
    picker.detail.textContent = selected ? coordinates(picker, selected.value) : '';
    picker.detail.hidden = !picker.detail.textContent;
    picker.trigger.disabled = picker.source.disabled;
    picker.trigger.setAttribute('aria-label', label(picker) + ' · ' + picker.value.textContent);
    if (picker.label) picker.label.parentElement.htmlFor = picker.trigger.id;
    if (active === picker) {
      if (picker.source.disabled) return close(true);
      picker.heading.textContent = label(picker);
      picker.list.setAttribute('aria-label', label(picker));
      if (picker.search) {
        picker.search.placeholder = phrase('Saha veya görev ara…', 'Search a site or mission…');
        picker.search.setAttribute('aria-label', phrase('İniş sahası ara', 'Search landing sites'));
      }
      renderOptions(picker);
      place(picker);
    }
  }

  function setActive(picker, index, scroll) {
    const rows = picker.rows;
    picker.index = index;
    rows.forEach((row, i) => row.node.classList.toggle('is-active', i === index));
    const target = picker.search || picker.trigger;
    if (index < 0 || !rows[index]) {
      target.removeAttribute('aria-activedescendant');
      return;
    }
    target.setAttribute('aria-activedescendant', rows[index].node.id);
    if (scroll) {
      const row = rows[index].node.getBoundingClientRect();
      const list = picker.list.getBoundingClientRect();
      if (row.top < list.top) picker.list.scrollTop -= list.top - row.top;
      else if (row.bottom > list.bottom) picker.list.scrollTop += row.bottom - list.bottom;
    }
  }

  function renderOptions(picker) {
    const query = normalize(picker.search ? picker.search.value.trim() : '');
    const previous = picker.rows && picker.rows[picker.index] && picker.rows[picker.index].value;
    picker.list.replaceChildren();
    picker.rows = [];
    let lastGroup = null;
    for (const option of options(picker)) {
      if (query && !normalize(option.text + ' ' + option.group + ' ' + option.detail).includes(query)) continue;
      if (option.group && option.group !== lastGroup) {
        const heading = element('div', 'ap-picker-group', option.group);
        heading.setAttribute('role', 'presentation');
        picker.list.append(heading);
      }
      lastGroup = option.group;
      const row = element('div', 'ap-picker-option');
      row.id = picker.trigger.id + '-option-' + picker.rows.length;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.value === picker.source.value));
      row.setAttribute('aria-disabled', String(option.disabled));
      const copy = element('span', 'ap-option-copy');
      copy.append(element('span', 'ap-option-name', option.text));
      if (option.detail) copy.append(element('span', 'ap-option-detail', option.detail));
      const check = element('span', 'ap-option-check', option.value === picker.source.value ? '✓' : '');
      check.setAttribute('aria-hidden', 'true');
      row.append(copy, check);
      const index = picker.rows.length;
      row.addEventListener('pointermove', () => { if (!option.disabled) setActive(picker, index, false); });
      row.addEventListener('mousedown', e => e.preventDefault());
      row.addEventListener('click', () => { if (!option.disabled) choose(picker, option.value); });
      picker.list.append(row);
      picker.rows.push({...option, node: row});
    }
    if (!picker.rows.length) {
      const empty = element('div', 'ap-picker-empty', phrase('Sonuç bulunamadı.', 'No matching sites.'));
      empty.setAttribute('role', 'status');
      picker.list.append(empty);
    }
    let index = picker.rows.findIndex(row => !row.disabled && row.value === previous);
    if (index < 0) index = picker.rows.findIndex(row => !row.disabled && row.value === picker.source.value);
    if (index < 0) index = picker.rows.findIndex(row => !row.disabled);
    setActive(picker, index, false);
  }

  function place(picker) {
    if (!picker.menu) return;
    const bounds = picker.trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport ? viewport.offsetLeft : 0;
    const topEdge = viewport ? viewport.offsetTop : 0;
    const width = viewport ? viewport.width : document.documentElement.clientWidth;
    const height = viewport ? viewport.height : window.innerHeight;
    const gap = 8, margin = 12;
    if (!bounds.width || bounds.bottom < topEdge || bounds.top > topEdge + height) return close(false);
    const menuWidth = Math.min(Math.max(bounds.width, picker.site ? 340 : 220), width - margin * 2);
    const below = topEdge + height - margin - bounds.bottom - gap;
    const above = bounds.top - topEdge - margin - gap;
    const upwards = below < 240 && above > below;
    const available = Math.max(100, Math.min(height - margin * 2, upwards ? above : below));
    picker.menu.style.width = menuWidth + 'px';
    picker.menu.style.maxHeight = Math.min(picker.site ? 470 : 340, available) + 'px';
    picker.menu.style.left = Math.max(leftEdge + margin, Math.min(bounds.left, leftEdge + width - margin - menuWidth)) + 'px';
    picker.menu.dataset.placement = upwards ? 'top' : 'bottom';
    const menuHeight = picker.menu.getBoundingClientRect().height;
    const top = upwards ? bounds.top - gap - menuHeight : bounds.bottom + gap;
    picker.menu.style.top = Math.max(topEdge + margin, Math.min(top, topEdge + height - margin - menuHeight)) + 'px';
  }

  function choose(picker, value) {
    const option = Array.from(picker.source.options).find(item => item.value === value);
    if (!option || option.disabled || option.parentElement.disabled || picker.source.disabled) return;
    close(true);
    if (picker.source.value !== value) {
      picker.source.value = value;
      picker.source.dispatchEvent(new Event('change', {bubbles: true}));
    }
    sync(picker);
    if (picker.site && value === 'custom') {
      const scenario = picker.source.closest('.scn');
      const details = scenario && scenario.querySelector('details');
      if (details) {
        details.open = true;
        scenario.querySelector('[data-f="lat"]').focus();
      }
    }
  }

  function open(picker, edge) {
    if (picker.source.disabled) return;
    close(false);
    active = picker;
    picker.index = -1;
    picker.menu = element('div', 'ap-picker-menu');
    picker.menu.id = picker.trigger.id + '-popup';
    picker.heading = element('div', 'ap-picker-heading', label(picker));
    picker.heading.id = picker.trigger.id + '-heading';
    picker.menu.append(picker.heading);
    if (picker.site) {
      picker.menu.setAttribute('role', 'dialog');
      picker.menu.setAttribute('aria-labelledby', picker.heading.id);
      picker.search = element('input', 'ap-picker-search');
      picker.search.type = 'search';
      picker.search.autocomplete = 'off';
      picker.search.spellcheck = false;
      picker.search.setAttribute('role', 'combobox');
      picker.search.setAttribute('aria-autocomplete', 'list');
      picker.search.setAttribute('aria-expanded', 'true');
      picker.search.setAttribute('aria-controls', picker.trigger.id + '-list');
      picker.search.placeholder = phrase('Saha veya görev ara…', 'Search a site or mission…');
      picker.search.setAttribute('aria-label', phrase('İniş sahası ara', 'Search landing sites'));
      picker.search.addEventListener('input', () => { renderOptions(picker); place(picker); });
      picker.menu.append(picker.search);
    }
    picker.list = element('div', 'ap-picker-list');
    picker.list.id = picker.trigger.id + '-list';
    picker.list.setAttribute('role', 'listbox');
    picker.list.setAttribute('aria-label', label(picker));
    picker.menu.append(picker.list);
    document.body.append(picker.menu);
    picker.trigger.setAttribute('aria-expanded', 'true');
    renderOptions(picker);
    if (edge === 'first') setActive(picker, picker.rows.findIndex(row => !row.disabled), false);
    if (edge === 'last') setActive(picker, picker.rows.findLastIndex(row => !row.disabled), false);
    place(picker);
    (picker.search || picker.trigger).focus({preventScroll: true});
    setActive(picker, picker.index, true);
  }

  function enhance(source) {
    const site = source.dataset.f === 'site';
    const id = 'ap-picker-' + (++sequence);
    const wrapper = element('div', 'ap-picker' + (site ? ' ap-picker--site' : '') + (source.id === 'speed' ? ' ap-picker--speed' : ''));
    const trigger = element('button', 'ap-picker-trigger');
    trigger.type = 'button';
    trigger.id = id;
    if (!site) trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', site ? 'dialog' : 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id + (site ? '-popup' : '-list'));
    const copy = element('span', 'ap-picker-copy');
    const value = element('span', 'ap-picker-value');
    const detail = element('span', 'ap-picker-detail');
    copy.append(value, detail);
    if (site) {
      const icon = element('span', 'ap-picker-icon', '◎');
      icon.setAttribute('aria-hidden', 'true');
      trigger.append(icon);
    }
    const chevron = element('span', 'ap-picker-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(copy, chevron);
    const originalLabel = source.closest('label');
    const labelText = originalLabel && originalLabel.querySelector('span');
    source.before(wrapper);
    wrapper.append(source, trigger);
    source.hidden = true;
    source.classList.add('ap-native-select');
    const picker = {source, site, trigger, value, detail, label: labelText, wrapper, rows: [], index: -1, menu: null};
    pickers.push(picker);
    trigger.addEventListener('click', () => { if (active === picker) close(true); else open(picker); });
    source.addEventListener('change', () => queueMicrotask(() => sync(picker)));
    new MutationObserver(() => sync(picker)).observe(source, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label', 'selected']
    });
    sync(picker);
  }

  document.addEventListener('keydown', e => {
    const picker = active || pickers.find(p => p.trigger === e.target);
    if (!picker || !(picker.trigger === e.target || (picker.menu && picker.menu.contains(e.target)))) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key === 'Tab') { if (active) close(true); return; }
    if (!active) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        open(picker, e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : undefined);
      }
      return;
    }
    if (e.key === 'Enter' || (e.key === ' ' && !picker.search)) {
      e.preventDefault();
      if (picker.rows[picker.index]) choose(picker, picker.rows[picker.index].value);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const available = picker.rows.map((row, i) => row.disabled ? -1 : i).filter(i => i >= 0);
      if (!available.length) return;
      const current = available.indexOf(picker.index);
      let next = e.key === 'ArrowUp' ? Math.max(0, current - 1) : Math.min(available.length - 1, current + 1);
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = available.length - 1;
      setActive(picker, available[next], true);
      return;
    }
    if (!picker.search && e.key.length === 1) {
      const query = normalize(e.key);
      const index = picker.rows.findIndex(row => !row.disabled && normalize(row.text).startsWith(query));
      if (index >= 0) setActive(picker, index, true);
    }
  }, true);
  document.addEventListener('pointerdown', e => {
    if (active && !active.menu.contains(e.target) && !active.wrapper.contains(e.target)) close(false);
  }, true);
  document.addEventListener('focusin', e => {
    if (active && !active.menu.contains(e.target) && !active.wrapper.contains(e.target)) close(false);
  });
  window.addEventListener('resize', () => { if (active) place(active); });
  document.addEventListener('scroll', e => {
    if (active && !active.menu.contains(e.target)) place(active);
  }, true);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => { if (active) place(active); });
    window.visualViewport.addEventListener('scroll', () => { if (active) place(active); });
  }
  document.querySelectorAll('#dur, #speed, .scn select').forEach(enhance);
  AA.onChange(() => pickers.forEach(sync));
})();

