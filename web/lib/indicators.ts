// Tipos mínimos usados por los indicadores
export type Candle = {
  time: number; // segundos UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

/** Simple Moving Average */
export function SMA(candles: Candle[], length: number): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (length <= 0) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= length) sum -= candles[i - length].close;
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

/** Exponential Moving Average */
export function EMA(candles: Candle[], length: number): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (length <= 0) return out;
  const k = 2 / (length + 1);
  let ema = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].close;
    if (i === 0) ema = c;
    else ema = c * k + ema * (1 - k);
    if (i >= length - 1) out[i] = ema;
  }
  return out;
}

/** Relative Strength Index (Wilder) */
export function RSI(candles: Candle[], length = 14): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (length <= 0 || candles.length < 2) return out;

  let gain = 0;
  let loss = 0;

  // seed
  for (let i = 1; i <= length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    gain += ch > 0 ? ch : 0;
    loss += ch < 0 ? -ch : 0;
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  let rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[length] = 100 - 100 / (1 + rs);

  // Wilder smoothing
  for (let i = length + 1; i < candles.length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (length - 1) + g) / length;
    avgLoss = (avgLoss * (length - 1) + l) / length;
    rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

/** MACD clásico: fast EMA - slow EMA, señal = EMA(macd, signal), hist = macd - señal */
export function MACD(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number[]; signal: number[]; hist: number[] } {
  const outMacd: number[] = new Array(candles.length).fill(NaN);
  const outSignal: number[] = new Array(candles.length).fill(NaN);
  const outHist: number[] = new Array(candles.length).fill(NaN);
  if (fast <= 0 || slow <= 0 || signal <= 0) {
    return { macd: outMacd, signal: outSignal, hist: outHist };
  }

  const emaFast = EMA(candles, fast);
  const emaSlow = EMA(candles, slow);

  for (let i = 0; i < candles.length; i++) {
    if (Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i])) {
      outMacd[i] = (emaFast[i] as number) - (emaSlow[i] as number);
    }
  }

  // señal = EMA del macd (usamos una EMA sobre la serie macd, saltando NaN)
  const macdCandles: Candle[] = candles.map((c, i) => ({
    ...c,
    close: Number.isFinite(outMacd[i]) ? (outMacd[i] as number) : 0,
  }));
  const macdEma = EMA(macdCandles, signal);

  for (let i = 0; i < candles.length; i++) {
    if (Number.isFinite(outMacd[i]) && Number.isFinite(macdEma[i])) {
      outSignal[i] = macdEma[i] as number;
      outHist[i] = (outMacd[i] as number) - (outSignal[i] as number);
    }
  }

  return { macd: outMacd, signal: outSignal, hist: outHist };
}
