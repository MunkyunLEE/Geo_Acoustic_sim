import { BAND_CENTERS, type PerBand, type Vec3 } from '../../types';
import { A_WEIGHTING_DB, perBand } from '../core/bands';
import { dbToPower, powerToDb } from '../core/db';
import { distance } from '../core/vec';
import { closestHit, segmentVisible, bvhEpsilon, type Bvh } from '../tracing/bvh';

/** 최소 거리 [m]. 음원 근처에서 1/r² 발산(NaN/Infinity)을 막는다. */
export const R_MIN = 0.1;

/** 표시할 레벨 선택: 밴드 중심 주파수, 전체(에너지 합), A가중 전체. */
export type LevelSelection = 'total' | 'totalA' | (typeof BAND_CENTERS)[number];

/** 자유장 음원 대비 상대 에너지 이득 g = (1 m / r)² · 10^(-α r / 10). (물리 문서 4~5장) */
export function spreadingGain(
  r: number, // 음원-수음점 거리 [m]
  alphaDbPerM: number, // 공기 흡음 [dB/m]
): number {
  const rr = Math.max(r, R_MIN);
  return Math.pow(1 / rr, 2) * Math.pow(10, (-alphaDbPerM * rr) / 10);
}

export interface DirectResult {
  distance: number; // 거리 [m]
  visible: boolean; // 가시선 여부 (투과하는 면이 있어도 가려진 것으로 본다)
  gain: PerBand<number>; // 밴드별 상대 에너지 이득 (가려지면 투과율 곱, 투과가 없으면 0)
}

/** 직접음 계산. 가려지면 이득 0 (회절은 STEP 1 범위 밖). */
export function computeDirect(
  src: Vec3, // 음원 위치 [m]
  rcv: Vec3, // 수음점 [m]
  bvh: Bvh | null, // 장면 BVH
  alpha: PerBand<number>, // 밴드별 공기 흡음 [dB/m]
  objTrans?: Float32Array, // 객체 삼각형별 투과율 τ (삼각형당 6개). 없으면 투과 없음
): DirectResult {
  const r = distance(src, rcv);
  const eps = bvh ? bvhEpsilon(bvh) : 0;
  const visible = segmentVisible(bvh, src, rcv, eps);
  if (visible || !bvh || !objTrans) {
    return {
      distance: r,
      visible,
      gain: perBand((fc) => (visible ? spreadingGain(r, alpha[fc]) : 0)),
    };
  }
  // 가려진 경우: 선분이 지나는 모든 면의 투과율을 곱한다 (면마다 한 번 통과)
  const tau = [1, 1, 1, 1, 1, 1];
  const dir: Vec3 = [(rcv[0] - src[0]) / r, (rcv[1] - src[1]) / r, (rcv[2] - src[2]) / r];
  let o: Vec3 = [src[0], src[1], src[2]];
  let left = r;
  for (let guard = 0; guard < 64 && left > eps; guard++) {
    const hit = closestHit(bvh, o, dir, eps, left - eps);
    if (!hit) break;
    // bvhObjects의 삼각형 번호 = 객체 메시를 이어 붙인 번호
    for (let b = 0; b < 6; b++) tau[b] = tau[b]! * (objTrans[hit.triIndex * 6 + b] ?? 0);
    o = [o[0] + dir[0] * hit.t, o[1] + dir[1] * hit.t, o[2] + dir[2] * hit.t];
    left -= hit.t;
  }
  const gain = perBand((fc) => tau[BAND_CENTERS.indexOf(fc)]! * spreadingGain(r, alpha[fc]));
  return { distance: r, visible, gain };
}

/** 선택에 따른 밴드 가중치 (BAND_CENTERS 순서, 합 1). 밴드 하나를 고르면 그 밴드만 1. */
export function selectionWeights(lw: PerBand<number>, sel: LevelSelection): number[] {
  if (sel !== 'total' && sel !== 'totalA') return BAND_CENTERS.map((fc) => (fc === sel ? 1 : 0));
  const w = BAND_CENTERS.map((fc) =>
    dbToPower(lw[fc] + (sel === 'totalA' ? A_WEIGHTING_DB[fc] : 0)),
  );
  const sum = w.reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map((v) => v / sum) : w;
}

/** 밴드별 이득을 가중치로 합산해 dB로 (이득 합이 0이면 -Infinity). */
export function levelFromWeights(gain: PerBand<number>, w: readonly number[]): number {
  let sum = 0;
  BAND_CENTERS.forEach((fc, i) => (sum += w[i]! * gain[fc]));
  return powerToDb(sum);
}

/**
 * 상대 레벨 [dB]. 음원 Lw 스펙트럼으로 가중한 에너지 평균: 10log10(Σ W_b g_b / Σ W_b).
 * 평탄 스펙트럼이면 모든 밴드 이득의 평균이 된다. 이득 0이면 -Infinity.
 */
export function relativeLevelDb(
  gain: PerBand<number>, // 밴드별 이득
  lw: PerBand<number>, // 음원 Lw [dB]
  sel: LevelSelection, // 선택
): number {
  return levelFromWeights(gain, selectionWeights(lw, sel));
}
