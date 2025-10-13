export type LineKind = 'solid' | 'dashed' | 'dotted';

export type ToolStyles = {
  ema13: { color: string; width: number };
  ema48: { color: string; width: number };
  upperEnv: { color: string; width: number };
  lowerEnv: { color: string; width: number };
  upperBreak: { color: string; width: number; style: LineKind };
  lowerBreak: { color: string; width: number; style: LineKind };
  zoneUp: { color: string; width: number; style: LineKind };
  zoneDn: { color: string; width: number; style: LineKind };
  lateUp: { color: string; width: number; style: LineKind };
  lateDn: { color: string; width: number; style: LineKind };
  rsi: { color: string; width: number };
};

export const DEFAULT_STYLES: ToolStyles = {
  // EMA EFMUS (overlays suaves)
  ema13: { color: '#42a5f5', width: 2 },   // azul medio
  ema48: { color: '#ffb74d', width: 2 },   // ámbar

  // NWE (envolvente)
  upperEnv: { color: '#26a69a', width: 1 }, // teal
  lowerEnv: { color: '#ef5350', width: 1 }, // rojo

  // Breakouts (líneas más ligeras)
  upperBreak: { color: '#00c853', width: 1, style: 'dashed' },
  lowerBreak: { color: '#ff1744', width: 1, style: 'dashed' },

  // Zonas Rebote (principal)
  zoneUp: { color: '#26a69a', width: 2, style: 'dashed' },
  zoneDn: { color: '#ef5350', width: 2, style: 'dashed' },

  // Zonas Rebote Tardío (aún más discretas)
  lateUp: { color: '#00c853', width: 1, style: 'dotted' },
  lateDn: { color: '#ff1744', width: 1, style: 'dotted' },

  // RSI
  rsi: { color: '#90caf9', width: 1 },
};
