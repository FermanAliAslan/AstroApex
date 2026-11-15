/* Browser preferences are separate from shareable mission scenarios. */
(() => {
  const AA = window.AA;
  if (!AA) return;
  const byId = id => document.getElementById(id);
  const key = 'astroapex.workspace.settings.v1';
  let preferences = {};
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && typeof saved === 'object') preferences = saved;
  } catch { /* Preferences still work in memory. */ }
  function save(field, value) {
    preferences[field] = value;
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Session only. */ }
  }
  const home = byId('cfg-home'), commands = byId('cfg-commands'), search = byId('cfg-search');
  home.checked = preferences.consoleHome === true;
  commands.checked = preferences.commands === true;
  home.addEventListener('change', () => save('consoleHome', home.checked));
  commands.addEventListener('change', () => save('commands', commands.checked));
  window.AASettings = { commandsEnabled: () => commands.checked };

  const analyst = window.AAssist;
  function refresh() {
    const config = analyst.getProviderSettings();
    byId('cfg-modes').querySelectorAll('input').forEach(el => { el.checked = el.value === config.mode; });
    search.checked = config.search;
    search.disabled = config.mode !== 'gemini';
    let message = 'cfg_offline';
    if (config.mode === 'gemini') {
      message = config.authorized && config.providers.gemini ? 'cfg_gemini_ok'
        : (config.providers.qwen ? 'cfg_gemini_fallback' : 'cfg_missing');
    }
    if (config.mode === 'auto' && (window.AstroApexAI?.ask || (config.authorized && config.providers.anthropic))) message = 'cfg_auto_ok';
    if (config.mode === 'openai') message = config.authorized && config.providers.openai ? 'cfg_luna_on' : (config.providers.qwen ? 'cfg_luna_fallback' : 'cfg_luna_off');
    if (config.mode === 'auto' && config.providers.openai) message = 'cfg_luna_on';
    if (config.mode === 'qwen') message = config.providers.qwen ? 'cfg_qwen_on' : 'cfg_qwen_off';
    if (config.mode === 'auto' && config.providers.qwen && message === 'cfg_offline') message = 'cfg_qwen_on';
    if (config.mode !== 'local' && config.retrying) message = 'cfg_retry';
    byId('cfg-status').textContent = AA.t(message);
  }
  byId('cfg-modes').addEventListener('change', e => {
    if (e.target.name === 'cfg-provider') analyst.setProviderSettings({mode: e.target.value, search: search.checked});
  });
  search.addEventListener('change', () => analyst.setProviderSettings({mode: analyst.getProviderSettings().mode, search: search.checked}));
  window.addEventListener('astroapex:providerchange', refresh);
  AA.onChange(refresh);
  refresh();
  const requestedView = new URLSearchParams(location.search).get('view');
  if (requestedView === 'settings' || requestedView === 'console') AA.showTab(requestedView);
  else if (home.checked) AA.showTab('console');
})();
