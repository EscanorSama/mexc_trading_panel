'use client';

type Opt = { value: string; label: string };

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
            {s.label}
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
