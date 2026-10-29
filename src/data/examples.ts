import { makeDomain } from '../geometry/domain';
import { makeBoxMesh } from '../geometry/primitives';
import { flatBands } from '../solver/core/bands';
import { SCENE_SCHEMA_VERSION, type Scene } from '../types';
import { EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL } from './materials';

/** 장면에 들어가는 재료 목록 (예시 재료 + 소산 경계). */
const MATERIALS = [...EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL];
const OPEN = { type: 'open', materialId: 'open-boundary' } as const; // 소산 면
const REFLECT = { type: 'reflect', materialId: 'ex-reflective' } as const; // 반사 면

/** 예시 음원 스펙트럼: 전 밴드 Lw = 94 dB re 1 pW (평탄, 동작 확인용). */
const EXAMPLE_LW = flatBands(94);

/** 기본 수신 구 반경 [m]. 초기 가정이며 STEP 3에서 민감도 측정 후 확정. */
const DEFAULT_RECEIVER_RADIUS = 0.5;

/** 기본 장면: 10 × 10 × 10 m 정육면체 박스룸, 6면 모두 반사. */
export const boxRoomScene: Scene = {
  schemaVersion: SCENE_SCHEMA_VERSION,
  name: '박스 룸 (10 m 정육면체, 전 면 반사)',
  units: 'm',
  domain: makeDomain([10, 10, 10], REFLECT),
  meshes: [],
  materials: MATERIALS,
  sources: [{ kind: 'point', id: 's1', name: '점음원', position: [3, 3, 3], lw: EXAMPLE_LW }],
  receivers: [
    { id: 'r1', name: 'R1', position: [8, 7, 5], radius: DEFAULT_RECEIVER_RADIUS },
    { id: 'r2', name: 'R2', position: [6, 3, 3], radius: DEFAULT_RECEIVER_RADIUS },
  ],
};

/** 열린 공간: 바닥만 반사, 나머지 5면은 소산 (광선이 나가면 사라짐). */
export const openSpaceScene: Scene = {
  schemaVersion: SCENE_SCHEMA_VERSION,
  name: '열린 공간 (바닥 반사, 5면 소산)',
  units: 'm',
  domain: (() => {
    const d = makeDomain([20, 20, 10], OPEN, [-10, -10, 0]);
    d.faces.zmin = { ...REFLECT, materialId: 'ex-medium' };
    return d;
  })(),
  meshes: [],
  materials: MATERIALS,
  sources: [{ kind: 'point', id: 's1', name: '점음원', position: [0, 0, 1.5], lw: EXAMPLE_LW }],
  receivers: [
    { id: 'r1', name: 'R1 (2 m)', position: [2, 0, 1.5], radius: DEFAULT_RECEIVER_RADIUS },
    { id: 'r2', name: 'R2 (8 m)', position: [8, 0, 1.5], radius: DEFAULT_RECEIVER_RADIUS },
  ],
};

/** 자유장: 모든 면 소산. 거리 감쇠 해석해 검증용. */
export const freeFieldScene: Scene = {
  schemaVersion: SCENE_SCHEMA_VERSION,
  name: '자유장 (전 면 소산)',
  units: 'm',
  domain: makeDomain([20, 20, 20], OPEN, [-10, -10, -10]),
  meshes: [],
  materials: MATERIALS,
  sources: [{ kind: 'point', id: 's1', name: '점음원', position: [0, 0, 0], lw: EXAMPLE_LW }],
  receivers: [
    { id: 'r1', name: 'R1 (2 m)', position: [2, 0, 0], radius: DEFAULT_RECEIVER_RADIUS },
    { id: 'r2', name: 'R2 (4 m)', position: [4, 0, 0], radius: DEFAULT_RECEIVER_RADIUS },
    { id: 'r3', name: 'R3 (8 m)', position: [8, 0, 0], radius: DEFAULT_RECEIVER_RADIUS },
  ],
};

/** 차폐벽: 열린 공간 + 지면 위 높이 6 m 벽 (회절 시연). 벽은 0.4 m 두께의 박스. */
export const barrierScene: Scene = {
  schemaVersion: SCENE_SCHEMA_VERSION,
  name: '차폐벽 (열린 공간 + 벽, 회절)',
  units: 'm',
  domain: (() => {
    const d = makeDomain([40, 30, 15], OPEN, [-5, -15, 0]);
    d.faces.zmin = { ...REFLECT, materialId: 'ex-medium' };
    return d;
  })(),
  meshes: [makeBoxMesh('wall', '벽', [14.8, -8, 0], [15.2, 8, 6], 'ex-reflective')],
  materials: MATERIALS,
  sources: [{ kind: 'point', id: 's1', name: '점음원', position: [5, 0, 1.5], lw: EXAMPLE_LW }],
  receivers: [
    { id: 'r1', name: 'R1 (벽 앞)', position: [10, 0, 1.5], radius: DEFAULT_RECEIVER_RADIUS },
    { id: 'r2', name: 'R2 (벽 뒤)', position: [25, 0, 1.5], radius: DEFAULT_RECEIVER_RADIUS },
  ],
};

/** 첫 번째가 기본 장면 (박스룸). */
export const EXAMPLE_SCENES: readonly Scene[] = [
  boxRoomScene,
  openSpaceScene,
  barrierScene,
  freeFieldScene,
];
