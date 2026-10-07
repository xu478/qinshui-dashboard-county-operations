(function (global) {
  'use strict';

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const codeOf = (value) => typeof value === 'string' && value.trim().length <= 120 ? value.trim() : '';
  const codesOf = (input) => new Set(Array.from(input instanceof Set || Array.isArray(input) ? input : []).map(codeOf).filter(Boolean));
  const EPSILON = 0.0001;

  /**
   * Bind once to an SVG ECharts instance. After each setOption(..., false), call
   * update({ rows: [{code, value}], positiveCodes, changedCodes, sourceKey }).
   * positiveCodes comes from the caller's comparison of all stores, including
   * off-screen stores; changedCodes also stops a previously active decrease.
   * Initial/source-switch updates establish a baseline. reset() also does so.
   * This component never sets chart options or changes sales/series identities.
   */
  class StoreBarFlow {
    constructor(chart, options = {}) {
      if (!chart || typeof chart.getModel !== 'function' || typeof chart.getZr !== 'function') throw new Error('StoreBarFlow requires an ECharts instance');
      const graphic = options.graphic || (global.echarts && global.echarts.graphic);
      if (!graphic || !graphic.Group || !graphic.Rect || !graphic.LinearGradient) throw new Error('StoreBarFlow requires ECharts graphic primitives');
      this._chart = chart;
      this._zr = chart.getZr();
      this._graphic = graphic;
      this._seriesId = codeOf(options.seriesId) || 'store-sales';
      this._duration = finite(options.durationMs) ? Math.min(5000, Math.max(200, options.durationMs)) : 1200;
      this._values = new Map();
      this._visible = new Set();
      this._active = new Map();
      this._sourceKey = undefined;
      this._initialized = false;
      this._destroyed = false;
      this._timer = null;
      this._media = typeof global.matchMedia === 'function' ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this._onRendered = () => this._sync();
      this._onMotion = () => { if (this._reducedMotion()) this._clear(); };
      chart.on('rendered', this._onRendered);
      if (this._media) {
        if (typeof this._media.addEventListener === 'function') this._media.addEventListener('change', this._onMotion);
        else if (typeof this._media.addListener === 'function') this._media.addListener(this._onMotion);
      }
    }

    _usable() { return !this._destroyed && !(this._chart.isDisposed && this._chart.isDisposed()); }
    _reducedMotion() { return !!(this._media && this._media.matches); }

    update(input = {}) {
      if (!this._usable()) { this._clear(); return false; }
      if (input.sourceKey !== undefined && input.sourceKey !== this._sourceKey) this.reset(input.sourceKey);
      const rows = new Map();
      for (const row of Array.isArray(input.rows) ? input.rows : []) {
        const code = row && codeOf(row.code);
        if (code && finite(row.value) && row.value >= 0) rows.set(code, row.value);
      }
      const positive = codesOf(input.positiveCodes), changed = codesOf(input.changedCodes);
      this._visible = new Set(rows.keys());
      for (const code of this._active.keys()) {
        if (!rows.has(code) || (changed.has(code) && !positive.has(code))) this._stop(code);
      }
      const canStart = this._initialized && !this._reducedMotion();
      for (const [code, value] of rows) {
        const previous = this._values.get(code);
        if (previous !== undefined && value < previous - EPSILON) this._stop(code);
        // An explicit positive code can bring an off-screen store into view.
        // A repeated same-value update or ordinary ranking rotation never starts it.
        if (canStart && value > 0 && positive.has(code) && (previous === undefined || value > previous + EPSILON)) this._start(code);
        this._values.set(code, value);
      }
      this._initialized = true;
      if (this._reducedMotion()) this._clear();
      else this._sync();
      return true;
    }

    _series() {
      if (!this._usable()) return null;
      const model = this._chart.getModel();
      return model && model.getSeries().find((series) => series.id === this._seriesId && series.type === 'series.bar');
    }

    _geometry(code) {
      const series = this._series();
      if (!series) return null;
      const data = series.getData();
      for (let i = 0; i < data.count(); i++) {
        if (data.getId(i) !== code) continue;
        const element = data.getItemGraphicEl(i);
        if (!element || element.type !== 'rect' || element.ignore || element.invisible) return null;
        const shape = element.shape;
        if (!shape || !['x', 'y', 'width', 'height'].every((key) => finite(shape[key]))) return null;
        const matrix = element.getComputedTransform();
        return {
          shape: { x: shape.x, y: shape.y, width: shape.width, height: shape.height, r: Array.isArray(shape.r) ? shape.r.slice() : shape.r || 0 },
          matrix: matrix ? Array.from(matrix) : [1, 0, 0, 1, 0, 0],
          z: element.z || 0, zlevel: element.zlevel || 0, z2: (element.z2 || 0) + 1
        };
      }
      return null;
    }

    _start(code) {
      this._stop(code);
      const graphic = this._graphic;
      const clip = new graphic.Rect({ shape: { x: 0, y: 0, width: 0, height: 0 }, silent: true });
      const band = new graphic.Rect({
        shape: { x: 0, y: 0, width: 0, height: 0 }, silent: true,
        style: { opacity: 0.86, fill: new graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: 'rgba(232,251,255,0)' },
          { offset: 0.48, color: 'rgba(232,251,255,0.85)' },
          { offset: 1, color: 'rgba(232,251,255,0)' }
        ]) }
      });
      const group = new graphic.Group({ silent: true });
      group.name = 'store-bar-flow';
      group.setClipPath(clip);
      group.add(band);
      const startedAt = Date.now();
      const entry = { code, group, clip, band, startedAt, expiresAt: startedAt + this._duration, progress: 0, geometryKey: '', bandKey: '' };
      this._active.set(code, entry);
      this._syncEntry(entry);
      this._zr.add(group);
      band.animate('style', false).when(this._duration, { opacity: 0 }).during((style, progress) => {
        if (this._active.get(code) !== entry || !this._usable()) return;
        entry.progress = progress;
        this._syncEntry(entry);
      }).done(() => {
        if (this._active.get(code) === entry) this._stop(code);
      }).start('linear');
      this._scheduleCleanup();
    }

    _syncEntry(entry) {
      const geometry = this._geometry(entry.code);
      if (!geometry) {
        if (!entry.group.ignore) entry.group.attr('ignore', true);
        return;
      }
      const shape = geometry.shape, width = Math.abs(shape.width), height = Math.abs(shape.height);
      if (entry.group.ignore !== (width === 0 || height === 0)) entry.group.attr('ignore', width === 0 || height === 0);
      const geometryKey = JSON.stringify(geometry);
      if (entry.geometryKey !== geometryKey) {
        // Clone the actual animated rounded rectangle, never an estimated bar.
        entry.clip.setShape(shape);
        entry.group.setLocalTransform(geometry.matrix);
        entry.band.attr({ z: geometry.z, zlevel: geometry.zlevel, z2: geometry.z2 });
        entry.geometryKey = geometryKey;
      }
      const bandWidth = width * 0.28;
      const bandShape = {
        x: Math.min(shape.x, shape.x + shape.width) - bandWidth + (width + bandWidth) * entry.progress,
        y: Math.min(shape.y, shape.y + shape.height), width: bandWidth, height
      };
      const bandKey = JSON.stringify(bandShape);
      if (entry.bandKey !== bandKey) {
        entry.band.setShape(bandShape);
        entry.bandKey = bandKey;
      }
    }

    _sync() {
      if (!this._usable()) { this._clear(); return; }
      if (this._reducedMotion()) { this._clear(); return; }
      const now = Date.now();
      for (const [code, entry] of this._active) {
        if (now >= entry.expiresAt) this._stop(code);
        else this._syncEntry(entry);
      }
    }

    _stop(code) {
      const entry = this._active.get(code);
      if (!entry) return;
      this._active.delete(code);
      entry.band.stopAnimation();
      if (!(this._chart.isDisposed && this._chart.isDisposed())) this._zr.remove(entry.group);
      this._scheduleCleanup();
    }

    _scheduleCleanup() {
      if (this._timer !== null) { global.clearTimeout(this._timer); this._timer = null; }
      if (!this._active.size || this._destroyed) return;
      const next = Math.min(...Array.from(this._active.values(), (entry) => entry.expiresAt));
      this._timer = global.setTimeout(() => {
        this._timer = null;
        this._sync();
        this._scheduleCleanup();
      }, Math.max(1, next - Date.now()) + 8);
    }

    _clear() {
      for (const code of Array.from(this._active.keys())) this._stop(code);
      if (this._timer !== null) { global.clearTimeout(this._timer); this._timer = null; }
    }

    reset(sourceKey) {
      this._clear();
      this._values.clear();
      this._visible.clear();
      this._sourceKey = sourceKey;
      this._initialized = false;
    }

    getState() {
      return { activeCodes: Array.from(this._active.keys()), reducedMotion: this._reducedMotion(), destroyed: this._destroyed };
    }

    destroy() {
      if (this._destroyed) return;
      this._clear();
      this._chart.off('rendered', this._onRendered);
      if (this._media) {
        if (typeof this._media.removeEventListener === 'function') this._media.removeEventListener('change', this._onMotion);
        else if (typeof this._media.removeListener === 'function') this._media.removeListener(this._onMotion);
      }
      this._values.clear();
      this._visible.clear();
      this._destroyed = true;
    }
  }

  global.StoreBarFlow = StoreBarFlow;
})(typeof window !== 'undefined' ? window : globalThis);
