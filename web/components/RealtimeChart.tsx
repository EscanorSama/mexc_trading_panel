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
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { Candle as CandleT } from '../lib/types';
import { EMA, RSI, MACD } from '../lib/indicators';
import { wsURL, httpURL } from '../lib/ws';

type Candle = CandleT;

type Props = { symbol?: string; interval?: string };

// ---------- helpers tiempo ----------
function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function toTsSeconds(t: unknown): number {
  if (typeof t === 'number') return t;
  if (t && typeof t === 'object') {
    const anyT = t as { year?: number; month?: number; day?: number };
    if (anyT.year && anyT.month && anyT.day) {
      return Math.floor(Date.UTC(anyT.year, (anyT.month as number) - 1, anyT.day) / 1000);
    }
  }
  return 0;
}
function fmtByInterval(tsSec: number, interval: string) {
  const d = new Date(tsSec * 1000);
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  const D = d.getUTCDate();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (interval.startsWith('Min')) return `${pad(h)}:${pad(m)}`;
  if (interval === 'Min60' || interval.startsWith('Hour')) return `${pad(D)}/${pad(M)} ${pad(h)}:${pad(m)}`;
  if (interval === 'Day1' || interval === 'Week1') return `${pad(D)}/${pad(M)}`;
  if (interval === 'Month1') return `${pad(M)}/${Y}`;
  return `${pad(D)}/${pad(M)} ${pad(h)}:${pad(m)}`;
}

// ---------- precisión dinámica por timeframe ----------
function precisionForInterval(interval: string): number {
  if (interval.startsWith('Min') || interval === 'Min60' || interval.startsWith('Hour')) return 8; // intradía → más decimales
  if (interval === 'Day1' || interval === 'Week1') return 6;
  return 6; // mensual u otros
}
function minMoveFromPrecision(p: number) {
  return Number((1 / Math.pow(10, p)).toFixed(p));
}

// ---------- preferencias (persisten por símbolo+intervalo) ----------
type IndicatorPrefs = {
  ema: { enabled: boolean; length: number };
  rsi: { enabled: boolean; length: number };
  macd: { enabled: boolean; fast: number; slow: number; signal: number };
};
const DEFAULT_PREFS: IndicatorPrefs = {
  ema: { enabled: true, length: 20 },
  rsi: { enabled: false, length: 14 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
};
const prefsKey = (sym: string, intv: string) => `chart_prefs:${sym}:${intv}`;

export default function RealtimeChart({ symbol = 'DOGE_USDT', interval = 'Min1' }: Props) {
  // contenedor general (para overlays)
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // contenedores de cada chart
  const priceEl = useRef<HTMLDivElement | null>(null);
  const volEl = useRef<HTMLDivElement | null>(null);
  const rsiEl = useRef<HTMLDivElement | null>(null);
  const macdEl = useRef<HTMLDivElement | null>(null);

  // Charts independientes
  const priceChart = useRef<IChartApi | null>(null);
  const volChart = useRef<IChartApi | null>(null);
  const rsiChart = useRef<IChartApi | null>(null);
  const macdChart = useRef<IChartApi | null>(null);

  // Series
  const priceSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const volSeries = useRef<ISeriesApi<'Histogram'> | null>(null);

  const rsiSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const macdLineSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistSeries = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Datos
  const [candles, setCandles] = useState<Candle[]>([]);

  // Indicadores (prefs)
  const [prefs, setPrefs] = useState<IndicatorPrefs>(DEFAULT_PREFS);

  // Histórico infinito y avisos
  const isLoadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const [notice, setNotice] = useState<string | null>(null);

  function showNotice(msg: string, ms = 2500) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), ms);
  }

  // --------- persistencia de prefs ---------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(prefsKey(symbol, interval));
      setPrefs(raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS);
    } catch {
      setPrefs(DEFAULT_PREFS);
    }
  }, [symbol, interval]);

  useEffect(() => {
    try {
      localStorage.setItem(prefsKey(symbol, interval), JSON.stringify(prefs));
    } catch {}
  }, [symbol, interval, prefs]);

  // --------- init charts (4) ----------
  useEffect(() => {
    if (!priceEl.current || !volEl.current || !rsiEl.current || !macdEl.current) return;

    const common = {
      layout: { textColor: '#b7bcc5', background: { type: ColorType.Solid, color: 'transparent' as const } },
      grid: {
        horzLines: { visible: true, color: 'rgba(255,255,255,0.12)' },
        vertLines: { visible: true, color: 'rgba(255,255,255,0.12)' },
      },
      timeScale: {
        rightOffset: 6,
        borderVisible: true,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
      localization: {
        timeFormatter: (t: unknown) => fmtByInterval(toTsSeconds(t), interval),
      },
    } as const;

    // Precio
    priceChart.current = createChart(priceEl.current, {
      ...common,
      height: 340,
      rightPriceScale: { borderVisible: true },
      leftPriceScale: { borderVisible: false },
    });

    // precisiones dinámicas
    const p = precisionForInterval(interval);

    priceSeries.current = priceChart.current.addCandlestickSeries({
      priceFormat: { type: 'price', precision: p, minMove: minMoveFromPrecision(p) },
    });
    emaSeries.current = priceChart.current.addLineSeries({}); // overlay en PRECIO

    // Volumen
    volChart.current = createChart(volEl.current, {
      ...common,
      height: 120,
      rightPriceScale: { borderVisible: true },
      leftPriceScale: { borderVisible: false },
    });
    volSeries.current = volChart.current.addHistogramSeries({ priceFormat: { type: 'volume' } });

    // RSI (su propio chart)
    rsiChart.current = createChart(rsiEl.current, {
      ...common,
      height: 140,
      rightPriceScale: { borderVisible: true },
      leftPriceScale: { borderVisible: false },
    });

    // MACD (su propio chart)
    macdChart.current = createChart(macdEl.current, {
      ...common,
      height: 140,
      rightPriceScale: { borderVisible: true },
      leftPriceScale: { borderVisible: false },
    });

    // ----- sincronización de timeScale entre charts -----
    const charts = [priceChart.current, volChart.current, rsiChart.current, macdChart.current];
    let syncing = false;
    const cbs: Array<(r: any) => void> = [];

    charts.forEach((src, idx) => {
      const cb = (range: any) => {
        if (!range || syncing) return;
        syncing = true;
        charts.forEach((dst, j) => {
          if (j === idx) return;
          try {
            dst.timeScale().setVisibleLogicalRange(range);
          } catch {}
        });
        syncing = false;
      };
      src.timeScale().subscribeVisibleLogicalRangeChange(cb as any);
      cbs.push(cb);
    });

    // Resize por layout/cambios externos
    const applyWidths = () => {
      const width = priceEl.current?.clientWidth ?? 0;
      if (width > 0) {
        priceChart.current?.applyOptions({ width });
        volChart.current?.applyOptions({ width });
        rsiChart.current?.applyOptions({ width });
        macdChart.current?.applyOptions({ width });
      }
    };
    applyWidths();

    const onWindowResize = () => applyWidths();
    window.addEventListener('resize', onWindowResize);

    const ros = [priceEl, volEl, rsiEl, macdEl].map((ref) => {
      const ro = new ResizeObserver(() => applyWidths());
      if (ref.current) ro.observe(ref.current);
      return ro;
    });

    const onRefresh = () => {
      applyWidths();
      charts.forEach((c) => c.timeScale().fitContent());
    };
    window.addEventListener('charts:refresh', onRefresh as EventListener);

    // Carga infinita: nos enganchamos al chart de PRECIO
    const onLogical = async () => {
      if (!priceSeries.current || !hasMoreRef.current || isLoadingMoreRef.current) return;
      const range = priceChart.current?.timeScale().getVisibleLogicalRange();
      if (!range || (range as any).from === undefined) return;
      if ((range as any).from < 5) await loadMoreHistory();
    };
    priceChart.current.timeScale().subscribeVisibleLogicalRangeChange(onLogical);

    return () => {
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('charts:refresh', onRefresh as EventListener);
      try {
        priceChart.current?.timeScale().unsubscribeVisibleLogicalRangeChange(onLogical);
      } catch {}
      ros.forEach((ro) => ro.disconnect());
      // desuscribir sincronización
      charts.forEach((c, i) => {
        try {
          c.timeScale().unsubscribeVisibleLogicalRangeChange(cbs[i] as any);
        } catch {}
      });
      // quitar charts
      macdChart.current?.remove();
      rsiChart.current?.remove();
      volChart.current?.remove();
      priceChart.current?.remove();

      priceChart.current = null;
      volChart.current = null;
      rsiChart.current = null;
      macdChart.current = null;

      priceSeries.current = null;
      emaSeries.current = null;
      volSeries.current = null;
      rsiSeries.current = null;
      macdLineSeries.current = null;
      macdSignalSeries.current = null;
      macdHistSeries.current = null;

      isLoadingMoreRef.current = false;
      hasMoreRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // una sola vez

  // actualizar formateo de tiempo + precisión al cambiar intervalo
  useEffect(() => {
    const opts = { localization: { timeFormatter: (t: unknown) => fmtByInterval(toTsSeconds(t), interval) } };
    priceChart.current?.applyOptions(opts);
    volChart.current?.applyOptions(opts);
    rsiChart.current?.applyOptions(opts);
    macdChart.current?.applyOptions(opts);

    const prec = precisionForInterval(interval);
    const mm = minMoveFromPrecision(prec);
    priceSeries.current?.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: mm } });

    // para MACD usamos algo alto también
    const macdPrec = Math.max(4, prec - 2);
    macdLineSeries.current?.applyOptions({ priceFormat: { type: 'price', precision: macdPrec, minMove: minMoveFromPrecision(macdPrec) } });
    macdSignalSeries.current?.applyOptions({ priceFormat: { type: 'price', precision: macdPrec, minMove: minMoveFromPrecision(macdPrec) } });
    macdHistSeries.current?.applyOptions({ priceFormat: { type: 'price', precision: macdPrec, minMove: minMoveFromPrecision(macdPrec) } });
  }, [interval]);

  // --------- seed histórico (y cambio de símbolo/intervalo) ----------
  useEffect(() => {
    (async () => {
      isLoadingMoreRef.current = false;
      hasMoreRef.current = true;

      const c = await fetchHistory({ symbol, interval, limit: 600 });
      setCandles(c);

      // set data en cada chart
      priceSeries.current?.setData(c.map(toCandle));
      emaSeries.current?.setData([]); // se rellena en recomputeIndicators
      volSeries.current?.setData(c.map(toVolume));

      // ajustar vista
      priceChart.current?.timeScale().fitContent();
      volChart.current?.timeScale().fitContent();
      rsiChart.current?.timeScale().fitContent();
      macdChart.current?.timeScale().fitContent();
    })();
  }, [symbol, interval]);

  // --------- WebSocket live ----------
  useEffect(() => {
    const ws = new WebSocket(wsURL({ symbol, interval }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'kline') {
        const k: Candle = msg.payload;
        const t = Number((k as any).time);
        if (!Number.isFinite(t)) return;

        setCandles((prev) => {
          const last = prev[prev.length - 1];
          if (!last) {
            // serie vacía: setData (evita "Cannot update oldest data")
            const arr = [k];
            priceSeries.current?.setData(arr.map(toCandle));
            volSeries.current?.setData(arr.map(toVolume));
            return arr;
          }

          const lastT = Number(last.time);
          if (t > lastT) {
            // nueva vela → push + update
            const arr = [...prev, k];
            priceSeries.current?.update(toCandle(k));
            volSeries.current?.update(toVolume(k));
            return arr;
          } else if (t === lastT) {
            // vela en curso → replace última + update
            const arr = [...prev.slice(0, -1), k];
            priceSeries.current?.update(toCandle(k));
            volSeries.current?.update(toVolume(k));
            return arr;
          } else {
            // más antigua → ignorar
            return prev;
          }
        });
      }
    };
    return () => ws.close();
  }, [symbol, interval]);

  // --------- recomputar indicadores al cambiar datos o prefs ----------
  useEffect(() => {
    if (!priceChart.current || candles.length === 0) return;

    // EMA en chart de PRECIO
    if (prefs.ema.enabled) {
      const values = EMA(candles, prefs.ema.length);
      emaSeries.current?.setData(mapLine(candles, values));
    } else {
      emaSeries.current?.setData([]);
    }

    // RSI (línea) en su chart
    if (prefs.rsi.enabled) {
      if (!rsiSeries.current && rsiChart.current) {
        rsiSeries.current = rsiChart.current.addLineSeries({
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });
      }
      const r = RSI(candles, prefs.rsi.length);
      rsiSeries.current?.setData(mapLine(candles, r));
    } else if (rsiSeries.current && rsiChart.current) {
      rsiChart.current.removeSeries(rsiSeries.current);
      rsiSeries.current = null;
    }

    // MACD (line, signal, hist) en su chart
    if (prefs.macd.enabled) {
      const prec = precisionForInterval(interval);
      const macdPrec = Math.max(4, prec - 2);

      if (!macdLineSeries.current && macdChart.current) {
        macdLineSeries.current = macdChart.current.addLineSeries({
          priceFormat: { type: 'price', precision: macdPrec, minMove: minMoveFromPrecision(macdPrec) },
        });
      }
      if (!macdSignalSeries.current && macdChart.current) {
        macdSignalSeries.current = macdChart.current.addLineSeries({
          priceFormat: { type: 'price', precision: macdPrec, minMove: minMoveFromPrecision(macdPrec) },
        });
      }
      if (!macdHistSeries.current && macdChart.current) {
        macdHistSeries.current = macdChart.current.addHistogramSeries({
          priceFormat: { type: 'price', precision: macdPrec, minMove: minMoveFromPrecision(macdPrec) },
        });
      }
      const { macd, signal, hist } = MACD(candles, prefs.macd.fast, prefs.macd.slow, prefs.macd.signal);
      macdLineSeries.current?.setData(mapLine(candles, macd));
      macdSignalSeries.current?.setData(mapLine(candles, signal));
      macdHistSeries.current?.setData(mapHist(candles, hist));
    } else {
      if (macdLineSeries.current && macdChart.current) {
        macdChart.current.removeSeries(macdLineSeries.current);
        macdLineSeries.current = null;
      }
      if (macdSignalSeries.current && macdChart.current) {
        macdChart.current.removeSeries(macdSignalSeries.current);
        macdSignalSeries.current = null;
      }
      if (macdHistSeries.current && macdChart.current) {
        macdChart.current.removeSeries(macdHistSeries.current);
        macdHistSeries.current = null;
      }
    }
  }, [candles, prefs, interval]);

  // --------- carga histórica hacia atrás ----------
  async function loadMoreHistory() {
    if (!candles.length) return;
    isLoadingMoreRef.current = true;

    const firstTs = Number(candles[0]?.time);
    const prevRange = priceChart.current?.timeScale().getVisibleLogicalRange();

    const older = await fetchHistory({
      symbol,
      interval,
      limit: 600,
      endTimeSec: firstTs - 1,
    });

    if (!older.length) {
      hasMoreRef.current = false;
      showNotice('No hay más datos históricos');
      isLoadingMoreRef.current = false;
      return;
    }

    const merged = [...older, ...candles].sort((a, b) => Number(a.time) - Number(b.time));
    const added = older.length;

    setCandles(merged);
    priceSeries.current?.setData(merged.map(toCandle));
    volSeries.current?.setData(merged.map(toVolume));

    // mantener viewport y sincronizar
    if (prevRange && priceChart.current) {
      priceChart.current.timeScale().setVisibleLogicalRange({
        from: (prevRange as any).from + added,
        to: (prevRange as any).to + added,
      });
      const range = priceChart.current.timeScale().getVisibleLogicalRange();
      try {
        volChart.current?.timeScale().setVisibleLogicalRange(range as any);
        rsiChart.current?.timeScale().setVisibleLogicalRange(range as any);
        macdChart.current?.timeScale().setVisibleLogicalRange(range as any);
      } catch {}
    }

    isLoadingMoreRef.current = false;
  }

  async function fetchHistory(params: {
    symbol: string;
    interval: string;
    limit: number;
    endTimeSec?: number;
  }): Promise<Candle[]> {
    const { symbol, interval, limit, endTimeSec } = params;
    const endParam = endTimeSec ? `&endTime=${Math.max(0, endTimeSec * 1000)}` : '';
    try {
      const r = await fetch(httpURL(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${endParam}`));
      if (!r.ok) throw new Error('fetch klines failed');
      const j = await r.json();
      return (j.candles ?? []) as Candle[];
    } catch {
      return [];
    }
  }

  // ---------- mappers ----------
  function mapLine(data: Candle[], values: number[]): LineData[] {
    const out: LineData[] = [];
    for (let i = 0; i < data.length; i++) {
      const v = values[i];
      if (Number.isFinite(v)) {
        const t = Number((data[i].time as any));
        out.push({ time: (t as number) as UTCTimestamp, value: v as number });
      }
    }
    return out;
  }

  function mapHist(data: Candle[], values: number[]): HistogramData[] {
    const out: HistogramData[] = [];
    for (let i = 0; i < data.length; i++) {
      const v = values[i];
      if (Number.isFinite(v)) {
        const t = Number((data[i].time as any));
        out.push({
          time: (t as number) as UTCTimestamp,
          value: v as number,
          color: (v as number) >= 0 ? 'rgba(111, 207, 151, 0.8)' : 'rgba(239, 83, 80, 0.8)',
        });
      }
    }
    return out;
  }

  function toCandle(c: Candle): CandlestickData {
    const t = Number((c.time as any));
    return { time: (t as number) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
    // (Nos aseguramos de mandar number, no objetos BusinessDay)
  }

  function toVolume(c: Candle): HistogramData {
    const up = c.close >= c.open;
    const t = Number((c.time as any));
    return {
      time: (t as number) as UTCTimestamp,
      value: c.volume ?? 0,
      color: up ? '#26a69a' : '#ef5350',
    };
  }

  // ---------- UI ----------
  const [open, setOpen] = useState(false);

  const onToggle = (key: keyof IndicatorPrefs) => {
    setPrefs((prev) => ({ ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled } as any }));
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      {/* Header + controles */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 className="title" style={{ margin: 0 }}>
          {symbol} — {interval}
        </h2>
        <div>
          <button onClick={() => setOpen((o) => !o)} style={{ padding: '6px 10px', borderRadius: 8 }} title="Indicadores">
            ✦ Indicadores
          </button>
        </div>
      </div>

      {open && (
        <div
          style={{
            marginBottom: 8,
            padding: 10,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {/* EMA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={prefs.ema.enabled} onChange={() => onToggle('ema')} id="emaToggle" />
            <label htmlFor="emaToggle" style={{ minWidth: 50 }}>EMA</label>
            <label style={{ fontSize: 12, opacity: 0.8 }}>len</label>
            <input
              type="number"
              value={prefs.ema.length}
              min={1}
              onChange={(e) => setPrefs((p) => ({ ...p, ema: { ...p.ema, length: Number(e.target.value) || 1 } }))}
              style={{ width: 70 }}
            />
          </div>

          {/* RSI */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={prefs.rsi.enabled} onChange={() => onToggle('rsi')} id="rsiToggle" />
            <label htmlFor="rsiToggle" style={{ minWidth: 50 }}>RSI</label>
            <label style={{ fontSize: 12, opacity: 0.8 }}>len</label>
            <input
              type="number"
              value={prefs.rsi.length}
              min={1}
              onChange={(e) => setPrefs((p) => ({ ...p, rsi: { ...p.rsi, length: Number(e.target.value) || 1 } }))}
              style={{ width: 70 }}
            />
          </div>

          {/* MACD */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input type="checkbox" checked={prefs.macd.enabled} onChange={() => onToggle('macd')} id="macdToggle" />
            <label htmlFor="macdToggle" style={{ minWidth: 50 }}>MACD</label>
            <label style={{ fontSize: 12, opacity: 0.8 }}>fast</label>
            <input
              type="number"
              value={prefs.macd.fast}
              min={1}
              onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, fast: Number(e.target.value) || 1 } }))}
              style={{ width: 64 }}
            />
            <label style={{ fontSize: 12, opacity: 0.8 }}>slow</label>
            <input
              type="number"
              value={prefs.macd.slow}
              min={1}
              onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, slow: Number(e.target.value) || 1 } }))}
              style={{ width: 64 }}
            />
            <label style={{ fontSize: 12, opacity: 0.8 }}>signal</label>
            <input
              type="number"
              value={prefs.macd.signal}
              min={1}
              onChange={(e) => setPrefs((p) => ({ ...p, macd: { ...p.macd, signal: Number(e.target.value) || 1 } }))}
              style={{ width: 64 }}
            />
          </div>
        </div>
      )}

      {/* Charts apilados: PRECIO / VOLUMEN / RSI / MACD */}
      <div ref={wrapperRef} style={{ position: 'relative' }}>
        <div ref={priceEl} />
        <div ref={volEl} style={{ marginTop: 8 }} />
        <div ref={rsiEl} style={{ marginTop: 8 }} />
        <div ref={macdEl} style={{ marginTop: 8 }} />

        {/* Avisos */}
        {notice && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              top: 12,
              padding: '6px 10px',
              borderRadius: 8,
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.15)',
              fontSize: 12,
              pointerEvents: 'none',
            }}
          >
            {notice}
          </div>
        )}
        {isLoadingMoreRef.current && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              padding: '6px 10px',
              borderRadius: 8,
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.15)',
              fontSize: 12,
              pointerEvents: 'none',
            }}
          >
            Cargando histórico…
          </div>
        )}
      </div>
    </div>
  );
}
