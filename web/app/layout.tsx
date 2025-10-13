import './styles/globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MEXC Futures — DOGE/USDT Realtime',
  description: 'Gráfico en tiempo real con indicadores (Next.js + lightweight-charts)'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
