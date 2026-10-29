import type { PerBand, PointSource, Scene } from '../../types';
import { compileScene } from '../core/compile';
import type { DiffuseField } from '../physics/diffuse';
import { makeFieldContext, type FieldOptions } from '../physics/field';
import { traceDiffuse, type DiffuseSettings } from '../tracing/diffuseTrace';

/** 확산 몬테카를로 작업 입력. 구조화 복제가 가능한 값만 담는다. */
export interface DiffuseRequest {
  scene: Scene;
  sources: PointSource[];
  alpha: PerBand<number>; // 공기 흡음 [dB/m]
  c: number; // 음속 [m/s]
  options: FieldOptions; // 정반사 차수 등 (이미지 음원과 같은 값)
  settings: DiffuseSettings;
}

/**
 * 확산 작업 본체 (워커와 시험에서 공용). 음원마다 이미지 음원이 실제로 쓴 차수를 구해
 * 그 다음 차수부터 순수 정반사를 몬테카를로가 이어받게 한다.
 */
export function runDiffuseJob(
  req: DiffuseRequest,
  onProgress?: (done: number, total: number) => void,
): DiffuseField {
  const c = compileScene(req.scene);
  const countFrom = req.sources.map((s) => {
    const ctx = makeFieldContext(c, s.position, s.lw, req.alpha, req.c, req.options);
    return (req.options.maxOrder > 0 ? ctx.images.order : 0) + 1; // 직접음(0차)은 해석식이 계산
  });
  return traceDiffuse({
    c,
    sources: req.sources,
    receivers: req.scene.receivers,
    alpha: req.alpha,
    countFrom,
    speed: req.c,
    settings: req.settings,
    onProgress,
  });
}
