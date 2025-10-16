// components/RealtimeChart.tsx
'use client';

import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  UTCTimestamp,
  ColorType,
  LineStyle,
  LineWidth,
} from 'lightweight-charts';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle as CandleT } from '../lib/indicators';
import {
  EMA, RSI, MACD,
  NWE_Dynamic, BreakoutLevelsStrict, BalanceNumber,
  HeikinAshiMarketBiasFull, EfmusSignals,
  ReboundsPineLike, ReboundsLatePineLike,
} from '../lib/indicators';
import { wsURL, httpURL } from '../lib/ws';

/* ---------------- tipos / util ---------------- */
type Candle = CandleT;
type Props = { symbol?: string; interval?: string };

const toTs = (t: number): UTCTimestamp => t as UTCTimestamp;
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtByInterval = (tsSec: number, interval: string) => {
  const d = new Date(tsSec * 1000);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1, D = d.getUTCDate();
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  if (interval.startsWith('Min')) return `${pad(h)}:${pad(m)}`;
  if (interval.startsWith('Hour') || interval === 'Min60') return `${pad(D)}/${pad(M)} ${pad(h)}:${pad(m)}`;
  if (interval === 'Day1' || interval === 'Week1') return `${pad(D)}/${pad(M)}`;
  if (interval === 'Month1') return `${pad(M)}/${Y}`;
  return `${pad(D)}/${pad(M)} ${pad(h)}:${pad(m)}`;
};
const precisionForInterval = (interval: string) => (interval.startsWith('Min') || interval.startsWith('Hour') ? 8 : 6);
const minMoveFromPrecision = (p: number) => Number((1 / Math.pow(10, p)).toFixed(p));
const toLW = (n: number): LineWidth => Math.max(1, Math.min(3, Math.round(n))) as LineWidth;

const LEFT_PAD = 25;   // barras libres a la izquierda
const RIGHT_PAD = 35;  // barras libres a la derecha

/* ---------------- prefs ---------------- */
type IndicatorPrefs = {
  ema: { enabled: boolean; length: number; color: string };
  nwe: { enabled: boolean; h: number; mult: number; upColor: string; dnColor: string };
  breakout: { enabled: boolean; rangeLen: number; atrLen: number; bufATR: number; upColor: string; dnColor: string };
  efmus: { enabled: boolean; fast: number; slow: number; upColor: string; dnColor: string; emaFastColor: string; emaSlowColor: string };
  rsi: { enabled: boolean; length: number; color: string };
  macd: { enabled: boolean; fast: number; slow: number; signal: number; lineColor: string; signalColor: string; posColor: string; negColor: string };
  balance: { enabled: boolean; scale: number; posColor: string; negColor: string; proxWidth: number };
  mbias: { enabled: boolean; len: number; smooth: number; colorBull: string; colorBear: string; width: number; oscLen: number };
};
const DEFAULT_PREFS: IndicatorPrefs = {
  ema: { enabled: true, length: 20, color: '#00B4FF' },
  nwe: { enabled: false, h: 8, mult: 3, upColor: '#2dd4bf', dnColor: '#ef4444' },
  breakout: { enabled: false, rangeLen: 16, atrLen: 14, bufATR: 0.2, upColor: '#2dd4bf', dnColor: '#ef4444' },
  efmus: { enabled: false, fast: 13, slow: 48, upColor: '#22c55e', dnColor: '#ef4444', emaFastColor: '#22c55e', emaSlowColor: '#f59e0b' },
  rsi: { enabled: false, length: 14, color: '#22d3ee' },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9, lineColor: '#60a5fa', signalColor: '#f472b6', posColor: 'rgba(111,207,151,0.8)', negColor: 'rgba(239,83,80,0.8)' },
  balance: { enabled: false, scale: 100, posColor: '#22c55e', negColor: '#ef4444', proxWidth: 1.0 },
  mbias: { enabled: true, len: 100, smooth: 100, colorBull: '#00e676', colorBear: '#ff1744', width: 3, oscLen: 7 },
};
const prefsKey = (sym: string, intv: string) => `chart_prefs:${sym}:${intv}`;

/* =========================================================
   HOOK: charts sincronizados por LOGICAL RANGE + padding
   ========================================================= */
function useSyncedCharts(interval: string) {
  const priceEl = useRef<HTMLDivElement | null>(null);
  const volEl = useRef<HTMLDivElement | null>(null);
  const rsiEl = useRef<HTMLDivElement | null>(null);
  const macdEl = useRef<HTMLDivElement | null>(null);
  const balEl = useRef<HTMLDivElement | null>(null);

  const priceChart = useRef<IChartApi | null>(null);
  const volChart = useRef<IChartApi | null>(null);
  const rsiChart = useRef<IChartApi | null>(null);
  const macdChart = useRef<IChartApi | null>(null);
  const balChart = useRef<IChartApi | null>(null);

  const priceSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const overlays = useRef<Record<string, ISeriesApi<'Line'>> | null>(null);

  const getOverlay = useCallback((name: string) => {
    if (!priceChart.current) return null as ISeriesApi<'Line'> | null;
    if (!overlays.current) overlays.current = {};
    if (!overlays.current[name]) {
      overlays.current[name] = priceChart.current.addLineSeries({
        priceScaleId: 'right',
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }
    return overlays.current[name];
  }, []);

  // padding usando logical range en el chart de precio
  const ensurePadding = useCallback((barsCount: number) => {
    if (!priceChart.current) return;
    const r = priceChart.current.timeScale().getVisibleLogicalRange() as any;
    const width = r ? r.to - r.from : Math.max(50, Math.min(200, barsCount * 0.5));
    const minFrom = -LEFT_PAD;
    const maxTo = (barsCount - 1) + RIGHT_PAD;
    const target = !r
      ? { from: minFrom, to: minFrom + width }
      : (r.to >= (barsCount - 1) - 0.5)
        ? { from: maxTo - width, to: maxTo }
        : (r.from <= 0.5)
          ? { from: minFrom, to: minFrom + width }
          : r;
    try { priceChart.current.timeScale().setVisibleLogicalRange(target); } catch {}
    // propaga el MISMO logical range a los demás panes
    const newR = priceChart.current.timeScale().getVisibleLogicalRange() as any;
    [volChart.current, rsiChart.current, macdChart.current, balChart.current].forEach((c) => {
      if (!c || !newR || newR.from == null || newR.to == null) return;
      try { c.timeScale().setVisibleLogicalRange(newR); } catch {}
    });
  }, []);

  useEffect(() => {
    if (!priceEl.current || !volEl.current || !rsiEl.current || !macdEl.current || !balEl.current) return;

    const common = {
      layout: { textColor: '#b7bcc5', background: { type: ColorType.Solid, color: 'transparent' as const } },
      grid: { horzLines: { visible: true, color: 'rgba(255,255,255,0.12)' }, vertLines: { visible: true, color: 'rgba(255,255,255,0.12)' } },
      timeScale: { rightOffset: 12, borderVisible: true, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      localization: { timeFormatter: (t: unknown) => fmtByInterval(Number(t), interval) },
    } as const;

    // precio
    priceChart.current = createChart(priceEl.current, { ...common, height: 340, rightPriceScale: { borderVisible: true }, leftPriceScale: { borderVisible: false } });
    const p = precisionForInterval(interval);
    priceSeries.current = priceChart.current.addCandlestickSeries({
      priceFormat: { type: 'price', precision: p, minMove: minMoveFromPrecision(p) },
      lastValueVisible: true, priceLineVisible: true, priceScaleId: 'right',
    });

    // panes
    volChart.current = createChart(volEl.current,   { ...common, height: 110, rightPriceScale: { borderVisible: true }, leftPriceScale: { borderVisible: false } });
    rsiChart.current = createChart(rsiEl.current,   { ...common, height: 140, rightPriceScale: { borderVisible: true }, leftPriceScale: { borderVisible: false } });
    macdChart.current = createChart(macdEl.current, { ...common, height: 140, rightPriceScale: { borderVisible: true }, leftPriceScale: { borderVisible: false } });
    balChart.current = createChart(balEl.current,   { ...common, height: 120, rightPriceScale: { borderVisible: true }, leftPriceScale: { borderVisible: false } });

    const charts = [priceChart.current, volChart.current, rsiChart.current, macdChart.current, balChart.current];

    // sincronización por logical range
    let syncing = false;
    const cbs: Array<(r: any) => void> = [];
    charts.forEach((src, idx) => {
      const cb = (r: any) => {
        if (syncing || !r || r.from == null || r.to == null) return;
        syncing = true;
        charts.forEach((dst, j) => {
          if (j === idx || !dst) return;
          try { dst.timeScale().setVisibleLogicalRange(r); } catch {}
        });
        syncing = false;
      };
      src.timeScale().subscribeVisibleLogicalRangeChange(cb as any);
      cbs.push(cb);
    });

    // resize
    const applyWidths = () => {
      const w = priceEl.current?.clientWidth ?? 0;
      if (w > 0) charts.forEach((c) => c.applyOptions({ width: w }));
    };
    applyWidths();
    const onResize = () => applyWidths();
    window.addEventListener('resize', onResize);
    const ros = [priceEl, volEl, rsiEl, macdEl, balEl].map((ref) => {
      const ro = new ResizeObserver(() => applyWidths());
      if (ref.current) ro.observe(ref.current);
      return ro;
    });

    return () => {
      window.removeEventListener('resize', onResize);
      ros.forEach((ro) => ro.disconnect());
      charts.forEach((c, i) => {
        try { c.timeScale().unsubscribeVisibleLogicalRangeChange(cbs[i] as any); } catch {}
        c.remove();
      });
      priceChart.current = volChart.current = rsiChart.current = macdChart.current = balChart.current = null;
      priceSeries.current = null;
      overlays.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    priceEl, volEl, rsiEl, macdEl, balEl,
    priceChart, volChart, rsiChart, macdChart, balChart,
    priceSeries, getOverlay, ensurePadding,
  };
}

/* ---------------- mappers ---------------- */
const mapLine = (data: Candle[], values: number[]): LineData[] => {
  const out: LineData[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) out.push({ time: toTs(data[i].time), value: v as number });
  }
  return out;
};
const mapHistFill = (
  data: Candle[],
  values: number[],
  posColor: string,
  negColor: string,
  fillTransparent = true
): HistogramData[] => {
  const out: HistogramData[] = new Array<HistogramData>(data.length);
  for (let i = 0; i < data.length; i++) {
    const finite = Number.isFinite(values[i]);
    const value = finite ? (values[i] as number) : 0;
    const color = finite ? (value >= 0 ? posColor : negColor) : (fillTransparent ? 'rgba(0,0,0,0)' : negColor);
    out[i] = { time: toTs(data[i].time), value, color };
  }
  return out;
};
const toCandle = (c: Candle): CandlestickData => ({ time: toTs(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
const toVolume = (c: Candle): HistogramData => ({ time: toTs(c.time), value: c.volume ?? 0, color: c.close >= c.open ? '#26a69a' : '#ef5350' });

/* =========================================================
   Componente principal
   ========================================================= */
export default function RealtimeChart({ symbol = 'DOGE_USDT', interval = 'Min1' }: Props) {
  const {
    priceEl, volEl, rsiEl, macdEl, balEl,
    priceChart, volChart, rsiChart, macdChart, balChart,
    priceSeries, getOverlay, ensurePadding,
  } = useSyncedCharts(interval);

  // panes
  const volSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const macdLineSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const balHistSeries = useRef<ISeriesApi<'Histogram'> | null>(null);

  // series “ancla” para forzar mismo eje X en TODOS los panes
  const rsiAnchor  = useRef<ISeriesApi<'Histogram'> | null>(null);
  const macdAnchor = useRef<ISeriesApi<'Histogram'> | null>(null);
  const balAnchor  = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [prefs, setPrefs] = useState<IndicatorPrefs>(DEFAULT_PREFS);
  const [panelOpen, setPanelOpen] = useState(false);

  // persistencia
  useEffect(() => {
    try {
      const raw = localStorage.getItem(prefsKey(symbol, interval));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed.mbias) parsed.mbias = DEFAULT_PREFS.mbias;
        if (parsed.mbias.enabled === undefined) parsed.mbias.enabled = true;
        setPrefs({ ...DEFAULT_PREFS, ...parsed });
      } else {
        setPrefs(DEFAULT_PREFS);
      }
    } catch { setPrefs(DEFAULT_PREFS); }
  }, [symbol, interval]);
  useEffect(() => { try { localStorage.setItem(prefsKey(symbol, interval), JSON.stringify(prefs)); } catch {} }, [prefs, symbol, interval]);

  // init series panes + anchors
  useEffect(() => {
    if (!volChart.current || !rsiChart.current || !macdChart.current || !balChart.current) return;

    volSeries.current = volChart.current.addHistogramSeries({ priceFormat: { type: 'volume' } });

    // ANCHOR (hist transparente con todos los times del precio)
    rsiAnchor.current  = rsiChart.current.addHistogramSeries({ priceFormat: { type: 'volume' } });
    macdAnchor.current = macdChart.current.addHistogramSeries({ priceFormat: { type: 'volume' } });
    balAnchor.current  = balChart.current.addHistogramSeries({ priceFormat: { type: 'volume' } });

    // series visibles
    rsiSeries.current = rsiChart.current.addLineSeries({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    macdLineSeries.current = macdChart.current.addLineSeries({});
    macdSignalSeries.current = macdChart.current.addLineSeries({});
    macdHistSeries.current = macdChart.current.addHistogramSeries({});
    balHistSeries.current = balChart.current.addHistogramSeries({});

    return () => {
      volSeries.current = null;
      rsiSeries.current = null;
      macdLineSeries.current = macdSignalSeries.current = macdHistSeries.current = null;
      balHistSeries.current = null;
      rsiAnchor.current = macdAnchor.current = balAnchor.current = null;
    };
  }, [volChart.current, rsiChart.current, macdChart.current, balChart.current]);

  // timeframe visual
  useEffect(() => {
    const opts = { localization: { timeFormatter: (t: unknown) => fmtByInterval(Number(t), interval) } };
    [priceChart.current, volChart.current, rsiChart.current, macdChart.current, balChart.current].forEach((c) => c?.applyOptions(opts));
    const prec = precisionForInterval(interval);
    const mm = minMoveFromPrecision(prec);
    priceSeries.current?.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: mm } });
  }, [interval]);

  // seed
  useEffect(() => {
    (async () => {
      const c = await fetchHistory({ symbol, interval, limit: 1800 });
      setCandles(c);
    })();
  }, [symbol, interval]);

  // WS
  useEffect(() => {
    const ws = new WebSocket(wsURL({ symbol, interval }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'kline') {
        const k: Candle = msg.payload;
        const t = Number(k.time);
        if (!Number.isFinite(t) || t <= 0) return;
        setCandles((prev) => {
          if (prev.length === 0) return [k];
          const lastT = Number(prev[prev.length - 1].time);
          if (t > lastT) return [...prev, k];
          if (t === lastT) return [...prev.slice(0, -1), k];
          return prev;
        });
      }
    };
    return () => ws.close();
  }, [symbol, interval]);

  /* -------- índice por tiempo para lookup O(1) -------- */
  const timeIndex = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < candles.length; i++) m.set(Number(candles[i].time), i);
    return m;
  }, [candles]);

  /* -------- cálculo (con PREFS) -------- */
  const calc = useMemo(() => {
    if (candles.length === 0) {
      return {
        ema: [] as number[],
        nweUp: [] as number[], nweDn: [] as number[],
        brkUp: [] as number[], brkDn: [] as number[],
        mb: { avg: [] as number[], oscBias: [] as number[], oscSmooth: [] as number[] },
        efmus: { emaF: [] as number[], emaS: [] as number[], longIdx: [] as number[], shortIdx: [] as number[] },
        rsi: [] as number[],
        macd: { macd: [] as number[], signal: [] as number[], hist: [] as number[] },
        balance: [] as number[],
      };
    }
    const ema = prefs.ema.enabled ? EMA(candles, prefs.ema.length) : [];
    const { calcUp: nweUp, calcDn: nweDn } =
      prefs.nwe.enabled ? NWE_Dynamic(candles, prefs.nwe.h, prefs.nwe.mult) : { calcUp: [], calcDn: [] };
    const { upperBreak: brkUp, lowerBreak: brkDn } =
      prefs.breakout.enabled ? BreakoutLevelsStrict(candles, prefs.breakout.rangeLen, prefs.breakout.atrLen, prefs.breakout.bufATR)
                             : { upperBreak: [], lowerBreak: [] };
    const mbFull = HeikinAshiMarketBiasFull(candles, prefs.mbias.len, prefs.mbias.smooth, prefs.mbias.oscLen);
    const efmus = prefs.efmus.enabled ? EfmusSignals(candles, prefs.efmus.fast, prefs.efmus.slow)
                                      : { emaF: [], emaS: [], longIdx: [], shortIdx: [] };
    const rsi = prefs.rsi.enabled ? RSI(candles, prefs.rsi.length) : [];
    const macd = prefs.macd.enabled ? MACD(candles, prefs.macd.fast, prefs.macd.slow, prefs.macd.signal)
                                    : { macd: [], signal: [], hist: [] };
    const { balance } = prefs.balance.enabled
      ? BalanceNumber(candles, {
          h: 8, mult: 3, rangeLen: 16, atrLen: 14, bufATR: 0.2,
          proxWidth: prefs.balance.proxWidth, wUpProx: 0.60, wDnOut: 0.40, wDnProx: 0.60, wUpOut: 0.40,
          histScale: prefs.balance.scale,
        })
      : { balance: [] as number[] };
    return { ema, nweUp, nweDn, brkUp, brkDn, mb: mbFull, efmus, rsi, macd, balance };
  }, [candles, prefs]);

  /* -------- pintado -------- */
  useEffect(() => {
    if (!priceSeries.current) return;

    // precio/volumen
    priceSeries.current.setData(candles.map(toCandle));
    volSeries.current?.setData(candles.map(toVolume));

    // anchors: obligan a todos los panes a tener EXACTAMENTE los mismos "time"
    const anchorRows: HistogramData[] = candles.map((c) => ({ time: toTs(c.time), value: 0, color: 'rgba(0,0,0,0)' }));
    rsiAnchor.current?.setData(anchorRows);
    macdAnchor.current?.setData(anchorRows);
    balAnchor.current?.setData(anchorRows);

    // padding + sincroniza logical range a todos los panes
    ensurePadding(candles.length);

    // ==== Market Bias (bicolor; por defecto activo) ====
    if (prefs.mbias.enabled) {
      const bull: number[] = new Array(candles.length).fill(NaN);
      const bear: number[] = new Array(candles.length).fill(NaN);
      for (let i = 0; i < candles.length; i++) {
        const ob = calc.mb.oscBias[i], os = calc.mb.oscSmooth[i], avg = calc.mb.avg[i];
        if (!Number.isFinite(avg)) continue;
        if (Number.isFinite(ob) && Number.isFinite(os)) {
          const strongBull = (ob as number) > 0 && (ob as number) >= (os as number);
          const strongBear = (ob as number) < 0 && (ob as number) <= (os as number);
          if (strongBull) bull[i] = avg as number;
          else if (strongBear) bear[i] = avg as number;
          else { if ((ob as number) > 0) bull[i] = avg as number; else if ((ob as number) < 0) bear[i] = avg as number; }
        }
      }
      const mbBull = getOverlay('mbBull'); const mbBear = getOverlay('mbBear');
      mbBull?.applyOptions({ color: prefs.mbias.colorBull, lineWidth: toLW(prefs.mbias.width) });
      mbBear?.applyOptions({ color: prefs.mbias.colorBear, lineWidth: toLW(prefs.mbias.width) });
      mbBull?.setData(mapLine(candles, bull));
      mbBear?.setData(mapLine(candles, bear));
    } else {
      getOverlay('mbBull')?.setData([]); getOverlay('mbBear')?.setData([]);
    }

    // EMA
    if (prefs.ema.enabled) {
      const ema = getOverlay('ema');
      ema?.applyOptions({ color: prefs.ema.color, lineWidth: toLW(2) });
      ema?.setData(mapLine(candles, calc.ema));
    } else getOverlay('ema')?.setData([]);

    // NWE
    if (prefs.nwe.enabled) {
      const up = getOverlay('nweUp'); const dn = getOverlay('nweDn');
      up?.applyOptions({ color: prefs.nwe.upColor, lineWidth: toLW(2) });
      dn?.applyOptions({ color: prefs.nwe.dnColor, lineWidth: toLW(2) });
      up?.setData(mapLine(candles, calc.nweUp));
      dn?.setData(mapLine(candles, calc.nweDn));
    } else { getOverlay('nweUp')?.setData([]); getOverlay('nweDn')?.setData([]); }

    // Breakouts
    if (prefs.breakout.enabled) {
      const up = getOverlay('brkUp'); const dn = getOverlay('brkDn');
      up?.applyOptions({ color: prefs.breakout.upColor, lineStyle: LineStyle.Dashed, lineWidth: toLW(1) });
      dn?.applyOptions({ color: prefs.breakout.dnColor, lineStyle: LineStyle.Dashed, lineWidth: toLW(1) });
      up?.setData(mapLine(candles, calc.brkUp));
      dn?.setData(mapLine(candles, calc.brkDn));
    } else { getOverlay('brkUp')?.setData([]); getOverlay('brkDn')?.setData([]); }

    // Efmus + Rebotes
    if (prefs.efmus.enabled) {
      const e1 = getOverlay('efEmaFast'); const e2 = getOverlay('efEmaSlow');
      e1?.applyOptions({ color: prefs.efmus.emaFastColor, lineWidth: toLW(2) });
      e2?.applyOptions({ color: prefs.efmus.emaSlowColor, lineWidth: toLW(2) });
      e1?.setData(mapLine(candles, calc.efmus.emaF));
      e2?.setData(mapLine(candles, calc.efmus.emaS));
    } else { getOverlay('efEmaFast')?.setData([]); getOverlay('efEmaSlow')?.setData([]); }

    const markers: { time: UTCTimestamp; position: 'aboveBar'|'belowBar'; color: string; shape: any; text?: string }[] = [];
    calc.efmus.longIdx.forEach((i) => markers.push({ time: toTs(candles[i].time), position: 'belowBar', color: prefs.efmus.upColor, shape: 'arrowUp', text: '▲' }));
    calc.efmus.shortIdx.forEach((i) => markers.push({ time: toTs(candles[i].time), position: 'aboveBar', color: prefs.efmus.dnColor, shape: 'arrowDown', text: '▼' }));

    const efFlags = { longIdx: new Set(calc.efmus.longIdx), shortIdx: new Set(calc.efmus.shortIdx) };
    const rb = ReboundsPineLike(candles, calc.mb.avg, efFlags, {
      rb_wick_min: 0.35, rb_wick_ref: 'range', rb_body_max: 0.55,
      rb_eps_atr: 0.03, rb_bias_eps_atr: 0.02, rb_touch_atr: 0.02,
      allow_big_body: true, imp_body_ratio: 0.60, imp_atr_ratio: 0.35,
    });
    rb.long.forEach((i) => markers.push({ time: toTs(candles[i].time), position: 'belowBar', color: '#2dd4bf', shape: 'circle', text: 'R↑' }));
    rb.short.forEach((i) => markers.push({ time: toTs(candles[i].time), position: 'aboveBar', color: '#ef4444', shape: 'circle', text: 'R↓' }));

    const rbL = ReboundsLatePineLike(candles, rb.lastMarkBodyLow, rb.lastMarkBodyHigh, rb.lastMarkIndex, rb.lastSignal, calc.mb.avg, {
      minBars: 12, topFracLong: 0.25, botFracShort: 0.25,
      disp_atr: 0.02, disp_ticks: 1, wick_min: 0.35, wick_ref: 'range',
      body_max: 0.55, allow_big_body: true, imp_body_ratio: 0.60, imp_atr_ratio: 0.35, touch_atr: 0.02,
      bias_eps_atr: 0.02,
    });
    rbL.long.forEach((i) => markers.push({ time: toTs(candles[i].time), position: 'belowBar', color: '#14b8a6', shape: 'diamond', text: 'R↑L' }));
    rbL.short.forEach((i) => markers.push({ time: toTs(candles[i].time), position: 'aboveBar', color: '#f87171', shape: 'diamond', text: 'R↓L' }));
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    priceSeries.current?.setMarkers(markers);

    // Panes
    togglePaneDisplay(volEl.current, true);
    togglePaneDisplay(rsiEl.current, prefs.rsi.enabled);
    togglePaneDisplay(macdEl.current, prefs.macd.enabled);
    togglePaneDisplay(balEl.current, prefs.balance.enabled);

    if (prefs.rsi.enabled) {
      rsiSeries.current?.applyOptions({ color: prefs.rsi.color, lineWidth: toLW(2) });
      rsiSeries.current?.setData(mapLine(candles, calc.rsi));
    } else rsiSeries.current?.setData([]);

    if (prefs.macd.enabled) {
      macdLineSeries.current?.applyOptions({ color: prefs.macd.lineColor, lineWidth: toLW(2) });
      macdSignalSeries.current?.applyOptions({ color: prefs.macd.signalColor, lineWidth: toLW(2) });
      macdHistSeries.current?.applyOptions({ base: 0 as any });
      macdLineSeries.current?.setData(mapLine(candles, calc.macd.macd));
      macdSignalSeries.current?.setData(mapLine(candles, calc.macd.signal));
      macdHistSeries.current?.setData(mapHistFill(candles, calc.macd.hist, prefs.macd.posColor, prefs.macd.negColor, true));
    } else { macdLineSeries.current?.setData([]); macdSignalSeries.current?.setData([]); macdHistSeries.current?.setData([]); }

    if (prefs.balance.enabled) {
      balHistSeries.current?.setData(mapHistFill(candles, calc.balance, prefs.balance.posColor, prefs.balance.negColor, true));
    } else balHistSeries.current?.setData([]);

  }, [candles, prefs, interval, calc, ensurePadding, getOverlay, priceSeries.current]);

  /* -------- sync de CROSSHAIR entre panes -------- */
  useEffect(() => {
    const charts: Array<{ chart: IChartApi | null; pickValue: (idx: number) => number; series: () => ISeriesApi<any> | null }> = [
      { chart: priceChart.current, pickValue: (i) => candles[i]?.close ?? 0, series: () => priceSeries.current },
      { chart: rsiChart.current,   pickValue: (i) => Number.isFinite(calc.rsi[i]) ? (calc.rsi[i] as number) : 50, series: () => (rsiSeries.current ?? rsiAnchor.current) },
      { chart: macdChart.current,  pickValue: (i) => Number.isFinite(calc.macd.macd[i]) ? (calc.macd.macd[i] as number) : 0, series: () => (macdLineSeries.current ?? macdAnchor.current) },
      { chart: balChart.current,   pickValue: (i) => Number.isFinite(calc.balance[i]) ? (calc.balance[i] as number) : 0, series: () => (balHistSeries.current ?? balAnchor.current) },
      { chart: volChart.current,   pickValue: (i) => candles[i]?.volume ?? 0, series: () => volSeries.current },
    ];
    const allCharts = charts.map((x) => x.chart).filter(Boolean) as IChartApi[];

    // helper
    const syncToTime = (src: IChartApi, timeNum: number | undefined) => {
      if (!timeNum || !Number.isFinite(timeNum)) { allCharts.forEach((c) => c.clearCrosshairPosition()); return; }
      const idx = timeIndex.get(timeNum);
      if (idx == null) { allCharts.forEach((c) => c.clearCrosshairPosition()); return; }
      const t = toTs(timeNum);
      charts.forEach(({ chart, pickValue, series }) => {
        if (!chart) return;
        const s = series();
        if (!s) return;
        const val = pickValue(idx);
        chart.setCrosshairPosition(val, t, s);
      });
    };

    // suscripciones
    const unsubs: Array<() => void> = [];
    const attach = (c: IChartApi | null) => {
      if (!c) return;
      const handler = (p: any) => {
        if (!p || p.time == null) { allCharts.forEach((x) => x.clearCrosshairPosition()); return; }
        // param.time será UTCTimestamp (número) porque nuestros datos son numéricos
        const tnum = Number(p.time);
        syncToTime(c, tnum);
      };
      c.subscribeCrosshairMove(handler);
      unsubs.push(() => c.unsubscribeCrosshairMove(handler));
    };
    [priceChart.current, rsiChart.current, macdChart.current, balChart.current, volChart.current].forEach(attach);

    return () => { unsubs.forEach((u) => { try { u(); } catch {} }); };
  }, [priceChart.current, rsiChart.current, macdChart.current, balChart.current, volChart.current, timeIndex, candles, calc, priceSeries.current, rsiSeries.current, macdLineSeries.current, balHistSeries.current, volSeries.current]);

  /* -------- fetch -------- */
  async function fetchHistory(params: { symbol: string; interval: string; limit: number; endTimeSec?: number }): Promise<Candle[]> {
    const { symbol, interval, limit, endTimeSec } = params;
    const endParam = endTimeSec ? `&endTime=${Math.max(0, endTimeSec * 1000)}` : '';
    try {
      const r = await fetch(httpURL(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${endParam}`));
      if (!r.ok) throw new Error('fetch klines failed');
      const j = await r.json();
      return (j.candles ?? []) as Candle[];
    } catch { return []; }
  }

  /* -------- UI -------- */
  const onToggle = (key: keyof IndicatorPrefs) => setPrefs((prev) => ({ ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled } as any }));

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 className="title" style={{ margin: 0 }}>{symbol} — {interval}</h2>
        <button
          onClick={() => setPanelOpen((o) => !o)}
          style={{
            padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)',
            background: panelOpen ? 'rgba(255,255,255,0.08)' : 'transparent', cursor: 'pointer'
          }}
        >
          ✦ Indicadores
        </button>
      </div>

      {panelOpen && (
        <IndicatorsPanel prefs={prefs} setPrefs={setPrefs} onToggle={onToggle} />
      )}

      {/* panes */}
      <div>
        <div ref={priceEl} />
        <div ref={volEl} style={{ marginTop: 8 }} />
        <div ref={rsiEl} style={{ marginTop: 8 }} />
        <div ref={macdEl} style={{ marginTop: 8 }} />
        <div ref={balEl} style={{ marginTop: 8 }} />
      </div>
    </div>
  );
}

/* ---------------- Panel de Indicadores ---------------- */
type PanelProps = {
  prefs: IndicatorPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<IndicatorPrefs>>;
  onToggle: (key: keyof IndicatorPrefs) => void;
};

const Section: React.FC<{ title: string; checked: boolean; onToggle: () => void; children: React.ReactNode }> =
({ title, checked, onToggle, children }) => (
  <fieldset style={{
    border: '1px solid rgba(255,255,255,0.12)', padding: 12, borderRadius: 12,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))'
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <legend style={{ fontWeight: 700 }}>{title}</legend>
      <Switch checked={checked} onChange={onToggle} />
    </div>
    {/* Cada configurador en SU FILA */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
      {children}
    </div>
  </fieldset>
);

const Labeled: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'grid', gridTemplateRows: 'auto auto', gap: 6 }}>
    <span style={{ fontSize: 12, opacity: 0.9 }}>{label}</span>
    {children}
  </label>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props}
    style={{
      height: 36, padding: '0 10px', borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.03)', color: 'inherit'
    }}
  />
);

const Switch: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
  <span onClick={onChange} style={{
    width: 54, height: 28, borderRadius: 999, display: 'inline-flex', alignItems: 'center',
    padding: 3, cursor: 'pointer',
    background: checked ? '#22c55e' : 'rgba(255,255,255,0.14)', transition: 'background 160ms'
  }}>
    <span style={{
      width: 22, height: 22, borderRadius: '50%', background: '#111827',
      transform: `translateX(${checked ? 26 : 0}px)`, transition: 'transform 160ms'
    }}/>
  </span>
);

const IndicatorsPanel = memo(function IndicatorsPanel({ prefs, setPrefs, onToggle }: PanelProps) {
  return (
    <div style={{
      marginBottom: 12, padding: 12, borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.14)',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))',
      display: 'grid', gap: 12, gridTemplateColumns: '1fr' // <<< una sola columna (cada bloque ocupa una fila)
    }}>
      <Section title="EMA" checked={prefs.ema.enabled} onToggle={() => onToggle('ema')}>
        <Labeled label="Longitud">
          <Input type="number" min={1} value={prefs.ema.length}
                 onChange={(e) => setPrefs((p) => ({ ...p, ema: { ...p.ema, length: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Color">
          <Input type="color" value={prefs.ema.color}
                 onChange={(e) => setPrefs((p) => ({ ...p, ema: { ...p.ema, color: e.target.value } }))} />
        </Labeled>
      </Section>

      <Section title="NWE Envelope" checked={prefs.nwe.enabled} onToggle={() => onToggle('nwe')}>
        <Labeled label="h">
          <Input type="number" step={0.5} value={prefs.nwe.h}
                 onChange={(e) => setPrefs((p) => ({ ...p, nwe: { ...p.nwe, h: Number(e.target.value) || 0 } }))} />
        </Labeled>
        <Labeled label="mult">
          <Input type="number" step={0.1} value={prefs.nwe.mult}
                 onChange={(e) => setPrefs((p) => ({ ...p, nwe: { ...p.nwe, mult: Number(e.target.value) || 0 } }))} />
        </Labeled>
        <Labeled label="Color UP">
          <Input type="color" value={prefs.nwe.upColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, nwe: { ...p.nwe, upColor: e.target.value } }))} />
        </Labeled>
        <Labeled label="Color DN">
          <Input type="color" value={prefs.nwe.dnColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, nwe: { ...p.nwe, dnColor: e.target.value } }))} />
        </Labeled>
      </Section>

      <Section title="Breakout HH/LL + ATR" checked={prefs.breakout.enabled} onToggle={() => onToggle('breakout')}>
        <Labeled label="Rango">
          <Input type="number" min={5} value={prefs.breakout.rangeLen}
                 onChange={(e) => setPrefs((p) => ({ ...p, breakout: { ...p.breakout, rangeLen: Number(e.target.value) || 5 } }))} />
        </Labeled>
        <Labeled label="ATR len">
          <Input type="number" min={5} value={prefs.breakout.atrLen}
                 onChange={(e) => setPrefs((p) => ({ ...p, breakout: { ...p.breakout, atrLen: Number(e.target.value) || 5 } }))} />
        </Labeled>
        <Labeled label="Buffer ATR">
          <Input type="number" step={0.01} value={prefs.breakout.bufATR}
                 onChange={(e) => setPrefs((p) => ({ ...p, breakout: { ...p.breakout, bufATR: Number(e.target.value) || 0 } }))} />
        </Labeled>
        <Labeled label="Color UP">
          <Input type="color" value={prefs.breakout.upColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, breakout: { ...p.breakout, upColor: e.target.value } }))} />
        </Labeled>
        <Labeled label="Color DN">
          <Input type="color" value={prefs.breakout.dnColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, breakout: { ...p.breakout, dnColor: e.target.value } }))} />
        </Labeled>
      </Section>

      <Section title="Efmus EMA Cross" checked={prefs.efmus.enabled} onToggle={() => onToggle('efmus')}>
        <Labeled label="Fast">
          <Input type="number" value={prefs.efmus.fast}
                 onChange={(e) => setPrefs((p) => ({ ...p, efmus: { ...p.efmus, fast: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Slow">
          <Input type="number" value={prefs.efmus.slow}
                 onChange={(e) => setPrefs((p) => ({ ...p, efmus: { ...p.efmus, slow: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Color EMA fast">
          <Input type="color" value={prefs.efmus.emaFastColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, efmus: { ...p.efmus, emaFastColor: e.target.value } }))} />
        </Labeled>
        <Labeled label="Color EMA slow">
          <Input type="color" value={prefs.efmus.emaSlowColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, efmus: { ...p.efmus, emaSlowColor: e.target.value } }))} />
        </Labeled>
      </Section>

      <Section title="RSI" checked={prefs.rsi.enabled} onToggle={() => onToggle('rsi')}>
        <Labeled label="Longitud">
          <Input type="number" min={1} value={prefs.rsi.length}
                 onChange={(e) => setPrefs((p) => ({ ...p, rsi: { ...p.rsi, length: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Color">
          <Input type="color" value={prefs.rsi.color}
                 onChange={(e) => setPrefs((p) => ({ ...p, rsi: { ...p.rsi, color: e.target.value } }))} />
        </Labeled>
      </Section>

      <Section title="MACD" checked={prefs.macd.enabled} onToggle={() => onToggle('macd')}>
        <Labeled label="Fast">
          <Input type="number" value={prefs.macd.fast}
                 onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, fast: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Slow">
          <Input type="number" value={prefs.macd.slow}
                 onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, slow: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Signal">
          <Input type="number" value={prefs.macd.signal}
                 onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, signal: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Color línea">
          <Input type="color" value={prefs.macd.lineColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, lineColor: e.target.value } }))} />
        </Labeled>
        <Labeled label="Color signal">
          <Input type="color" value={prefs.macd.signalColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, signalColor: e.target.value } }))} />
        </Labeled>
        <Labeled label="Color +">
          <Input type="color" value={prefs.macd.posColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, posColor: e.target.value } }))} />
        </Labeled>
        <Labeled label="Color -">
          <Input type="color" value={prefs.macd.negColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, negColor: e.target.value } }))} />
        </Labeled>
      </Section>

      <Section title="Balance (NWE + Breakout)" checked={prefs.balance.enabled} onToggle={() => onToggle('balance')}>
        <Labeled label="Escala">
          <Input type="number" value={prefs.balance.scale}
                 onChange={(e) => setPrefs((p) => ({ ...p, balance: { ...p.balance, scale: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Prox width">
          <Input type="number" step={0.05} value={prefs.balance.proxWidth}
                 onChange={(e) => setPrefs((p) => ({ ...p, balance: { ...p.balance, proxWidth: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Color +">
          <Input type="color" value={prefs.balance.posColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, balance: { ...p.balance, posColor: e.target.value } }))} />
        </Labeled>
        <Labeled label="Color -">
          <Input type="color" value={prefs.balance.negColor}
                 onChange={(e) => setPrefs((p) => ({ ...p, balance: { ...p.balance, negColor: e.target.value } }))} />
        </Labeled>
      </Section>

      <Section title="Market Bias (Heikin Ashi)" checked={prefs.mbias.enabled} onToggle={() => onToggle('mbias')}>
        <Labeled label="Len">
          <Input type="number" value={prefs.mbias.len}
                 onChange={(e) => setPrefs((p) => ({ ...p, mbias: { ...p.mbias, len: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Smooth">
          <Input type="number" value={prefs.mbias.smooth}
                 onChange={(e) => setPrefs((p) => ({ ...p, mbias: { ...p.mbias, smooth: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="OscLen">
          <Input type="number" value={prefs.mbias.oscLen}
                 onChange={(e) => setPrefs((p) => ({ ...p, mbias: { ...p.mbias, oscLen: Number(e.target.value) || 1 } }))} />
        </Labeled>
        <Labeled label="Color Bull">
          <Input type="color" value={prefs.mbias.colorBull}
                 onChange={(e) => setPrefs((p) => ({ ...p, mbias: { ...p.mbias, colorBull: e.target.value } }))} />
        </Labeled>
        <Labeled label="Color Bear">
          <Input type="color" value={prefs.mbias.colorBear}
                 onChange={(e) => setPrefs((p) => ({ ...p, mbias: { ...p.mbias, colorBear: e.target.value } }))} />
        </Labeled>
        <Labeled label="Grosor línea">
          <Input type="number" value={prefs.mbias.width}
                 onChange={(e) => setPrefs((p) => ({ ...p, mbias: { ...p.mbias, width: Number(e.target.value) || 2 } }))} />
        </Labeled>
      </Section>
    </div>
  );
});

/* ---------------- util ---------------- */
function togglePaneDisplay(el: HTMLDivElement | null, show: boolean) {
  if (!el) return; el.style.display = show ? '' : 'none';
}
