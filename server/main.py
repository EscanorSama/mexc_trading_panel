import time
from typing import Dict, List, Any

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from settings import settings
from mexc_stream import hub

app = FastAPI(title="MEXC Futures Realtime Proxy", version="1.1.0")

# CORS abierto para desarrollo (restringe en prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


# ============================
# Contratos disponibles (Futuros)
# ============================
@app.get("/api/contracts")
async def contracts():
    """
    Devuelve la lista de contratos de futuros (USDT-settled) aptos para API.
    Fuente oficial: GET /api/v1/contract/detail
    """
    url = f"{settings.MEXC_REST_BASE}/contract/detail"
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json().get("data", [])

    # Filtrado y normalización
    out: List[Dict[str, Any]] = []
    for it in data:
        # Campos típicos: symbol, displayNameEn, baseCoin, quoteCoin, settleCoin, apiAllowed, priceScale, amountScale
        if it.get("settleCoin") != "USDT":
            continue
        api_allowed = it.get("apiAllowed")
        if api_allowed is not None and not api_allowed:
            continue

        out.append({
            "symbol": it.get("symbol"),
            "displayName": it.get("displayNameEn") or it.get("displayName") or it.get("symbol"),
            "baseCoin": it.get("baseCoin"),
            "quoteCoin": it.get("quoteCoin"),
            "priceScale": it.get("priceScale"),
            "amountScale": it.get("amountScale"),
        })

    # Orden alfabético por símbolo
    out.sort(key=lambda x: (x.get("symbol") or ""))

    return {"contracts": out}


# ============================
# Histórico para sembrar gráfico
# ============================
@app.get("/api/klines")
async def klines(
    symbol: str = Query(default=settings.DEFAULT_SYMBOL),
    interval: str = Query(default=settings.DEFAULT_INTERVAL),
    limit: int = Query(default=500, ge=1, le=2000),
):
    """
    Devuelve candles normalizados para lightweight-charts.
    Usa REST de MEXC Futures: /api/v1/contract/kline/{symbol}?interval=Min1&start=&end=
    """
    now = int(time.time())
    step_sec_map: Dict[str, int] = {
        "Min1": 60, "Min5": 300, "Min15": 900, "Min30": 1800, "Min60": 3600,
        "Hour4": 14400, "Hour8": 28800, "Day1": 86400, "Week1": 604800, "Month1": 2592000
    }
    step_sec = step_sec_map.get(interval, 60)
    start = now - limit * step_sec

    url = f"{settings.MEXC_REST_BASE}/contract/kline/{symbol}"
    params = {"interval": interval, "start": start, "end": now}

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        payload = r.json().get("data", {})

    # La API devuelve arrays paralelos
    times: List[int] = payload.get("time", [])
    opens: List[str] = payload.get("open", [])
    highs: List[str] = payload.get("high", [])
    lows: List[str] = payload.get("low", [])
    closes: List[str] = payload.get("close", [])
    vols: List[str] = payload.get("vol", [])

    n = min(len(times), len(opens), len(highs), len(lows), len(closes))
    candles = []
    for i in range(n):
        candles.append({
            "time": int(times[i]),
            "open": float(opens[i]),
            "high": float(highs[i]),
            "low": float(lows[i]),
            "close": float(closes[i]),
            "volume": float(vols[i]) if i < len(vols) else 0.0,
        })

    return {"symbol": symbol, "interval": interval, "candles": candles}


# ============================
# WebSocket: reenvío de push.kline
# ============================
@app.websocket("/ws/kline")
async def ws_kline(
    websocket: WebSocket,
    symbol: str = settings.DEFAULT_SYMBOL,
    interval: str = settings.DEFAULT_INTERVAL,
):
    await websocket.accept()
    stream = hub.get_or_create(symbol, interval)
    await stream.start()
    q = stream.subscribe()

    try:
        while True:
            msg = await q.get()
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        stream.unsubscribe(q)
