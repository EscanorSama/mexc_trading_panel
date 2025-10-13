'use client';

import {
  createChart,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  UTCTimestamp,
  IChartApi,
  ColorType,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { Candle, IndicatorConfig } from '../lib/types';
import { EMA, SMA, RSI } from '../lib/indicators';
import { wsURL, httpURL } from '../lib/ws';
import IndicatorControls from './IndicatorControls';

type Props = { symbol?: string; interval?: string };

export default function RealtimeChart({ symbol = 'DOGE_USDT', interval = 'Min1' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Refs SIEMPRE inicializados en TS estricto
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const overlaySeries = useRef<Record<string, ISeriesApi<'Line'>>>(
    {} as Record<string, ISeriesApi<'Line'>>
  );

  const [candles, setCandles] = useState<Candle[]>([]);
  const [indis, setIndis] = useState<IndicatorConfig[]>([
    { kind: 'EMA', length: 20, id: 'EMA-20' },
    { kind: 'RSI', length: 14, id: 'RSI-14' },
  ]);

  // Init chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height: 520,
      rightPriceScale: { borderVisible: false },
      leftPriceScale: { borderVisible: false },
      timeScale: { rightOffset: 6, borderVisible: false },
      grid: { horzLines: { visible: true }, vertLines: { visible: false } },
      layout: { textColor: '#b7bcc5', background: { type: ColorType.Solid, color: 'transparent' } },
      crosshair: { mode: 0 },
    });

    chartRef.current = chart;

    // Series
    priceSeries.current = chart.addCandlestickSeries({ priceScaleId: 'right' });

    // ⬇️ Volumen en ESCALA OVERLAY ('') para que NO afecte al precio
    volSeries.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '', // overlay (sin eje propio)
    });

    // RSI en escala izquierda (pane inferior)
    rsiSeries.current = chart.addLineSeries({ priceScaleId: 'left' });

    // Distribución vertical por márgenes (simula 3 “paneles”):
    // - Precio (right): 60% superior
    // - Volumen (overlay): ~10% justo bajo el precio
    // - RSI (left): 25% inferior
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.35 } });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.60, bottom: 0.30 } });
    chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.75, bottom: 0.05 } });

    const resize = () => chart.applyOptions({ width: containerRef.current!.clientWidth });
    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      chart.remove();
      chartRef.current = null;
      priceSeries.current = null;
      volSeries.current = null;
      rsiSeries.current = null;
      overlaySeries.current = {} as Record<string, ISeriesApi<'Line'>>;
    };
  }, []);

  // Seed history
  useEffect(() => {
    (async () => {
      const r = await fetch(httpURL(`/api/klines?symbol=${symbol}&interval=${interval}&limit=600`));
      const j = await r.json();
      const c: Candle[] = j.candles ?? [];
      setCandles(c);
      priceSeries.current?.setData(c.map(toCandle));
      volSeries.current?.setData(c.map(toVolume));
    })();
  }, [symbol, interval]);

  // Live WebSocket
  useEffect(() => {
    const ws = new WebSocket(wsURL({ symbol, interval }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'kline') {
        const k: Candle = msg.payload;
        setCandles((prev) => {
          const last = prev[prev.length - 1];
          let arr: Candle[];
          if (!last || k.time > last.time) arr = [...prev, k];
          else arr = [...prev.slice(0, -1), k];

          priceSeries.current?.update(toCandle(k));
          volSeries.current?.update(toVolume(k));
          return arr;
        });
      }
    };
    return () => ws.close();
  }, [symbol, interval]);

  // Recompute indicators whenever candles or config changes
  useEffect(() => {
    recomputeIndicators(candles, indis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, indis]);

  function recomputeIndicators(data: Candle[], cfgs: IndicatorConfig[]) {
    if (!chartRef.current || data.length === 0) return;

    // Overlays (EMA/SMA) sobre la escala de precio (right)
    cfgs
      .filter((x) => x.kind === 'EMA' || x.kind === 'SMA')
      .forEach((cfg) => {
        const id = cfg.id;
        if (!overlaySeries.current[id]) {
          overlaySeries.current[id] = chartRef.current!.addLineSeries({ priceScaleId: 'right' });
        }
        const values = cfg.kind === 'EMA' ? EMA(data, cfg.length) : SMA(data, cfg.length);
        overlaySeries.current[id].setData(mapLine(data, values));
      });

    // RSI (left)
    const rsiCfg = cfgs.find((x) => x.kind === 'RSI');
    if (rsiCfg && rsiSeries.current) {
      const values = RSI(data, rsiCfg.length);
      rsiSeries.current.setData(mapLine(data, values));
    }
  }

  function mapLine(data: Candle[], values: number[]): LineData[] {
    const out: LineData[] = [];
    for (let i = 0; i < data.length; i++) {
      const v = values[i];
      if (Number.isFinite(v)) out.push({ time: data[i].time as UTCTimestamp, value: v as number });
    }
    return out;
  }

  function toCandle(c: Candle): CandlestickData {
    return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
  }

  function toVolume(c: Candle): HistogramData {
    // Color por vela (verde si cierre >= apertura)
    const up = c.close >= c.open;
    return {
      time: c.time as UTCTimestamp,
      value: c.volume ?? 0,
      color: up ? '#26a69a' : '#ef5350',
    };
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 className="title" style={{ margin: 0 }}>
          {symbol} — {interval}
        </h2>
        <IndicatorControls onAdd={(cfg) => setIndis((prev) => [...prev, cfg])} />
      </div>
      <div ref={containerRef} className="chart" />
    </div>
  );
}
