(function (global) {
  'use strict';
  const RATE = 0.2, VERSION = 'configured-compound-monthly-growth-v1';
  const MONTHLY_POLICY = 'configured-monthly-estimates', MONTHLY_VERSION = 'configured-monthly-estimates-v1';
  const validMonth = value => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 100;
  const monthIndex = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  const monthFromIndex = index => String(Math.floor(index / 12)).padStart(4, '0') + '-' + String(index % 12 + 1).padStart(2, '0');
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }
  function toCents(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError('invalid_growth_anchor_amount');
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(cents / 100 - value) > 1e-8) throw new TypeError('invalid_growth_anchor_precision');
    return cents;
  }
  function observedThrough(rows, asOfDate) {
    let latest = null;
    for (const row of rows) {
      if (row.actualSalesCny == null) continue;
      if (typeof row.actualSalesCny !== 'number' || !Number.isFinite(row.actualSalesCny) || row.actualSalesCny < 0 || !validDate(row.actualPeriodEnd) || row.actualPeriodEnd.slice(0, 7) !== row.month) throw new TypeError('invalid_actual_sales_observation');
      if (row.actualPeriodEnd <= asOfDate && (!latest || row.actualPeriodEnd > latest)) latest = row.actualPeriodEnd;
    }
    return latest;
  }
  function compoundCents(anchorCents, step) {
    // Exactly compound 6/5 before rounding each published amount to cents.
    // This avoids accumulating an intermediate rounding error from month to month.
    const numerator = BigInt(anchorCents) * (6n ** BigInt(step));
    const denominator = 5n ** BigInt(step);
    const rounded = (numerator + denominator / 2n) / denominator;
    if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('growth_scenario_amount_too_large');
    return Number(rounded);
  }

  function buildMonthlyEstimates(monthlySales, settings, asOfDate, anchorMonth, horizonMonths, currentRow) {
    // Explicit monthly configuration replaces the compound-growth policy entirely.
    // Historical adjustment metadata is provenance, never another calculation step.
    if (['anchorSalesCny', 'anchorSource', 'growthRate'].some(key => Object.prototype.hasOwnProperty.call(settings, key))) throw new TypeError('configured_estimates_do_not_accept_growth_overrides');
    const anchorSalesCny = currentRow && currentRow.estimatedSalesCny;
    const result = {
      status: 'unavailable', sourceKind: MONTHLY_POLICY, scenarioVersion: MONTHLY_VERSION, currency: 'CNY',
      scenario: { policy: MONTHLY_POLICY, configurationSource: 'user-authorized-placeholder', userAuthorized: true,
        anchorMonth, anchorSalesCny: anchorSalesCny == null ? null : anchorSalesCny,
        anchorSource: currentRow && currentRow.estimateRevision ? currentRow.estimateRevision.source : 'user-provided-expectation',
        asOfDate, observedThrough: observedThrough(monthlySales.months, asOfDate), horizonMonths,
        fittedModel: false, llmUsed: false, uncertaintyRangeProvided: false,
        note: '逐月预估为用户授权配置；不执行旧20%增长规则或历史下调记录。' },
      currentMonth: null, months: []
    };
    if (anchorSalesCny == null) { result.reason = 'current-month-estimate-missing'; return result; }
    const anchorCents = toCents(anchorSalesCny);
    result.currentMonth = { month: anchorMonth, pointSalesCny: anchorCents / 100,
      type: 'configured-current-month-projection', sourceKind: MONTHLY_POLICY, isActual: false };
    const futureByMonth = new Map();
    if (monthlySales.futureEstimates != null) {
      if (!Array.isArray(monthlySales.futureEstimates)) throw new TypeError('invalid_configured_future_estimates');
      for (const row of monthlySales.futureEstimates) {
        if (!row || !validMonth(row.month) || futureByMonth.has(row.month)) throw new TypeError('invalid_configured_future_month');
        futureByMonth.set(row.month, row);
      }
    }
    const selected = [], missingMonths = [];
    for (let step = 1; step <= horizonMonths; step += 1) {
      const month = monthFromIndex(monthIndex(anchorMonth) + step);
      if (!validMonth(month)) throw new TypeError('growth_scenario_date_out_of_range');
      const row = futureByMonth.get(month);
      if (!row || row.estimatedSalesCny == null) { missingMonths.push(month); continue; }
      if (row.source !== 'user-authorized-placeholder') throw new TypeError('invalid_configured_estimate_source');
      if (row.configuredAt !== undefined && (!validDate(row.configuredAt) || row.configuredAt > asOfDate)) throw new TypeError('invalid_configured_estimate_date');
      const cents = toCents(row.estimatedSalesCny);
      if (row.maximumSalesCny != null && cents > toCents(row.maximumSalesCny)) throw new TypeError('configured_estimate_exceeds_maximum');
      selected.push({ month, step, pointSalesCny: cents / 100, type: 'configured-monthly-estimate',
        sourceKind: MONTHLY_POLICY, source: row.source, isActual: false });
    }
    if (missingMonths.length) {
      result.reason = 'future-month-estimate-missing'; result.missingMonths = missingMonths;
      return result;
    }
    result.status = 'ok'; result.months = selected;
    return result;
  }

  function build(monthlySales, options) {
    if (!monthlySales || monthlySales.currency !== 'CNY' || !Array.isArray(monthlySales.months)) throw new TypeError('invalid_growth_scenario_source');
    const settings = options || {}, asOfDate = settings.asOfDate || monthlySales.providedAt;
    if (!validDate(asOfDate)) throw new TypeError('invalid_growth_scenario_as_of_date');
    const anchorMonth = settings.currentMonth || asOfDate.slice(0, 7);
    if (!validMonth(anchorMonth) || anchorMonth !== asOfDate.slice(0, 7)) throw new TypeError('inconsistent_growth_scenario_current_month');
    const horizonMonths = settings.horizonMonths === undefined ? 3 : settings.horizonMonths;
    if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > 12) throw new TypeError('invalid_growth_scenario_horizon');
    const seen = new Set();
    for (const row of monthlySales.months) {
      if (!row || !validMonth(row.month) || seen.has(row.month)) throw new TypeError('invalid_growth_scenario_source_month');
      seen.add(row.month);
    }
    const currentRow = monthlySales.months.find(row => row.month === anchorMonth);
    if (Object.prototype.hasOwnProperty.call(monthlySales, 'forecastPolicy')) {
      if (monthlySales.forecastPolicy !== MONTHLY_POLICY) throw new TypeError('invalid_forecast_policy');
      return buildMonthlyEstimates(monthlySales, settings, asOfDate, anchorMonth, horizonMonths, currentRow);
    }
    if (settings.growthRate !== undefined && settings.growthRate !== RATE) throw new TypeError('growth_rate_must_be_twenty_percent');
    const explicitAnchor = Object.prototype.hasOwnProperty.call(settings, 'anchorSalesCny');
    const anchorSalesCny = explicitAnchor ? settings.anchorSalesCny : currentRow && currentRow.estimatedSalesCny;
    const anchorSource = explicitAnchor ? (settings.anchorSource || 'explicit-user-anchor') : 'user-provided-expectation';
    if (typeof anchorSource !== 'string' || !anchorSource.trim() || anchorSource.length > 160) throw new TypeError('invalid_growth_scenario_anchor_source');
    const result = {
      status: 'unavailable', sourceKind: 'configured-growth-scenario', scenarioVersion: VERSION, currency: 'CNY',
      scenario: { rate: RATE, multiplier: 1.2, growthKind: 'compound-month-over-month', anchorMonth,
        anchorSalesCny: anchorSalesCny == null ? null : anchorSalesCny, anchorSource,
        asOfDate, observedThrough: observedThrough(monthlySales.months, asOfDate), horizonMonths,
        fittedModel: false, llmUsed: false, uncertaintyRangeProvided: false,
        rounding: 'compound-exact-six-fifths-then-round-each-result-to-cents' },
      currentMonth: null, months: []
    };
    if (anchorSalesCny == null) { result.reason = 'current-month-anchor-missing'; return result; }
    const anchorCents = toCents(anchorSalesCny);
    result.status = 'ok';
    result.currentMonth = { month: anchorMonth, pointSalesCny: anchorCents / 100,
      type: 'configured-current-month-projection', sourceKind: 'configured-growth-scenario', isActual: false };
    let previousCents = anchorCents;
    for (let step = 1; step <= horizonMonths; step += 1) {
      const month = monthFromIndex(monthIndex(anchorMonth) + step);
      if (!validMonth(month)) throw new TypeError('growth_scenario_date_out_of_range');
      const cents = compoundCents(anchorCents, step);
      result.months.push({ month, step, pointSalesCny: cents / 100, previousSalesCny: previousCents / 100,
        configuredMonthOverMonthRate: RATE, type: 'configured-growth-scenario', isActual: false });
      previousCents = cents;
    }
    result.scenario.strictlyIncreasing = result.months.every((row, index) => row.pointSalesCny > (index ? result.months[index - 1].pointSalesCny : result.currentMonth.pointSalesCny));
    result.scenario.note = anchorCents === 0
      ? '锚点为真实配置的0；乘以1.2仍为0，不能生成严格上升。'
      : !result.scenario.strictlyIncreasing ? '情景增长率为20%；金额按分显示，极小金额可能暂不显示增长。'
      : '用户设定每月环比+20%的复合增长情景，不是统计拟合或实时AI预测。';
    return result;
  }

  const api = Object.freeze({ build, RATE, VERSION, MONTHLY_POLICY, MONTHLY_VERSION });
  global.SalesGrowthScenario = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
