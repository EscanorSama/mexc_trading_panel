import type { Candle } from './types';

// ========= util tiempo =========
export const toSeconds = (t: number) => (t > 1e12 ? Math.floor(t / 1000) : t);

// ========= medias/ATR =========
export function EMAa(values: number[], len: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (len <= 1) return values.slice();
  const k = 2 / (len + 1);
  let ema = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    ema = Number.isNaN(ema) ? v : ema + k * (v - ema);
    out[i] = ema;
  }
  return out;
}
export function emaArray(candles: Candle[], len: number) {
  return EMAa(candles.map((c) => c.close), len);
}
export function SMA(candles: Candle[], len: number) {
  const src = candles.map((c) => c.close);
  const out = new Array(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

export function EMA(candles: Candle[], length: number): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length === 0) return out;
  const k = 2 / (length + 1);
  let ema = candles[0].close;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].close;
    ema = i === 0 ? c : c * k + ema * (1 - k);
    if (i >= length - 1) out[i] = ema;
  }
  return out;
}
export function RSI(candles: Candle[], len: number) {
  const out = new Array(candles.length).fill(NaN);
  let avgGain = NaN;
  let avgLoss = NaN;
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    if (Number.isNaN(avgGain)) {
      avgGain = gain;
      avgLoss = loss;
    } else {
      avgGain = (avgGain * (len - 1) + gain) / len;
      avgLoss = (avgLoss * (len - 1) + loss) / len;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / (avgLoss || 1e-12);
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export function atrWilderArray(c: Candle[], len: number) {
  const out = new Array(c.length).fill(NaN);
  let r = NaN;
  for (let i = 0; i < c.length; i++) {
    const tr =
      i === 0
        ? c[0].high - c[0].low
        : Math.max(
            c[i].high - c[i].low,
            Math.abs(c[i].high - c[i - 1].close),
            Math.abs(c[i].low - c[i - 1].close)
          );
    r = Number.isNaN(r) ? tr : r + (tr - r) / len; // RMA (Wilder)
    out[i] = r;
  }
  return out;
}

export function rmaWarm(values: number[], len: number) {
  const out = new Array(values.length).fill(NaN);
  let r = NaN;
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    r = Number.isNaN(r) ? x : r + (x - r) / len;
    out[i] = r;
  }
  return out;
}

// ========= EFM cruces =========
export function detectEFMCrosses(
  candles: Candle[],
  ema13: number[],
  ema48: number[]
): { index: number; type: 'long' | 'short' }[] {
  const out: { index: number; type: 'long' | 'short' }[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (!Number.isFinite(ema13[i]) || !Number.isFinite(ema48[i])) continue;
    if (ema13[i] > ema48[i] && ema13[i - 1] <= ema48[i - 1]) out.push({ index: i, type: 'long' });
    if (ema13[i] < ema48[i] && ema13[i - 1] >= ema48[i - 1]) out.push({ index: i, type: 'short' });
  }
  return out;
}

// ========= NWE + Breakouts (estilo Pine) =========
const GAUSS = (x: number, h: number) => Math.exp(-(x * x) / (2 * h * h));

export function computeBalanceAndEnvelopes(
  candles: Candle[],
  h = 8, // bandwidth
  mult = 3, // MAE Mult
  rangeLen = 16,
  atrLen = 14,
  brBufATR = 0.2
): {
  upperEnv: number[];
  lowerEnv: number[];
  upperBreak: number[];
  lowerBreak: number[];
} {
  const n = candles.length;
  const src = candles.map((c) => c.close);

  // --- precalc kernel (0..499)
  const MAX = 499;
  const coefs: number[] = [];
  let denFull = 0;
  for (let i = 0; i <= MAX; i++) {
    const w = GAUSS(i, h);
    coefs.push(w);
    denFull += w;
  }

  // --- NWE endpoint por convolución dinámica (usa sólo datos disponibles)
  const out = new Array(n).fill(NaN);
  for (let t = 0; t < n; t++) {
    const last = Math.min(MAX, t);
    let num = 0;
    let den = 0;
    for (let i = 0; i <= last; i++) {
      const w = coefs[i];
      num += (src[t - i] ?? src[t]) * w;
      den += w;
    }
    out[t] = den > 0 ? num / den : NaN;
  }

  // --- MAE robusto desde el inicio (RMA warm)
  const absErr = src.map((v, i) => Math.abs(v - out[i]));
  const mae = rmaWarm(absErr, MAX) /* 499 en Pine */.map((v) => v * mult);

  const upperEnv = out.map((v, i) => (Number.isFinite(v) ? v + mae[i] : NaN));
  const lowerEnv = out.map((v, i) => (Number.isFinite(v) ? v - mae[i] : NaN));

  // --- Breakouts (HH/LL + buffer ATR) robustos desde primera vela
  const atr = atrWilderArray(candles, atrLen);
  const upperBreak = new Array(n).fill(NaN);
  const lowerBreak = new Array(n).fill(NaN);

  for (let t = 0; t < n; t++) {
    const lenEff = Math.max(1, Math.min(rangeLen, t + 1));
    let hh = -Infinity;
    let ll = Infinity;
    for (let k = t - lenEff + 1; k <= t; k++) {
      hh = Math.max(hh, candles[k].high);
      ll = Math.min(ll, candles[k].low);
    }
    // “usa el valor desplazado si hay historial”
    if (t > 0) {
      const lenEffPrev = Math.max(1, Math.min(rangeLen, t));
      let hhPrev = -Infinity;
      let llPrev = Infinity;
      for (let k = t - 1 - lenEffPrev + 1; k <= t - 1; k++) {
        hhPrev = Math.max(hhPrev, candles[k].high);
        llPrev = Math.min(llPrev, candles[k].low);
      }
      hh = isFinite(hhPrev) ? hhPrev : hh;
      ll = isFinite(llPrev) ? llPrev : ll;
    }
    const atr0 = Number.isFinite(atr[t])
      ? atr[t]
      : Math.max(
          candles[t].high - candles[t].low,
          t > 0 ? Math.abs(candles[t].high - candles[t - 1].close) : 0,
          t > 0 ? Math.abs(candles[t].low - candles[t - 1].close) : 0
        );
    upperBreak[t] = hh + brBufATR * atr0;
    lowerBreak[t] = ll - brBufATR * atr0;
  }

  return { upperEnv, lowerEnv, upperBreak, lowerBreak };
}
