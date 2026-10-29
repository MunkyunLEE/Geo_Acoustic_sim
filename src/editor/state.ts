import { EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL } from '../data/materials';
import {
  BAND_CENTERS,
  SCENE_SCHEMA_VERSION,
  type MeshSurface,
  type PointSource,
  type Scene,
  type Vec3,
} from '../types';
import { makeObjectMaterial } from './materials';
import { objectMesh, transformPoint } from './transform';
import { IDENTITY_TRANSFORM, type EditorState, type ObjectRole, type SceneObject } from './types';

/** 메시를 바운딩 박스 중심 기준 국소 좌표로 옮긴 객체를 만든다 (기즈모 중심이 형상 중심이 되도록). */
export function objectFromMesh(
  id: string, // 객체 id
  mesh: MeshSurface, // 세계 좌표 메시
  role: ObjectRole = 'reflect', // 역할 프리셋
  name = mesh.name, // 표시 이름
): SceneObject {
  const p = mesh.positions;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[i + k]!);
      hi[k] = Math.max(hi[k]!, p[i + k]!);
    }
  }
  const c: Vec3 = p.length
    ? [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2]
    : [0, 0, 0];
  const local = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    local[i] = p[i]! - c[0];
    local[i + 1] = p[i + 1]! - c[1];
    local[i + 2] = p[i + 2]! - c[2];
  }
  return {
    id,
    name,
    role,
    base: { ...mesh, id, positions: local },
    transform: { ...IDENTITY_TRANSFORM, position: c },
    material: makeObjectMaterial(id, role),
    visible: true,
  };
}

/** 국소 형상(원점 중심)과 초기 변환으로 객체를 만든다 (박스·평면·원기둥용). */
export function objectFromShape(
  id: string,
  base: MeshSurface,
  name: string,
  role: ObjectRole,
  position: Vec3,
  scale: Vec3,
): SceneObject {
  return {
    id,
    name,
    role,
    base: { ...base, id },
    transform: { position, rotationDeg: [0, 0, 0], scale },
    material: makeObjectMaterial(id, role),
    visible: true,
  };
}

/** 편집기 상태를 계산용 Scene으로 변환한다. 객체 재료는 객체마다 따로 들어간다. */
export function toScene(s: EditorState): Scene {
  const solid = s.objects.filter((o) => !o.emitter); // 면음원은 음향적으로 투명
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    name: s.name,
    units: 'm',
    domain: s.domain,
    meshes: solid.map(objectMesh),
    materials: [...EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL, ...solid.map((o) => o.material)],
    sources: [...s.sources, ...emitterPoints(s)],
    receivers: s.receivers,
  };
}

/**
 * 면음원을 표본점(점음원)들로 바꾼다. 평면 객체의 국소 좌표 (−0.5..0.5)²를 nu × nv 칸으로 나눠 칸 중심에 놓고,
 * 면 전체 파워를 균등 분할한다 (점당 Lw = Lw − 10·log10(N)). 서로 비간섭으로 합산한다 (근사).
 */
export function emitterPoints(s: EditorState): PointSource[] {
  const out: PointSource[] = [];
  for (const o of s.objects) {
    const e = o.emitter;
    if (!e) continue;
    const n = e.nu * e.nv;
    const drop = 10 * Math.log10(n);
    const lw = {} as Record<number, number>;
    for (const f of BAND_CENTERS) lw[f] = e.lw[f] - drop;
    for (let j = 0; j < e.nv; j++)
      for (let i = 0; i < e.nu; i++)
        out.push({
          kind: 'point',
          id: `${o.id}#${j * e.nu + i + 1}`,
          name: `${o.name} ${j * e.nu + i + 1}/${n}`,
          position: transformPoint(o.transform, [
            (i + 0.5) / e.nu - 0.5,
            (j + 0.5) / e.nv - 0.5,
            0,
          ]),
          lw: lw as PointSource['lw'],
          samples: n,
        });
  }
  return out;
}

const ROLE_OF_MATERIAL: Record<string, ObjectRole> = {
  'ex-reflective': 'reflect',
  'ex-medium': 'obstacle',
  'ex-absorptive': 'absorber',
  'open-boundary': 'open',
};

/** 예시 장면(Scene)을 편집기 상태로 바꾼다. 메시마다 객체가 된다. */
export function stateFromScene(scene: Scene): EditorState {
  const objects = scene.meshes.map((m, i) => {
    const id = `obj${i + 1}`;
    const role = ROLE_OF_MATERIAL[m.materialId] ?? 'custom';
    const o = objectFromMesh(id, m, role, m.name);
    const mat = scene.materials.find((x) => x.id === m.materialId);
    if (mat) o.material = { ...mat, id: `mat-${id}`, name: mat.name };
    return o;
  });
  return {
    name: scene.name,
    domain: scene.domain,
    objects,
    sources: scene.sources.filter((x): x is PointSource => x.kind === 'point'),
    receivers: scene.receivers,
  };
}

/** 다음 객체 id (obj1, obj2, ...). 기존 id와 겹치지 않는다. */
export function nextObjectId(objects: readonly SceneObject[]): string {
  let n = objects.length + 1;
  while (objects.some((o) => o.id === `obj${n}`)) n++;
  return `obj${n}`;
}

// ---- 장면 JSON 저장/불러오기 ----
const FILE_KIND = 'acoustic-simulator-scene';
const FILE_VERSION = 1;

/** 편집기 상태를 JSON 문자열로 직렬화한다 (형상은 국소 좌표 그대로). */
export function serializeState(s: EditorState): string {
  return JSON.stringify({
    kind: FILE_KIND,
    version: FILE_VERSION,
    state: {
      ...s,
      objects: s.objects.map((o) => ({
        ...o,
        base: {
          ...o.base,
          positions: Array.from(o.base.positions),
          indices: Array.from(o.base.indices),
        },
      })),
    },
  });
}

/** JSON 문자열에서 편집기 상태를 복원한다. 형식이 맞지 않으면 예외를 던진다. */
export function parseState(text: string): EditorState {
  const j = JSON.parse(text) as { kind?: string; version?: number; state?: EditorState };
  if (j.kind !== FILE_KIND || j.version !== FILE_VERSION || !j.state) {
    throw new Error('이 앱의 장면 파일이 아닙니다.');
  }
  const st = j.state;
  const objects = (st.objects ?? []).map((o) => ({
    ...o,
    base: {
      ...o.base,
      positions: Float32Array.from(o.base.positions as unknown as number[]),
      indices: Uint32Array.from(o.base.indices as unknown as number[]),
    },
  }));
  return { ...st, objects };
}
