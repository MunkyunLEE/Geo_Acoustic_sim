import { makeDomainMeshes } from '../../geometry/domain';
import {
  BAND_CENTERS,
  type BandCenter,
  type Material,
  type MeshSurface,
  type PerBand,
  type Scene,
  type Vec3,
} from '../../types';
import { buildBvh, bvhEpsilon, type Bvh } from '../tracing/bvh';
import { perBand } from './bands';

/** 정반사 가능한 평면 한 장. 같은 평면·같은 재료의 삼각형을 묶는다. */
export interface ReflectorPlane {
  n: Vec3; // 단위 법선 (부호는 임의, 양면 처리)
  d: number; // 평면 방정식 n·x = d
  refl: PerBand<number>; // 정반사 에너지 계수 (1 − α)(1 − s)
  materialId: string;
  tris: Float64Array; // 삼각형당 v0(3), e1(3), e2(3)
  triCount: number;
}

/** 계산에 쓰는 형태로 컴파일한 장면. 영역 면 6개(12 삼각형)가 먼저, 객체가 뒤에 온다. */
export interface CompiledScene {
  scene: Scene;
  allMeshes: MeshSurface[]; // 영역 면 + 객체
  bvhAll: Bvh; // 영역 면 + 객체 (파면 추적, 반사 평면 소속 판정)
  bvhObjects: Bvh | null; // 객체만 (차폐·가시선·회절 판정). 객체가 없으면 null
  materialOfTri: Material[]; // bvhAll의 전체 삼각형 번호 → 재료
  planes: ReflectorPlane[]; // 반사 계수가 0이 아닌 평면
  triPlane: Int32Array; // 전체 삼각형 번호 → planes 인덱스, 반사하지 않으면 -1
  triNormal: Float32Array; // 전체 삼각형 번호 → 단위 법선 (3개씩, 퇴화면은 0,0,1)
  eps: number; // 자기 교차 방지 오프셋 [m]
  diag: number; // 영역 대각선 [m]
  objTrans: Float32Array; // 객체 삼각형(bvhObjects 번호)별 밴드 투과율 τ (삼각형당 6개)
  triArea: Float32Array; // 전체 삼각형 번호 → 면적 [m²]
}

/** 재료의 투과율 τ(f). 지정하지 않으면 0 (투과 없음). */
export function transmissionOf(m: Material, fc: BandCenter): number {
  return m.transmission?.[fc] ?? 0;
}

/** 정반사 에너지 계수 (1 − α − τ)(1 − s). 산란분(s)은 확산 반사(몬테카를로)가 다룬다. */
export function specularFactor(m: Material): PerBand<number> {
  return perBand(
    (fc) => Math.max(0, 1 - m.absorption[fc] - transmissionOf(m, fc)) * (1 - m.scattering[fc]),
  );
}

const q = (v: number, k: number) => Math.round(v * k); // 평면 묶음용 양자화

export function compileScene(scene: Scene): CompiledScene {
  const allMeshes = [...makeDomainMeshes(scene.domain), ...scene.meshes];
  const bvhAll = buildBvh(allMeshes);
  const bvhObjects = scene.meshes.length > 0 ? buildBvh(scene.meshes) : null;
  const matById = new Map(scene.materials.map((m) => [m.id, m]));
  const diag = Math.hypot(
    scene.domain.max[0] - scene.domain.min[0],
    scene.domain.max[1] - scene.domain.min[1],
    scene.domain.max[2] - scene.domain.min[2],
  );

  const materialOfTri: Material[] = [];
  const triPlane: number[] = [];
  const triNormal: number[] = [];
  const triArea: number[] = [];
  const planes: ReflectorPlane[] = [];
  const planeIndex = new Map<string, number>();
  const planeTris: number[][] = [];

  for (const mesh of allMeshes) {
    const mat = matById.get(mesh.materialId);
    if (!mat) throw new Error(`재료를 찾을 수 없습니다: ${mesh.materialId}`);
    const refl = specularFactor(mat);
    const reflective = BAND_CENTERS.some((fc) => refl[fc] > 0);
    const p = mesh.positions;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      materialOfTri.push(mat);
      const a = mesh.indices[t]! * 3,
        b = mesh.indices[t + 1]! * 3,
        c = mesh.indices[t + 2]! * 3;
      const v0: Vec3 = [p[a]!, p[a + 1]!, p[a + 2]!];
      const e1: Vec3 = [p[b]! - v0[0], p[b + 1]! - v0[1], p[b + 2]! - v0[2]];
      const e2: Vec3 = [p[c]! - v0[0], p[c + 1]! - v0[1], p[c + 2]! - v0[2]];
      let n: Vec3 = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const len = Math.hypot(n[0], n[1], n[2]);
      triArea.push(len / 2);
      if (len < 1e-12) triNormal.push(0, 0, 1);
      else triNormal.push(n[0] / len, n[1] / len, n[2] / len);
      if (!reflective || len < 1e-12) {
        triPlane.push(-1);
        continue;
      }
      n = [n[0] / len, n[1] / len, n[2] / len];
      const lead = Math.abs(n[0]) > 1e-9 ? n[0] : Math.abs(n[1]) > 1e-9 ? n[1] : n[2];
      if (lead < 0) n = [-n[0], -n[1], -n[2]]; // 부호 정규화
      const d = n[0] * v0[0] + n[1] * v0[1] + n[2] * v0[2];
      const key = `${q(n[0], 1e5)},${q(n[1], 1e5)},${q(n[2], 1e5)},${q(d, 1e4)},${mesh.materialId}`;
      let idx = planeIndex.get(key);
      if (idx === undefined) {
        idx = planes.length;
        planeIndex.set(key, idx);
        planes.push({
          n,
          d,
          refl,
          materialId: mesh.materialId,
          tris: new Float64Array(0),
          triCount: 0,
        });
        planeTris.push([]);
      }
      planeTris[idx]!.push(...v0, ...e1, ...e2);
      triPlane.push(idx);
    }
  }
  planes.forEach((pl, i) => {
    pl.tris = new Float64Array(planeTris[i]!);
    pl.triCount = pl.tris.length / 9;
  });

  const objTrans: number[] = [];
  for (const mesh of scene.meshes) {
    const mat = matById.get(mesh.materialId)!;
    for (let t = 0; t < mesh.indices.length; t += 3)
      for (const fc of BAND_CENTERS) objTrans.push(transmissionOf(mat, fc));
  }

  return {
    scene,
    allMeshes,
    bvhAll,
    bvhObjects,
    materialOfTri,
    planes,
    triPlane: Int32Array.from(triPlane),
    triNormal: Float32Array.from(triNormal),
    eps: bvhEpsilon(bvhAll),
    diag,
    objTrans: Float32Array.from(objTrans),
    triArea: Float32Array.from(triArea),
  };
}
