import { colormap } from '../visualization/colormap';

/** GIF 프레임에 시각 라벨과 작은 컬러바를 그린다. */
export function drawOverlay(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  label: string, // 예: "t = 12.0 ms"
  minDb: number, // 컬러바 하한 [dB]
): void {
  const fs = Math.max(11, Math.round(w / 45));
  g.font = `${fs}px system-ui, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(6, h - fs - 12, g.measureText(label).width + 12, fs + 8);
  g.fillStyle = '#111';
  g.fillText(label, 12, h - 12);
  // 컬러바 (오른쪽 가장자리, 위 0 dB)
  const bw = Math.max(8, Math.round(w / 60));
  const bh = Math.round(h * 0.4);
  const x = w - bw - 36;
  const y = Math.round(h * 0.08);
  for (let i = 0; i < bh; i++) {
    const [r, gg, b] = colormap(1 - i / (bh - 1));
    g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
    g.fillRect(x, y + i, bw, 1);
  }
  g.fillStyle = '#111';
  g.font = `${Math.max(9, fs - 2)}px system-ui, sans-serif`;
  g.fillText('0 dB', x - 2, y - 3);
  g.fillText(`${minDb}`, x - 2, y + bh + fs - 2);
}
