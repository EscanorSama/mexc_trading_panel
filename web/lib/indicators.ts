export type Candle = {
  time: number; // segundos UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/* -------------------- básicas -------------------- */
function rmaSeries(src: number[], L: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  if (!n || L <= 0) return out;

  let sum = 0, i = 0;
  for (; i < Math.min(L, n); i++) sum += src[i];
  if (i < L) return out;
  let r = sum / L;
  out[i - 1] = r;

  const k = 1 / L;
  for (; i < n; i++) { r = r + k * (src[i] - r); out[i] = r; }
  return out;
}

// ATR basado en TR con rmaSeries (semilla estable)
export function ATR(candles: Candle[], length = 14): number[] {
  const tr = candles.map((_, i) => TR(candles, i));
  return rmaSeries(tr, length);
}


// EMA con semilla SMA (evita “deriva” al añadir velas antiguas)
function emaSeries(src: number[], L: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  if (!n || L <= 0) return out;

  // semilla estable = SMA de las primeras L velas
  let sum = 0, i = 0;
  for (; i < Math.min(L, n); i++) sum += src[i];
  if (i < L) return out;               // datos insuficientes
  let e = sum / L;
  out[i - 1] = e;

  const k = 2 / (L + 1);
  for (; i < n; i++) { e = src[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

function smaSeries(src: number[], L: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  if (L <= 0) return out;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= L) sum -= src[i - L];
    if (i >= L - 1) out[i] = sum / L;
  }
  return out;
}

/* -------------------- ATR / TR -------------------- */
export function TR(c: Candle[], i: number): number {
  const h = c[i].high;
  const l = c[i].low;
  const cPrev = i > 0 ? c[i - 1].close : c[i].close;
  return Math.max(h - l, Math.abs(h - cPrev), Math.abs(l - cPrev));
}

/* -------------------- EMA / SMA / RSI / MACD -------------------- */
export function EMA(candles: Candle[], length: number): number[] {
  return emaSeries(candles.map((c) => c.close), length);
}
export function SMA(candles: Candle[], length: number): number[] {
  return smaSeries(candles.map((c) => c.close), length);
}
export function RSI(candles: Candle[], length = 14): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2 || length <= 0) return out;

  let gain = 0, loss = 0;
  for (let i = 1; i <= Math.min(length, n - 1); i++) {
    const ch = candles[i].close - candles[i - 1].close;
    if (ch > 0) gain += ch; else loss += -ch;
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  let rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  if (n > length) out[length] = 100 - 100 / (1 + rs);

  for (let i = length + 1; i < n; i++) {
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
export function MACD(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number[]; signal: number[]; hist: number[] } {
  const n = candles.length;
  const macd = new Array<number>(n).fill(NaN);
  const signalArr = new Array<number>(n).fill(NaN);
  const hist = new Array<number>(n).fill(NaN);

  const emaF = EMA(candles, fast);
  const emaS = EMA(candles, slow);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(emaF[i]) && Number.isFinite(emaS[i])) macd[i] = (emaF[i] as number) - (emaS[i] as number);
  }
  // EMA de serie macd (no velas)
  const sig = emaSeries(macd.map((x) => (Number.isFinite(x) ? (x as number) : 0)), signal);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(macd[i]) && Number.isFinite(sig[i])) {
      signalArr[i] = sig[i] as number;
      hist[i] = (macd[i] as number) - (signalArr[i] as number);
    }
  }
  return { macd, signal: signalArr, hist };
}



export function NWE_Dynamic(
  candles: Candle[],
  h = 8,
  mult = 3,
  maxLen = 500
): { out_calc: number[]; mae_calc: number[]; calcUp: number[]; calcDn: number[]; envWd: number[] } {
  const n = candles.length;
  const out_calc = new Array<number>(n).fill(NaN);
  const mae_calc = new Array<number>(n).fill(NaN);
  const calcUp = new Array<number>(n).fill(NaN);
  const calcDn = new Array<number>(n).fill(NaN);
  const envWd = new Array<number>(n).fill(NaN);
  if (!n) return { out_calc, mae_calc, calcUp, calcDn, envWd };

  const W: number[] = [];
  const gauss = (x: number, hh: number) => Math.exp(-(x * x) / (hh * hh * 2));
  for (let j = 0; j < maxLen; j++) W.push(gauss(j, h));

  for (let i = 0; i < n; i++) {
    const last = Math.min(maxLen - 1, i);
    let sum = 0, den = 0;
    for (let j = 0; j <= last; j++) {
      const w = W[j];
      sum += candles[i - j].close * w;
      den += w;
    }
    out_calc[i] = den > 0 ? sum / den : NaN;
  }

  const err = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) err[i] = Math.abs(candles[i].close - (out_calc[i] ?? candles[i].close));
  const rma = rmaSeries(err, 499);
  for (let i = 0; i < n; i++) mae_calc[i] = (rma[i] ?? 0) * mult;

  for (let i = 0; i < n; i++) {
    const tr = TR(candles, i);
    const wd = Number.isFinite(mae_calc[i]) ? mae_calc[i] : tr;
    envWd[i] = Math.max(wd, 1e-10);
    const o = Number.isFinite(out_calc[i]) ? out_calc[i] : candles[i].close;
    calcUp[i] = o + (mae_calc[i] ?? 0);
    calcDn[i] = o - (mae_calc[i] ?? 0);
  }

  return { out_calc, mae_calc, calcUp, calcDn, envWd };
}

export function BreakoutLevelsStrict(
  candles: Candle[],
  rangeLen = 16,
  atrLen = 14,
  bufATR = 0.2
): { upperBreak: number[]; lowerBreak: number[]; atr0: number[] } {
  const n = candles.length;
  const upperBreak = new Array<number>(n).fill(NaN);
  const lowerBreak = new Array<number>(n).fill(NaN);
  const atrRaw = ATR(candles, atrLen);
  const atr0 = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) atr0[i] = Number.isFinite(atrRaw[i]) ? atrRaw[i] : TR(candles, i);

  const hh_raw = new Array<number>(n).fill(NaN);
  const ll_raw = new Array<number>(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    const lenEff = Math.max(1, Math.min(rangeLen, i + 1));
    let hh = -Infinity, ll = Infinity;
    for (let k = i - (lenEff - 1); k <= i; k++) {
      if (k < 0) continue;
      if (candles[k].high > hh) hh = candles[k].high;
      if (candles[k].low < ll) ll = candles[k].low;
    }
    hh_raw[i] = hh;
    ll_raw[i] = ll;
  }

  for (let i = 0; i < n; i++) {
    const hh = i > 0 ? (Number.isFinite(hh_raw[i - 1]) ? (hh_raw[i - 1] as number) : hh_raw[i]) : hh_raw[i];
    const ll = i > 0 ? (Number.isFinite(ll_raw[i - 1]) ? (ll_raw[i - 1] as number) : ll_raw[i]) : ll_raw[i];
    upperBreak[i] = hh + bufATR * atr0[i];
    lowerBreak[i] = ll - bufATR * atr0[i];
  }

  return { upperBreak, lowerBreak, atr0 };
}

export function BalanceNumber(
  candles: Candle[],
  opts: {
    h?: number; mult?: number;
    rangeLen?: number; atrLen?: number; bufATR?: number;
    proxWidth?: number;
    wUpProx?: number; wDnOut?: number; wDnProx?: number; wUpOut?: number;
    histScale?: number;
  } = {}
): { balance: number[]; aux: { calcUp: number[]; calcDn: number[]; upperBreak: number[]; lowerBreak: number[] } } {
  const h = opts.h ?? 8;
  const mult = opts.mult ?? 3;
  const rangeLen = opts.rangeLen ?? 16;
  const atrLen = opts.atrLen ?? 14;
  const bufATR = opts.bufATR ?? 0.2;

  const proxWidth = opts.proxWidth ?? 1.0;
  const wUpProx = opts.wUpProx ?? 0.60;
  const wDnOut = opts.wDnOut ?? 0.40;
  const wDnProx = opts.wDnProx ?? 0.60;
  const wUpOut = opts.wUpOut ?? 0.40;
  const histScale = opts.histScale ?? 100.0;

  const n = candles.length;
  const balance = new Array<number>(n).fill(NaN);

  const { calcUp, calcDn, envWd } = NWE_Dynamic(candles, h, mult);
  const { upperBreak, lowerBreak } = BreakoutLevelsStrict(candles, rangeLen, atrLen, bufATR);

  for (let i = 0; i < n; i++) {
    const scaleW = proxWidth * (envWd[i] ?? 1e-10);

    const distUpToPrice = (upperBreak[i] ?? NaN) - candles[i].close;
    const distDnToPrice = candles[i].close - (lowerBreak[i] ?? NaN);

    const bullProx = !Number.isFinite(scaleW) ? NaN :
      (distUpToPrice <= 0 ? 1 : clamp(1 - distUpToPrice / scaleW, 0, 1));
    const bearProx = !Number.isFinite(scaleW) ? NaN :
      (distDnToPrice <= 0 ? 1 : clamp(1 - distDnToPrice / scaleW, 0, 1));

    const bullOpp = !Number.isFinite(scaleW) ? NaN : clamp(((calcDn[i] as number) - (lowerBreak[i] as number)) / scaleW, 0, 1);
    const bearOpp = !Number.isFinite(scaleW) ? NaN : clamp(((upperBreak[i] as number) - (calcUp[i] as number)) / scaleW, 0, 1);

    const bullDen = Math.max(wUpProx + wDnOut, 1e-9);
    const bearDen = Math.max(wDnProx + wUpOut, 1e-9);

    const bullScore = (Number.isFinite(bullProx) && Number.isFinite(bullOpp))
      ? (wUpProx * (bullProx as number) + wDnOut * (bullOpp as number)) / bullDen
      : NaN;
    const bearScore = (Number.isFinite(bearProx) && Number.isFinite(bearOpp))
      ? (wDnProx * (bearProx as number) + wUpOut * (bearOpp as number)) / bearDen
      : NaN;

    balance[i] = (Number.isFinite(bullScore) && Number.isFinite(bearScore))
      ? ((bullScore as number) - (bearScore as number)) * histScale
      : NaN;
  }

  return { balance, aux: { calcUp, calcDn, upperBreak, lowerBreak } };
}

/* -------------------- Market Bias (HA smoothed + osc) -------------------- */
export function HeikinAshiMarketBiasFull(
  candles: Candle[],
  ha_len = 100,
  ha_len2 = 100,
  osc_len = 7
): { avg: number[]; h2: number[]; l2: number[]; o2: number[]; c2: number[]; oscBias: number[]; oscSmooth: number[] } {
  const n = candles.length;
  const avg = new Array<number>(n).fill(NaN);
  if (!n) return { avg, h2: avg.slice(), l2: avg.slice(), o2: avg.slice(), c2: avg.slice(), oscBias: avg.slice(), oscSmooth: avg.slice() };

  const o1 = emaSeries(candles.map((c) => c.open), ha_len);
  const h1 = emaSeries(candles.map((c) => c.high), ha_len);
  const l1 = emaSeries(candles.map((c) => c.low), ha_len);
  const c1 = emaSeries(candles.map((c) => c.close), ha_len);

  const haclose = c1.map((_, i) => (o1[i] + h1[i] + l1[i] + c1[i]) / 4);
  const haopen = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) haopen[i] = i === 0 ? (o1[i] + c1[i]) / 2 : (haopen[i - 1] + haclose[i - 1]) / 2;
  const hahigh = h1.map((hh, i) => Math.max(hh, Math.max(haopen[i], haclose[i])));
  const halow = l1.map((ll, i) => Math.min(ll, Math.min(haopen[i], haclose[i])));

  const o2 = emaSeries(haopen, ha_len2);
  const c2 = emaSeries(haclose, ha_len2);
  const h2 = emaSeries(hahigh, ha_len2);
  const l2 = emaSeries(halow, ha_len2);

  const avgOut = h2.map((_, i) => (h2[i] + l2[i]) / 2);
  const oscBias = c2.map((c, i) => 100 * (c - o2[i]));
  const oscSmooth = emaSeries(oscBias.map((x) => (Number.isFinite(x) ? x : 0)), osc_len);
  return { avg: avgOut, h2, l2, o2, c2, oscBias, oscSmooth };
}

/* -------------------- Efmus (cruces) -------------------- */
export function EfmusSignals(
  candles: Candle[],
  fast = 13,
  slow = 48
): { emaF: number[]; emaS: number[]; longIdx: number[]; shortIdx: number[] } {
  const emaF = EMA(candles, fast);
  const emaS = EMA(candles, slow);
  const longIdx: number[] = [];
  const shortIdx: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevUp = emaF[i - 1] > emaS[i - 1];
    const nowUp = emaF[i] > emaS[i];
    if (!prevUp && nowUp && Number.isFinite(emaF[i]) && Number.isFinite(emaS[i])) longIdx.push(i);
    if (prevUp && !nowUp && Number.isFinite(emaF[i]) && Number.isFinite(emaS[i])) shortIdx.push(i);
  }
  return { emaF, emaS, longIdx, shortIdx };
}

/* -------------------- Rebotes (fieles al Pine) con filtro Market Bias -------------------- */
type WickRef = 'range'|'body';

export function ReboundsPineLike(
  candles: Candle[],
  ha_avg: number[],
  ef: { longIdx: Set<number>; shortIdx: Set<number> },
  p: {
    rb_wick_min: number; rb_wick_ref: WickRef; rb_body_max: number;
    rb_eps_atr: number; rb_bias_eps_atr: number; rb_touch_atr: number;
    allow_big_body: boolean; imp_body_ratio: number; imp_atr_ratio: number;
  }
): { long: number[]; short: number[]; lastSignal: 'long'|'short'|null; lastMarkBodyLow: number; lastMarkBodyHigh: number; lastMarkIndex: number } {
  const n = candles.length;
  const atr = ATR(candles, 14);
  const long: number[] = [];
  const short: number[] = [];

  let zoneLow = NaN, zoneHigh = NaN;
  let lastSignal: 'long'|'short'|null = null;
  let markBodyLow = NaN, markBodyHigh = NaN, markIndex = -1;

  for (let i = 0; i < n; i++) {
    const a = Number.isFinite(atr[i]) ? atr[i] : TR(candles, i);
    const eps = a * p.rb_eps_atr;
    const epsBias = a * p.rb_bias_eps_atr;
    const touchMin = a * p.rb_touch_atr;

    // Filtro Market Bias (close vs mb_avg)
    const biasUp = Number.isFinite(ha_avg[i]) ? candles[i].close > (ha_avg[i] as number) + epsBias : true;
    const biasDn = Number.isFinite(ha_avg[i]) ? candles[i].close < (ha_avg[i] as number) - epsBias : true;

    // Señal marcada (como en Pine: efmus + color vela)
    const isMarkedUp = ef.longIdx.has(i) && candles[i].close > candles[i].open;
    const isMarkedDn = ef.shortIdx.has(i) && candles[i].close < candles[i].open;

    if (isMarkedUp && biasUp) {
      // Regla Bias: si close > ha_avg + epsBias, usa rango de la vela anterior; si no, el cuerpo actual
      const usePrev = Number.isFinite(ha_avg[i]) && (candles[i].close > (ha_avg[i] as number) + epsBias);
      const refHigh = usePrev && i > 0 ? candles[i - 1].high : candles[i].close;
      const refLow  = usePrev && i > 0 ? candles[i - 1].low  : candles[i].open;
      zoneHigh = Math.max(refHigh, refLow);
      zoneLow  = Math.min(refHigh, refLow);
      lastSignal = 'long';

      markBodyLow = Math.min(candles[i].open, candles[i].close);
      markBodyHigh = Math.max(candles[i].open, candles[i].close);
      markIndex = i;
    }
    if (isMarkedDn && biasDn) {
      const usePrev = Number.isFinite(ha_avg[i]) && (candles[i].close < (ha_avg[i] as number) - epsBias);
      const refHigh = usePrev && i > 0 ? candles[i - 1].high : candles[i].open;
      const refLow  = usePrev && i > 0 ? candles[i - 1].low  : candles[i].close;
      zoneHigh = Math.max(refHigh, refLow);
      zoneLow  = Math.min(refHigh, refLow);
      lastSignal = 'short';

      markBodyLow = Math.min(candles[i].open, candles[i].close);
      markBodyHigh = Math.max(candles[i].open, candles[i].close);
      markIndex = i;
    }

    // Métricas vela actual
    const rng = candles[i].high - candles[i].low;
    const body = Math.abs(candles[i].close - candles[i].open);
    const upper_wick = candles[i].high - Math.max(candles[i].open, candles[i].close);
    const lower_wick = Math.min(candles[i].open, candles[i].close) - candles[i].low;
    const refWick = p.rb_wick_ref === 'range' ? rng : Math.max(body, 1e-12);

    const smallBody = rng > 0 ? body <= p.rb_body_max * rng : false;
    const longLower = rng > 0 ? lower_wick >= p.rb_wick_min * refWick : false;
    const longUpper = rng > 0 ? upper_wick >= p.rb_wick_min * refWick : false;

    const penetrLong  = Number.isFinite(zoneHigh) ? Math.max(0, (zoneHigh as number) - candles[i].low) : 0;
    const penetrShort = Number.isFinite(zoneLow)  ? Math.max(0, candles[i].high - (zoneLow as number)) : 0;

    const wickInsideLong  = Number.isFinite(zoneLow) && Number.isFinite(zoneHigh) && (candles[i].low  >= (zoneLow as number) - eps)  && (candles[i].low  <= (zoneHigh as number) + eps)  && (penetrLong  >= touchMin);
    const wickInsideShort = Number.isFinite(zoneLow) && Number.isFinite(zoneHigh) && (candles[i].high <= (zoneHigh as number) + eps) && (candles[i].high >= (zoneLow  as number) - eps) && (penetrShort >= touchMin);

    const impulseUp  = p.allow_big_body && (body >= p.imp_body_ratio * rng || (candles[i].close - candles[i].open) >= p.imp_atr_ratio * a);
    const impulseDn  = p.allow_big_body && (body >= p.imp_body_ratio * rng || (candles[i].open  - candles[i].close) >= p.imp_atr_ratio * a);

    const basicUp   = lastSignal === 'long'  && candles[i].close >= candles[i].open && smallBody && longLower && wickInsideLong && biasUp;
    const basicDown = lastSignal === 'short' && candles[i].close <= candles[i].open && smallBody && longUpper && wickInsideShort && biasDn;

    if (basicUp || (lastSignal === 'long'  && wickInsideLong  && candles[i].close >= candles[i].open && impulseUp && biasUp))  long.push(i);
    if (basicDown || (lastSignal === 'short' && wickInsideShort && candles[i].close <= candles[i].open && impulseDn && biasDn)) short.push(i);
  }

  return { long, short, lastSignal, lastMarkBodyLow: markBodyLow, lastMarkBodyHigh: markBodyHigh, lastMarkIndex: markIndex };
}

export function ReboundsLatePineLike(
  candles: Candle[],
  markBodyLow: number,
  markBodyHigh: number,
  markIndex: number,
  lastSignal: 'long'|'short'|null,
  ha_avg: number[],
  p: {
    minBars: number; topFracLong: number; botFracShort: number;
    disp_ticks: number; disp_atr: number; wick_min: number; wick_ref: WickRef;
    body_max: number; allow_big_body: boolean; imp_body_ratio: number; imp_atr_ratio: number; touch_atr: number;
    bias_eps_atr: number;
  }
): { long: number[]; short: number[] } {
  const n = candles.length;
  const long: number[] = [];
  const short: number[] = [];
  if (markIndex < 0 || lastSignal == null) return { long, short };

  const atr = ATR(candles, 14);
  for (let i = 0; i < n; i++) {
    const a = Number.isFinite(atr[i]) ? atr[i] : TR(candles, i);
    const disp = Math.max(p.disp_ticks * 0, a * p.disp_atr); // ticks no disponibles; usamos ATR
    const touch = a * p.touch_atr;
    const epsBias = a * p.bias_eps_atr;

    // FILTRO Market Bias
    const biasUp = Number.isFinite(ha_avg[i]) ? candles[i].close > (ha_avg[i] as number) + epsBias : true;
    const biasDn = Number.isFinite(ha_avg[i]) ? candles[i].close < (ha_avg[i] as number) - epsBias : true;

    let lateLow = NaN, lateHigh = NaN;
    if (lastSignal === 'long') {
      const bodyTop = markBodyHigh, bodyBot = markBodyLow;
      const bodySize = Math.max(0, bodyTop - bodyBot);
      const topLow = bodyTop - bodySize * p.topFracLong;
      lateLow = topLow - disp;
      lateHigh = bodyTop + disp;
    } else if (lastSignal === 'short') {
      const bodyTop = markBodyHigh, bodyBot = markBodyLow;
      const bodySize = Math.max(0, bodyTop - bodyBot);
      const botHigh = bodyBot + bodySize * p.botFracShort;
      lateLow = bodyBot - disp;
      lateHigh = botHigh + disp;
    } else continue;

    const barsFar = markIndex >= 0 ? (i - markIndex >= p.minBars) : false;
    if (!barsFar) continue;

    const rng = candles[i].high - candles[i].low;
    const body = Math.abs(candles[i].close - candles[i].open);
    const upper_wick = candles[i].high - Math.max(candles[i].open, candles[i].close);
    const lower_wick = Math.min(candles[i].open, candles[i].close) - candles[i].low;
    const refW = p.wick_ref === 'range' ? rng : Math.max(body, 1e-12);

    const smallBody = rng > 0 ? body <= p.body_max * rng : false;
    const longLower = rng > 0 ? lower_wick >= p.wick_min * refW : false;
    const longUpper = rng > 0 ? upper_wick >= p.wick_min * refW : false;

    const penetrLong  = Number.isFinite(lateHigh) ? Math.max(0, (lateHigh as number) - candles[i].low) : 0;
    const penetrShort = Number.isFinite(lateLow)  ? Math.max(0, candles[i].high - (lateLow as number)) : 0;

    const insideLong  = Number.isFinite(lateLow) && Number.isFinite(lateHigh) && (candles[i].low  >= (lateLow as number)) && (candles[i].low  <= (lateHigh as number)) && penetrLong  >= touch;
    const insideShort = Number.isFinite(lateLow) && Number.isFinite(lateHigh) && (candles[i].high <= (lateHigh as number)) && (candles[i].high >= (lateLow  as number)) && penetrShort >= touch;

    const impulseUp  = p.allow_big_body && (body >= p.imp_body_ratio * rng || (candles[i].close - candles[i].open) >= p.imp_atr_ratio * a);
    const impulseDn  = p.allow_big_body && (body >= p.imp_body_ratio * rng || (candles[i].open  - candles[i].close) >= p.imp_atr_ratio * a);

    const late_basicUp   = lastSignal === 'long'  && insideLong  && candles[i].close >= candles[i].open && smallBody && longLower && biasUp;
    const late_basicDown = lastSignal === 'short' && insideShort && candles[i].close <= candles[i].open && smallBody && longUpper && biasDn;

    if (late_basicUp || (lastSignal === 'long'  && insideLong  && candles[i].close >= candles[i].open && impulseUp && biasUp))  long.push(i);
    if (late_basicDown || (lastSignal === 'short' && insideShort && candles[i].close <= candles[i].open && impulseDn && biasDn)) short.push(i);
  }

  return { long, short };
}
