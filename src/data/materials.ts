import { flatBands } from '../solver/core/bands';
import type { Material } from '../types';

/**
 * 예시 재료. 계수는 동작 확인용 단순 값이며 실측 데이터가 아니다.
 * 신뢰할 수 있는 밴드별 데이터가 확보되면 교체한다 (결정 D5).
 */
export const EXAMPLE_MATERIALS: Material[] = [
  {
    id: 'ex-reflective',
    name: '예시: 반사성 면 (α=0.05)',
    absorption: flatBands(0.05),
    scattering: flatBands(0.1),
    isExample: true,
  },
  {
    id: 'ex-medium',
    name: '예시: 중간 흡음 (α=0.30)',
    absorption: flatBands(0.3),
    scattering: flatBands(0.2),
    isExample: true,
  },
  {
    id: 'ex-absorptive',
    name: '예시: 높은 흡음 (α=0.80)',
    absorption: flatBands(0.8),
    scattering: flatBands(0.2),
    isExample: true,
  },
];

/** 소산 경계용 재료 id. 열린 공간 경계는 이 재료(α=1)로 처리한다. */
export const OPEN_MATERIAL_ID = 'open-boundary';

/** 소산 경계: 흡음 100 %, 반사·산란 없음. 실측 재료가 아니라 경계 조건이다. */
export const OPEN_BOUNDARY_MATERIAL: Material = {
  id: OPEN_MATERIAL_ID,
  name: '소산 경계 (열린 공간, α=1)',
  absorption: flatBands(1),
  scattering: flatBands(0),
  isExample: false,
};
