(function (global) {
  'use strict';

  // Only decorate the consumer panel; data values and metric calculations stay
  // with dashboard.js and ConsumerMetrics. Motion never changes data values.
  function cloneOption(value) {
    if (Array.isArray(value)) return value.map(cloneOption);
    if (value && Object.prototype.toString.call(value) === '[object Object]') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneOption(entry)]));
    }
    return value;
  }

  function decorateRadarOption(option) {
    const decorated = cloneOption(option);
    const radar = decorated.radar;
    radar.splitLine = { lineStyle: {
      color: ['#4f89a3', '#629cb2', '#74aec0', '#8dc4d1', '#b1e3ea'],
      width: 1.6, opacity: 1
    } };
    radar.axisLine = { lineStyle: { color: '#8bc8dc', width: 1.7, opacity: 1 } };
    radar.splitArea = { show: true, areaStyle: {
      color: ['rgba(31,107,135,.055)', 'rgba(31,107,135,.10)']
    } };
    for (const series of decorated.series || []) {
      if (series.type !== 'radar') continue;
      series.symbol = 'circle';
      // Radar node styling applies to every vertex; keep numeric value arrays
      // intact rather than replacing dimensions with unsupported style objects.
      series.symbolSize = 10;
      for (const group of series.data || []) {
        const color = group.itemStyle && group.itemStyle.color;
        group.itemStyle = { ...group.itemStyle,
          borderColor: '#ffffff', borderWidth: 2, opacity: 1,
          shadowBlur: 9, shadowColor: color
        };
      }
    }
    return decorated;
  }

  function installMetricGlow() {
    if (document.getElementById('consumer-metric-glow')) return;
    const style = document.createElement('style');
    style.id = 'consumer-metric-glow';
    style.textContent = `
      .profile-numbers .profile-number strong {
        display:inline-block;
        animation:consumer-metric-breathe 2.4s ease-in-out infinite;
      }
      .profile-numbers .profile-number:nth-child(2) strong {animation-delay:.6s}
      .profile-numbers .profile-number:nth-child(3) strong {animation-delay:1.2s}
      @keyframes consumer-metric-breathe {
        0%,100% {filter:brightness(1);text-shadow:0 0 0 transparent}
        50% {filter:brightness(1.35);text-shadow:0 0 13px #ffc44c99}
      }
      @media(prefers-reduced-motion:reduce) {
        .profile-numbers .profile-number strong {
          animation:none;filter:none;text-shadow:none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  global.ConsumerVisuals = { decorateRadarOption, installMetricGlow };
  installMetricGlow();
})(window);
