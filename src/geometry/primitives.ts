import type { MeshSurface, Vec3 } from '../types';

/** 축 정렬 박스 (12 삼각형, 법선이 바깥쪽을 향하는 반시계 감김). */
export function makeBoxMesh(
  id: string,
  name: string,
  min: Vec3, // 최소 모서리 [m]
  max: Vec3, // 최대 모서리 [m]
  materialId: string,
): MeshSurface {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  // prettier-ignore
  const positions = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, // v0..v3 (아래)
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, // v4..v7 (위)
  ]);
  // prettier-ignore
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // 아래 (-z)
    4, 5, 6, 4, 6, 7, // 위 (+z)
    0, 1, 5, 0, 5, 4, // 앞 (-y)
    2, 3, 7, 2, 7, 6, // 뒤 (+y)
    0, 4, 7, 0, 7, 3, // 왼쪽 (-x)
    1, 2, 6, 1, 6, 5, // 오른쪽 (+x)
  ]);
  return { id, name, positions, indices, materialId };
}

/** 수평 평면 (법선 +z, 삼각형 2개). 지면 등에 사용. */
export function makePlaneMesh(
  id: string,
  name: string,
  center: Vec3, // 평면 중심 [m]
  sizeX: number, // X 방향 길이 [m]
  sizeY: number, // Y 방향 길이 [m]
  materialId: string,
): MeshSurface {
  const [cx, cy, cz] = center;
  const hx = sizeX / 2;
  const hy = sizeY / 2;
  // prettier-ignore
  const positions = new Float32Array([
    cx - hx, cy - hy, cz, cx + hx, cy - hy, cz, cx + hx, cy + hy, cz, cx - hx, cy + hy, cz,
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { id, name, positions, indices, materialId };
}

export function triangleCount(mesh: MeshSurface): number {
  return mesh.indices.length / 3;
}

/** 여러 메시와 추가 점들의 바운딩 박스. 비어 있으면 null. */
export function boundingBox(
  meshes: readonly MeshSurface[],
  extraPoints: readonly Vec3[] = [],
): { min: Vec3; max: Vec3 } | null {
  let lo: [number, number, number] = [Infinity, Infinity, Infinity];
  let hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let any = false;
  const add = (x: number, y: number, z: number) => {
    lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
    hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
    any = true;
  };
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i += 3)
      add(m.positions[i] as number, m.positions[i + 1] as number, m.positions[i + 2] as number);
  }
  for (const [x, y, z] of extraPoints) add(x, y, z);
  return any ? { min: lo, max: hi } : null;
}

/** 바운딩 박스 대각선 길이 [m]. 장면 스케일(ε 등)의 기준. */
export function diagonal(box: { min: Vec3; max: Vec3 }): number {
  return Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
}
