import type { PerBand, Vec3 } from '../../types';
import type { CompiledScene } from '../core/compile';
import { perBand } from '../core/bands';
import { diffractionGains } from './diffraction';
import { computeDirect } from './direct';
import { buildImagePaths, reflectionGains, type ImageSet } from './reflection';

/** 계산에 포함할 성분과 반사 차수. */
export interface FieldOptions {
  direct: boolean; // 직접음
  maxOrder: number; // 정반사 최대 차수 (0이면 반사 없음)
  diffraction: boolean; // 차폐 보정 회절 (직접음이 가려진 곳에만 적용)
}

export const DEFAULT_FIELD_OPTIONS: FieldOptions = { direct: true, maxOrder: 2, diffraction: true };

/** 음원이 고정된 동안 재사용하는 계산 문맥 (이미지 음원 목록 등). */
export interface FieldContext {
  c: CompiledScene; // 컴파일된 장면
  src: Vec3; // 음원 위치 [m]
  lw: PerBand<number>; // 음원 Lw
  alpha: PerBand<number>; // 공기 흡음 [dB/m]
  speed: number; // 음속 [m/s]
  options: FieldOptions;
  images: ImageSet; // 이미지 음원 경로
}

export function makeFieldContext(
  c: CompiledScene,
  src: Vec3,
  lw: PerBand<number>,
  alpha: PerBand<number>,
  speed: number,
  options: FieldOptions,
): FieldContext {
  const images =
    options.maxOrder > 0
      ? buildImagePaths(c, src, options.maxOrder)
      : { paths: [], order: 0, truncated: false };
  return { c, src, lw, alpha, speed, options, images };
}

export interface FieldSample {
  distance: number; // 직선 거리 [m]
  visible: boolean; // 직접음 가시선
  direct: PerBand<number>; // 직접음 이득
  reflection: PerBand<number>; // 반사음 이득
  diffraction: PerBand<number>; // 회절음 이득
  total: PerBand<number>; // 선택한 성분의 합 (에너지 합)
  nReflectionPaths: number;
  nDiffractionPaths: number;
}

const zero = () => perBand(() => 0);

/** 수음점의 상대 에너지 이득을 성분별로 계산한다. 성분은 에너지로 합산한다 (비간섭, 근사). */
export function evaluateField(ctx: FieldContext, rcv: Vec3): FieldSample {
  const { c, src, alpha, options } = ctx;
  const d = computeDirect(src, rcv, c.bvhObjects, alpha, c.objTrans);
  const direct = options.direct ? d.gain : zero();
  const refl =
    options.maxOrder > 0 ? reflectionGains(c, ctx.images, rcv, alpha) : { gain: zero(), nValid: 0 };
  let diffraction = zero();
  let nDiff = 0;
  if (options.diffraction && !d.visible) {
    const r = diffractionGains(c, src, rcv, ctx.speed, alpha);
    diffraction = r.gain;
    nDiff = r.paths.length;
  }
  const total = perBand((fc) => direct[fc] + refl.gain[fc] + diffraction[fc]);
  return {
    distance: d.distance,
    visible: d.visible,
    direct,
    reflection: refl.gain,
    diffraction,
    total,
    nReflectionPaths: refl.nValid,
    nDiffractionPaths: nDiff,
  };
}
