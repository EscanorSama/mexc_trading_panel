export type Candle = {
  time: number; // epoch seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type IndicatorConfig =
  | { kind: 'EMA' | 'SMA'; length: number; id: string; color?: string }
  | { kind: 'RSI'; length: number; id: string; color?: string };

export type ToolsState = {
  balance: boolean;     // NWE + breakouts
  efm: boolean;         // EMA13/48 + markers
  rebound: boolean;     // zona principal
  reboundLate: boolean; // zona tardía
};
