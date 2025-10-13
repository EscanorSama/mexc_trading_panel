import os
from pydantic import BaseModel

class Settings(BaseModel):
    # WS y REST oficiales de MEXC Futures
    MEXC_WS_URL: str = os.getenv("MEXC_WS_URL", "wss://contract.mexc.com/edge")
    MEXC_REST_BASE: str = os.getenv("MEXC_REST_BASE", "https://contract.mexc.com/api/v1")

    # Parámetros por defecto
    DEFAULT_SYMBOL: str = os.getenv("DEFAULT_SYMBOL", "DOGE_USDT")
    DEFAULT_INTERVAL: str = os.getenv("DEFAULT_INTERVAL", "Min1")

    # Keep-alive
    PING_INTERVAL_SEC: int = int(os.getenv("PING_INTERVAL_SEC", "15"))

settings = Settings()
