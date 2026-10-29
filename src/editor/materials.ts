import { flatBands } from '../solver/core/bands';
import type { Material } from '../types';
import type { ObjectRole } from './types';

export const ROLE_LABELS: Record<ObjectRole, string> = {
  reflect: '반사벽',
  absorber: '흡음재',
  obstacle: '장애물',
  open: '소산벽 (α=1)',
  custom: '사용자 정의',
  emitter: '면음원',
};

/** 역할 프리셋 계수 [흡음률 α, 산란 계수 s]. 예시 값이며 실측 데이터가 아니다 (D5). */
const PRESETS: Record<Exclude<ObjectRole, 'custom' | 'emitter'>, [number, number]> = {
  reflect: [0.05, 0.1],
  absorber: [0.8, 0.2],
  obstacle: [0.3, 0.2],
  open: [1, 0],
};

/** 객체 전용 재료를 만든다. id는 mat-<객체 id>. 투과 속성은 지원하지 않는다 (STEP 6). */
export function makeObjectMaterial(objectId: string, role: ObjectRole): Material {
  const [a, s] = PRESETS[role === 'custom' ? 'reflect' : role === 'emitter' ? 'open' : role];
  return {
    id: `mat-${objectId}`,
    name: ROLE_LABELS[role],
    absorption: flatBands(a),
    scattering: flatBands(s),
    isExample: role !== 'open',
  };
}
