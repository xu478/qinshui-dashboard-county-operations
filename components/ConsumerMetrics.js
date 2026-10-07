(function (global) {
  'use strict';

  const DEFAULT_ENDPOINT = 'data/consumer-metrics.json';
  const STORAGE_KEY = 'qinshui-consumer-metrics-v1';
  const DAY_MS = 86400000;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const clean = (value) => typeof value === 'string' ? value.trim() : '';
  const dateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
      && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  }

  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      || !validDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 || !Number.isFinite(Date.parse(value))) {
      throw new Error('消费者指标时间须含明确时区');
    }
    return new Date(value).toISOString();
  }

  function expectedDays(value) {
    if (value === undefined) return 30;
    if (!Number.isSafeInteger(value) || value < 1 || value > 366) throw new Error('消费者指标观察期无效');
    return value;
  }

  function normalizeSnapshot(input, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || !['ok', 'unavailable'].includes(input.status) || input.sourceKind !== 'actual') throw new Error('消费者指标汇总格式无效');
    const updatedAt = timestamp(input.updatedAt), sourceWindow = input.window;
    const days = expectedDays(options.expectedWindowDays);
    const today = options.businessDate || dateFormatter.format(new Date(own(options, 'now') ? options.now : Date.now()));
    if (!validDate(today) || !sourceWindow || !validDate(sourceWindow.start) || !validDate(sourceWindow.end)
      || sourceWindow.days !== days || typeof sourceWindow.complete !== 'boolean'
      || (Date.parse(sourceWindow.end + 'T00:00:00Z') - Date.parse(sourceWindow.start + 'T00:00:00Z')) / DAY_MS + 1 !== days) {
      throw new Error('消费者指标须提供完整、首尾计入的观察期');
    }
    const window = { start: sourceWindow.start, end: sourceWindow.end, days, complete: sourceWindow.complete };
    const counts = { identifiedCustomers: null, purchaseOrders: null, repeatCustomers: null };
    let reason = input.status === 'unavailable' ? 'source-unavailable' : '';
    if (window.end > today || (!options.allowHistoricalWindow && window.end !== today)) reason = 'expired-window';
    else if (!window.complete) reason = 'incomplete-window';
    if (input.status === 'ok' && !reason) {
      const source = input.counts;
      if (!source || ['identifiedCustomers', 'purchaseOrders', 'repeatCustomers'].some((key) => source[key] === null || source[key] === undefined)) reason = 'missing-counts';
      else {
        for (const key of Object.keys(counts)) {
          if (!integer(source[key])) throw new Error('消费者指标计数须为非负整数');
          counts[key] = source[key];
        }
        if (counts.purchaseOrders < counts.identifiedCustomers || counts.repeatCustomers > counts.identifiedCustomers
          || counts.purchaseOrders < counts.identifiedCustomers + counts.repeatCustomers
          || (counts.identifiedCustomers === 0 && (counts.purchaseOrders !== 0 || counts.repeatCustomers !== 0))) {
          throw new Error('消费者指标计数关系不一致');
        }
      }
    }
    if (reason) for (const key of Object.keys(counts)) counts[key] = null;
    return { status: reason ? 'unavailable' : 'ok', sourceKind: 'actual', updatedAt, window, counts, reason };
  }

  function calculate(snapshot) {
    if (!snapshot || snapshot.status !== 'ok' || !snapshot.counts.identifiedCustomers) return { purchaseFrequency: null, repurchaseRate: null };
    return {
      purchaseFrequency: snapshot.counts.purchaseOrders / snapshot.counts.identifiedCustomers,
      repurchaseRate: snapshot.counts.repeatCustomers / snapshot.counts.identifiedCustomers * 100
    };
  }

  function normalizeReplay(input, options) {
    if (!options.allowHistoricalWindow || !input || input.sourceKind !== 'historical-order-replay') throw new Error('会员回放须明确启用历史观察期');
    const replay = input.replay;
    if (!replay || typeof replay.sourceVersion !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(replay.sourceVersion)
      || typeof replay.runId !== 'string' || !replay.runId.trim() || replay.runId.length > 120
      || !integer(replay.step) || !integer(replay.total) || replay.total < 1 || replay.step > replay.total
      || (own(replay, 'fingerprintAlgorithm') && replay.fingerprintAlgorithm !== 'sha256-json-key-amountCents-v1')) {
      throw new Error('会员回放来源绑定或进度无效');
    }
    // The caller verifies the source fingerprint against the built-in batch; no identities or raw orders enter this component.
    const snapshot = normalizeSnapshot({ ...input, status: 'ok', sourceKind: 'actual' }, options);
    if (snapshot.status !== 'ok') throw new Error('会员回放须有完整原始观察期及有效聚合计数');
    snapshot.sourceKind = 'historical-order-replay';
    snapshot.replay = { sourceVersion: replay.sourceVersion, fingerprintAlgorithm: 'sha256-json-key-amountCents-v1', runId: replay.runId.trim(), step: replay.step, total: replay.total };
    return snapshot;
  }

  function normalizeEndpoint(input, baseUrl = global.location && global.location.href) {
    const text = clean(input) || DEFAULT_ENDPOINT;
    if (text.length > 2048 || /-----BEGIN|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i.test(text)) throw new Error('消费者指标地址不能含凭证');
    const base = new URL(baseUrl || 'https://dashboard.invalid/'), url = new URL(text, base);
    if (url.username || url.password || url.hash) throw new Error('消费者指标地址不能含账号、密码或片段');
    for (const key of url.searchParams.keys()) {
      if (/^(?:key|tk|auth|sig|bearer|session|password|passwd|pwd)$|api[-_]?key|jwt|token|secret|authorization|credential|signature|private[-_]?key|access[-_]?key/i.test(key)) throw new Error('消费者指标地址不能含 API 凭证');
    }
    if (/(^|\.)(qweatherapi\.com|qweather\.com|openweathermap\.org|weatherapi\.com|open-meteo\.com)$/i.test(url.hostname)) throw new Error('请填写自己的消费者指标汇总地址');
    const relative = !/^[a-z][a-z\d+.-]*:/i.test(text) && !text.startsWith('//');
    if (url.origin === base.origin && ['http:', 'https:', 'file:'].includes(url.protocol)) return relative ? text : url.href;
    if (url.protocol !== 'https:') throw new Error('消费者指标汇总地址须使用 HTTPS 或同站 JSON');
    return url.href;
  }

  function interval(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(30000, Math.min(3600000, Math.round(number))) : 60000;
  }

  function installStyle(document) {
    if (document.getElementById('consumer-metrics-motion')) return;
    const style = document.createElement('style'); style.id = 'consumer-metrics-motion';
    style.textContent = '.consumer-metric-updating{animation:consumer-metric-refresh 1s ease-out}@keyframes consumer-metric-refresh{0%{color:#fff;text-shadow:0 0 12px #52daf5}100%{text-shadow:none}}@media(prefers-reduced-motion:reduce){.consumer-metric-updating{animation:none}}';
    document.head.appendChild(style);
  }

  class ConsumerMetrics {
    constructor(container, options = {}) {
      if (!container || typeof container.querySelector !== 'function') throw new Error('消费者指标容器不存在');
      this.container = container; this.document = container.ownerDocument; this.persistConfig = options.persistConfig !== false;
      this.statusElement = options.statusElement || null; this.configElements = options.configElements || {};
      this.expectedWindowDays = expectedDays(options.expectedWindowDays); this.allowHistoricalWindow = options.allowHistoricalWindow === true;
      this.precision = own(options, 'precision') ? options.precision : 1;
      if (!Number.isSafeInteger(this.precision) || this.precision < 0 || this.precision > 4) throw new Error('消费者指标显示精度无效');
      this.now = typeof options.now === 'function' ? options.now : () => global.Date.now();
      this.elements = { purchaseFrequency: container.querySelector('#purchaseFrequency'), repurchaseRate: container.querySelector('#repurchaseRate') };
      this.snapshot = null; this.actualSnapshot = null; this.actualTransportKind = 'none'; this.replaySnapshot = null;
      this.metrics = calculate(null); this.transportKind = 'none';
      this.config = { endpoint: DEFAULT_ENDPOINT, enabled: true, intervalMs: 60000 };
      this.destroyed = false; this.sequence = 0; this.inflight = null; this.pollTimer = null; this.expiryTimer = null; this.motionTimer = null;
      this.timeoutMs = finite(options.timeoutMs) ? Math.max(1000, Math.min(30000, options.timeoutMs)) : 8000;
      this.autoRefresh = options.autoRefresh !== false;
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
      let configError = '';
      try {
        if (this.persistConfig) {
          let saved = null; try { saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { /* Local preferences are optional. */ }
          if (saved && typeof saved === 'object') this.config = { endpoint: normalizeEndpoint(saved.endpoint), enabled: saved.enabled !== false, intervalMs: interval(saved.intervalMs) };
        }
        this.config = { endpoint: normalizeEndpoint(own(options, 'endpoint') ? options.endpoint : this.config.endpoint),
          enabled: own(options, 'enabled') ? options.enabled !== false : this.config.enabled,
          intervalMs: interval(own(options, 'intervalMs') ? options.intervalMs : this.config.intervalMs) };
      } catch (error) { configError = error.message; this.config.enabled = false; }
      installStyle(this.document);
      this.handleSave = () => this.saveConfig();
      if (this.configElements.save) this.configElements.save.addEventListener('click', this.handleSave);
      this.fillConfig(); this.render(false); this.setStatus('unavailable', '数据不足，消费者指标显示“—”。');
      const initial = own(options, 'snapshot') ? options.snapshot : global.CONSUMER_METRICS_DATA;
      if (initial) this.update(initial, 'embedded');
      this.scheduleExpiry();
      if (configError) this.setStatus('config-error', configError);
      else if (!this.config.enabled) this.setStatus('paused', '消费者指标自动刷新已暂停。');
      else if (options.autoStart !== false) this.refresh();
    }

    businessDate() { return dateFormatter.format(new Date(this.now())); }
    reducedMotion() { try { return !!global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } }
    fillConfig() {
      const fields = this.configElements;
      if (fields.endpoint) fields.endpoint.value = this.config.endpoint;
      if (fields.enabled) fields.enabled.checked = this.config.enabled;
      if (fields.interval) fields.interval.value = String(this.config.intervalMs / 1000);
    }

    setStatus(code, message) {
      if (this.destroyed) return;
      this.statusCode = code; this.statusMessage = message;
      this.container.dataset.consumerMetricsStatus = code;
      const source = this.snapshot ? ' · ' + this.snapshot.window.start + '～' + this.snapshot.window.end
        + '（' + this.snapshot.window.days + '天） · 汇总 ' + timeFormatter.format(new Date(this.snapshot.updatedAt)) : '';
      const replay = this.snapshot && this.snapshot.replay;
      const progress = replay ? ' · 原始会员记录渐进回放 ' + replay.step + '/' + replay.total + ' · 来源版本 ' + replay.sourceVersion : '';
      if (this.statusElement) { this.statusElement.textContent = message + source + progress; this.statusElement.dataset.consumerMetricsStatus = code; }
      const scope = '仅已识别会员的正额订单；多次下单占比不等于再次到店概率。';
      for (const key of Object.keys(this.elements)) if (this.elements[key]) {
        this.elements[key].title = (key === 'purchaseFrequency' ? '人均订单次数' : '至少两笔订单的会员占购买会员比例') + ' · ' + scope + '\n' + message + source + progress;
        this.elements[key].dataset.consumerMetricsStatus = code;
      }
      this.container.title = scope + '\n' + message + source + progress;
      try { this.onStatus(this.getState(false)); } catch (_) { /* Observers do not affect rendering. */ }
    }

    render(changed) {
      for (const key of Object.keys(this.elements)) if (this.elements[key]) {
        this.elements[key].textContent = finite(this.metrics[key]) ? this.metrics[key].toFixed(this.precision) : '—';
        this.elements[key].classList.remove('consumer-metric-updating');
      }
      if (this.motionTimer !== null) { global.clearTimeout(this.motionTimer); this.motionTimer = null; }
      if (Array.isArray(changed) && changed.length && !this.reducedMotion()) {
        for (const key of changed) if (this.elements[key]) { void this.elements[key].offsetWidth; this.elements[key].classList.add('consumer-metric-updating'); }
        this.motionTimer = global.setTimeout(() => { for (const element of Object.values(this.elements)) if (element) element.classList.remove('consumer-metric-updating'); this.motionTimer = null; }, 1100);
      }
      const snapshot = this.snapshot;
      this.container.dataset.consumerMetricsSource = snapshot ? snapshot.sourceKind : '';
      this.container.dataset.consumerMetricsTransport = this.transportKind;
      this.container.dataset.consumerMetricsUpdatedAt = snapshot ? snapshot.updatedAt : '';
      this.container.dataset.consumerMetricsWindowStart = snapshot ? snapshot.window.start : '';
      this.container.dataset.consumerMetricsWindowEnd = snapshot ? snapshot.window.end : '';
      this.container.dataset.consumerMetricsWindowDays = String(this.expectedWindowDays);
      this.container.dataset.consumerMetricsComplete = String(!!snapshot && snapshot.window.complete);
      this.container.dataset.consumerMetricsPrecision = String(this.precision);
      const replay = snapshot && snapshot.replay;
      this.container.dataset.consumerMetricsReplayStep = replay ? String(replay.step) : '';
      this.container.dataset.consumerMetricsReplayTotal = replay ? String(replay.total) : '';
      this.container.dataset.consumerMetricsReplayRunId = replay ? replay.runId : '';
      this.container.dataset.consumerMetricsSourceVersion = replay ? replay.sourceVersion : '';
    }

    checkExpiry() {
      if (this.destroyed || !this.snapshot || this.snapshot.status !== 'ok' || this.allowHistoricalWindow || this.snapshot.window.end === this.businessDate()) return false;
      const previous = this.snapshot;
      this.snapshot = { ...previous, status: 'unavailable', reason: 'expired-window', counts: { identifiedCustomers: null, purchaseOrders: null, repeatCustomers: null } };
      if (this.actualSnapshot === previous) this.actualSnapshot = this.snapshot;
      this.metrics = calculate(this.snapshot); this.render(false);
      this.setStatus('expired', '观察期已过期，等待当前' + this.expectedWindowDays + '天的完整汇总；指标显示“—”。');
      return true;
    }

    scheduleExpiry() {
      if (this.expiryTimer !== null) global.clearTimeout(this.expiryTimer);
      if (this.destroyed || this.allowHistoricalWindow) { this.expiryTimer = null; return; }
      const nextMidnight = Date.parse(this.businessDate() + 'T00:00:00+08:00') + DAY_MS;
      this.expiryTimer = global.setTimeout(() => { this.expiryTimer = null; this.checkExpiry(); this.scheduleExpiry(); }, Math.max(1, nextMidnight - this.now() + 5));
    }

    update(input, transportKind = 'backend') {
      if (this.destroyed) return false;
      this.checkExpiry();
      let snapshot;
      try { snapshot = normalizeSnapshot(input, { expectedWindowDays: this.expectedWindowDays, allowHistoricalWindow: this.allowHistoricalWindow, businessDate: this.businessDate() }); }
      catch (error) { this.setStatus('error', error.message + (this.snapshot && this.snapshot.status === 'ok' ? '；保留最后有效指标。' : '；指标显示“—”。')); return false; }
      if (this.actualSnapshot && Date.parse(snapshot.updatedAt) < Date.parse(this.actualSnapshot.updatedAt)) { this.setStatus('outdated', '收到更早汇总，保留最后有效指标。'); return false; }
      this.actualSnapshot = snapshot; this.actualTransportKind = transportKind;
      if (this.replaySnapshot) { this.setStatus('replay', '原始会员记录渐进回放；真实历史汇总缓存已更新。'); return true; }
      this.displaySnapshot(snapshot, transportKind);
      return true;
    }

    displaySnapshot(snapshot, transportKind) {
      const previous = this.metrics, metrics = calculate(snapshot);
      const changed = Object.keys(metrics).filter((key) => finite(previous[key]) && finite(metrics[key]) && previous[key].toFixed(this.precision) !== metrics[key].toFixed(this.precision));
      this.snapshot = snapshot; this.metrics = metrics; this.transportKind = transportKind; this.render(changed);
      if (!snapshot) this.setStatus('unavailable', '尚无完整' + this.expectedWindowDays + '天会员汇总，消费者指标显示“—”。');
      else if (snapshot.replay) this.setStatus('replay', '原始' + snapshot.window.days + '天会员记录渐进回放；不计为新增实际购买。');
      else if (snapshot.status === 'unavailable') this.setStatus(snapshot.reason === 'expired-window' ? 'expired' : 'unavailable', '完整' + this.expectedWindowDays + '天数据不足，消费者指标显示“—”。');
      else if (!snapshot.counts.identifiedCustomers) this.setStatus('no-customers', '完整观察期内无已识别购买会员，指标显示“—”。');
      else this.setStatus('ready', '已读取真实会员汇总。');
    }

    updateReplay(input) {
      if (this.destroyed) return false;
      let snapshot;
      try {
        snapshot = normalizeReplay(input, { expectedWindowDays: this.expectedWindowDays, allowHistoricalWindow: this.allowHistoricalWindow, businessDate: this.businessDate() });
        const previous = this.replaySnapshot;
        if (previous && previous.replay.runId === snapshot.replay.runId) {
          if (previous.replay.sourceVersion !== snapshot.replay.sourceVersion || previous.replay.total !== snapshot.replay.total
            || JSON.stringify(previous.window) !== JSON.stringify(snapshot.window) || snapshot.replay.step < previous.replay.step) throw new Error('同一会员回放批次的来源及进度不能后退或更换');
          const fields = ['identifiedCustomers', 'purchaseOrders', 'repeatCustomers'];
          if (fields.some((key) => snapshot.counts[key] < previous.counts[key])
            || (snapshot.replay.step === previous.replay.step && fields.some((key) => snapshot.counts[key] !== previous.counts[key]))) throw new Error('同一会员回放进度的聚合计数不一致');
        }
      } catch (error) { this.setStatus('replay-error', error.message + '；保留最后有效指标。'); return false; }
      this.replaySnapshot = snapshot;
      this.displaySnapshot(snapshot, 'historical-order-replay');
      return true;
    }

    clearReplay() {
      if (this.destroyed || !this.replaySnapshot) return false;
      this.replaySnapshot = null;
      this.displaySnapshot(this.actualSnapshot, this.actualTransportKind);
      this.checkExpiry();
      return true;
    }

    configure(next = {}) {
      if (this.destroyed) return false;
      try {
        const config = { endpoint: normalizeEndpoint(own(next, 'endpoint') ? next.endpoint : this.config.endpoint), enabled: own(next, 'enabled') ? next.enabled !== false : this.config.enabled,
          intervalMs: interval(own(next, 'intervalMs') ? next.intervalMs : this.config.intervalMs) };
        this.cancelRequest(); this.clearPoll(); this.config = config;
        if (this.persistConfig) try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (_) { /* Optional preferences only. */ }
        this.fillConfig(); this.checkExpiry();
        if (config.enabled) this.refresh(); else this.setStatus('paused', '消费者指标自动刷新已暂停。');
        return true;
      } catch (error) { this.setStatus('config-error', error.message); return false; }
    }
    saveConfig() {
      const fields = this.configElements;
      return this.configure({ endpoint: fields.endpoint ? fields.endpoint.value : this.config.endpoint, enabled: fields.enabled ? fields.enabled.checked : this.config.enabled,
        intervalMs: fields.interval ? Number(fields.interval.value) * 1000 : this.config.intervalMs });
    }
    clearPoll() { if (this.pollTimer !== null) global.clearTimeout(this.pollTimer); this.pollTimer = null; }
    schedule() {
      this.clearPoll();
      if (!this.destroyed && this.config.enabled && this.autoRefresh) this.pollTimer = global.setTimeout(() => { this.pollTimer = null; this.refresh(); }, this.config.intervalMs);
    }
    cancelRequest() {
      this.sequence++;
      if (this.inflight) { if (this.inflight.controller) this.inflight.controller.abort(); global.clearTimeout(this.inflight.timeout); this.inflight.reject(new Error('cancelled')); this.inflight = null; }
    }

    refresh() {
      if (this.destroyed) return Promise.resolve(false);
      this.checkExpiry();
      if (!this.config.enabled) return Promise.resolve(false);
      if (this.inflight) return this.inflight.promise;
      this.clearPoll();
      const endpoint = this.config.endpoint, resolved = new URL(endpoint, global.location && global.location.href || 'https://dashboard.invalid/');
      if (resolved.protocol === 'file:') { this.setStatus(this.snapshot && this.snapshot.status === 'ok' ? 'offline' : 'unavailable', '当前读取预置汇总；在线刷新需 HTTPS 汇总接口。'); return Promise.resolve(false); }
      if (typeof global.fetch !== 'function') { this.setStatus('error', '当前环境无法读取消费者指标汇总。'); return Promise.resolve(false); }
      this.setStatus('loading', '正在读取消费者指标汇总。');
      const sequence = ++this.sequence, controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
      const flight = { controller, timeout: null, reject: () => {}, promise: null }; this.inflight = flight;
      let timedOut = false;
      const transport = new Promise((resolve, reject) => {
        flight.reject = reject;
        flight.timeout = global.setTimeout(() => { timedOut = true; if (controller) controller.abort(); reject(new Error('timeout')); }, this.timeoutMs);
        Promise.resolve().then(() => global.fetch(endpoint, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', ...(controller ? { signal: controller.signal } : {}) }))
          .then(async (response) => {
            if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status || '错误'));
            const type = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : null;
            if (type && !/\bjson\b|\+json\b/i.test(type)) throw new Error('消费者指标须返回 JSON');
            try { return await response.json(); } catch (_) { throw new Error('消费者指标 JSON 无效'); }
          }).then(resolve, reject);
      });
      flight.promise = (async () => {
        try { const payload = await transport; if (this.destroyed || sequence !== this.sequence) return false; return this.update(payload, endpoint === DEFAULT_ENDPOINT ? 'snapshot-file' : 'backend'); }
        catch (_) {
          if (this.destroyed || sequence !== this.sequence) return false;
          this.checkExpiry();
          this.setStatus(timedOut ? 'timeout' : 'error', (timedOut ? '消费者指标读取超时' : '消费者指标读取失败') + (this.snapshot && this.snapshot.status === 'ok' ? '；保留最后有效指标。' : '；指标显示“—”。'));
          return false;
        } finally { global.clearTimeout(flight.timeout); if (this.inflight === flight) { this.inflight = null; this.schedule(); } }
      })();
      return flight.promise;
    }

    getState(checkExpiry = true) {
      if (checkExpiry) this.checkExpiry();
      return { status: this.statusCode || 'unavailable', message: this.statusMessage || '', sourceKind: this.snapshot ? this.snapshot.sourceKind : null, transportKind: this.transportKind,
        updatedAt: this.snapshot && this.snapshot.updatedAt, metrics: { ...this.metrics }, snapshot: this.snapshot ? JSON.parse(JSON.stringify(this.snapshot)) : null,
        replay: this.replaySnapshot ? { ...this.replaySnapshot.replay } : null,
        actualSnapshot: this.actualSnapshot ? JSON.parse(JSON.stringify(this.actualSnapshot)) : null, precision: this.precision, config: { ...this.config } };
    }
    destroy() {
      this.destroyed = true; this.cancelRequest(); this.clearPoll();
      if (this.expiryTimer !== null) global.clearTimeout(this.expiryTimer);
      if (this.motionTimer !== null) global.clearTimeout(this.motionTimer);
      this.expiryTimer = null; this.motionTimer = null;
      for (const element of Object.values(this.elements)) if (element) element.classList.remove('consumer-metric-updating');
      if (this.configElements.save) this.configElements.save.removeEventListener('click', this.handleSave);
    }
  }

  ConsumerMetrics.DEFAULT_ENDPOINT = DEFAULT_ENDPOINT;
  ConsumerMetrics.normalizeSnapshot = normalizeSnapshot;
  ConsumerMetrics.normalizeReplay = normalizeReplay;
  ConsumerMetrics.normalizeEndpoint = normalizeEndpoint;
  ConsumerMetrics.calculate = calculate;
  global.ConsumerMetrics = ConsumerMetrics;
})(window);
