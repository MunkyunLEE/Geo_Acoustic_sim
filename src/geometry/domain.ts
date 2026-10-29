import {
  FACE_IDS,
  type Domain,
  type DomainFace,
  type FaceId,
  type MeshSurface,
  type Vec3,
} from '../types';
import { OPEN_MATERIAL_ID } from '../data/materials';

export const FACE_LABELS: Record<FaceId, string> = {
  xmin: '−X 면',
  xmax: '+X 면',
  ymin: '−Y 면',
  ymax: '+Y 면',
  zmin: '−Z 면 (바닥)',
  zmax: '+Z 면 (천장)',
};

/** 기본 해석 영역: 한 변 size [m]의 정육면체, 바닥 모서리가 원점. 면은 모두 같은 경계 조건. */
export function makeDomain(
  size: Vec3, // 가로·세로·높이 [m]
  face: DomainFace, // 모든 면에 줄 경계 조건
  origin: Vec3 = [0, 0, 0], // 최소 모서리 [m]
): Domain {
  const faces = {} as Record<FaceId, DomainFace>;
  for (const f of FACE_IDS) faces[f] = { ...face };
  return {
    min: origin,
    max: [origin[0] + size[0], origin[1] + size[1], origin[2] + size[2]],
    faces,
  };
}

/** 면의 네 모서리 (xyz 순서 보장 없이 사각형 순환 순서). */
function faceCorners(d: Domain, f: FaceId): Vec3[] {
  const [x0, y0, z0] = d.min;
  const [x1, y1, z1] = d.max;
  switch (f) {
    case 'xmin':
      return [
        [x0, y0, z0],
        [x0, y1, z0],
        [x0, y1, z1],
        [x0, y0, z1],
      ];
    case 'xmax':
      return [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ];
    case 'ymin':
      return [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ];
    case 'ymax':
      return [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ];
    case 'zmin':
      return [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ];
    case 'zmax':
      return [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ];
  }
}

/** 해석 영역의 6개 면을 메시(사각형 2삼각형)로 만든다. 소산 면은 소산 재료를 쓴다. */
export function makeDomainMeshes(d: Domain): MeshSurface[] {
  return FACE_IDS.map((f) => {
    const c = faceCorners(d, f);
    const positions = new Float32Array(c.flat());
    return {
      id: `domain-${f}`,
      name: `영역 ${f}`,
      positions,
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      materialId: d.faces[f].type === 'open' ? OPEN_MATERIAL_ID : d.faces[f].materialId,
    };
  });
}

/** 영역 안에 점이 들어 있는지 (경계 포함). */
export function insideDomain(d: Domain, p: Vec3): boolean {
  return p.every((v, i) => v >= d.min[i]! && v <= d.max[i]!);
}

/** 점을 영역 안으로 밀어 넣는다. */
export function clampToDomain(d: Domain, p: Vec3): Vec3 {
  return [0, 1, 2].map((i) => Math.min(d.max[i]!, Math.max(d.min[i]!, p[i]!))) as unknown as Vec3;
}
