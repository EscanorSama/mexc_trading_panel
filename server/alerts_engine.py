from __future__ import annotations
from dataclasses import dataclass
from typing import Deque, List, Optional, Tuple, Dict
from collections import deque
import math, time, uuid

def ema(prev: Optional[float], x: float, length: int) -> float:
    if prev is None: return x
    k = 2.0 / (length + 1.0)
    return x * k + prev * (1 - k)

def rma_warm(prev: Optional[float], x: float, length: int) -> float:
    if prev is None: return x
    return prev + (x - prev) / float(length)

def true_range(h: float, l: float, c_prev: Optional[float]) -> float:
    if c_prev is None: return h - l
    return max(h - l, abs(h - c_prev), abs(l - c_prev))

def atr_wilder(prev_atr: Optional[float], tr: float, length: int) -> float:
    if prev_atr is None: return tr
    return (prev_atr * (length - 1) + tr) / length

def gauss_w(x: int, h: float) -> float:
    return math.exp(-(x * x) / (h * h * 2.0)) if h > 0 else 1.0

class Candle:
    def __init__(self, t:int,o:float,h:float,l:float,c:float,v:float):
        self.t=t; self.o=o; self.h=h; self.l=l; self.c=c; self.v=v

class EngineConfig:
    def __init__(self, symbol:str, interval:str, balance_threshold:float=20.0,
                 enable_balance:bool=True, enable_efm:bool=True,
                 enable_rebounds:bool=True, enable_rebounds_late:bool=True):
        self.symbol=symbol; self.interval=interval
        self.balance_threshold=balance_threshold
        self.enable_balance=enable_balance
        self.enable_efm=enable_efm
        self.enable_rebounds=enable_rebounds
        self.enable_rebounds_late=enable_rebounds_late

class AlertEvent:
    def __init__(self, id:str, ts:int, symbol:str, interval:str, title:str, message:str,
                 severity:str="info", price:Optional[float]=None, kind:str="info"):
        self.id=id; self.ts=ts; self.symbol=symbol; self.interval=interval
        self.title=title; self.message=message; self.severity=severity; self.price=price; self.kind=kind

class AlertsEngine:
    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.closes: Deque[float] = deque(maxlen=600)
        self.highs: Deque[float]  = deque(maxlen=600)
        self.lows: Deque[float]   = deque(maxlen=600)
        self.opens: Deque[float]  = deque(maxlen=600)
        self.vols: Deque[float]   = deque(maxlen=600)
        self.times: Deque[int]    = deque(maxlen=600)

        self.prev_close: Optional[float] = None
        self.prev_atr: Optional[float] = None

        self.ema13: Optional[float] = None
        self.ema48: Optional[float] = None
        self.mb_avg: Optional[float] = None

        self.mae_prev: Optional[float] = None
        self.gauss = [gauss_w(i, 8.0) for i in range(500)]

        self.last_signal: Optional[str] = None
        self.zone_low: Optional[float] = None
        self.zone_high: Optional[float] = None
        self.mark_body_low: Optional[float] = None
        self.mark_body_high: Optional[float] = None
        self.mark_index: Optional[int] = None

    def _nwe_out_calc(self, length: int = 500) -> float:
        n = min(len(self.closes), length)
        if n == 0: return float('nan')
        s=0.0; ws=0.0
        for i in range(n):
            w=self.gauss[i]; s += list(self.closes)[-1-i]*w; ws+=w
        return s/max(ws,1e-12)

    def _balance(self) -> Tuple[float, Dict[str, float]]:
        p = dict(h=8.0, mult=3.0, histScale=100.0, proxWidth=1.0,
                 wUpProx=0.60, wDnOut=0.40, wDnProx=0.60, wUpOut=0.40,
                 rangeLen=16, atrLen=14, brBufATR=0.20)
        len_eff = min(p["rangeLen"], len(self.highs))
        if len_eff == 0: return float('nan'), {}
        hh = max(list(self.highs)[-len_eff:])
        ll = min(list(self.lows)[-len_eff:])
        atr = self.prev_atr or 0.0
        upper_break = hh + p["brBufATR"] * atr
        lower_break = ll - p["brBufATR"] * atr

        out_calc = self._nwe_out_calc(500)
        if math.isnan(out_calc): return float('nan'), {}
        mae_in = abs(self.closes[-1] - out_calc)
        self.mae_prev = rma_warm(self.mae_prev, mae_in, 499)
        mae = (self.mae_prev or 0.0) * p["mult"]
        env_wd = max(mae, 1e-10)

        scaleW = p["proxWidth"] * env_wd
        distUpToPrice = upper_break - self.closes[-1]
        distDnToPrice = self.closes[-1] - lower_break

        bullProx = 1.0 if distUpToPrice <= 0 else max(0.0, 1.0 - distUpToPrice/scaleW)
        bearProx = 1.0 if distDnToPrice <= 0 else max(0.0, 1.0 - distDnToPrice/scaleW)
        bullOpp  = max(0.0, min(1.0, (out_calc - lower_break)/scaleW))
        bearOpp  = max(0.0, min(1.0, (upper_break - out_calc)/scaleW))
        bullDen  = max(0.60 + 0.40, 1e-9)
        bearDen  = max(0.60 + 0.40, 1e-9)
        bullScore = (0.60*bullProx + 0.40*bullOpp)/bullDen
        bearScore = (0.60*bearProx + 0.40*bearOpp)/bearDen
        balance = (bullScore - bearScore) * p["histScale"]
        return balance, {"upper_break":upper_break,"lower_break":lower_break,"out_calc":out_calc,"mae":mae,"atr":atr}

    def _efm_signals(self, c: Candle) -> Tuple[bool,bool]:
        hl2 = 0.5*(c.h + c.l)
        self.mb_avg = ema(self.mb_avg, hl2, 100)
        e13_prev, e48_prev = self.ema13, self.ema48
        self.ema13 = ema(self.ema13, c.c, 13)
        self.ema48 = ema(self.ema48, c.c, 48)
        long=short=False
        if e13_prev is not None and e48_prev is not None:
            cross_up = e13_prev <= e48_prev and self.ema13 > self.ema48
            cross_dn = e13_prev >= e48_prev and self.ema13 < self.ema48
            bias_up  = self.mb_avg is None or c.c > self.mb_avg
            bias_dn  = self.mb_avg is None or c.c < self.mb_avg
            long  = cross_up and bias_up
            short = cross_dn and bias_dn
        return long, short

    def _mark_zone_from_signal(self, c:Candle, signal:str):
        self.last_signal = signal
        self.zone_low = min(c.o, c.c)
        self.zone_high = max(c.o, c.c)
        self.mark_body_low = self.zone_low
        self.mark_body_high = self.zone_high
        self.mark_index = len(self.closes) - 1

    def _rebound_principal(self, c:Candle, atr:float) -> Tuple[bool,bool]:
        if self.last_signal not in ("long","short") or self.zone_low is None or self.zone_high is None: return False, False
        rng=c.h-c.l;
        if rng<=0: return False, False
        body=abs(c.c-c.o); up_w=c.h-max(c.o,c.c); dn_w=min(c.o,c.c)-c.l; refW=rng
        smallBody= body <= 0.55*rng
        longLower= dn_w >= 0.35*refW
        longUpper= up_w >= 0.35*refW
        eps= 0.03*atr; touchMin=0.02*atr
        penetrLong=max(0.0, (self.zone_high or c.h)-c.l)
        penetrShort=max(0.0, c.h-(self.zone_low or c.l))
        wickInsideLong = (c.l >= (self.zone_low-eps)) and (c.l <= (self.zone_high+eps)) and (penetrLong >= touchMin)
        wickInsideShort= (c.h <= (self.zone_high+eps)) and (c.h >= (self.zone_low-eps)) and (penetrShort>= touchMin)
        impulseUp= body>=0.60*rng or (c.c-c.o)>=0.35*atr
        impulseDn= body>=0.60*rng or (c.o-c.c)>=0.35*atr
        return (self.last_signal=="long"  and c.c>=c.o and smallBody and longLower and wickInsideLong) or (self.last_signal=="long"  and wickInsideLong  and impulseUp), \
               (self.last_signal=="short" and c.c<=c.o and smallBody and longUpper and wickInsideShort) or (self.last_signal=="short" and wickInsideShort and impulseDn)

    def _rebound_late(self, c:Candle, atr:float) -> Tuple[bool,bool]:
        if self.mark_index is None or self.mark_body_low is None or self.mark_body_high is None: return False, False
        barsFar = (len(self.closes)-1 - self.mark_index) >= 12
        if not barsFar: return False, False
        disp=0.02*atr
        if self.last_signal=="long":
            size=max(0.0, self.mark_body_high - self.mark_body_low)
            topLow=self.mark_body_high - size*0.25
            low=topLow - disp; high=self.mark_body_high + disp
        else:
            size=max(0.0, self.mark_body_high - self.mark_body_low)
            botHigh=self.mark_body_low + size*0.25
            low=self.mark_body_low - disp; high=botHigh + disp

        rng=c.h-c.l; body=abs(c.c-c.o); up_w=c.h-max(c.o,c.c); dn_w=min(c.o,c.c)-c.l; refW=rng
        smallBody= rng>0 and body<=0.55*rng
        longLower= rng>0 and dn_w >= 0.35*refW
        longUpper= rng>0 and up_w >= 0.35*refW
        touch2=0.02*atr
        penetrLong2=max(0.0, high - c.l)
        penetrShort2=max(0.0, c.h - low)
        insideLong  = (c.l>=low) and (c.l<=high) and (penetrLong2>=touch2)
        insideShort = (c.h<=high) and (c.h>=low)  and (penetrShort2>=touch2)
        impulseUp= body>=0.60*rng or (c.c-c.o)>=0.35*atr
        impulseDn= body>=0.60*rng or (c.o-c.c)>=0.35*atr
        return (self.last_signal=="long"  and c.c>=c.o and smallBody and longLower and insideLong)  or (self.last_signal=="long"  and insideLong  and impulseUp), \
               (self.last_signal=="short" and c.c<=c.o and smallBody and longUpper and insideShort) or (self.last_signal=="short" and insideShort and impulseDn)

    def on_closed_candle(self, c: Candle) -> List[AlertEvent]:
        evs: List[AlertEvent] = []
        self.opens.append(c.o); self.highs.append(c.h); self.lows.append(c.l); self.closes.append(c.c); self.vols.append(c.v); self.times.append(c.t)
        tr = true_range(c.h, c.l, self.prev_close)
        self.prev_atr = atr_wilder(self.prev_atr, tr, 14)
        self.prev_close = c.c
        atr = self.prev_atr or 0.0

        # EFM
        if self.cfg.enable_efm:
          long_sig, short_sig = self._efm_signals(c)
          if long_sig:
              self._mark_zone_from_signal(c, "long")
              evs.append(self._mk("EFMUS Long", f"EMA13>EMA48. C={c.c:.6f}", "bull", c.c, "efm"))
          if short_sig:
              self._mark_zone_from_signal(c, "short")
              evs.append(self._mk("EFMUS Short", f"EMA13<EMA48. C={c.c:.6f}", "bear", c.c, "efm"))

        # Balance
        if self.cfg.enable_balance:
          bal, _ = self._balance()
          if not math.isnan(bal):
              if bal >= self.cfg.balance_threshold:
                  evs.append(self._mk("Balance Bull", f"{bal:.2f} ≥ {self.cfg.balance_threshold}", "bull", c.c, "balance"))
              if bal <= -self.cfg.balance_threshold:
                  evs.append(self._mk("Balance Bear", f"{bal:.2f} ≤ -{self.cfg.balance_threshold}", "bear", c.c, "balance"))

        # Rebotes
        if self.cfg.enable_rebounds:
          ru, rd = self._rebound_principal(c, atr)
          if ru: evs.append(self._mk("Rebote LONG (principal)", "zona activa", "bull", c.c, "rebound"))
          if rd: evs.append(self._mk("Rebote SHORT (principal)", "zona activa", "bear", c.c, "rebound"))

        if self.cfg.enable_rebounds_late:
          lu, ld = self._rebound_late(c, atr)
          if lu: evs.append(self._mk("Rebote LONG (tardío)", "zona tardía", "bull", c.c, "rebound_late"))
          if ld: evs.append(self._mk("Rebote SHORT (tardío)", "zona tardía", "bear", c.c, "rebound_late"))

        return evs

    def _mk(self, title:str, message:str, sev:str, price:float, kind:str)->AlertEvent:
        return AlertEvent(str(uuid.uuid4()), int(time.time()), self.cfg.symbol, self.cfg.interval, title, message, sev, price, kind)
