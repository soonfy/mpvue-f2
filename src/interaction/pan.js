import { Util, Chart } from "../lib/f2";
import Helper from './helper';
import Interaction from './base';

const DAY_TIMESTAMPS = 86400000;

class Pan extends Interaction {
  getDefaultCfg() {
    const defaultCfg = super.getDefaultCfg();
    return Util.mix({}, defaultCfg, {
      mode: 'x', // 方向，可取值 x、y、xy
      resetEvent: 'touchend',
      lastPoint: null,
      limitRange: {}, // 限制范围
      _timestamp: 0
    });
  }

  constructor(cfg, chart) {
    super(cfg, chart);
    chart.set('limitInPlot', true);

    // 该交互中 tooltip 为长按触发
    const tooltipController = chart.get('tooltipController');
    if (tooltipController.enable) { // 用户未关闭 tooltip
      chart.tooltip(false);
      Util.addEventListener(this.el, 'press', Util.wrapBehavior(this, '_handlePress'));
    }
  }

  start(e) {
    if (this.pressed) return;

    this.lastPoint = e.touches[0];
    this._handlePan(e);
  }

  process(e) {
    if (this.pressed) return;

    this._handlePan(e);
  }

  end() {
    if (this.pressed) return;

    this.lastPoint = null;
  }

  reset() {
    const self = this;
    self.pressed = false;
    self.chart.hideTooltip();
    self.chart.tooltip(false);
  }

  _handlePress(e) {
    this.pressed = true;
    const point = e.touches[0];
    this.chart.tooltip(true);
    this.chart.showTooltip(point);
  }

  _handlePan(e) {
    const { lastPoint } = this;
    if (lastPoint) {
      const currentPoint = e.touches[0];
      const deltaX = currentPoint.x - lastPoint.x;
      const deltaY = currentPoint.y - lastPoint.y;
      this.lastPoint = currentPoint;

      const lastTimestamp = this._timestamp;
      const now = +new Date();
      if ((now - lastTimestamp) > 16) {
        this._doPan(deltaX, deltaY);
        this._timestamp = now;
      }
    }
  }

  _doPan(deltaX, deltaY) {
    const self = this;
    const { mode, chart } = self;
    const coord = chart.get('coord');
    const { start, end } = coord;
    if (Helper.directionEnabled(mode, 'x') && deltaX !== 0) {
      const xScale = chart.getXScale();
      const coordWidth = end.x - start.x; // 绘图区域宽度

      if (xScale.isCategory) { // 横轴为分类类型
        self._panCatScale(xScale, deltaX, coordWidth);
      } else if (xScale.isLinear) {
        self._panLinearScale(xScale, deltaX, coordWidth, 'x');
      }
    }

    if (Helper.directionEnabled(mode, 'y') && deltaY !== 0) {
      const coordHeight = start.y - end.y; // 绘图区域高度
      const yScales = chart.getYScales();
      Util.each(yScales, yScale => {
        yScale.isLinear && self._panLinearScale(yScale, deltaY, coordHeight, 'y');
      });
    }
    chart.repaint();
  }

  _panLinearScale(scale, delta, range, flag) {
    const {
      field,
      min,
      max
    } = scale;

    const chart = this.chart;
    const ratio = delta / range;
    const panValue = ratio * (max - min);
    let newMax = flag === 'x' ? max - panValue : max + panValue;
    let newMin = flag === 'x' ? min - panValue : min + panValue;

    const limitRange = this.limitRange;
    if (limitRange[field] && limitRange[field].min && newMin <= limitRange[field].min) {
      newMin = limitRange[field].min;
      newMax = (max - min) + newMin;
    }
    if (limitRange[field] && limitRange[field].max && newMax >= limitRange[field].max) {
      newMax = limitRange[field].max;
      newMin = newMax - (max - min);
    }
    const colDef = Helper.getColDef(chart, field);
    chart.scale(field, Util.mix({}, colDef, {
      min: newMin,
      max: newMax,
      nice: false
    }));
  }

  _panCatScale(scale, delta, range) {
    const chart = this.chart;
    const {
      type,
      field,
      values,
      ticks
    } = scale;
    const colDef = Helper.getColDef(chart, field);

    if (!this.limitRange[field] || chart.get('dataChanged')) { // 缓存原始数据
      const data = chart.get('data');
      const originValues = [];
      data.map(obj => {
        let value = obj[field];
        if (type === 'timeCat') {
          value = scale._toTimeStamp(value);
        }
        if (originValues.indexOf(value) === -1) {
          originValues.push(value);
        }
        return obj;
      });
      this.limitRange[field] = originValues;
    }

    const originValues = this.limitRange[field];
    const ratio = delta / range;
    const valueLength = values.length;
    const deltaCount = Math.max(1, Math.abs(parseInt(ratio * valueLength))); // 变动的个数

    let firstIndex = originValues.indexOf(values[0]);
    let lastIndex = originValues.indexOf(values[valueLength - 1]);
    if (delta > 0 && firstIndex >= 0) { // 右移
      for (let i = 0; i < deltaCount && firstIndex > 0; i++) {
        firstIndex -= 1;
        lastIndex -= 1;
      }
      const newValues = originValues.slice(firstIndex, lastIndex + 1);
      let newTicks = null;
      if (type === 'timeCat') {
        const tickGap = ticks.length > 2 ? ticks[1] - ticks[0] : DAY_TIMESTAMPS;
        for (let i = ticks[0] - tickGap; i >= newValues[0]; i -= tickGap) {
          ticks.unshift(i);
        }
        newTicks = ticks;
      }

      chart.scale(field, Util.mix({}, colDef, {
        values: newValues,
        ticks: newTicks
      }));
    } else if (delta < 0 && lastIndex <= originValues.length - 1) { // 左移
      for (let i = 0; i < deltaCount && lastIndex < originValues.length - 1; i++) {
        firstIndex += 1;
        lastIndex += 1;
      }
      const newValues = originValues.slice(firstIndex, lastIndex + 1);

      let newTicks = null;
      if (type === 'timeCat') {
        const tickGap = ticks.length > 2 ? ticks[1] - ticks[0] : DAY_TIMESTAMPS;
        for (let i = ticks[ticks.length - 1] + tickGap; i <= newValues[newValues.length - 1]; i += tickGap) {
          ticks.push(i);
        }
        newTicks = ticks;
      }

      chart.scale(field, Util.mix({}, colDef, {
        values: newValues,
        ticks: newTicks
      }));
    }
  }
}

Chart.registerInteraction('pan', Pan);
// module.exports = Pan;
export default Pan
