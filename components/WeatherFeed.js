(function (global) {
  'use strict';

  const DEFAULT_ENDPOINT = 'data/weather-latest.json';
  const STORAGE_KEY = 'qinshui-weather-feed-v1';
  const RULE_VERSION = 'weather-rules-v1';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const clean = (value, limit = 120) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const valueText = (value, suffix = '') => finite(value) ? String(Math.round(value * 10) / 10) + suffix : '—';
  const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const shanghaiTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });

  function timestamp(value, required = false) {
    if (value === null || value === undefined || value === '') {
      if (required) throw new Error('天气快照缺少获取时间');
      return null;
    }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      || !isoDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 || !Number.isFinite(Date.parse(value))) {
      throw new Error('天气时间须含明确时区');
    }
    return new Date(value).toISOString();
  }

  function numeric(value, min, max) {
    if (value === null || value === undefined) return null;
    if (!finite(value) || value < min || value > max) throw new Error('天气数值超出有效范围');
    return value;
  }

  function windScale(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return String(numeric(value, 0, 17));
    if (typeof value !== 'string') throw new Error('天气风力字段无效');
    return clean(value, 20) || null;
  }

  function unavailableMessage(input) {
    const codes = input && Array.isArray(input.errors) ? input.errors.map((item) => item && item.code) : [];
    if (codes.includes('quota_unverified')) return '天气源待核验免费额度';
    if (codes.includes('quota_exhausted') || codes.includes('budget_exhausted')) return '天气源额度已暂停';
    return '天气汇总未就绪';
  }

  function normalizeSnapshot(input) {
    if (!input || typeof input !== 'object' || !['ok', 'stale'].includes(input.status)) throw new Error(unavailableMessage(input));
    const fetchedAt = timestamp(input.fetchedAt, true);
    const current = input.current && typeof input.current === 'object' ? input.current : {};
    const normalized = {
      status: input.status, provider: clean(input.provider, 40) || '天气数据源',
      snapshotVersion: clean(String(input.snapshotVersion || ''), 100), fetchedAt,
      currentFetchedAt: timestamp(input.currentFetchedAt), dailyFetchedAt: timestamp(input.dailyFetchedAt),
      location: {
        name: clean(input.location && input.location.name, 60),
        longitude: numeric(input.location && input.location.longitude, -180, 180),
        latitude: numeric(input.location && input.location.latitude, -90, 90),
        coordinateSystem: clean(input.location && input.location.coordinateSystem, 30)
      },
      current: {
        observedAt: timestamp(current.observedAt), temperature: numeric(current.temperature, -100, 70),
        conditionText: clean(current.conditionText, 80) || null,
        conditionCode: clean(current.conditionCode == null ? '' : String(current.conditionCode), 12) || null,
        humidityPercent: numeric(current.humidityPercent, 0, 100), windScale: windScale(current.windScale),
        windDirectionText: clean(current.windDirectionText, 24) || null
      }, days: [], attributions: []
    };
    const dates = new Set();
    if (input.days != null && !Array.isArray(input.days)) throw new Error('七天预报字段无效');
    for (const item of input.days || []) {
      if (!item || !isoDate(item.date) || dates.has(item.date)) throw new Error('预报日期无效或重复');
      dates.add(item.date);
      const day = {
        date: item.date, high: numeric(item.high, -100, 70), low: numeric(item.low, -100, 70),
        conditionText: clean(item.conditionText, 80) || null,
        precipitationProbabilityPercent: numeric(item.precipitationProbabilityPercent, 0, 100),
        dayPrecipitationMm: numeric(item.dayPrecipitationMm, 0, 2000), windScale: windScale(item.windScale)
      };
      if (day.high !== null && day.low !== null && day.low > day.high) throw new Error('预报最低温高于最高温');
      normalized.days.push(day);
    }
    normalized.days.sort((a, b) => a.date.localeCompare(b.date));
    normalized.days = normalized.days.slice(0, 7);
    if (Array.isArray(input.attributions)) normalized.attributions = [...new Set(input.attributions.filter((item) => typeof item === 'string').map((item) => clean(item, 300)))].slice(0, 8);
    const hasCurrent = ['temperature', 'conditionText', 'humidityPercent', 'windScale', 'windDirectionText'].some((key) => normalized.current[key] !== null);
    const hasForecast = normalized.days.some((day) => ['high', 'low', 'conditionText', 'precipitationProbabilityPercent', 'dayPrecipitationMm', 'windScale'].some((key) => day[key] !== null));
    if (!hasCurrent && !hasForecast) throw new Error('天气汇总尚无有效实况或预报');
    return normalized;
  }

  function normalizeEndpoint(input, baseUrl = global.location && global.location.href) {
    const text = clean(input, 2048) || DEFAULT_ENDPOINT;
    if (/-----BEGIN|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i.test(text)) throw new Error('天气地址不能含凭证');
    const url = new URL(text, baseUrl || 'https://dashboard.invalid/');
    const relative = !/^[a-z][a-z\d+.-]*:/i.test(text) && !text.startsWith('//');
    if (url.username || url.password || url.hash) throw new Error('天气地址不能含账号、密码或片段');
    for (const key of url.searchParams.keys()) {
      if (/^(?:key|tk|auth|sig|bearer|session|password|passwd|pwd)$|api[-_]?key|api[-_]?host|jwt|token|secret|authorization|credential|signature|private[-_]?key|access[-_]?key/i.test(key)) throw new Error('天气地址不能含 API 凭证');
    }
    if (/(^|\.)(qweatherapi\.com|qweather\.com|openweathermap\.org|weatherapi\.com)$/i.test(url.hostname)) {
      throw new Error('请填写自己的天气汇总地址，不能直接请求上游');
    }
    const base = new URL(baseUrl || 'https://dashboard.invalid/');
    if (relative && url.origin === base.origin && ['http:', 'https:', 'file:'].includes(url.protocol)) return text;
    if (url.protocol !== 'https:') throw new Error('天气后台汇总地址须使用 HTTPS');
    return url.href;
  }

  function interval(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(60000, Math.min(3600000, Math.round(number))) : 600000;
  }

  function maximumWind(value) {
    if (finite(value)) return value >= 0 && value <= 17 ? value : null;
    if (typeof value !== 'string' || !/^\d{1,2}(?:\s*[-~～–]\s*\d{1,2})?$/.test(value.trim())) return null;
    return Math.max(...value.match(/\d+/g).map(Number));
  }

  function deriveRules(snapshot) {
    const days = snapshot && Array.isArray(snapshot.days) ? snapshot.days : [];
    const rule = (id, text, condition, evidence = []) => ({ id, text, condition, evidence, version: RULE_VERSION, triggered: evidence.length > 0 });
    const pick = (field, predicate) => days.filter((day) => finite(day[field]) && predicate(day[field])).map((day) => ({ date: day.date, field, value: day[field] }));
    let demand, agriculture;
    if (!days.length) return {
      demand: rule('demand-insufficient', '预报待补齐，暂不判断备货方向。', '无有效预报'),
      agriculture: rule('agriculture-insufficient', '预报待补齐，暂不判断农业影响。', '无有效预报')
    };
    let evidence = pick('low', (value) => value <= 10);
    if (evidence.length) demand = rule('demand-cold', '预报低温≤10°C，关注热饮备货。', '未来7天任一天最低温≤10°C', evidence);
    if (!demand && (evidence = pick('high', (value) => value >= 30)).length) demand = rule('demand-heat', '预报高温≥30°C，关注饮品冷链。', '未来7天任一天最高温≥30°C', evidence);
    if (!demand) {
      evidence = [];
      for (let i = 1; i < days.length; i++) {
        const previous = days[i - 1], day = days[i];
        if (finite(previous.high) && finite(day.high) && Date.parse(day.date) - Date.parse(previous.date) === 86400000 && previous.high - day.high >= 5) {
          evidence.push({ date: day.date, field: 'highDropFromPreviousDay', value: previous.high - day.high });
        }
      }
      if (evidence.length) demand = rule('demand-cooling', '次日高温下降≥5°C，关注热饮备货。', '相邻日期最高温下降≥5°C', evidence);
    }
    if (!demand && (evidence = pick('precipitationProbabilityPercent', (value) => value >= 60)).length) demand = rule('demand-rain', '白天降雨概率≥60%，关注配送。', '未来7天任一天白天降水概率≥60%', evidence);
    if (!demand) demand = days.some((day) => finite(day.low) || finite(day.high) || finite(day.precipitationProbabilityPercent))
      ? rule('demand-no-trigger', '暂无已知阈值触发，按销量核对备货。', '已提供字段未触发需求阈值；缺失字段不判断')
      : rule('demand-insufficient', '预报字段缺失，暂不判断备货方向。', '温度和白天降水概率均缺失');

    evidence = pick('low', (value) => value <= 0);
    if (evidence.length) agriculture = rule('agriculture-frost', '预报低温≤0°C，关注霜冻防护。', '未来7天任一天最低温≤0°C', evidence);
    if (!agriculture && (evidence = pick('dayPrecipitationMm', (value) => value >= 10)).length) agriculture = rule('agriculture-rain', '白天雨量≥10mm，核查田间排水。', '未来7天任一天白天降水量≥10mm', evidence);
    if (!agriculture) {
      evidence = days.filter((day) => maximumWind(day.windScale) !== null && maximumWind(day.windScale) >= 6).map((day) => ({ date: day.date, field: 'windScale', value: day.windScale }));
      if (evidence.length) agriculture = rule('agriculture-wind', '预报风力≥6级，核查设施与采收。', '未来7天任一天白天风力区间上限≥6级', evidence);
    }
    if (!agriculture) {
      for (let i = 0; i + 2 < days.length; i++) {
        const span = days.slice(i, i + 3);
        if (span.every((day) => finite(day.dayPrecipitationMm) && day.dayPrecipitationMm < 1)
          && Date.parse(span[2].date) - Date.parse(span[0].date) === 172800000) {
          evidence = span.map((day) => ({ date: day.date, field: 'dayPrecipitationMm', value: day.dayPrecipitationMm }));
          agriculture = rule('agriculture-dry', '连续3天白天雨量<1mm，核查墒情。', '连续3个日期白天降水量均<1mm；需结合土壤墒情，不推定干旱', evidence);
          break;
        }
      }
    }
    if (!agriculture) agriculture = days.some((day) => finite(day.low) || finite(day.dayPrecipitationMm) || maximumWind(day.windScale) !== null)
      ? rule('agriculture-no-trigger', '暂无已知阈值触发，结合墒情作业。', '已提供字段未触发农业阈值；缺失字段不判断')
      : rule('agriculture-insufficient', '预报字段缺失，暂不判断农业影响。', '最低温、白天雨量和白天风力均缺失');
    return { demand, agriculture };
  }

  function chartModel(snapshot) {
    const days = snapshot ? snapshot.days.map((day) => ({ ...day })) : [];
    return {
      dates: days.map((day) => String(Number(day.date.slice(5, 7))) + '/' + String(Number(day.date.slice(8, 10)))),
      highs: days.map((day) => day.high), lows: days.map((day) => day.low), days,
      empty: !days.some((day) => finite(day.high) || finite(day.low)),
      timeZone: 'Asia/Shanghai', sourceDate: days.length ? days[0].date : null,
      seriesNames: ['最高温', '最低温'], precipitationScope: '白天'
    };
  }

  function attributionURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      for (const key of url.searchParams.keys()) if (/key|token|secret|auth|password|jwt|credential|signature/i.test(key)) return null;
      return url;
    } catch (_) { return null; }
  }

  function providerLabel(value) {
    return value.toLowerCase() === 'qweather' ? '和风天气' : value;
  }

  function installStyle(document) {
    if (document.getElementById('weather-feed-motion')) return;
    const style = document.createElement('style'); style.id = 'weather-feed-motion';
    style.textContent = '.weather-feed-note{display:none!important}.weather-feed-current{max-width:225px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.weather-feed-current .small{overflow:hidden;text-overflow:ellipsis}.weather-panel.is-weather-updating .weather-now strong{animation:weather-value-refresh 1s ease-out}@keyframes weather-value-refresh{0%{color:#fff;text-shadow:0 0 12px #52daf5}100%{text-shadow:none}}@media(prefers-reduced-motion:reduce){.weather-panel.is-weather-updating .weather-now strong{animation:none}}';
    document.head.appendChild(style);
  }

  function renderGlyph(glyph, code, document) {
    if (!glyph) return;
    const number = typeof code === 'string' && /^\d{3}$/.test(code) ? Number(code) : null;
    glyph.style.visibility = number === null ? 'hidden' : 'visible';
    glyph.replaceChildren();
    if (number === null) return;
    const add = (tag, attrs) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
      glyph.appendChild(node);
    };
    if (number === 100 || number === 150) {
      add('circle', { cx: 20, cy: 20, r: 7, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 });
      if (number === 100) add('path', { d: 'M20 2v6m0 24v6M2 20h6m24 0h6M7 7l4 4m18 18 4 4M7 33l4-4M29 11l4-4', stroke: 'currentColor', 'stroke-width': 2 });
      return;
    }
    add('path', { d: 'M10 27h21a7 7 0 0 0 0-14 11 11 0 0 0-20-2A8 8 0 0 0 10 27Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 });
    if (number >= 300 && number < 400) add('path', { d: 'M12 31l-2 5m11-5l-2 5m11-5l-2 5', stroke: 'currentColor', 'stroke-width': 2 });
    if (number >= 400 && number < 500) add('path', { d: 'M12 31v6m-3-3h6m10-3v6m-3-3h6', stroke: 'currentColor', 'stroke-width': 2 });
  }

  class WeatherFeed {
    constructor(container, options = {}) {
      if (!container || typeof container.querySelector !== 'function') throw new Error('天气容器不存在');
      this.container = container; this.document = container.ownerDocument;
      this.options = options; this.statusElement = options.statusElement || null; this.configElements = options.configElements || {};
      this.renderChart = typeof options.renderChart === 'function' ? options.renderChart : () => {};
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
      this.config = { endpoint: DEFAULT_ENDPOINT, enabled: true, intervalMs: 600000 };
      this.snapshot = null; this.sourceKind = null; this.latestHash = ''; this.chartRendered = false;
      this.destroyed = false; this.sequence = 0; this.inflight = null; this.pollTimer = null; this.motionTimer = null;
      this.timeoutMs = finite(options.timeoutMs) ? Math.max(1000, Math.min(30000, options.timeoutMs)) : 8000;
      this.autoRefresh = options.autoRefresh !== false;
      this.elements = {
        temperature: container.querySelector('#weatherTemperature, .weather-now strong'),
        current: container.querySelector('#weatherCurrent, .weather-now > div'),
        glyph: container.querySelector('.weather-glyph'),
        demand: container.querySelector('#weatherDemand, .weather-impacts > div:first-child p'),
        agriculture: container.querySelector('#weatherAgriculture, .weather-impacts > div:last-child p'),
        chart: container.querySelector('#weatherChart'), tag: container.querySelector('.panel-header .tag')
      };
      this.note = container.querySelector('#weatherSourceNote, .weather-feed-note');
      if (!this.note) { this.note = this.document.createElement('div'); this.note.className = 'weather-feed-note'; container.appendChild(this.note); }
      this.note.classList.add('weather-feed-note');
      this.note.hidden = true; this.note.setAttribute('aria-hidden', 'true');
      installStyle(this.document);
      let configError = '';
      try {
        if (options.persistConfig !== false) {
          let saved = null;
          try { saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { /* Storage may be unavailable. */ }
          if (saved && typeof saved === 'object') this.config = {
            endpoint: normalizeEndpoint(saved.endpoint), enabled: saved.enabled !== false, intervalMs: interval(saved.intervalMs)
          };
        }
        this.config = {
          endpoint: normalizeEndpoint(own(options, 'endpoint') ? options.endpoint : this.config.endpoint),
          enabled: own(options, 'enabled') ? options.enabled !== false : this.config.enabled,
          intervalMs: interval(own(options, 'intervalMs') ? options.intervalMs : this.config.intervalMs)
        };
      } catch (error) { configError = error.message; this.config.enabled = false; }
      this.handleSave = () => this.saveConfig();
      if (this.configElements.save) this.configElements.save.addEventListener('click', this.handleSave);
      this.fillConfig(); this.render(null, 'none', false); this.setStatus('empty', '暂无真实天气；等待天气汇总快照。');
      const initial = own(options, 'snapshot') ? options.snapshot : global.WEATHER_DATA;
      if (initial) this.update(initial, 'embedded');
      if (configError) this.setStatus('config-error', configError + '；保留最后有效天气。');
      else if (!this.config.enabled) this.setStatus('paused', '自动更新已暂停；保留最后有效天气。');
      else if (options.autoStart !== false) this.refresh();
    }

    reducedMotion() {
      try { return !!global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
    }

    fillConfig() {
      const fields = this.configElements;
      if (fields.endpoint) fields.endpoint.value = this.config.endpoint;
      if (fields.enabled) fields.enabled.checked = this.config.enabled;
      if (fields.interval) fields.interval.value = String(this.config.intervalMs / 1000);
    }

    setStatus(code, message) {
      if (this.destroyed) return;
      this.statusCode = code; this.statusMessage = message;
      this.container.dataset.weatherStatus = code;
      if (this.statusElement) { this.statusElement.textContent = message; this.statusElement.dataset.weatherStatus = code; }
      this.renderSourceNote();
      try { this.onStatus(this.getState()); } catch (_) { /* Status observers cannot disrupt rendering. */ }
    }

    renderSourceNote() {
      this.note.replaceChildren();
      this.note.removeAttribute('title');
      this.note.hidden = true;
    }

    update(input, sourceKind = 'backend') {
      if (this.destroyed) return false;
      let snapshot;
      try { snapshot = normalizeSnapshot(input); } catch (error) {
        this.setStatus('unavailable', error.message + '；' + (this.snapshot ? '保留最后有效天气。' : '暂无真实天气。'));
        return false;
      }
      if (this.snapshot && (Date.parse(snapshot.fetchedAt) < Date.parse(this.snapshot.fetchedAt)
        || Date.parse(snapshot.currentFetchedAt || snapshot.fetchedAt) < Date.parse(this.snapshot.currentFetchedAt || this.snapshot.fetchedAt)
        || Date.parse(snapshot.dailyFetchedAt || snapshot.fetchedAt) < Date.parse(this.snapshot.dailyFetchedAt || this.snapshot.fetchedAt)
        || snapshot.current.observedAt && this.snapshot.current.observedAt && Date.parse(snapshot.current.observedAt) < Date.parse(this.snapshot.current.observedAt))) {
        this.setStatus('outdated', '收到部分来源更早的天气快照；保留最后有效天气。'); return false;
      }
      const hash = JSON.stringify([snapshot.location, snapshot.current, snapshot.days]);
      const changed = !!this.snapshot && hash !== this.latestHash;
      this.snapshot = snapshot; this.latestHash = hash; this.sourceKind = sourceKind;
      this.render(snapshot, sourceKind, changed);
      this.setStatus(snapshot.status === 'stale' ? 'stale' : 'ready', snapshot.status === 'stale'
        ? '天气源返回旧数据；保留原始时间，等待后续更新。'
        : '真实天气已读取；数据时间按 Asia/Shanghai 展示。');
      return true;
    }

    render(snapshot, sourceKind, changed) {
      const elements = this.elements;
      if (elements.temperature) elements.temperature.textContent = snapshot ? valueText(snapshot.current.temperature, '°') : '—';
      if (elements.current) {
        elements.current.classList.add('weather-feed-current');
        const detail = this.document.createElement('div'); detail.className = 'small';
        detail.textContent = snapshot ? '湿度 ' + valueText(snapshot.current.humidityPercent, '%') + ' · '
          + (snapshot.current.windDirectionText || '风向—') + (snapshot.current.windScale ? ' ' + snapshot.current.windScale + '级' : ' 风力—') : '湿度 — · 风向/风力 —';
        const condition = snapshot && snapshot.current.conditionText || '实况暂无数据';
        elements.current.replaceChildren(this.document.createTextNode(condition), detail);
        elements.current.title = condition + '\n' + detail.textContent;
      }
      renderGlyph(elements.glyph, snapshot && snapshot.current.conditionCode, this.document);
      if (elements.tag) { elements.tag.textContent = snapshot && snapshot.days.length ? '实况 · ' + snapshot.days.length + '天预报' : '预报待接入'; elements.tag.classList.remove('sample'); }
      const rules = deriveRules(snapshot);
      for (const key of ['demand', 'agriculture']) {
        const element = elements[key], rule = rules[key];
        if (!element) continue;
        element.textContent = rule.text; element.dataset.ruleId = rule.id; element.dataset.ruleVersion = rule.version;
        element.title = '业务规则：' + rule.condition + '\n依据：' + (rule.evidence.length ? JSON.stringify(rule.evidence) : '未触发或字段缺失') + '\n规则提示不等于销量预测或农事保证。';
      }
      this.container.dataset.weatherSource = sourceKind;
      this.container.dataset.weatherFetchedAt = snapshot ? snapshot.fetchedAt : '';
      this.container.dataset.weatherObservedAt = snapshot && snapshot.current.observedAt || '';
      this.container.dataset.weatherRuleVersion = RULE_VERSION;
      this.container.classList.remove('is-weather-updating');
      if (this.motionTimer !== null) { global.clearTimeout(this.motionTimer); this.motionTimer = null; }
      if (changed && !this.reducedMotion()) {
        // The original source values must change; the dashboard clock and retrieval clock alone never pulse.
        void this.container.offsetWidth; this.container.classList.add('is-weather-updating');
        this.motionTimer = global.setTimeout(() => { this.container.classList.remove('is-weather-updating'); this.motionTimer = null; }, 1100);
      }
      if (elements.chart) elements.chart.setAttribute('aria-label', snapshot && snapshot.days.length
        ? snapshot.days[0].date + '起' + snapshot.days.length + '天最高、最低气温预报；缺失值留空' : '暂无真实七天气温预报');
      const model = chartModel(snapshot), chartHash = JSON.stringify(model);
      if (!this.chartRendered || this.chartHash !== chartHash) {
        this.chartHash = chartHash; this.chartRendered = true;
        try { this.renderChart(model, { sourceKind, sourceTime: snapshot && (snapshot.current.observedAt || snapshot.currentFetchedAt || snapshot.fetchedAt), reducedMotion: this.reducedMotion(), changed }); }
        catch (_) { this.chartRendered = false; }
      }
    }

    configure(next = {}) {
      if (this.destroyed) return false;
      try {
        const config = {
          endpoint: normalizeEndpoint(own(next, 'endpoint') ? next.endpoint : this.config.endpoint),
          enabled: own(next, 'enabled') ? next.enabled !== false : this.config.enabled,
          intervalMs: interval(own(next, 'intervalMs') ? next.intervalMs : this.config.intervalMs)
        };
        this.cancelRequest(); this.clearPoll(); this.config = config;
        if (this.options.persistConfig !== false) try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (_) { /* Optional local preferences only. */ }
        this.fillConfig();
        if (config.enabled) this.refresh(); else this.setStatus('paused', '自动更新已暂停；保留最后有效天气。');
        return true;
      } catch (error) { this.setStatus('config-error', error.message + '；保留最后有效天气。'); return false; }
    }

    saveConfig() {
      const fields = this.configElements;
      return this.configure({ endpoint: fields.endpoint ? fields.endpoint.value : this.config.endpoint,
        enabled: fields.enabled ? fields.enabled.checked : this.config.enabled,
        intervalMs: fields.interval ? Number(fields.interval.value) * 1000 : this.config.intervalMs });
    }

    clearPoll() { if (this.pollTimer !== null) global.clearTimeout(this.pollTimer); this.pollTimer = null; }

    schedule() {
      this.clearPoll();
      if (!this.destroyed && this.config.enabled && this.autoRefresh) this.pollTimer = global.setTimeout(() => { this.pollTimer = null; this.refresh(); }, this.config.intervalMs);
    }

    cancelRequest() {
      this.sequence++;
      if (this.inflight) {
        this.inflight.controller.abort(); global.clearTimeout(this.inflight.timeout);
        this.inflight.reject(new Error('cancelled')); this.inflight = null;
      }
    }

    async refresh() {
      if (this.destroyed || !this.config.enabled) return false;
      if (this.inflight) return this.inflight.promise;
      this.clearPoll();
      const endpoint = this.config.endpoint;
      const resolved = new URL(endpoint, global.location && global.location.href || 'https://dashboard.invalid/');
      if (resolved.protocol === 'file:') {
        this.setStatus('offline', this.snapshot ? 'file:// 正在展示真实预置快照；在线更新需配置 HTTPS 天气汇总地址。' : 'file:// 尚无真实快照；请配置 HTTPS 天气汇总地址。');
        return false;
      }
      if (typeof global.fetch !== 'function') { this.setStatus('error', '当前环境无法读取天气汇总；保留最后有效天气。'); return false; }
      this.setStatus('loading', this.snapshot ? '正在读取天气汇总；当前保留最后有效值。' : '正在读取天气汇总；当前暂无真实值。');
      const controller = new global.AbortController(), sequence = ++this.sequence;
      const flight = { controller, timeout: null, reject: () => {}, promise: null };
      this.inflight = flight;
      let timedOut = false;
      const transport = new Promise((resolve, reject) => {
        flight.reject = reject;
        flight.timeout = global.setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('timeout')); }, this.timeoutMs);
        Promise.resolve().then(() => global.fetch(endpoint, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal }))
          .then(async (response) => {
            if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status || '错误'));
            const contentType = response.headers && response.headers.get('content-type');
            if (contentType && !/\bjson\b|\+json\b/i.test(contentType)) throw new Error('天气汇总须返回 JSON');
            try { return await response.json(); } catch (_) { throw new Error('天气汇总 JSON 无效'); }
          }).then(resolve, reject);
      });
      flight.promise = (async () => {
        try {
          const payload = await transport;
          if (this.destroyed || sequence !== this.sequence) return false;
          return this.update(payload, endpoint === DEFAULT_ENDPOINT ? 'snapshot-file' : 'backend');
        } catch (error) {
          if (this.destroyed || sequence !== this.sequence) return false;
          const detail = timedOut ? '天气汇总读取超时' : /^HTTP \d+$|^天气汇总/.test(error.message || '') ? error.message : '天气汇总读取失败';
          this.setStatus(timedOut ? 'timeout' : 'error', detail + '；' + (this.snapshot ? '保留最后有效天气。' : '暂无真实天气，可配置 HTTPS 汇总地址。'));
          return false;
        } finally {
          global.clearTimeout(flight.timeout);
          if (this.inflight === flight) { this.inflight = null; this.schedule(); }
        }
      })();
      return flight.promise;
    }

    getState() {
      return { status: this.statusCode || 'empty', message: this.statusMessage || '', sourceKind: this.sourceKind,
        fetchedAt: this.snapshot && this.snapshot.fetchedAt, observedAt: this.snapshot && this.snapshot.current.observedAt,
        snapshot: this.snapshot ? JSON.parse(JSON.stringify(this.snapshot)) : null, config: { ...this.config } };
    }

    destroy() {
      this.destroyed = true; this.cancelRequest(); this.clearPoll();
      if (this.motionTimer !== null) global.clearTimeout(this.motionTimer);
      this.motionTimer = null; this.container.classList.remove('is-weather-updating');
      if (this.configElements.save) this.configElements.save.removeEventListener('click', this.handleSave);
    }
  }

  WeatherFeed.normalizeSnapshot = normalizeSnapshot;
  WeatherFeed.normalizeEndpoint = normalizeEndpoint;
  WeatherFeed.deriveRules = deriveRules;
  WeatherFeed.chartModel = chartModel;
  WeatherFeed.ruleVersion = RULE_VERSION;
  global.WeatherFeed = WeatherFeed;
})(window);
