import { BAND_CENTERS, type PerBand, type PointSource, type Vec3 } from '../../types';
import type { CompiledScene } from '../core/compile';
import { dbToPower, powerToDb } from '../core/db';
import { A_WEIGHTING_DB, perBand } from '../core/bands';
import { levelFromWeights, selectionWeights, type LevelSelection } from './direct';
import {
  emptyBands,
  diffuseAtPoint,
  diffuseAtReceiver,
  diffuseSeAtReceiver,
  type DiffuseField,
} from './diffuse';
import { evaluateField, makeFieldContext, type FieldContext, type FieldOptions } from './field';

/** 음원 여러 개의 장. 음원별 문맥 + 음원 간 에너지 비율(가장 큰 음원 = 1). */
export interface MultiField {
  ctxs: FieldContext[]; // 음원별 계산 문맥
  scales: number[]; // 음원별 에너지 비율 k_s (선택 레벨 기준, 최대 = 1)
  weights: number[][]; // 음원별 밴드 가중치 w_sb (k_s 미포함)
  sel: LevelSelection;
  diffuse: DiffuseField | null; // 확산 반사 몬테카를로 결과 (없으면 정반사·회절만)
}

/** 선택 레벨에서의 음원 한 개의 총 파워 [dB]. 밴드를 고르면 그 밴드의 Lw. */
function selectedLw(lw: PerBand<number>, sel: LevelSelection): number {
  if (sel !== 'total' && sel !== 'totalA') return lw[sel];
  const sum = BAND_CENTERS.reduce(
    (a, fc) => a + dbToPower(lw[fc] + (sel === 'totalA' ? A_WEIGHTING_DB[fc] : 0)),
    0,
  );
  return powerToDb(sum);
}

export function makeMultiField(
  c: CompiledScene,
  sources: readonly PointSource[],
  alpha: PerBand<number>,
  speed: number,
  options: FieldOptions,
  sel: LevelSelection,
  diffuse: DiffuseField | null = null,
): MultiField {
  const lws = sources.map((s) => selectedLw(s.lw, sel));
  const ref = Math.max(...lws);
  return {
    ctxs: sources.map((s) => makeFieldContext(c, s.position, s.lw, alpha, speed, options)),
    scales: lws.map((l) => (Number.isFinite(ref) ? dbToPower(l - ref) : 0)),
    weights: sources.map((s) => selectionWeights(s.lw, sel)),
    sel,
    diffuse,
  };
}

export interface MultiSample {
  distance: number; // 가장 가까운 음원까지 거리 [m]
  visible: boolean; // 어느 한 음원이라도 직접음 가시선이 있음
  totalDb: number; // 선택 레벨 합 [dB, 가장 큰 음원의 자유장 1 m = 0]
  directDb: number;
  reflDb: number;
  diffDb: number;
  scatDb: number; // 확산(몬테카를로) 성분 [dB], 계산하지 않았으면 -Infinity
  scatSeDb: number; // 확산 성분의 표준오차 [dB] (배치 평균의 표준오차, 근사), 없으면 NaN
  bandDb: PerBand<number>; // 밴드별 합계 [dB, 밴드별 가장 큰 음원 기준]
  nRefl: number;
  nDiff: number;
}

/** 음원들의 기여를 에너지로 합산한다 (비간섭). 음원이 하나면 evaluateField와 같은 값. */
export function evaluateMulti(mf: MultiField, rcv: Vec3, rIndex?: number): MultiSample {
  let dist = Infinity;
  let visible = false;
  let nRefl = 0;
  let nDiff = 0;
  const acc = { total: 0, direct: 0, refl: 0, diff: 0, scat: 0, scatVar: 0 };
  const band = BAND_CENTERS.map(() => 0);
  const bandRef = BAND_CENTERS.map((fc) => Math.max(...mf.ctxs.map((x) => x.lw[fc]))); // 밴드별 기준 Lw
  mf.ctxs.forEach((ctx, s) => {
    const f0 = evaluateField(ctx, rcv);
    const k = mf.scales[s]!;
    const w = mf.weights[s]!;
    const dg = diffuseGain(mf, s, rcv, rIndex); // 확산 성분 이득 (없으면 0)
    const f = { ...f0, total: perBand((fc) => f0.total[fc] + dg[fc]) };
    acc.scat += k * dbToPower(levelFromWeights(dg, w));
    if (mf.diffuse && rIndex !== undefined) {
      const se = diffuseSeAtReceiver(mf.diffuse, s, rIndex);
      acc.scatVar += k * k * BAND_CENTERS.reduce((a, fc, i) => a + (w[i]! * se[fc]) ** 2, 0);
    }
    dist = Math.min(dist, f.distance);
    visible ||= f.visible;
    nRefl += f.nReflectionPaths;
    nDiff += f.nDiffractionPaths;
    acc.total += k * dbToPower(levelFromWeights(f.total, w));
    acc.direct += k * dbToPower(levelFromWeights(f.direct, w));
    acc.refl += k * dbToPower(levelFromWeights(f.reflection, w));
    acc.diff += k * dbToPower(levelFromWeights(f.diffraction, w));
    BAND_CENTERS.forEach((fc, i) => {
      band[i] = band[i]! + dbToPower(ctx.lw[fc] - bandRef[i]!) * f.total[fc];
    });
  });
  const bandDb = {} as Record<number, number>;
  BAND_CENTERS.forEach((fc, i) => (bandDb[fc] = powerToDb(band[i]!)));
  return {
    distance: dist,
    visible,
    totalDb: powerToDb(acc.total),
    directDb: powerToDb(acc.direct),
    reflDb: powerToDb(acc.refl),
    diffDb: powerToDb(acc.diff),
    scatDb: powerToDb(acc.scat),
    scatSeDb:
      acc.scat > 0 && acc.scatVar > 0
        ? (10 / Math.LN10) * (Math.sqrt(acc.scatVar) / acc.scat)
        : NaN,
    bandDb: bandDb as PerBand<number>,
    nRefl,
    nDiff,
  };
}

/** 슬라이스용: 한 점의 선택 레벨 합 [dB]. */
export function levelAt(mf: MultiField, p: Vec3): number {
  let sum = 0;
  mf.ctxs.forEach((ctx, s) => {
    const f = evaluateField(ctx, p);
    const dg = diffuseGain(mf, s, p);
    const tot = perBand((fc) => f.total[fc] + dg[fc]);
    sum += mf.scales[s]! * dbToPower(levelFromWeights(tot, mf.weights[s]!));
  });
  return powerToDb(sum);
}

/** 음원 s의 확산 성분 이득. 수신점 번호가 있으면 수신 구 값, 없으면 복셀 보간. */
function diffuseGain(mf: MultiField, s: number, p: Vec3, rIndex?: number): PerBand<number> {
  if (!mf.diffuse) return emptyBands();
  return rIndex !== undefined
    ? diffuseAtReceiver(mf.diffuse, s, rIndex)
    : diffuseAtPoint(mf.diffuse, s, p);
}
