'use client';

import { useEffect, useState } from 'react';
import RealtimeChart from '../components/RealtimeChart';
import SymbolIntervalBar from '../components/SymbolIntervalBar';
import { httpURL } from '../lib/ws';

type ContractInfo = {
  symbol: string;
  displayName?: string;
  baseCoin?: string;
  quoteCoin?: string;
  priceScale?: number;
  amountScale?: number;
};

const DEFAULT_SYMBOLS: ContractInfo[] = [
  { symbol: 'DOGE_USDT' },
  { symbol: 'BTC_USDT' },
  { symbol: 'ETH_USDT' },
  { symbol: 'SOL_USDT' },
];

const INTERVALS = [
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
];

export default function ChartClient() {
  const [symbols, setSymbols] = useState<ContractInfo[]>(DEFAULT_SYMBOLS);
  const [symbol, setSymbol] = useState<string>('DOGE_USDT');
  const [interval, setInterval] = useState<string>('Min1');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(httpURL('/api/contracts'));
        if (!r.ok) throw new Error('contracts fetch failed');
        const j = await r.json();
        const list: ContractInfo[] = (j.contracts ?? [])
          // orden básico: los más típicos primero
          .sort((a: { symbol: number; }, b: { symbol: number; }) => (a.symbol > b.symbol ? 1 : -1));
        if (list.length) setSymbols(list);
      } catch {
        // fallback silencioso a DEFAULT_SYMBOLS
        setSymbols(DEFAULT_SYMBOLS);
      }
    })();
  }, []);

  return (
    <>
      <SymbolIntervalBar
        symbols={symbols.map((c) => ({ value: c.symbol, label: c.displayName || c.symbol }))}
        intervals={INTERVALS}
        valueSymbol={symbol}
        valueInterval={interval}
        onChangeSymbol={setSymbol}
        onChangeInterval={setInterval}
      />
      <RealtimeChart symbol={symbol} interval={interval} />
    </>
  );
}
