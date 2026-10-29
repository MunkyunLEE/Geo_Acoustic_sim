import { BAND_CENTERS } from '../types';
import type { ResultRow } from '../ui/ResultsPanel';
import { echoTotal, type Echogram } from '../solver/physics/echogram';
import type { SliceGrid } from '../solver/receivers/slice';

const num = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '');
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** 수신점별 결과 표 CSV (레벨은 모두 음원 대비 상대 dB, 자유장 1 m = 0 dB). */
export function resultsCsv(rows: readonly ResultRow[]): string {
  const head = [
    '수신점',
    '거리_m',
    '지연_ms',
    '가시선',
    ...BAND_CENTERS.map((f) => `${f}Hz_dB`),
    '합계_dB',
    '직접_dB',
    '반사_dB',
    '회절_dB',
    '확산_dB',
    '확산_표준오차_dB',
    '반사경로수',
    '회절경로수',
  ];
  const lines = rows.map((r) =>
    [
      esc(r.name),
      num(r.distance, 3),
      num(r.delayMs, 3),
      r.visible ? 1 : 0,
      ...BAND_CENTERS.map((f) => num(r.bandDb[f], 2)),
      num(r.totalDb, 2),
      num(r.directDb, 2),
      num(r.reflDb, 2),
      num(r.diffDb, 2),
      num(r.scatDb, 2),
      num(r.scatSeDb, 2),
      r.nRefl,
      r.nDiff,
    ].join(','),
  );
  return [head.join(','), ...lines].join('\n') + '\n';
}

/** 에코그램 CSV: 구간 시작 시각과 성분별·합계 에너지 이득(선형)과 dB. */
export function echoCsv(e: Echogram): string {
  const head = '시간_ms,직접,반사,회절,확산,합계,합계_dB';
  const lines: string[] = [];
  for (let i = 0; i < e.nBins; i++) {
    const t = echoTotal(e, i);
    lines.push(
      [
        num(i * e.dtMs, 3),
        e.direct[i]!.toExponential(4),
        e.refl[i]!.toExponential(4),
        e.diff[i]!.toExponential(4),
        e.scat[i]!.toExponential(4),
        t.toExponential(4),
        num(10 * Math.log10(t), 2),
      ].join(','),
    );
  }
  return [head, ...lines].join('\n') + '\n';
}

/** 슬라이스 CSV: 셀 중심 x, y와 상대 레벨 [dB]. 계산할 성분이 없는 셀은 빈 칸. */
export function sliceCsv(g: SliceGrid): string {
  const lines = ['x_m,y_m,z_m,level_dB'];
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const lv = g.levels[j * g.nx + i]!;
      lines.push(
        `${num(g.x0 + (i + 0.5) * g.cell, 3)},${num(g.y0 + (j + 0.5) * g.cell, 3)},${num(g.z, 3)},${Number.isFinite(lv) ? lv.toFixed(2) : ''}`,
      );
    }
  return lines.join('\n') + '\n';
}
