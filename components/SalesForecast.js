(function (global) {
  'use strict';
  const MODEL_VERSION = 'calendar-rate-ols-anchored-damped-v1';
  const REFERENCES = [
    { title: 'Calendar adjustments', url: 'https://otexts.com/fpp3/transformations.html' },
    { title: 'Linear time trend', url: 'https://otexts.com/fpp3/useful-predictors.html' },
    { title: 'Damped trend methods', url: 'https://otexts.com/fpp3/holt.html' },
    { title: 'Very short time series', url: 'https://otexts.com/fpp3/long-short-ts.html' },
    { title: 'Scenario forecasting', url: 'https://otexts.com/fpp3/scenarios.html' }
  ];
  const TYPES = ['anchored-damped', 'anchored-flat', 'anchored-linear', 'complete-month-ols'];
  const money = value => Math.round(Math.max(0, value) * 100) / 100;
  const finiteAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const monthIndex = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  const monthAtIndex = index => String(Math.floor(index / 12)).padStart(4, '0') + '-' + String(index % 12 + 1).padStart(2, '0');
  const validMonth = value => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 100;
  const daysInMonth = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
  }
  function observations(data, asOfDate) {
    if (!data || data.currency !== 'CNY' || !Array.isArray(data.months)) throw new TypeError('invalid_monthly_sales_source');
    const seen = new Set(), result = [];
    for (const row of data.months) {
      if (!row || !validMonth(row.month) || seen.has(row.month)) throw new TypeError('invalid_monthly_sales_month');
      seen.add(row.month);
      if (row.actualSalesCny == null) continue; // Unknown actual is not zero or a business target.
      if (!finiteAmount(row.actualSalesCny)) throw new TypeError('invalid_actual_sales_amount');
      const periodStart = row.actualPeriodStart || row.month + '-01', periodEnd = row.actualPeriodEnd;
      if (!validDate(periodStart) || !validDate(periodEnd) || periodStart.slice(0, 7) !== row.month || periodEnd.slice(0, 7) !== row.month || periodStart > periodEnd) throw new TypeError('invalid_actual_sales_period');
      const calendarDays = daysInMonth(row.month);
      const coveredDays = Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000) + 1;
      const partial = coveredDays !== calendarDays;
      if (typeof row.partial === 'boolean' && row.partial !== partial) throw new TypeError('inconsistent_actual_sales_period');
      if (periodEnd > asOfDate) continue; // Never train with information beyond the business as-of date.
      result.push({ month: row.month, monthIndex: monthIndex(row.month), actualSalesCny: row.actualSalesCny,
        periodStart, periodEnd, calendarDays, coveredDays, partial,
        dailyRateCny: row.actualSalesCny / coveredDays });
    }
    return result.sort((a, b) => a.monthIndex - b.monthIndex);
  }
  function fitTrend(rows) {
    const origin = rows[0].monthIndex;
    const meanX = rows.reduce((sum, row) => sum + row.monthIndex - origin, 0) / rows.length;
    const meanY = rows.reduce((sum, row) => sum + row.dailyRateCny, 0) / rows.length;
    const denominator = rows.reduce((sum, row) => sum + Math.pow(row.monthIndex - origin - meanX, 2), 0);
    const slope = rows.reduce((sum, row) => sum + (row.monthIndex - origin - meanX) * (row.dailyRateCny - meanY), 0) / denominator;
    const intercept = meanY - slope * meanX;
    const rmse = Math.sqrt(rows.reduce((sum, row) => sum + Math.pow(row.dailyRateCny - intercept - slope * (row.monthIndex - origin), 2), 0) / rows.length);
    return { origin, slope, intercept, trainingRmseCnyPerDay: rmse };
  }

  function build(data, options) {
    const settings = options || {};
    const asOfDate = settings.asOfDate || data && data.providedAt;
    if (!validDate(asOfDate)) throw new TypeError('invalid_forecast_as_of_date');
    const horizonMonths = settings.horizonMonths === undefined ? 3 : settings.horizonMonths;
    const damping = settings.damping === undefined ? 0.8 : settings.damping;
    const candidateType = settings.candidateType || 'anchored-damped';
    if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > 12 || typeof damping !== 'number' || !Number.isFinite(damping) || damping <= 0 || damping > 1 || !TYPES.includes(candidateType)) throw new TypeError('invalid_forecast_settings');
    const forecastStartMonth = settings.forecastStartMonth || monthAtIndex(monthIndex(asOfDate.slice(0, 7)) + 1);
    if (!validMonth(forecastStartMonth) || monthIndex(forecastStartMonth) < monthIndex(asOfDate.slice(0, 7))) throw new TypeError('invalid_forecast_start_month');
    const observed = observations(data, asOfDate), complete = observed.filter(row => !row.partial);
    const base = { status: 'unavailable', sourceKind: 'trend-model-forecast', modelVersion: MODEL_VERSION,
      currency: 'CNY', scope: typeof data.scope === 'string' ? data.scope : null, asOfDate,
      observedThrough: observed.length ? observed[observed.length - 1].periodEnd : null,
      forecastStartMonth, horizonMonths, months: [],
      model: { name: '趋势模型预测', candidateType, trainingMonths: complete.map(row => row.month),
        completeMonthCount: complete.length, damping: { value: damping, kind: 'fixed-assumption', applied: candidateType === 'anchored-damped' },
        uncertainty: { kind: 'scenario-envelope', confidenceLevel: null, isPredictionInterval: false },
        llmUsed: false, seasonalityEstimated: false, weatherUsed: false, inventoryUsed: false,
        validation: 'not-out-of-sample-validated', references: REFERENCES.map(reference => ({ ...reference })) }
    };
    if (complete.length < 3 || !observed.length) {
      base.reason = 'insufficient-complete-actual-months'; return base;
    }
    const trend = fitTrend(complete), anchor = observed[observed.length - 1];
    const anchorEquivalent = anchor.dailyRateCny * anchor.calendarDays;
    base.status = 'ok';
    Object.assign(base.model, {
      olsDailyTrendCnyPerMonth: trend.slope, olsDailyInterceptCny: trend.intercept,
      olsOriginMonth: monthAtIndex(trend.origin), trainingResidualRmseCnyPerDay: trend.trainingRmseCnyPerDay,
      anchor: { month: anchor.month, actualSalesCny: anchor.actualSalesCny,
        actualPeriodStart: anchor.periodStart, actualPeriodEnd: anchor.periodEnd,
        coveredCalendarDays: anchor.coveredDays, monthCalendarDays: anchor.calendarDays,
        coverageFraction: anchor.coveredDays / anchor.calendarDays,
        dailyRateCny: anchor.dailyRateCny, monthEquivalentSalesCny: money(anchorEquivalent),
        isActualFullMonth: !anchor.partial, basis: 'uniform-calendar-day-rate-assumption' },
      formula: candidateType === 'complete-month-ols'
        ? 'calendarDays(month) * max(0, olsIntercept + olsDailyTrend * (monthIndex - olsOriginMonthIndex))'
        : candidateType === 'anchored-flat' ? 'calendarDays(month) * max(0, anchorDailyRate)'
        : candidateType === 'anchored-linear' ? 'calendarDays(month) * max(0, anchorDailyRate + olsDailyTrend * h)'
        : 'calendarDays(month) * max(0, anchorDailyRate + olsDailyTrend * sum(phi^j, j=1..h))',
      targetPolicy: 'historical-estimatedSalesCny-and-business-targets-excluded-from-training',
      limitations: [
        '仅少量完整月，模型优劣及未来误差分布尚未验证。',
        '日历日均仅调整月长，未校正营业日、星期结构、节假日或渠道变化。',
        anchor.partial ? '部分月日均校准假定已覆盖日期代表整月；整月外推不是实际销售额。' : '近期日均延续为预测假设，未来实际可能改变。',
        '阻尼系数为预设假设，未用数据估计；这不是已拟合的ETS/Holt模型。',
        '情景范围不保证覆盖未来实际，不是置信区间或预测区间。'
      ],
      scenarioDefinition: 'envelope-of-flat-anchor-undamped-anchor-and-selected-candidate'
    });
    const initialMonth = monthIndex(forecastStartMonth);
    for (let index = 0; index < horizonMonths; index += 1) {
      const targetIndex = initialMonth + index, month = monthAtIndex(targetIndex);
      const h = targetIndex - anchor.monthIndex;
      if (h < 0) throw new TypeError('forecast_precedes_anchor');
      let sum = 0;
      for (let step = 1; step <= h; step += 1) sum += Math.pow(damping, step);
      const flatRate = anchor.dailyRateCny, linearRate = flatRate + trend.slope * h;
      let rate = flatRate + trend.slope * sum;
      if (candidateType === 'anchored-flat') rate = flatRate;
      if (candidateType === 'anchored-linear') rate = linearRate;
      if (candidateType === 'complete-month-ols') rate = trend.intercept + trend.slope * (targetIndex - trend.origin);
      const calendarDays = daysInMonth(month), point = money(rate * calendarDays);
      const flatSales = money(flatRate * calendarDays), linearSales = money(linearRate * calendarDays);
      base.months.push({ month, pointSalesCny: point,
        scenarioLowerSalesCny: Math.min(flatSales, linearSales, point),
        scenarioUpperSalesCny: Math.max(flatSales, linearSales, point),
        scenarios: { flatDailySalesCny: flatSales, undampedTrendSalesCny: linearSales },
        businessTargetSalesCny: null, calendarDays, horizonFromAnchorMonths: h,
        type: h === 0 && anchor.partial ? 'partial-month-nowcast' : 'trend-model-forecast' });
    }
    return base;
  }

  const api = Object.freeze({ build, MODEL_VERSION, CANDIDATE_TYPES: TYPES.slice() });
  global.SalesForecast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
