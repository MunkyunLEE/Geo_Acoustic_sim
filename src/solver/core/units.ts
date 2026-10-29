import type { LengthUnit } from '../../types';

/** 길이 단위 → m 변환 계수. */
export const LENGTH_UNIT_TO_M: Readonly<Record<LengthUnit, number>> = {
  mm: 1e-3,
  cm: 1e-2,
  m: 1,
};

/** 길이 값을 m로 변환한다. */
export function toMeters(value: number, unit: LengthUnit): number {
  return value * LENGTH_UNIT_TO_M[unit];
}

/** 좌표 배열 전체를 m로 변환한 새 배열을 반환한다 (입력은 변경하지 않음). 임포트 경계에서만 사용. */
export function convertPositionsToMeters(
  positions: ArrayLike<number>, // [x0,y0,z0,...] 원본 단위
  unit: LengthUnit, // 원본 길이 단위
): Float32Array {
  const k = LENGTH_UNIT_TO_M[unit];
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) out[i] = (positions[i] as number) * k;
  return out;
}
