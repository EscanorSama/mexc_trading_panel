export function wsURL(params: { symbol?: string; interval?: string } = {}) {
  const base = process.env.NEXT_PUBLIC_BACKEND_WS ?? 'ws://localhost:8000/ws/kline';
  const url = new URL(base);
  if (params.symbol) url.searchParams.set('symbol', params.symbol);
  if (params.interval) url.searchParams.set('interval', params.interval);
  return url.toString();
}

export function httpURL(path: string) {
  const base = process.env.NEXT_PUBLIC_BACKEND_HTTP ?? 'http://localhost:8000';
  return `${base}${path}`;
}
