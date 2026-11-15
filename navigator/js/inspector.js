// UI bindings for the surface inspector. The projection and scenario data are owned by app.js.
(() => {
  'use strict';
  const AA = window.AA;
  if (!AA) return;
  const { S } = AA;
  const map = document.getElementById('map');
  const byId = id => document.getElementById(id);
  const globe = byId('globe-wrap');
  const cameraCoords = byId('inspect-coords');
  const cameraZoom = byId('inspect-zoom');
  const text = {
    en: {
      back: 'Back to planner', title: 'Lunar surface inspector', analyse: 'Mission analyst',
      camera: 'Camera centre', gestures: 'Drag to rotate. Tap a point to set the active landing site.',
      keys: 'Arrow keys rotate. Enter selects the centre point.', active: 'Active landing site',
      center: 'Centre on site', views: 'Camera views', report: 'Landing site report', search: 'Find candidate sites',
      position: 'Sun and Earth positions', model: 'Interactive lunar surface', zoomIn: 'Zoom in', zoomOut: 'Zoom out'
    },
    tr: {
      back: 'Planlayıcıya dön', title: 'Ay yüzeyini incele', analyse: 'Görev analisti',
      camera: 'Kamera merkezi', gestures: 'Döndürmek için sürükleyin. Aktif iniş sahasını seçmek için bir noktaya dokunun.',
      keys: 'Ok tuşlarıyla döndürün. Merkezdeki noktayı seçmek için Enter’a basın.', active: 'Aktif iniş sahası',
      center: 'Sahayı ortala', views: 'Kamera açıları', report: 'Saha raporu', search: 'Aday sahaları bul',
      position: 'Güneş ve Dünya konumu', model: 'Etkileşimli Ay yüzeyi', zoomIn: 'Yakınlaştır', zoomOut: 'Uzaklaştır'
    }
  };

  let lastLat, lastLon, lastZoom, lastLang;
  function syncCamera() {
    const { lat0, lon0, zoom } = S.globe;
    if (lat0 !== lastLat || lon0 !== lastLon || S.lang !== lastLang) {
      cameraCoords.textContent = AA.fmtCoord(lat0, ((lon0 % 360 + 540) % 360) - 180);
    }
    if (zoom !== lastZoom || S.lang !== lastLang) {
      cameraZoom.textContent = AA.nf(zoom, Number.isInteger(zoom) ? 0 : 1) + '×';
    }
    lastLat = lat0; lastLon = lon0; lastZoom = zoom; lastLang = S.lang;
  }
  let labelLang;
  function syncSite() {
    if (labelLang !== S.lang) {
      const labels = text[S.lang];
      for (const node of map.querySelectorAll('[data-inspector]')) node.textContent = labels[node.dataset.inspector];
      globe.setAttribute('aria-label', labels.model);
      byId('zin').setAttribute('aria-label', labels.zoomIn);
      byId('zout').setAttribute('aria-label', labels.zoomOut);
      labelLang = S.lang;
    }
    const k = S.globe.target;
    byId('inspect-site-title').textContent = AA.siteName(k);
    byId('inspect-site-coords').textContent = AA.fmtCoord(S.sc[k].lat, S.sc[k].lon);
    byId('inspect-center').dataset.view = k;
    for (const b of map.querySelectorAll('[data-t]')) b.setAttribute('aria-pressed', String(k === b.dataset.t));
    syncCamera();
  }

  globe.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const g = S.globe;
    const step = (e.shiftKey ? 15 : 5) / g.zoom;
    switch (e.key) {
      case 'ArrowUp': g.lat0 = Math.min(90, g.lat0 + step); break;
      case 'ArrowDown': g.lat0 = Math.max(-90, g.lat0 - step); break;
      case 'ArrowLeft': g.lon0 -= step; break;
      case 'ArrowRight': g.lon0 += step; break;
      case '+': case '=': byId('zin').click(); break;
      case '-': byId('zout').click(); break;
      case 'Enter':
        AA.setPoint(g.target, g.lat0, ((g.lon0 % 360 + 540) % 360) - 180);
        AA.refresh(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    AA.queueGlobe();
  });
  // Refit projected markers when opening the analyst changes only the workspace width.
  if (window.ResizeObserver) new ResizeObserver(() => {
    if (!map.hidden) AA.queueGlobe();
  }).observe(globe);
  window.AAInspector = { syncCamera };
  AA.onChange(syncSite);
  syncSite();
})();
