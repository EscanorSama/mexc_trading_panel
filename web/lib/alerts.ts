export type AlertEvent = {
  id: string;
  ts: number;             // epoch seconds
  symbol: string;
  interval: string;
  title: string;
  message: string;
  severity?: 'info' | 'bull' | 'bear';
  price?: number;
  kind?: string;          // 'balance' | 'efm' | 'rebound' | 'rebound_late'
};
