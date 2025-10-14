'use client';

import { useEffect, useMemo, useState } from 'react';
import RealtimeChart from '../components/RealtimeChart';
import SymbolIntervalBar from '../components/SymbolIntervalBar';
import { httpURL } from '../lib/ws';

type ContractInfo = {
  symbol?: string;        // puede venir con formas raras
  displayName?: string;   // a veces "EDEN:USDT PERPETUAL"
  baseCoin?: string;
  quoteCoin?: string;
  priceScale?: number;
  amountScale?: number;
};

type Opt = { value: string; label: string };

const DEFAULT_SYMBOLS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'DOGE_USDT'];
const POPULAR_ORDER = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'DOGE_USDT', 'XRP_USDT', 'ADA_USDT'];

/** Normaliza cualquier variante a BASE_QUOTE (e.g., "EDEN:USDT PERPETUAL" -> "EDEN_USDT") */
function normalizePair(raw?: string, displayName?: string): string | null {
  let s = (raw || displayName || '').trim();
  if (!s) return null;

  // uniformizar separadores y quitar sufijos típicos de derivados
  s = s.replace(/\s+/g, '_').replace(/:/g, '_').toUpperCase();
  // Ej.: BTC_USDT_PERPETUAL, BTC_USDT-SWAP, etc.
  s = s.replace(/[_-](PERPETUAL|SWAP|FUTURES?|CQ|USDM|COINM)$/i, '');

  // Si quedan más de dos tokens, nos quedamos con los 2 primeros
  const parts = s.split('_').filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}_${parts[1]}`;
  return null;
}

function sortSymbols(arr: string[]): string[] {
  return [...arr].sort((a, b) => {
    const ia = POPULAR_ORDER.indexOf(a);
    const ib = POPULAR_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });
}

export default function ChartClient(props: {
  symbol: string;
  interval: string;
  onChangeSymbol: (s: string) => void;
  onChangeInterval: (i: string) => void;
}) {
  const { symbol, interval, onChangeSymbol, onChangeInterval } = props;

  const [options, setOptions] = useState<Opt[]>(
    DEFAULT_SYMBOLS.map((s) => ({ value: s, label: s }))
  );

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(httpURL('/api/contracts'));
        if (!r.ok) throw new Error('contracts fetch failed');
        const j = await r.json();

        const fetched: string[] = (j.contracts ?? [])
          .map((c: ContractInfo) => normalizePair(c.symbol, c.displayName))
          .filter((x: string | null): x is string => Boolean(x));

        // fusionar con defaults + símbolo actual y deduplicar
        const mergedSet = new Set<string>([
          ...DEFAULT_SYMBOLS,
          symbol,             // asegura el actual
          ...fetched,
        ]);

        const merged = sortSymbols(Array.from(mergedSet));

        // si por lo que sea quedase vacío, fallback a defaults
        const finalList = merged.length ? merged : DEFAULT_SYMBOLS;

        setOptions(finalList.map((s) => ({ value: s, label: s })));
      } catch {
        // fallback silencioso
        const merged = sortSymbols(Array.from(new Set([symbol, ...DEFAULT_SYMBOLS])));
        setOptions(merged.map((s) => ({ value: s, label: s })));
      }
    })();
    // NOTA: dependemos de `symbol` para garantizar que siempre esté en la lista
  }, [symbol]);

  // Evitar estado inválido: si el valor actual no está en la lista (raro), lo metemos
  const safeOptions = useMemo(() => {
    const hasCurrent = options.some((o) => o.value === symbol);
    return hasCurrent ? options : [{ value: symbol, label: symbol }, ...options];
  }, [options, symbol]);

  return (
    <>
      <SymbolIntervalBar
        symbols={safeOptions}
        intervals={[
          { value: 'Min1', label: '1m' },
          { value: 'Min5', label: '5m' },
          { value: 'Min15', label: '15m' },
          { value: 'Min30', label: '30m' },
          { value: 'Min60', label: '1h' },
          { value: 'Hour4', label: '4h' },
          { value: 'Hour8', label: '8h' },
          { value: 'Day1', label: '1D' },
          { value: 'Week1', label: '1W' },
          { value: 'Month1', label: '1M' },
        ]}
        valueSymbol={symbol}
        valueInterval={interval}
        onChangeSymbol={onChangeSymbol}
        onChangeInterval={onChangeInterval}
      />
      <RealtimeChart symbol={symbol} interval={interval} />
    </>
  );
}
