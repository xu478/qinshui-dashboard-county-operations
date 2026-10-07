(function () {
  'use strict';
  const SCHEMA = 'qinshui-gps-points-v1', STORAGE_KEY = SCHEMA, MAX_ACCURACY = 100;
  const TYPE_LABELS = { store: '门店', canteen: '后勤事业部', warehouse: '园区' };
  let initialized = false;

  function validPosition(longitude, latitude, accuracyMeters) {
    return typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
      typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters) && accuracyMeters >= 0;
  }
  function init() {
    if (initialized) return;
    initialized = true;
    const byId = new Map(), saved = new Map();
    const elements = Object.fromEntries(['point-search', 'point-select', 'list-count', 'point-address', 'selected-saved',
      'locate-button', 'position-result', 'longitude-value', 'latitude-value', 'accuracy-value', 'timestamp-value',
      'onsite-confirm', 'save-button', 'status', 'saved-count', 'storage-notice', 'export-button', 'saved-list'].map(id => [id, document.getElementById(id)]));
    let candidate = null, requesting = false, requestToken = 0;
    function status(message, kind) { elements.status.textContent = message; elements.status.dataset.kind = kind || 'info'; }
    function selectedPoint() { return byId.get(elements['point-select'].value) || null; }
    function renderControls() {
      elements['locate-button'].disabled = !selectedPoint() || requesting;
      elements['locate-button'].textContent = requesting ? '正在定位…' : '获取现场定位';
      const usable = Boolean(candidate && selectedPoint() && candidate.id === selectedPoint().id && candidate.accuracyMeters <= MAX_ACCURACY && !requesting);
      elements['onsite-confirm'].disabled = !usable;
      elements['save-button'].disabled = !usable || !elements['onsite-confirm'].checked;
    }
    function clearCandidate() {
      requestToken += 1; candidate = null; requesting = false;
      elements['onsite-confirm'].checked = false;
      elements['position-result'].hidden = true;
      for (const key of ['longitude-value', 'latitude-value', 'accuracy-value', 'timestamp-value']) elements[key].textContent = '';
      renderControls();
    }
    function renderSelection() {
      const point = selectedPoint();
      elements['point-address'].textContent = point ? '地址：' + (point.address || '待补') : '地址：请先选择网点';
      elements['selected-saved'].textContent = point && saved.has(point.id) ? '这个网点已有本机记录；重新保存会替换该网点记录。' : '';
      renderControls();
    }
    function renderOptions() {
      const previous = elements['point-select'].value;
      const query = elements['point-search'].value.trim().toLocaleLowerCase();
      const visible = [...byId.values()].filter(point => (point.name + ' ' + (point.address || '')).toLocaleLowerCase().includes(query));
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '请选择网点';
      elements['point-select'].replaceChildren(placeholder);
      for (const point of visible) {
        const option = document.createElement('option'); option.value = point.id;
        option.textContent = (TYPE_LABELS[point.type] || point.type) + ' · ' + point.name + (saved.has(point.id) ? '（已保存）' : '');
        elements['point-select'].append(option);
      }
      if (visible.some(point => point.id === previous)) elements['point-select'].value = previous;
      else if (previous) { clearCandidate(); status('已切换筛选范围，请选择现场网点并重新定位。'); }
      elements['list-count'].textContent = '当前显示' + visible.length + '个网点，共' + byId.size + '个';
      elements['point-select'].disabled = !byId.size;
      renderSelection();
    }
    function envelope() {
      return { schemaVersion: SCHEMA, coordinateSystem: 'WGS84', points: [...byId.values()].filter(point => saved.has(point.id)).map(point => saved.get(point.id)) };
    }
    function renderSaved() {
      elements['saved-count'].textContent = '已保存' + saved.size + '个网点';
      elements['export-button'].disabled = saved.size === 0;
      elements['saved-list'].replaceChildren();
      for (const point of envelope().points) {
        const row = document.createElement('li'); row.className = 'saved-row';
        const name = document.createElement('strong'); name.textContent = point.name;
        const detail = document.createElement('div'); detail.className = 'muted';
        detail.textContent = (point.address || '地址待补') + ' · 精度' + point.accuracyMeters + '米 · ' + new Date(point.capturedAt).toLocaleString('zh-CN', { hour12: false });
        row.append(name, detail); elements['saved-list'].append(row);
      }
      renderOptions();
    }
    function record(point, position) {
      // Only these fields are persisted/exported; browser/device metadata is excluded.
      return { id: point.id, name: point.name, type: point.type, sourceRow: point.sourceRow, address: point.address,
        longitude: position.longitude, latitude: position.latitude, pointCoordinateSystem: 'WGS84', coordinateSystem: 'WGS84',
        positionSource: 'browser-geolocation-wgs84', accuracyMeters: position.accuracyMeters,
        capturedAt: position.capturedAt, locationConfirmedByUser: true };
    }
    function restore() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const cache = JSON.parse(raw);
        if (!cache || cache.schemaVersion !== SCHEMA || cache.coordinateSystem !== 'WGS84' || !Array.isArray(cache.points)) throw new Error('invalid_cache');
        let ignored = 0;
        for (const row of cache.points) {
          const point = row && byId.get(row.id);
          const timestamp = row && typeof row.capturedAt === 'string' ? Date.parse(row.capturedAt) : NaN;
          if (!point || !['name', 'type', 'sourceRow', 'address'].every(key => row[key] === point[key]) ||
            row.coordinateSystem !== 'WGS84' || row.pointCoordinateSystem !== 'WGS84' || row.positionSource !== 'browser-geolocation-wgs84' ||
            row.locationConfirmedByUser !== true || !validPosition(row.longitude, row.latitude, row.accuracyMeters) || row.accuracyMeters > MAX_ACCURACY || !Number.isFinite(timestamp)) { ignored += 1; continue; }
          const clean = record(point, { longitude: row.longitude, latitude: row.latitude, accuracyMeters: row.accuracyMeters, capturedAt: new Date(timestamp).toISOString() });
          if (!saved.has(point.id) || saved.get(point.id).capturedAt < clean.capturedAt) saved.set(point.id, clean);
        }
        if (ignored) elements['storage-notice'].textContent = '有' + ignored + '条旧记录未通过当前网点/精度检查，请重新采集；未自动关联其他网点。';
      } catch (_) { elements['storage-notice'].textContent = '本机旧记录无法读取，或浏览器限制本地存储。保存时会再次检查，请及时导出有效记录。'; }
    }

    const source = window.PENDING_MAP_POINTS;
    try {
      if (!Array.isArray(source) || !source.length) throw new Error('missing_points');
      for (const row of source) {
        if (!row || typeof row.id !== 'string' || !row.id || byId.has(row.id) || typeof row.name !== 'string' || !row.name ||
          typeof row.type !== 'string' || !row.type || !Number.isInteger(row.sourceRow) || row.sourceRow < 1 ||
          (row.address != null && typeof row.address !== 'string')) throw new Error('invalid_points');
        byId.set(row.id, Object.freeze({ id: row.id, name: row.name, type: row.type, sourceRow: row.sourceRow, address: row.address && row.address.trim() || null }));
      }
    } catch (_) {
      byId.clear(); elements['point-select'].disabled = true; elements['point-search'].disabled = true;
      status('网点清单未加载或格式无效。请从包含完整文件的 HTTPS 网站重新打开本页。', 'error'); renderControls(); return;
    }
    restore(); renderSaved();
    elements['point-select'].addEventListener('change', function () {
      clearCandidate(); renderSelection(); status(selectedPoint() ? '请确认已经到达这个网点入口，再点击获取现场定位。' : '请先选择网点。');
    });
    elements['point-search'].addEventListener('input', renderOptions);
    elements['onsite-confirm'].addEventListener('change', renderControls);
    elements['locate-button'].addEventListener('click', function () {
      const point = selectedPoint(); if (!point || requesting) return;
      clearCandidate();
      if (window.isSecureContext !== true) { status('当前页面不是安全连接。请通过 HTTPS 网站打开；手机局域网 HTTP 不能用于定位采集。', 'error'); return; }
      if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') { status('当前浏览器不支持定位，请使用手机 Safari 或 Chrome，并开启系统定位。', 'error'); return; }
      requesting = true; renderControls(); status('正在获取一次现场定位，请允许浏览器定位权限。');
      const token = ++requestToken, pointId = point.id;
      function currentRequest() { return token === requestToken && selectedPoint() && selectedPoint().id === pointId; }
      function fail(error) {
        if (!currentRequest()) return;
        requesting = false; renderControls();
        const message = error && error.code === 1 ? '没有获得定位权限。请在浏览器和系统设置中允许定位，再点击重试。'
          : error && error.code === 3 ? '15秒内未获取定位。请到户外空旷处检查系统定位，再手动重试。'
          : '暂时无法获取位置。请到户外空旷处开启系统定位，再手动重试。';
        status(message, 'error');
      }
      try {
        navigator.geolocation.getCurrentPosition(function (position) {
          if (!currentRequest()) return;
          requesting = false;
          const coords = position && position.coords, timestamp = position && position.timestamp;
          if (!coords || !validPosition(coords.longitude, coords.latitude, coords.accuracy) || typeof timestamp !== 'number' ||
            !Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) { renderControls(); status('定位结果不完整或无效，请手动重新获取。', 'error'); return; }
          candidate = Object.freeze({ id: pointId, longitude: coords.longitude, latitude: coords.latitude, accuracyMeters: coords.accuracy, capturedAt: new Date(timestamp).toISOString() });
          elements['longitude-value'].textContent = String(candidate.longitude); elements['latitude-value'].textContent = String(candidate.latitude);
          elements['accuracy-value'].textContent = candidate.accuracyMeters + '米';
          elements['timestamp-value'].textContent = new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
          elements['position-result'].hidden = false; renderControls();
          status(candidate.accuracyMeters > MAX_ACCURACY ? '当前精度超过100米，不能保存。请到户外空旷处重新定位。' : '请核对网点和定位结果，确认在入口附近后保存。', candidate.accuracyMeters > MAX_ACCURACY ? 'warning' : 'info');
        }, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      } catch (_) { fail(null); }
    });
    elements['save-button'].addEventListener('click', function () {
      const point = selectedPoint();
      if (!point || !candidate || requesting || candidate.id !== point.id || !elements['onsite-confirm'].checked || candidate.accuracyMeters > MAX_ACCURACY) return;
      const previous = saved.get(point.id); saved.set(point.id, record(point, candidate));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope())); }
      catch (_) {
        if (previous) saved.set(point.id, previous); else saved.delete(point.id);
        status('浏览器未能保存本机记录。请允许本地存储或退出隐私模式后重试；定位结果仍在本页。', 'error'); return;
      }
      clearCandidate(); renderSaved(); status('已保存“' + point.name + '”到本机。采集完成后请导出 JSON 文件备份。');
    });
    elements['export-button'].addEventListener('click', function () {
      if (!saved.size) return;
      let url;
      try {
        const blob = new Blob([JSON.stringify(envelope(), null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
        url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url;
        const today = new Date(), date = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        link.download = '沁水网点现场坐标-' + date + '.json'; document.body.append(link); link.click(); link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        status('已导出' + saved.size + '个网点。请将 JSON 文件导入大屏的网点配置。');
      } catch (_) { if (url) URL.revokeObjectURL(url); status('当前浏览器无法直接下载，请用手机 Safari 或 Chrome 重新打开并导出。', 'error'); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
