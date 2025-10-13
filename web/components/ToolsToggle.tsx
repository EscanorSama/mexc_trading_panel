'use client';

import type { ToolsState } from '../lib/types';

export default function ToolsToggle({
  value, onChange,
}: { value: ToolsState; onChange: (t: ToolsState) => void }) {
  const set = (k: keyof ToolsState, v: boolean) => onChange({ ...value, [k]: v });
  return (
    <div className="toolbar" style={{ margin: '12px 0 12px 0' }}>
      <label><input type="checkbox" checked={value.balance} onChange={e => set('balance', e.target.checked)} />&nbsp;Balance/NWE</label>
      <label><input type="checkbox" checked={value.efm} onChange={e => set('efm', e.target.checked)} style={{ marginLeft: 12 }} />&nbsp;EFM (EMA13/48)</label>
      <label><input type="checkbox" checked={value.rebound} onChange={e => set('rebound', e.target.checked)} style={{ marginLeft: 12 }} />&nbsp;Rebote</label>
      <label><input type="checkbox" checked={value.reboundLate} onChange={e => set('reboundLate', e.target.checked)} style={{ marginLeft: 12 }} />&nbsp;Rebote tardío</label>
      <div style={{ flex: 1 }} />
      <span className="subtle">Activa/desactiva overlays y señales</span>
    </div>
  );
}
