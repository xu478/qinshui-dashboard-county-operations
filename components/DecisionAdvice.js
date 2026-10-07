(function (global) {
  'use strict';

  const STORAGE_KEY = 'qinshui-decision-ai-v1';
  const ALLOWED_TYPES = new Set(['stock', 'data', 'plan', 'forecast']);
  const MONEY = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const amount = (value) => finite(value) ? '¥' + MONEY.format(value) : '—';
  const count = (value) => finite(value) ? Math.max(0, Math.round(value)).toLocaleString('zh-CN') : '—';
  const clean = (value, limit = 80) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const DISPLAY_LABELS = { stock: '门店', data: '运营', plan: '拓展', forecast: '配送' };
  const RULE_VERSION = 'county-supply-chain-rules-v1';
  const RESEARCH_SOURCES = {
    network: 'https://www.chinacoop.gov.cn/subStation/fzgg/news.html?aid=1849785&subId=1831',
    coldChain: 'https://www.ndrc.gov.cn/fggz/fzzlgh/gjjzxgh/202203/t20220325_1320204.html',
    foodLoss: 'https://www.fao.org/energy/news-and-events/news/news-details/cooling-the-chain--cutting-the-waste/en',
    scenario: 'https://nyncj.wuhan.gov.cn/ztzl_25/zxzt/zhny/202609/t20260918_2849494.html'
  };
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value ? value : null;
  const nonnegative = value => finite(value) && value >= 0 ? value : null;
  const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

  // Presentation only: source mode, composition, amounts and proxy request provenance stay intact.
  function displayText(value) {
    let text = value.replace(/[（(]\s*含基数\s*[）)]/g, '').replace(/演示|含基数/g, '');
    let previous;
    do { previous = text; text = text.replace(/[（(]\s*[）)]/g, ''); } while (text !== previous);
    return text.replace(/[ \t]{2,}/g, ' ').trim();
  }

  function displayAdvice(item) {
    const text = displayText(item.text) || '建议内容待补充，请结合业务核验。';
    const label = displayText(item.label) || DISPLAY_LABELS[item.type] || '建议';
    const emphasis = Array.isArray(item.emphasis) ? [...new Set(item.emphasis.filter((value) => typeof value === 'string')
      .map(displayText).filter((value) => value && value !== '—' && value !== text && text.includes(value)))] : [];
    return { ...item, label, text, emphasis };
  }

  function intervalSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(30, Math.min(300, Math.round(number))) : 30;
  }

  function normalizeEndpoint(value) {
    const text = clean(value, 2048);
    if (!text) return '';
    const url = new URL(text);
    if (url.username || url.password || url.hash) throw new Error('代理地址不能包含账号、密码或片段');
    for (const key of url.searchParams.keys()) {
      if (/^(?:auth|sig|password|passwd|pwd|bearer|session|key)$|api[-_]?key|token|secret|authorization|credential|signature|access[-_]?key/i.test(key)) throw new Error('请勿将 API 密钥放入前端代理地址');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      throw new Error('AI 代理须使用 HTTPS；本机 localhost 服务可使用 HTTP');
    }
    return url.href;
  }

  function readStoredConfig() {
    const defaults = { endpoint: '', enabled: false, interval: 30 };
    try {
      const saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return defaults;
      return { endpoint: normalizeEndpoint(saved.endpoint), enabled: saved.enabled === true, interval: intervalSeconds(saved.interval) };
    } catch (_) {
      return defaults;
    }
  }

  // Only the summary schema below may be sent to an AI proxy. Raw orders and customer data are excluded.
  function contextSummary(source) {
    const number = value => finite(value) ? value : null;
    const trend = source.salesTrend || {}, consumer = source.consumerMetrics || {}, weather = source.weather || {}, reserves = source.reserves || {};
    const window = consumer.window || {}, counts = consumer.counts || {}, replay = consumer.replay || {};
    const monthly = (rows, actual) => Array.isArray(rows) ? rows.slice(-24).map(row => ({
      month: /^\d{4}-(?:0[1-9]|1[0-2])$/.test(row && row.month || '') ? row.month : null,
      amount: number(row && row.amount),
      ...(actual ? { periodStart: date(row && row.periodStart), periodEnd: date(row && row.periodEnd), complete: typeof (row && row.complete) === 'boolean' ? row.complete : null }
        : { source: clean(row && row.source, 60) })
    })).filter(row => row.month) : [];
    return {
      salesTrend: {
        source: clean(trend.source, 60), currency: clean(trend.currency, 12), actual: monthly(trend.actual, true), forecast: monthly(trend.forecast, false),
        baseline: { coefficient: nonnegative(trend.baseline && trend.baseline.coefficient), source: clean(trend.baseline && trend.baseline.source, 60) }
      },
      reserves: { ambientTonnes: nonnegative(reserves.ambientTonnes), coldTonnes: nonnegative(reserves.coldTonnes), source: clean(reserves.source, 60) },
      consumerMetrics: {
        status: clean(consumer.status, 30), sourceKind: clean(consumer.sourceKind, 60),
        window: { start: date(window.start), end: date(window.end), days: integer(window.days), complete: window.complete === true },
        counts: { identifiedCustomers: integer(counts.identifiedCustomers), purchaseOrders: integer(counts.purchaseOrders), repeatCustomers: integer(counts.repeatCustomers) },
        replay: { step: integer(replay.step), total: integer(replay.total) }
      },
      weather: {
        status: clean(weather.status, 30), provider: clean(weather.provider, 40),
        observedAt: clean(weather.observedAt, 40) || null, currentFetchedAt: clean(weather.currentFetchedAt, 40) || null, dailyFetchedAt: clean(weather.dailyFetchedAt, 40) || null,
        temperature: number(weather.temperature),
        days: Array.isArray(weather.days) ? weather.days.slice(0, 7).map(day => ({ date: date(day && day.date), high: number(day && day.high), low: number(day && day.low), dayPrecipitationMm: nonnegative(day && day.dayPrecipitationMm), windScale: clean(day && typeof day.windScale === 'number' ? String(day.windScale) : day && day.windScale, 20) || null })).filter(day => day.date) : []
      }
    };
  }

  function summary(input) {
    const source = input && typeof input === 'object' ? input : {};
    const number = (value) => finite(value) ? value : null;
    const order = source.recentOrder && typeof source.recentOrder === 'object' ? {
      name: clean(source.recentOrder.name), amount: number(source.recentOrder.amount)
    } : null;
    const stores = Array.isArray(source.topOrderStores) ? source.topOrderStores.slice(0, 3).map((store) => ({
      name: clean(store && store.name), amount: number(store && store.amount), count: number(store && store.count)
    })).filter((store) => store.name) : [];
    return {
      businessDate: clean(source.businessDate, 20), mode: clean(source.mode, 30),
      sourceKind: clean(source.sourceKind, 60), sourceVersion: clean(String(source.sourceVersion || ''), 120),
      displayComposition: clean(source.displayComposition, 40), baselineSales: number(source.baselineSales),
      updatedAt: clean(source.updatedAt, 40), displayedSales: number(source.displayedSales),
      retail: number(source.retail), netOrderSales: number(source.netOrderSales), retailOrderSales: number(source.retailOrderSales), orderCount: number(source.orderCount),
      retailOrderCount: number(source.retailOrderCount), averageOrder: number(source.averageOrder),
      refundCount: number(source.refundCount), recentOrder: order, topOrderStores: stores,
      logistics: {
        active: number(source.logistics && source.logistics.active), total: number(source.logistics && source.logistics.total),
        ratio: number(source.logistics && source.logistics.ratio), source: clean(source.logistics && source.logistics.source, 40),
        onTimePercent: number(source.logistics && source.logistics.onTimePercent), onTimeSource: clean(source.logistics && source.logistics.onTimeSource, 40)
      },
      plans: { octStores: number(source.plans && source.plans.octStores), octLogistics: number(source.plans && source.plans.octLogistics), source: clean(source.plans && source.plans.source, 40) },
      ...contextSummary(source)
    };
  }

  function fingerprint(snapshot) {
    // A clock update alone must not send another request or falsely animate a data change.
    const { updatedAt, ...businessValues } = snapshot;
    return JSON.stringify(businessValues);
  }

  function identity(snapshot) {
    return JSON.stringify([snapshot.businessDate, snapshot.mode, snapshot.sourceKind, snapshot.sourceVersion]);
  }

  function localAdvice(snapshot) {
    const step = integer(snapshot.orderCount) || 0;
    const pick = options => options[step % options.length];
    const rule = (type, label, id, text, emphasis, evidence, sources) => ({ type, label, ruleId: id, ruleVersion: RULE_VERSION, text, emphasis, evidence, sources });
    const recent = snapshot.recentOrder, top = snapshot.topOrderStores[0];
    const store = recent && recent.name ? recent : top;
    const net = amount(snapshot.netOrderSales), storeAmount = amount(store && store.amount);
    const sales = store
      ? `${store.name}${recent ? '最新净额' : '订单净额'}${storeAmount}；订单净额${net}，先核对SKU可售量再补货。`
      : `订单净额${net}（${count(snapshot.orderCount)}单）；补齐门店SKU库存与到货，再核对补货。`;
    const salesText = pick([sales, `订单净额${net}；${snapshot.refundCount > 0 ? '含' + count(snapshot.refundCount) + '笔负额单，先核对退单与对账。' : '先按门店、品类核对销售与到货，再安排补货。'}`]);
    const active = count(snapshot.logistics.active), total = count(snapshot.logistics.total);
    const ratio = snapshot.logistics.total > 0 && finite(snapshot.logistics.active) ? (snapshot.logistics.active / snapshot.logistics.total * 100).toFixed(2) + '%' : '—';
    const deliveryBase = snapshot.logistics.source === 'configuration' ? `配送${active}/后勤${total}为配置（${ratio}）` : `配送${active}/后勤${total}口径待核验`;
    const onTime = snapshot.logistics.onTimeSource === 'configuration' && finite(snapshot.logistics.onTimePercent) && snapshot.logistics.onTimePercent >= 0 && snapshot.logistics.onTimePercent <= 100
      ? `准时率${snapshot.logistics.onTimePercent.toFixed(1)}%为配置` : '准时率待实测';
    const delivery = pick([`${deliveryBase}；按时窗合单并补签收时间。`, `${onTime}；按${active}点核对承诺/签收时间与线路。`]);
    const reserves = snapshot.reserves;
    const stockText = reserves.source === 'configuration'
      ? pick([`储备配置：常温${finite(reserves.ambientTonnes) ? reserves.ambientTonnes : '—'}吨/冷链${finite(reserves.coldTonnes) ? reserves.coldTonnes : '—'}吨；补批次、库容与温控交接记录。`, `冷链${finite(reserves.coldTonnes) ? reserves.coldTonnes : '—'}吨为配置；按品类核对温区、交接及批次保质期。`])
      : '库存批次与库容未接；先核对品类温区、可售量和装卸交接，再安排调拨。';
    const trend = snapshot.salesTrend, currentMonth = snapshot.businessDate.slice(0, 7), plans = [];
    const actual = trend.actual.find(row => row.month === currentMonth), forecast = trend.forecast.find(row => row.month === currentMonth);
    if (trend.currency === 'CNY' && actual && actual.periodStart && actual.periodEnd && actual.periodStart.slice(0, 7) === actual.month && actual.periodEnd.slice(0, 7) === actual.month && actual.periodStart <= actual.periodEnd && finite(actual.amount) && forecast && finite(forecast.amount)) {
      const period = actual.complete ? `${Number(actual.month.slice(5))}月实绩` : `${Number(actual.month.slice(5))}月${Number(actual.periodStart.slice(8))}–${Number(actual.periodEnd.slice(8))}日实绩`;
      plans.push({ id: 'plan-monthly-period', text: `${period}${amount(actual.amount)}，整月预估${amount(forecast.amount)}；逐周核对渠道。`, emphasis: [amount(actual.amount), amount(forecast.amount)] });
    }
    const completed = trend.actual.filter(row => row.complete === true && row.periodStart === row.month + '-01'
      && row.periodEnd === new Date(Date.UTC(Number(row.month.slice(0, 4)), Number(row.month.slice(5)), 0)).toISOString().slice(0, 10)
      && finite(row.amount) && row.amount >= 0 && row.periodEnd < snapshot.businessDate);
    if (trend.currency === 'CNY' && completed.length && trend.baseline.source === 'user-setting' && finite(trend.baseline.coefficient)) {
      const days = completed.reduce((sum, row) => sum + (Date.parse(row.periodEnd) - Date.parse(row.periodStart)) / 86400000 + 1, 0);
      if (days > 0) {
        const daily = completed.reduce((sum, row) => sum + row.amount, 0) / days, base = daily * trend.baseline.coefficient;
        plans.push({ id: 'plan-baseline-reference', text: `完整月日均${amount(daily)}×配置${trend.baseline.coefficient.toFixed(2)}＝参考${amount(base)}；复核门店/团餐基数。`, emphasis: [amount(daily), amount(base)] });
      }
    }
    const consumer = snapshot.consumerMetrics, c = consumer.counts;
    if (['ready', 'ok', 'replay', 'offline', 'paused'].includes(consumer.status) && ['actual', 'historical-order-replay'].includes(consumer.sourceKind)
      && consumer.window.complete && consumer.window.start && consumer.window.end && consumer.window.days > 0
      && (Date.parse(consumer.window.end) - Date.parse(consumer.window.start)) / 86400000 + 1 === consumer.window.days
      && c.identifiedCustomers > 0 && c.purchaseOrders >= c.identifiedCustomers + c.repeatCustomers && c.repeatCustomers !== null && c.repeatCustomers <= c.identifiedCustomers) {
      plans.push({ id: 'plan-member-channel', text: `${consumer.window.days}天会员多次下单${(c.repeatCustomers / c.identifiedCustomers * 100).toFixed(2)}%${consumer.sourceKind === 'historical-order-replay' ? '（原始记录回放）' : ''}；先试门店/团餐组合。`, emphasis: [] });
    }
    if (!plans.length) plans.push({ id: 'plan-channel-readiness', text: `10月规划配置：新增门店${count(snapshot.plans.octStores)}家/后勤${count(snapshot.plans.octLogistics)}点；先核对团餐需求与配送资源。`, emphasis: [] });
    const plan = pick(plans);
    const weather = snapshot.weather, sourceTime = Date.parse(weather.dailyFetchedAt || weather.currentFetchedAt || '');
    const referenceTime = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(snapshot.updatedAt) ? snapshot.updatedAt.replace(' ', 'T') + '+08:00' : snapshot.updatedAt);
    const freshWeather = ['ready', 'ok'].includes(weather.status) && Number.isFinite(sourceTime) && Number.isFinite(referenceTime) && referenceTime >= sourceTime && referenceTime - sourceTime < 3600000;
    const coldText = !freshWeather && weather.status ? pick([stockText, '天气为缓存或待核验；出车前核对预报、装卸时窗与温控交接。']) : stockText;
    return [
      rule('stock', '销售补货', 'sales-order-replenishment', salesText, [net, store && store.name || '', storeAmount], { netOrderSales: snapshot.netOrderSales, recentOrder: recent, refundCount: snapshot.refundCount }, [RESEARCH_SOURCES.network]),
      rule('forecast', '配送履约', 'delivery-time-window', delivery, [], { ...snapshot.logistics, measuredFulfillmentAvailable: false }, [RESEARCH_SOURCES.network, RESEARCH_SOURCES.coldChain]),
      rule('data', '库存冷链', 'inventory-cold-handoff', coldText, [], { ...reserves, inventoryBatchesAvailable: false, weatherStatus: weather.status || null, weatherFresh: freshWeather }, [RESEARCH_SOURCES.foodLoss, RESEARCH_SOURCES.coldChain, RESEARCH_SOURCES.scenario]),
      rule('plan', '经营渠道', plan.id, plan.text, plan.emphasis, { salesTrend: trend, consumerMetrics: consumer, plans: snapshot.plans }, [RESEARCH_SOURCES.network])
    ];
  }

  function importantEmphasis(value, snapshot) {
    const store = [snapshot.recentOrder && snapshot.recentOrder.name, ...snapshot.topOrderStores.map(store => store.name)]
      .filter(Boolean).map(displayText).some(name => value === name);
    if (store) return [value];
    if (/%|°|℃|倍|吨|单|点|家|天/.test(value)) return [];
    return value.match(/[¥￥]\s*-?\d[\d,]*(?:\.\d{1,2})?|-?\d[\d,]*\.\d{2}/g) || [];
  }

  function validateAIAdvice(payload) {
    if (!payload || !Array.isArray(payload.advice) || payload.advice.length < 1 || payload.advice.length > 4) {
      throw new Error('AI 返回的建议列表无效');
    }
    return payload.advice.map((item) => {
      if (!item || typeof item !== 'object' || !ALLOWED_TYPES.has(item.type)
        || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 12
        || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 180) {
        throw new Error('AI 返回的建议字段无效');
      }
      const text = item.text.trim();
      const emphasis = Array.isArray(item.emphasis) ? item.emphasis.filter((value) => typeof value === 'string'
        && value.length > 0 && value.length <= 40 && value.trim() !== text && text.includes(value)).slice(0, 8) : [];
      return displayAdvice({ type: item.type, label: item.label.trim(), text, emphasis });
    });
  }

  function appendEmphasis(element, text, emphasis) {
    const terms = [...new Set(emphasis)].filter((term) => term && term !== '—').sort((a, b) => b.length - a.length);
    let cursor = 0;
    while (cursor < text.length) {
      let matchAt = text.length, match = '';
      for (const term of terms) {
        const position = text.indexOf(term, cursor);
        if (position >= 0 && (position < matchAt || position === matchAt && term.length > match.length)) {
          matchAt = position; match = term;
        }
      }
      if (!match) { element.appendChild(document.createTextNode(text.slice(cursor))); break; }
      if (matchAt > cursor) element.appendChild(document.createTextNode(text.slice(cursor, matchAt)));
      const strong = document.createElement('strong'); strong.textContent = match; element.appendChild(strong);
      cursor = matchAt + match.length;
    }
  }

  function installMotion() {
    if (document.getElementById('decision-advice-motion')) return;
    const style = document.createElement('style'); style.id = 'decision-advice-motion';
    style.textContent = '.advice.is-updating{animation:decision-advice-refresh 1.2s ease-out}.advice.is-updating strong{animation:decision-value-refresh 1.2s ease-out}@keyframes decision-advice-refresh{0%{background:#3fbed725}100%{background:transparent}}@keyframes decision-value-refresh{0%{color:#fff;text-shadow:0 0 12px #52daf5}100%{text-shadow:none}}@media(prefers-reduced-motion:reduce){.advice.is-updating,.advice.is-updating strong{animation:none}}';
    document.head.appendChild(style);
  }

  class DecisionAdvice {
    constructor(container, options = {}) {
      if (!container || typeof container.replaceChildren !== 'function') throw new Error('决策建议容器不存在');
      this.container = container; this.statusElement = options.statusElement || null;
      this.configElements = options.configElements || {}; this.config = readStoredConfig();
      this.latest = null; this.latestHash = ''; this.latestIdentity = ''; this.lastAI = null; this.sequence = 0;
      this.inflight = null; this.timer = null; this.lastRequestedAt = -Infinity; this.destroyed = false;
      this.handleSave = () => this.saveConfig();
      if (this.configElements.save) this.configElements.save.addEventListener('click', this.handleSave);
      this.fillConfig(); installMotion(); this.status('本地规则建议；AI 分析尚未启用。');
    }

    fillConfig() {
      const fields = this.configElements;
      if (fields.endpoint) fields.endpoint.value = this.config.endpoint;
      if (fields.enabled) fields.enabled.checked = this.config.enabled;
      if (fields.interval) fields.interval.value = String(this.config.interval);
    }

    status(text) {
      if (this.statusElement) this.statusElement.textContent = text;
    }

    saveConfig() {
      const fields = this.configElements;
      try {
        const next = { endpoint: normalizeEndpoint(fields.endpoint ? fields.endpoint.value : this.config.endpoint),
          enabled: fields.enabled ? fields.enabled.checked : this.config.enabled,
          interval: intervalSeconds(fields.interval ? fields.interval.value : this.config.interval) };
        if (next.enabled && !next.endpoint) throw new Error('启用 AI 前请填写 HTTPS 分析代理地址');
        this.cancelRequest(); this.lastAI = null; this.config = next;
        try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) { /* Usable without browser storage. */ }
        this.fillConfig();
        if (this.latest) this.render(localAdvice(this.latest), 'local-rules', this.latest);
        this.status(next.enabled ? 'AI 代理已启用；等待当前汇总分析。' : '本地规则建议；AI 分析尚未启用。');
        this.schedule();
        return true;
      } catch (error) {
        this.status(error.message || 'AI 配置无效'); return false;
      }
    }

    update(input) {
      if (this.destroyed) return;
      const snapshot = summary(input), hash = fingerprint(snapshot), sourceIdentity = identity(snapshot);
      if (this.latestHash === hash) return;
      if (this.latestIdentity && this.latestIdentity !== sourceIdentity) { this.cancelRequest(); this.lastAI = null; }
      this.latest = snapshot; this.latestHash = hash; this.latestIdentity = sourceIdentity;
      if (this.config.enabled && this.lastAI && this.lastAI.identity === sourceIdentity) {
        this.status('AI 建议基于 ' + this.lastAI.snapshot.updatedAt + ' 的汇总；每 ' + this.config.interval + ' 秒按数据变化更新。');
      } else {
        this.render(localAdvice(snapshot), 'local-rules', snapshot);
      }
      if (!this.config.enabled) this.status('本地规则建议；AI 分析尚未启用。');
      this.schedule();
    }

    render(advice, source, snapshot) {
      const fragment = document.createDocumentFragment();
      for (const original of advice) {
        const item = displayAdvice(original);
        const card = document.createElement('div'); card.className = 'advice is-updating';
        card.dataset.source = source;
        card.title = (source === 'ai' ? 'AI 代理建议' : '本地规则建议') + ' · ' + snapshot.mode + ' · ' + snapshot.updatedAt;
        if (item.ruleId) {
          card.dataset.ruleId = item.ruleId; card.dataset.ruleVersion = item.ruleVersion;
          card.title += '\n依据：' + JSON.stringify(item.evidence) + '\n研究来源：' + item.sources.join('；');
        }
        const label = document.createElement('span'); label.className = 'advice-label ' + item.type; label.textContent = item.label;
        const text = document.createElement('span'); text.className = 'advice-text'; appendEmphasis(text, item.text, item.emphasis.flatMap(value => importantEmphasis(value, snapshot)));
        card.append(label, text); fragment.appendChild(card);
      }
      this.container.replaceChildren(fragment);
      this.container.dataset.analysisSource = source;
      this.container.dataset.updatedAt = snapshot.updatedAt;
      this.container.dataset.businessDate = snapshot.businessDate;
      this.container.dataset.sourceMode = snapshot.mode;
    }

    schedule() {
      if (this.destroyed || !this.latest || !this.config.enabled || !this.config.endpoint || this.inflight) return;
      if (typeof global.fetch !== 'function') { this.status('浏览器不支持分析请求；已回退本地规则建议。'); return; }
      if (this.timer !== null) return;
      const delay = Math.max(0, this.config.interval * 1000 - (Date.now() - this.lastRequestedAt));
      if (delay === 0) { this.request(); return; }
      this.timer = global.setTimeout(() => { this.timer = null; this.request(); }, delay);
    }

    async request() {
      if (this.destroyed || this.inflight || !this.config.enabled || !this.latest) return;
      const snapshot = this.latest, hash = this.latestHash, sourceIdentity = this.latestIdentity;
      const sequence = ++this.sequence;
      const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
      const task = { controller, sequence }; this.inflight = task; this.lastRequestedAt = Date.now();
      this.status(this.lastAI ? 'AI 正在分析当前汇总；保留 ' + this.lastAI.snapshot.updatedAt + ' 的分析建议。'
        : 'AI 正在分析当前汇总；页面继续展示本地规则建议。');
      let timeout = null;
      try {
        const deadline = new Promise((_, reject) => { timeout = global.setTimeout(() => {
          if (controller) controller.abort(); reject(new Error('AI 分析超时'));
        }, 15000); });
        const call = (async () => {
          const response = await global.fetch(this.config.endpoint, {
            method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot }), ...(controller ? { signal: controller.signal } : {})
          });
          if (!response.ok) throw new Error('AI 代理返回 HTTP ' + response.status);
          const contentType = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : null;
          if (contentType && !contentType.toLowerCase().includes('application/json')) throw new Error('AI 代理须返回 JSON');
          return validateAIAdvice(await response.json());
        })();
        const advice = await Promise.race([call, deadline]);
        if (this.destroyed || sequence !== this.sequence || sourceIdentity !== this.latestIdentity) return;
        this.lastAI = { advice, snapshot, identity: sourceIdentity };
        this.render(advice, 'ai', snapshot);
        this.status('AI 分析时间 ' + snapshot.updatedAt + '；每 ' + this.config.interval + ' 秒按数据变化更新，请结合业务核验。');
      } catch (error) {
        if (this.destroyed || sequence !== this.sequence || sourceIdentity !== this.latestIdentity) return;
        this.lastAI = null;
        this.render(localAdvice(this.latest), 'local-rules', this.latest);
        this.status('AI 分析未完成，已回退本地规则建议。' + (error && error.message ? ' ' + clean(error.message, 100) : ''));
      } finally {
        if (timeout !== null) global.clearTimeout(timeout);
        if (this.inflight === task) this.inflight = null;
        // Same-source AI results remain visible with their analysis time while later totals are analysed.
        // Date, mode, or batch changes invalidate the response via sourceIdentity/sequence above.
        if (!this.destroyed && sequence === this.sequence && hash !== this.latestHash) this.schedule();
      }
    }

    cancelRequest() {
      this.sequence++;
      if (this.timer !== null) { global.clearTimeout(this.timer); this.timer = null; }
      if (this.inflight && this.inflight.controller) this.inflight.controller.abort();
      this.inflight = null;
    }

    destroy() {
      this.destroyed = true; this.cancelRequest();
      if (this.configElements.save) this.configElements.save.removeEventListener('click', this.handleSave);
    }
  }

  global.DecisionAdvice = DecisionAdvice;
})(window);
