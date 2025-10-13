'use client';

import { useState } from 'react';
import type { IndicatorConfig } from '../lib/types';

export default function IndicatorControls({ onAdd }: { onAdd: (cfg: IndicatorConfig) => void }) {
  const [kind, setKind] = useState<'EMA'|'SMA'|'RSI'>('EMA');
  const [length, setLength] = useState<number>(20);

  return (
    <div className="toolbar">
      <select value={kind} onChange={e => setKind(e.target.value as any)}>
        <option>EMA</option>
        <option>SMA</option>
        <option>RSI</option>
      </select>
      <input
        type="number"
        min={2}
        value={length}
        onChange={e => setLength(Math.max(2, Number(e.target.value || 2)))}
      />
      <button onClick={() => onAdd({ kind, length, id: `${kind}-${Date.now()}` })}>
        Añadir indicador
      </button>
    </div>
  );
}
