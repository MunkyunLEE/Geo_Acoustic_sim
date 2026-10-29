import { useState } from 'react';
import { echoTotal, type Echogram } from '../solver/physics/echogram';

const COLORS = {
  direct: 'var(--accent, #1f6feb)',
  refl: '#2da44e',
  diff: '#e8912d',
  scat: '#a371f7',
} as const;
const LABELS: Record<keyof typeof COLORS, string> = {
  direct: '직접',
  refl: '정반사',
  diff: '회절',
  scat: '확산·고차',
};

/** 수신점 에코그램: 시간 구간별 에너지 이득 [dB] 막대. 막대 색은 그 구간에서 가장 큰 성분. */
export function EchoPlot({ echoes }: { echoes: { name: string; echo: Echogram }[] }) {
  const [idx, setIdx] = useState(0);
  const cur = echoes[Math.min(idx, echoes.length - 1)];
  if (!cur) return null;
  const e = cur.echo;
  const tot = Array.from({ length: e.nBins }, (_, i) => echoTotal(e, i));
  const peak = Math.max(...tot, 1e-30);
  const peakDb = 10 * Math.log10(peak);
  const top = Math.ceil(peakDb / 10) * 10; // 위쪽 눈금 [dB]
  const range = 70; // 표시 범위 [dB]
  let last = 0;
  tot.forEach((v, i) => {
    if (v > peak * 1e-7) last = i;
  });
  const shown = Math.max(8, Math.min(e.nBins, last + 4)); // 표시할 구간 수
  const W = 460;
  const H = 170;
  const L = 38;
  const B = 24;
  const px = (i: number) => L + (i / shown) * (W - L - 8);
  const py = (db: number) => 8 + ((top - db) / range) * (H - B - 8);
  const bw = Math.max(1, (W - L - 8) / shown - 0.5);
  const keys = Object.keys(COLORS) as (keyof typeof COLORS)[];
  return (
    <div className="echo">
      <label className="field">
        에코그램 수신점
        <select value={idx} onChange={(ev) => setIdx(Number(ev.target.value))}>
          {echoes.map((x, i) => (
            <option key={x.name} value={i}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${cur.name} 에코그램`}>
        {[0, 10, 20, 30, 40, 50, 60, 70].map((k) => (
          <g key={k}>
            <line
              x1={L}
              x2={W - 8}
              y1={py(top - k)}
              y2={py(top - k)}
              stroke="var(--line, #d0d7de)"
              strokeWidth={0.5}
            />
            <text
              x={L - 4}
              y={py(top - k) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--muted, #6e7781)"
            >
              {top - k}
            </text>
          </g>
        ))}
        {tot.slice(0, shown).map((v, i) => {
          if (!(v > 0)) return null;
          const db = Math.max(top - range, 10 * Math.log10(v));
          const dom = keys.reduce(
            (a, k) => (e[k][i]! > e[a][i]! ? k : a),
            'direct' as keyof typeof COLORS,
          );
          return (
            <rect
              key={i}
              x={px(i)}
              y={py(db)}
              width={bw}
              height={py(top - range) - py(db)}
              fill={COLORS[dom]}
            />
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text
            key={f}
            x={L + f * (W - L - 8)}
            y={H - 8}
            textAnchor="middle"
            fontSize={9}
            fill="var(--muted, #6e7781)"
          >
            {(f * shown * e.dtMs).toFixed(0)}
          </text>
        ))}
        <text x={W - 8} y={H - 0} textAnchor="end" fontSize={9} fill="var(--muted, #6e7781)">
          시간 [ms]
        </text>
        <text x={4} y={10} fontSize={9} fill="var(--muted, #6e7781)">
          dB
        </text>
      </svg>
      <div className="legend">
        {keys.map((k) => (
          <span key={k}>
            <i style={{ background: COLORS[k] }} /> {LABELS[k]}
          </span>
        ))}
      </div>
      <div className="muted">
        구간 폭 {e.dtMs} ms. 막대 높이 = 그 구간의 에너지 이득 [dB] (자유장 1 m = 0 dB). 구간 합은
        총 이득과 같습니다. 회절은 가장 짧은 우회 경로의 도달 시간에 모아 표시합니다.
      </div>
    </div>
  );
}
