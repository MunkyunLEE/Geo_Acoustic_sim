import { W0 } from './constants';

/** 선형 에너지량 → dB. 0 이하이면 -Infinity (NaN 방지). */
export function powerToDb(power: number, ref = 1): number {
  return power > 0 ? 10 * Math.log10(power / ref) : Number.NEGATIVE_INFINITY;
}

/** dB → 선형 에너지량. */
export function dbToPower(level: number, ref = 1): number {
  return ref * Math.pow(10, level / 10);
}

/** 레벨 여러 개를 에너지 합산한 dB. dB 값을 직접 더하지 않는다. 빈 입력은 -Infinity. */
export function sumLevelsDb(levels: readonly number[]): number {
  let sum = 0;
  for (const l of levels) sum += dbToPower(l);
  return powerToDb(sum);
}

/** Lw [dB re 1 pW] → 음향 파워 W [W]. */
export function lwToWatts(lw: number): number {
  return dbToPower(lw, W0);
}

/** 음향 파워 W [W] → Lw [dB re 1 pW]. */
export function wattsToLw(watts: number): number {
  return powerToDb(watts, W0);
}
