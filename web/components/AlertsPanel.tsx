'use client';

import { useEffect, useRef, useState } from 'react';
import { httpURL } from '../lib/ws';
import type { AlertEvent } from '../lib/alerts';
import type { ToolsState } from '../lib/types';

/**
 * Panel para configurar el umbral de Balance y escuchar alertas desde /ws/alerts.
 * Solo TELEGRAM en el backend; aquí puedes activar pitido local.
 */
export default function AlertsPanel({
  symbol, interval, tools,
}: { symbol: string; interval: string; tools: ToolsState }) {
  const [threshold, setThreshold] = useState<number>(20); // |balance| >= threshold
  const [soundOn, setSoundOn] = useState<boolean>(true);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Beep WebAudio
  const audioCtx = useRef<AudioContext | null>(null);
  function beep() {
    if (!soundOn) return;
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx.current!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 1000;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    o.start(); o.stop(ctx.currentTime + 0.21);
  }

  // (re)conecta WS
  useEffect(() => {
    const url = new URL(httpURL('/ws/alerts').replace('http', 'ws'));
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('balance_threshold', String(threshold));
    url.searchParams.set('enable_balance', String(tools.balance));
    url.searchParams.set('enable_efm', String(tools.efm));
    url.searchParams.set('enable_rebounds', String(tools.rebound));
    url.searchParams.set('enable_rebounds_late', String(tools.reboundLate));
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'alert') {
          const evn: AlertEvent = msg.payload;
          setEvents(prev => [evn, ...prev].slice(0, 60));
          beep();
        }
      } catch {/* ignore */}
    };
    return () => ws.close();
  }, [symbol, interval, threshold, tools.balance, tools.efm, tools.rebound, tools.reboundLate]);

  const color = (sev?: string) => sev === 'bull' ? '#00c853' : sev === 'bear' ? '#ff1744' : '#90caf9';

  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12 }}>Umbral Balance ±</label>
        <input type="number" step={1} value={threshold} onChange={e => setThreshold(Number(e.target.value || 0))} style={{ width: 90 }} />
        <label style={{ fontSize: 12, marginLeft: 8 }}>Pitido</label>
        <input type="checkbox" checked={soundOn} onChange={e => setSoundOn(e.target.checked)} />
        <div style={{ flex: 1 }} />
        <span className="subtle">Alertas ({symbol} · {interval})</span>
      </div>

      <div style={{ maxHeight: 180, overflow: 'auto', padding: '2px 4px' }}>
        {events.length === 0 ? <div className="subtle">Aún no hay alertas…</div> : null}
        {events.map((e) => (
          <div key={e.id} style={{
            display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8,
            borderBottom: '1px solid #1f2937', padding: '6px 2px'
          }}>
            <div className="subtle">{new Date(e.ts * 1000).toLocaleTimeString()}</div>
            <div>
              <div style={{ color: color(e.severity), fontWeight: 600 }}>{e.title}</div>
              <div className="subtle">{e.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
