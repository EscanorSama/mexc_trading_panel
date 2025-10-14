'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

// Carga dinámica del client
const ChartClient = dynamic(() => import('@/components/ChartClient'), { ssr: false });

type Panel = {
  id: string;
  symbol: string;
  interval: string;
};

type Persist = {
  cols: number;
  pageSize: number;
  page: number;
  panels: Panel[];
};

const LS_KEY = 'mexc_layout_v1';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function Page() {
  // ✅ Arrancamos con valores por defecto (coinciden SSR/CSR)
  const [panels, setPanels] = useState<Panel[]>([{ id: uid(), symbol: 'DOGE_USDT', interval: 'Min1' }]);
  const [cols, setCols] = useState<number>(2);
  const [pageSize, setPageSize] = useState<number>(4);
  const [page, setPage] = useState<number>(1);
  const [mounted, setMounted] = useState(false);

  // Tras montar, cargamos persistencia y actualizamos estado
  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Persist;
      if (!p || !Array.isArray(p.panels) || !p.panels.length) return;
      setPanels(p.panels);
      setCols(p.cols || 2);
      setPageSize(p.pageSize || 4);
      setPage(Math.max(1, p.page || 1));
    } catch {
      // ignore
    }
  }, []);

  // Guardar en localStorage cada cambio (ya con CSR montado)
  useEffect(() => {
    if (!mounted) return;
    const data: Persist = { cols, pageSize, page, panels };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }, [mounted, cols, pageSize, page, panels]);

  // Forzar refresh de los gráficos cuando cambie layout/paginación
  useEffect(() => {
    if (!mounted) return;
    window.dispatchEvent(new Event('charts:refresh'));
  }, [mounted, cols, pageSize, page]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(panels.length / pageSize)), [panels.length, pageSize]);
  const startIdx = (page - 1) * pageSize;
  const currentPanels = useMemo(() => panels.slice(startIdx, startIdx + pageSize), [panels, startIdx, pageSize]);

  const addPanel = () => {
    setPanels((prev) => [{ id: uid(), symbol: 'DOGE_USDT', interval: 'Min1' }, ...prev]);
    setPage(1);
  };

  const removePanel = (id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id));
    setPage(1);
  };

  const moveUp = (index: number) => {
    setPanels((prev) => {
      if (index <= 0) return prev;
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      return arr;
    });
  };

  const moveDown = (index: number) => {
    setPanels((prev) => {
      if (index >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
      return arr;
    });
  };

  const updatePanel = (id: string, patch: Partial<Panel>) => {
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const gridTemplate = useMemo(() => {
    return { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 16 } as const;
  }, [cols]);

  return (
    <main className="container" style={{ padding: 16 }}>
      {/* Toolbar superior */}
      <div
        className="toolbar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <button onClick={addPanel} style={{ padding: '6px 10px', borderRadius: 8 }}>
          + Añadir panel
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Columnas:</label>
          <select
            value={cols}
            onChange={(e) => {
              setCols(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Paneles por página:</label>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={2}>2</option>
            <option value={4}>4</option>
            <option value={6}>6</option>
            <option value={8}>8</option>
            <option value={12}>12</option>
          </select>
        </div>

        {/* Paginación */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            ◀
          </button>
          <span style={{ fontSize: 12 }}>
            Página {page} / {totalPages}
          </span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            ▶
          </button>
        </div>
      </div>

      {/* Gestor de panels */}
      <div
        className="tabs-manager"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
        }}
      >
        {panels.map((p, idx) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 8px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.9 }}>
              Panel {idx + 1} — {p.symbol} {p.interval}
            </span>
            <button onClick={() => moveUp(idx)} disabled={idx === 0} title="Subir">↑</button>
            <button onClick={() => moveDown(idx)} disabled={idx === panels.length - 1} title="Bajar">↓</button>
            <button onClick={() => removePanel(p.id)} title="Cerrar">✕</button>
          </div>
        ))}
      </div>

      {/* Grid de panels visibles */}
      <div style={gridTemplate}>
        {currentPanels.map((p) => (
          <div key={p.id}>
            <ChartClient
              symbol={p.symbol}
              interval={p.interval}
              onChangeSymbol={(s) => updatePanel(p.id, { symbol: s })}
              onChangeInterval={(i) => updatePanel(p.id, { interval: i })}
            />
          </div>
        ))}
      </div>
    </main>
  );
}
