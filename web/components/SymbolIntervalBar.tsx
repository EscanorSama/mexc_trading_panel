'use client';

type Opt = { value: string; label?: string };

// Normaliza solo para mostrar (no toca el value real)
function normalizeDisplaySymbol(s: string) {
  return (s ?? '')
    .replace(/\s*PERPETUAL.*/i, '') // quita " PERPETUAL" y lo que siga
    .replace(/[ :/\\-]+/g, '_')     // : , espacios, /, \, -  -> _
    .toUpperCase();
}

export default function SymbolIntervalBar(props: {
  symbols: Opt[];
  intervals: Opt[];
  valueSymbol: string;
  valueInterval: string;
  onChangeSymbol: (s: string) => void;
  onChangeInterval: (i: string) => void;
}) {
  const {
    symbols,
    intervals,
    valueSymbol,
    valueInterval,
    onChangeSymbol,
    onChangeInterval,
  } = props;

  return (
    <div className="toolbar" style={{ margin: '12px 0 16px 0', justifyContent: 'flex-start' }}>
      <label style={{ fontSize: 12, opacity: 0.8 }}>Símbolo:&nbsp;</label>
      <select value={valueSymbol} onChange={(e) => onChangeSymbol(e.target.value)}>
        {symbols.map((s) => (
          <option key={s.value} value={s.value}>
            {normalizeDisplaySymbol(s.value)}
          </option>
        ))}
      </select>

      <label style={{ fontSize: 12, opacity: 0.8, marginLeft: 8 }}>Timeframe:&nbsp;</label>
      <select value={valueInterval} onChange={(e) => onChangeInterval(e.target.value)}>
        {intervals.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
      </select>
    </div>
  );
}
