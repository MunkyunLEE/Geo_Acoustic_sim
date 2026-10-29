import { BAND_CENTERS, type BandCenter, type PerBand } from '../../types';

/** 밴드별 값을 함수로 만든다. */
export function perBand<T>(f: (fc: BandCenter) => T): PerBand<T> {
  const out = {} as Record<BandCenter, T>;
  for (const fc of BAND_CENTERS) out[fc] = f(fc);
  return out;
}

/** 모든 밴드에 같은 값을 넣는다. (재료 예시·평탄 스펙트럼용) */
export function flatBands(value: number): PerBand<number> {
  return perBand(() => value);
}

/** base-2 옥타브 밴드 경계 [Hz]: fc/√2 ~ fc·√2. */
export function bandEdges(fc: BandCenter): { lo: number; hi: number } {
  return { lo: fc / Math.SQRT2, hi: fc * Math.SQRT2 };
}

/** A 가중 [dB], 공칭 중심 주파수 값 (IEC 61672, 옵션 용도). */
export const A_WEIGHTING_DB: PerBand<number> = {
  125: -16.1,
  250: -8.6,
  500: -3.2,
  1000: 0,
  2000: 1.2,
  4000: 1.0,
};
