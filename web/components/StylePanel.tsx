'use client';

import { ToolStyles, DEFAULT_STYLES, LineKind } from '../lib/styles';

type Props = {
  value: ToolStyles;
  onChange: (s: ToolStyles) => void;
};

function Row({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <div className="subtle">{title}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>
    </div>
  );
}

function ColorInput({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: 110 }}
        placeholder="#rrggbb"
      />
    </>
  );
}

function WidthInput({
  value, onChange,
}: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={1}
      max={5}
      step={1}
      value={value}
      onChange={e => onChange(Math.max(1, Math.min(5, Number(e.target.value || 1))))}
      style={{ width: 70 }}
    />
  );
}

function StyleSelect({
  value, onChange,
}: { value: LineKind; onChange: (v: LineKind) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as LineKind)}>
      <option value="solid">Solid</option>
      <option value="dashed">Dashed</option>
      <option value="dotted">Dotted</option>
    </select>
  );
}

export default function StylePanel({ value, onChange }: Props) {
  const set = <K extends keyof ToolStyles>(k: K, patch: Partial<ToolStyles[K]>) =>
    onChange({ ...value, [k]: { ...value[k], ...patch } });

  const reset = () => onChange(DEFAULT_STYLES);

  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <strong>Estilos de indicadores</strong>
        <div style={{ flex: 1 }} />
        <button onClick={reset} className="btn">Restablecer</button>
      </div>

      {/* EMA */}
      <Row title="EMA 13 (EFMUS)">
        <ColorInput value={value.ema13.color} onChange={(v) => set('ema13', { color: v })} />
        <WidthInput value={value.ema13.width} onChange={(v) => set('ema13', { width: v })} />
      </Row>
      <Row title="EMA 48 (EFMUS)">
        <ColorInput value={value.ema48.color} onChange={(v) => set('ema48', { color: v })} />
        <WidthInput value={value.ema48.width} onChange={(v) => set('ema48', { width: v })} />
      </Row>

      <hr style={{ borderColor: '#2a2f3a', margin: '8px 0' }} />

      {/* NWE */}
      <Row title="NWE — banda superior">
        <ColorInput value={value.upperEnv.color} onChange={(v) => set('upperEnv', { color: v })} />
        <WidthInput value={value.upperEnv.width} onChange={(v) => set('upperEnv', { width: v })} />
      </Row>
      <Row title="NWE — banda inferior">
        <ColorInput value={value.lowerEnv.color} onChange={(v) => set('lowerEnv', { color: v })} />
        <WidthInput value={value.lowerEnv.width} onChange={(v) => set('lowerEnv', { width: v })} />
      </Row>

      <Row title="Breakout superior">
        <ColorInput value={value.upperBreak.color} onChange={(v) => set('upperBreak', { color: v })} />
        <WidthInput value={value.upperBreak.width} onChange={(v) => set('upperBreak', { width: v })} />
        <StyleSelect value={value.upperBreak.style} onChange={(v) => set('upperBreak', { style: v })} />
      </Row>
      <Row title="Breakout inferior">
        <ColorInput value={value.lowerBreak.color} onChange={(v) => set('lowerBreak', { color: v })} />
        <WidthInput value={value.lowerBreak.width} onChange={(v) => set('lowerBreak', { width: v })} />
        <StyleSelect value={value.lowerBreak.style} onChange={(v) => set('lowerBreak', { style: v })} />
      </Row>

      <hr style={{ borderColor: '#2a2f3a', margin: '8px 0' }} />

      {/* Zonas */}
      <Row title="Zona rebote (up)">
        <ColorInput value={value.zoneUp.color} onChange={(v) => set('zoneUp', { color: v })} />
        <WidthInput value={value.zoneUp.width} onChange={(v) => set('zoneUp', { width: v })} />
        <StyleSelect value={value.zoneUp.style} onChange={(v) => set('zoneUp', { style: v })} />
      </Row>
      <Row title="Zona rebote (down)">
        <ColorInput value={value.zoneDn.color} onChange={(v) => set('zoneDn', { color: v })} />
        <WidthInput value={value.zoneDn.width} onChange={(v) => set('zoneDn', { width: v })} />
        <StyleSelect value={value.zoneDn.style} onChange={(v) => set('zoneDn', { style: v })} />
      </Row>

      <Row title="Zona tardía (up)">
        <ColorInput value={value.lateUp.color} onChange={(v) => set('lateUp', { color: v })} />
        <WidthInput value={value.lateUp.width} onChange={(v) => set('lateUp', { width: v })} />
        <StyleSelect value={value.lateUp.style} onChange={(v) => set('lateUp', { style: v })} />
      </Row>
      <Row title="Zona tardía (down)">
        <ColorInput value={value.lateDn.color} onChange={(v) => set('lateDn', { color: v })} />
        <WidthInput value={value.lateDn.width} onChange={(v) => set('lateDn', { width: v })} />
        <StyleSelect value={value.lateDn.style} onChange={(v) => set('lateDn', { style: v })} />
      </Row>

      <hr style={{ borderColor: '#2a2f3a', margin: '8px 0' }} />

      {/* RSI */}
      <Row title="RSI">
        <ColorInput value={value.rsi.color} onChange={(v) => set('rsi', { color: v })} />
        <WidthInput value={value.rsi.width} onChange={(v) => set('rsi', { width: v })} />
      </Row>
    </div>
  );
}
