import { makeDomain } from '../geometry/domain';
import { boundingBox } from '../geometry/primitives';
import { flatBands } from '../solver/core/bands';
import { SCENE_SCHEMA_VERSION, type MeshSurface, type Scene, type Vec3 } from '../types';
import { EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL } from './materials';

/**
 * 임포트한 메시로 장면을 만든다. 해석 영역은 메시 바운딩 박스를 사방으로 넓힌 박스이고,
 * 바닥만 반사, 나머지 5면은 소산(열린 공간)이다. 음원은 메시 중심, 수신점은 X 방향으로 약간 옆.
 */
export function sceneFromMesh(mesh: MeshSurface): Scene {
  const box = boundingBox([mesh]) ?? { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 };
  const ext = [0, 1, 2].map((i) => box.max[i]! - box.min[i]!);
  const pad = Math.max(...ext, 1) * 0.5; // 사방 여유 [m]
  const origin: Vec3 = [box.min[0] - pad, box.min[1] - pad, box.min[2]];
  const size: Vec3 = [ext[0]! + 2 * pad, ext[1]! + 2 * pad, ext[2]! + pad];
  const domain = makeDomain(size, { type: 'open', materialId: OPEN_BOUNDARY_MATERIAL.id }, origin);
  domain.faces.zmin = { type: 'reflect', materialId: 'ex-medium' };
  const c: Vec3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    box.min[2] + Math.min(1.5, ext[2]! / 2),
  ];
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    name: `가져옴: ${mesh.name}`,
    units: 'm',
    domain,
    meshes: [mesh],
    materials: [...EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL],
    sources: [
      {
        kind: 'point',
        id: 's1',
        name: '점음원',
        position: [c[0] - ext[0]! * 0.35 - 0.5, c[1], c[2]],
        lw: flatBands(94),
      },
    ],
    receivers: [
      { id: 'r1', name: 'R1', position: [c[0] + ext[0]! * 0.35 + 0.5, c[1], c[2]], radius: 0.5 },
    ],
  };
}
