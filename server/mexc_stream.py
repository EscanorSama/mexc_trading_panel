import asyncio
import json
import logging
import time
from typing import Dict, Tuple, Set, Optional

import websockets
from websockets.exceptions import ConnectionClosed

from settings import settings

# Configuración de logging básica
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
log = logging.getLogger("mexc")

# Clave para identificar cada stream (símbolo + intervalo)
StreamKey = Tuple[str, str]


class KlineStreamer:
    """
    Mantiene una conexión WebSocket con MEXC Futures para un (symbol, interval),
    y hace broadcast de cada vela recibida a todos los suscriptores locales (colas asyncio).
    """
    def __init__(self, symbol: str, interval: str):
        self.symbol = symbol
        self.interval = interval
        self.clients: Set[asyncio.Queue] = set()
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()

    def key(self) -> StreamKey:
        return (self.symbol, self.interval)

    async def start(self):
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        self._stop.set()
        if self._task:
            await asyncio.wait([self._task])

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1024)
        self.clients.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self.clients.discard(q)

    async def broadcast(self, msg: dict):
        dead = []
        for q in self.clients:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.clients.discard(q)

    async def _run(self):
        backoff = 1
        while not self._stop.is_set():
            try:
                # Conexión WS (sin ping automático; lo gestionamos nosotros)
                async with websockets.connect(settings.MEXC_WS_URL, ping_interval=None) as ws:
                    # Suscripción a kline
                    sub = {
                        "method": "sub.kline",
                        "param": {"symbol": self.symbol, "interval": self.interval},
                    }
                    await ws.send(json.dumps(sub))
                    log.info(f"Subscribed: {self.symbol} {self.interval}")

                    last_ping = 0.0
                    while not self._stop.is_set():
                        now = time.time()
                        if now - last_ping > settings.PING_INTERVAL_SEC:
                            try:
                                await ws.send(json.dumps({"method": "ping"}))
                            except Exception:
                                pass
                            last_ping = now

                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=settings.PING_INTERVAL_SEC + 5)
                        except asyncio.TimeoutError:
                            # Sin datos; seguimos para enviar ping de nuevo
                            continue

                        # Algunos mensajes pueden venir como string JSON
                        try:
                            data = json.loads(raw)
                        except Exception:
                            continue

                        channel = data.get("channel")
                        if channel == "pong":
                            continue

                        if channel == "push.kline":
                            d = data.get("data", {})
                            # Estructura típica: { t, o, h, l, c, q?, symbol, interval }
                            try:
                                candle = {
                                    "symbol": d.get("symbol", self.symbol),
                                    "interval": d.get("interval", self.interval),
                                    "time": int(d["t"]),            # epoch seconds
                                    "open": float(d["o"]),
                                    "high": float(d["h"]),
                                    "low": float(d["l"]),
                                    "close": float(d["c"]),
                                    "volume": float(d.get("q", 0.0)),
                                }
                            except Exception as e:
                                log.debug(f"Malformed kline payload: {e} | {d}")
                                continue

                            await self.broadcast({"type": "kline", "payload": candle})

                # Si salimos del contextmanager sin excepción explícita, dormimos y reintentamos
                log.warning("WS closed gracefully; reconnecting...")
            except ConnectionClosed:
                log.warning("WS connection closed; reconnecting...")
            except Exception as e:
                log.exception(f"WS error: {e}")

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 10)


class StreamHub:
    """Gestiona múltiples streams (symbol, interval) y los reutiliza entre clientes."""
    def __init__(self):
        self.streams: Dict[StreamKey, KlineStreamer] = {}

    def get_or_create(self, symbol: str, interval: str) -> KlineStreamer:
        key = (symbol, interval)
        if key not in self.streams:
            self.streams[key] = KlineStreamer(symbol, interval)
        return self.streams[key]


hub = StreamHub()
