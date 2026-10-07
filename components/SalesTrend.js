(function (global) {
  'use strict';
  const DEFAULT_COLORS = { gold: '#ffe551', cyan: '#2eace2', text: '#ffffff', muted: '#92a0b7', grid: 'rgba(46,172,226,0.15)' };
  const finiteAmount = value => value == null ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const amountUnit = value => Math.abs(value) >= 100000000 ? { divisor: 100000000, unit: '亿元' }
    : Math.abs(value) >= 10000 ? { divisor: 10000, unit: '万元' } : { divisor: 1, unit: '元' };
  const formatAmount = value => {
    if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const unit = amountUnit(value);
    return (value / unit.divisor).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + unit.unit;
  };

  function normalize(data) {
    if (!data || data.currency !== 'CNY' || !Array.isArray(data.months)) throw new TypeError('invalid_monthly_sales_data');
    const seen = new Set();
    return data.months.map(row => {
      if (!row || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(row.month) || seen.has(row.month)) throw new TypeError('invalid_monthly_sales_month');
      seen.add(row.month);
      const actual = finiteAmount(row.actualSalesCny);
      const estimate = finiteAmount(row.estimatedSalesCny);
      const [year, month] = row.month.split('-').map(Number);
      let periodEnd = row.actualPeriodEnd == null ? null : row.actualPeriodEnd;
      let partial = Boolean(row.partial);
      if (periodEnd != null) {
        const parsed = Date.parse(periodEnd + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== periodEnd || periodEnd.slice(0, 7) !== row.month) throw new TypeError('invalid_actual_period_end');
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        partial = Number(periodEnd.slice(8)) < lastDay;
        if (typeof row.partial === 'boolean' && row.partial !== partial) throw new TypeError('inconsistent_actual_period');
      } else if (actual != null) {
        throw new TypeError('missing_actual_period_end');
      }
      return { month: row.month, monthNumber: month, actual, estimate, periodEnd, partial };
    }).sort((a, b) => a.month.localeCompare(b.month));
  }

  function buildOption(data, colors, forecast) {
    const palette = Object.assign({}, DEFAULT_COLORS, colors || {}), barColor = '#19bdd6';
    const observed = normalize(data), firstYear = observed[0] && observed[0].month.slice(0, 4);
    const byMonth = new Map(observed.map(row => [row.month, { ...row, prediction: null }]));
    const configuredForecast = forecast && ['configured-growth-scenario', 'configured-monthly-estimates'].includes(forecast.sourceKind);
    const predicted = forecast && Array.isArray(forecast.months) ? configuredForecast
      ? [...(forecast.currentMonth ? [forecast.currentMonth] : []), ...forecast.months]
      : forecast.sourceKind === 'trend-model-forecast' ? forecast.months : [] : [];
    for (const prediction of predicted) {
      if (!prediction || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(prediction.month)
        || finiteAmount(prediction.pointSalesCny) == null
        || !configuredForecast && ([prediction.scenarioLowerSalesCny, prediction.scenarioUpperSalesCny].some(value => finiteAmount(value) == null)
          || prediction.scenarioLowerSalesCny > prediction.pointSalesCny || prediction.pointSalesCny > prediction.scenarioUpperSalesCny)) throw new TypeError('invalid_sales_forecast');
      const row = byMonth.get(prediction.month) || { month: prediction.month, monthNumber: Number(prediction.month.slice(5)), actual: null, estimate: null, periodEnd: null, partial: false };
      byMonth.set(prediction.month, { ...row, prediction });
    }
    const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)), hasForecast = predicted.length > 0;
    const firstPredictionIndex = rows.findIndex(row => row.prediction);
    const monthOrder = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5));
    const bridgeIndex = !configuredForecast && firstPredictionIndex > 0 && rows[firstPredictionIndex - 1].estimate != null
      && monthOrder(rows[firstPredictionIndex].month) - monthOrder(rows[firstPredictionIndex - 1].month) === 1 ? firstPredictionIndex - 1 : -1;
    const maximum=Math.max(0,...rows.flatMap(row=>[row.partial?0:row.actual||0,row.estimate||0,row.prediction?.pointSalesCny||0,row.prediction?.scenarioUpperSalesCny||0]));
    // One scale per chart keeps all bars and lines comparable; labels and tooltips format each CNY amount independently.
    const axisUnit = amountUnit(maximum), plotMaximum = maximum / axisUnit.divisor;
    const magnitude = plotMaximum > 0 ? Math.pow(10, Math.floor(Math.log10(plotMaximum))) : 1;
    const axisMaximum = plotMaximum > 0 ? Math.ceil(plotMaximum / magnitude) * magnitude : 1;
    const toPlotAmount = value => value == null ? null : value / axisUnit.divisor;
    const formatPlotAmount = value => value == null ? '' : formatAmount(value * axisUnit.divisor);
    const projectionName = configuredForecast ? '预期走势' : '模型预期';
    const monthLabel = row => (row.month.slice(0, 4) !== firstYear ? row.month.slice(2, 4) + '年' : '') + row.monthNumber + '月';
    const cutoffLabel = row => row.periodEnd ? '截至' + row.monthNumber + '月' + Number(row.periodEnd.slice(8)) + '日' : '部分月';
    const completionRatio = row => configuredForecast && !row.partial && row.month === forecast.currentMonth?.month && row.actual != null && row.prediction?.pointSalesCny > 0
      ? row.actual / row.prediction.pointSalesCny * 100 : null;
    const actualSeries = {
      name: '实际销售额', type: 'bar', barWidth: hasForecast ? 28 : 38, itemStyle: { color: barColor }, z: 3,
      data: rows.map(row => ({ value: toPlotAmount(row.partial?null:row.actual), itemStyle: undefined, label: completionRatio(row) != null
        ? { distance: 6, formatter: params => formatPlotAmount(params.value) + '  完成 ' + completionRatio(row).toFixed(2) + '%' }
        : row.actual!=null&&row.estimate!=null&&maximum>0&&(row.estimate-row.actual)/maximum>.03&&(row.estimate-row.actual)/maximum<.23?{distance:28}:undefined })),
      label: { show: true, position: 'top', distance: configuredForecast ? 18 : 10, color: barColor, fontSize: 16, formatter: params => formatPlotAmount(params.value) }
    };
    const existingName = hasForecast ? '已有预期' : '销售预估';
    const existingLine = { name: existingName, type: 'line', connectNulls: false, data: rows.map(row => toPlotAmount(row.estimate)), symbol: 'circle', symbolSize: 7,
      lineStyle: { color: palette.gold, width: 2, type: 'solid' }, itemStyle: { color: palette.gold }, z: 5 };
    const series = [actualSeries, existingLine];
    if (hasForecast) {
      // Match both bars' x and zero origin; the light full-month bar stays behind actual sales, never summed with it.
      series.push({ name: '预测销售额', type: 'bar', barWidth: 28, barGap: '-100%', z: 1,
        data: rows.map(row => row.prediction ? configuredForecast && row.month === forecast.currentMonth?.month
          ? { value: toPlotAmount(row.prediction.pointSalesCny), label: { distance: 16, align: 'center', offset: [0, 0] } }
          : toPlotAmount(row.prediction.pointSalesCny) : null),
        itemStyle: { color: 'rgba(25,189,214,.24)', borderColor: '#94d7f5', borderWidth: 1, borderType: 'dashed' },
        label: { show: true, position: 'top', distance: configuredForecast ? 12 : 10, color: '#94d7f5', fontSize: 16, formatter: params => formatPlotAmount(params.value) } });
      // The user requested a continuous display; the preceding supplied expectation is a display-only anchor, excluded from model inputs.
      series.push({ name: projectionName, type: 'line', connectNulls: false, data: rows.map((row, index) => row.prediction
        ? configuredForecast && row.month === forecast.currentMonth?.month && row.prediction.pointSalesCny === row.estimate
          ? { value: toPlotAmount(row.prediction.pointSalesCny), symbol: 'none', sourceKind: 'configured-current-month-projection' } : toPlotAmount(row.prediction.pointSalesCny)
        : index === bridgeIndex ? { value: toPlotAmount(row.estimate), symbol: 'none', displayOnly: true, sourceKind: 'user-provided-expectation-anchor' } : null),
        symbol: 'emptyCircle', symbolSize: 7, lineStyle: { color: palette.gold, width: 2, type: 'dashed' }, itemStyle: { color: palette.gold }, z: 5 });
      if (!configuredForecast) series.push({ name: '情景范围', type: 'custom', silent: true, clip: true, z: 4,
        data: rows.flatMap((row, index) => row.prediction ? [[index, toPlotAmount(row.prediction.scenarioLowerSalesCny), toPlotAmount(row.prediction.scenarioUpperSalesCny)]] : []),
        renderItem: function (params, api) {
          const low = api.coord([api.value(0), api.value(1)]), high = api.coord([api.value(0), api.value(2)]);
          const style = { stroke: '#94d7f5', lineWidth: 1.5, opacity: .75 };
          return { type: 'group', children: [
            { type: 'line', shape: { x1: low[0], y1: low[1], x2: high[0], y2: high[1] }, style },
            { type: 'line', shape: { x1: low[0] - 7, y1: low[1], x2: low[0] + 7, y2: low[1] }, style },
            { type: 'line', shape: { x1: high[0] - 7, y1: high[1], x2: high[0] + 7, y2: high[1] }, style }
          ] };
        } });
    }
    return {
      animation: false, color: [barColor, palette.gold],
      grid: { left: 72, right: 28, top: 42, bottom: 62 },
      legend: { top: 0, left: 'center', itemWidth: 20, itemHeight: 10, itemGap: 22, textStyle: { color: palette.muted, fontSize: 18 },
        data: [{ name: '实际销售额', icon: 'rect' }, { name: existingName }, ...(hasForecast ? [{ name: '预测销售额', icon: 'rect' }, { name: projectionName }] : [])] },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: 'rgba(6,20,36,.96)', borderColor: palette.grid, textStyle: { color: palette.text, fontSize: 15 },
        formatter: function (params) {
          const first = Array.isArray(params) ? params[0] : params, row = rows[first && first.dataIndex];
          if (!row) return '';
          const title = row.month.slice(0, 4) + '年' + row.monthNumber + '月';
          const lines = [title];
          if (row.actual != null && !row.partial) lines.push('实际销售额：' + formatAmount(row.actual));
          else if (!row.prediction) lines.push('实际销售额：—');
          if (row.estimate != null) lines.push((hasForecast?'已有预期':'销售预估')+'：' + formatAmount(row.estimate));
          else if (!row.prediction) lines.push('销售预估：—');
          if (row.prediction) {
            if (configuredForecast) {
              lines.push((row.month === forecast.currentMonth?.month ? '当月预测：' : '预测销售额：') + formatAmount(row.prediction.pointSalesCny));
              if (completionRatio(row) != null) lines.push('实际 / 当月预期：' + completionRatio(row).toFixed(2) + '%（' + cutoffLabel(row) + '）');
            } else {
              lines.push('预测销售额 / 模型预期：' + formatAmount(row.prediction.pointSalesCny));
              lines.push('情景范围：' + formatAmount(row.prediction.scenarioLowerSalesCny) + '–' + formatAmount(row.prediction.scenarioUpperSalesCny));
            }
          }
          return lines.join('<br>');
        } },
      xAxis: { type: 'category', data: rows.map(row => monthLabel(row) + (row.prediction && row.actual == null ? '\n预测' : '')),
        axisLabel: { color: palette.muted, fontSize: 18, lineHeight: 22, interval: 0, margin: 10 }, axisTick: { show: false }, axisLine: { lineStyle: { color: palette.grid } } },
      yAxis: { type: 'value', name: axisUnit.unit, min: 0, max: configuredForecast ? axisMaximum : undefined, splitNumber: 3, nameTextStyle: { color: palette.muted, fontSize: 16 },
        axisLabel: { color: palette.muted, fontSize: 17, formatter: value => value.toLocaleString('zh-CN') }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: palette.grid } } },
      series
    };
  }

  global.SalesTrend = Object.freeze({ title: '销售情况与业绩走势', buildOption: buildOption, formatAmount: formatAmount });
})(typeof window !== 'undefined' ? window : globalThis);
