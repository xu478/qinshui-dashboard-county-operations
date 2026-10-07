(function (global) {
  'use strict';
  const SCHEMA = 'qinshui-gps-points-v1';
  function parseGPS(packet, sources) {
    if (!packet || packet.schemaVersion !== SCHEMA || packet.coordinateSystem !== 'WGS84' || !Array.isArray(packet.points) || !packet.points.length) throw new Error('请选择现场采集页导出的WGS84点位JSON。');
    const known = new Map(sources.map(point => [point.id, point])), seen = new Set();
    return packet.points.map(point => {
      const site = point && known.get(point.id);
      if (!site || seen.has(point.id)) throw new Error('文件存在未知或重复网点ID，请重新导出采集结果。');
      seen.add(point.id);
      if (point.name !== site.name || point.type !== site.type || point.sourceRow !== site.sourceRow) throw new Error('网点名称与采集ID不一致：' + site.name);
      if (point.coordinateSystem !== 'WGS84' || point.pointCoordinateSystem !== 'WGS84' || point.positionSource !== 'browser-geolocation-wgs84' || point.locationConfirmedByUser !== true) throw new Error('点位缺少现场确认或WGS84采集来源：' + site.name);
      if (![point.longitude, point.latitude, point.accuracyMeters].every(value => typeof value === 'number' && Number.isFinite(value)) || Math.abs(point.longitude) > 180 || Math.abs(point.latitude) > 90 || point.accuracyMeters < 0 || point.accuracyMeters > 100) throw new Error('经纬度或定位精度不合格：' + site.name);
      if (typeof point.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(point.capturedAt) || !Number.isFinite(Date.parse(point.capturedAt))) throw new Error('采集时间无效：' + site.name);
      return { id: site.id, name: site.name, type: site.type, sourceRow: site.sourceRow,
        address: typeof point.address === 'string' ? point.address.slice(0, 300) : site.address || '',
        longitude: point.longitude, latitude: point.latitude, accuracyMeters: point.accuracyMeters, capturedAt: point.capturedAt,
        coordinateSystem: 'WGS84', pointCoordinateSystem: 'WGS84', positionSource: 'browser-geolocation-wgs84',
        locationConfirmedByUser: true, coordinateSystemConfirmedBySource: 'W3C-Geolocation',
        isDispatchOrigin: Boolean(site.isDispatchOrigin || site.sourceType === '园区') };
    });
  }
  function mergeGPS(current, incoming) {
    const merged = new Map(current.map(point => [point.id, { ...point }]));
    for (const point of incoming) {
      const previous = merged.get(point.id);
      if (previous?.positionSource === 'browser-geolocation-wgs84' && Date.parse(previous.capturedAt) > Date.parse(point.capturedAt)) continue;
      merged.set(point.id, { ...point });
    }
    return [...merged.values()];
  }
  global.MapPointImport = Object.freeze({ parseGPS, mergeGPS, SCHEMA });
  if (typeof module !== 'undefined' && module.exports) module.exports = global.MapPointImport;
})(typeof window !== 'undefined' ? window : globalThis);
