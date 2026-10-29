import { flatBands } from '../solver/core/bands';
import type { Domain, PointSource, Receiver, Vec3 } from '../types';
import { makeObjectMaterial } from './materials';
import { extrudePolyline, polygonFace, unitBox, unitCylinder, unitPlane, type Pt2 } from './shapes';
import { nextObjectId, objectFromMesh, objectFromShape } from './state';
import type { EditorState, EmitterSpec, ObjectRole, SceneObject, Transform } from './types';

export type PrimitiveKind = 'box' | 'plane' | 'cylinder' | 'open-cylinder' | 'area-source';

const PRIMITIVE_NAME: Record<PrimitiveKind, string> = {
  box: '박스',
  plane: '평면(서페이스)',
  cylinder: '원기둥',
  'open-cylinder': '원통(열린 서페이스)',
  'area-source': '면음원',
};

const domainCenter = (d: Domain): Vec3 => [
  (d.min[0] + d.max[0]) / 2,
  (d.min[1] + d.max[1]) / 2,
  (d.min[2] + d.max[2]) / 2,
];

/** 기본 도형을 해석 영역 중앙 바닥 위에 추가한다. 평면은 세워진 벽(4 × 3 m)이다. */
export function addPrimitive(
  s: EditorState,
  kind: PrimitiveKind,
  role: ObjectRole = 'reflect',
): { state: EditorState; id: string } {
  const id = nextObjectId(s.objects);
  const c = domainCenter(s.domain);
  const z0 = s.domain.min[2];
  const name = `${PRIMITIVE_NAME[kind]} ${s.objects.length + 1}`;
  let o: SceneObject;
  if (kind === 'box')
    o = objectFromShape(id, unitBox(), name, role, [c[0], c[1], z0 + 1], [2, 2, 2]);
  else if (kind === 'plane') {
    o = objectFromShape(id, unitPlane(), name, role, [c[0], c[1], z0 + 1.5], [4, 3, 1]);
    o.transform = { ...o.transform, rotationDeg: [90, 0, 0] };
  } else if (kind === 'area-source') {
    o = objectFromShape(id, unitPlane(), name, 'emitter', [c[0], c[1], z0 + 1.5], [3, 2, 1]);
    o.transform = { ...o.transform, rotationDeg: [90, 0, 0] };
    o.emitter = { lw: flatBands(94), nu: 3, nv: 3 };
  } else
    o = objectFromShape(
      id,
      unitCylinder(24, kind === 'cylinder'),
      name,
      role,
      [c[0], c[1], z0 + 1.5],
      [2, 2, 3],
    );
  return { state: { ...s, objects: [...s.objects, o] }, id };
}

export interface DrawOptions {
  points: Pt2[]; // 폴리라인 점 [m]
  z: number; // 그리는 높이 [m]
  height: number; // extrude 높이 [m] (면 만들기면 무시)
  closed: boolean; // 닫힌 폴리라인
  capBottom: boolean;
  capTop: boolean;
  asFace: boolean; // true면 extrude 없이 닫힌 다각형 한 장 면
  role: ObjectRole;
}

/** 폴리라인에서 객체를 만든다. 점이 부족하거나 높이가 0 이하면 null. */
export function finishDraw(
  s: EditorState,
  o: DrawOptions,
): { state: EditorState; id: string } | null {
  const minPts = o.asFace || o.closed ? 3 : 2;
  if (o.points.length < minPts) return null;
  if (!o.asFace && !(o.height > 0)) return null;
  const mesh = o.asFace
    ? polygonFace(o.points, o.z)
    : extrudePolyline(o.points, o.z, o.height, {
        closed: o.closed,
        capBottom: o.capBottom,
        capTop: o.capTop,
      });
  const id = nextObjectId(s.objects);
  const name = `${o.asFace ? '면' : o.closed ? '압출 건물' : '압출 벽'} ${s.objects.length + 1}`;
  const obj = objectFromMesh(id, mesh, o.role, name);
  return { state: { ...s, objects: [...s.objects, obj] }, id };
}

export function updateObject(s: EditorState, id: string, patch: Partial<SceneObject>): EditorState {
  return { ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) };
}

export function setTransform(s: EditorState, id: string, t: Transform): EditorState {
  return updateObject(s, id, { transform: t });
}

/** 역할 프리셋을 적용한다 (재료 값이 프리셋 값으로 바뀐다). custom이면 현재 값 유지. */
export function setRole(s: EditorState, id: string, role: ObjectRole): EditorState {
  const o = s.objects.find((x) => x.id === id);
  if (!o) return s;
  const material =
    role === 'custom' ? { ...o.material, name: '사용자 정의' } : makeObjectMaterial(id, role);
  return updateObject(s, id, { role, material });
}

/** 한 밴드의 흡음률/산란 계수를 바꾸면 역할은 custom이 된다. */
export function setMaterialBand(
  s: EditorState,
  id: string,
  field: 'absorption' | 'scattering' | 'transmission',
  band: number,
  value: number,
): EditorState {
  const o = s.objects.find((x) => x.id === id);
  if (!o) return s;
  const v = Math.min(1, Math.max(0, value));
  const mat = o.material;
  const cur = { ...(mat.transmission ?? flatBands(0)) } as Record<number, number>;
  const alphas = { ...mat.absorption } as Record<number, number>;
  if (field === 'transmission') cur[band] = Math.min(v, 1 - alphas[band]!); // α + τ ≤ 1
  if (field === 'absorption') {
    alphas[band] = v;
    cur[band] = Math.min(cur[band] ?? 0, 1 - v);
  }
  const material = {
    ...mat,
    name: '사용자 정의',
    absorption: alphas as typeof mat.absorption,
    transmission: cur as typeof mat.absorption,
    ...(field === 'scattering' ? { scattering: { ...mat.scattering, [band]: v } } : {}),
  };
  return updateObject(s, id, { role: 'custom', material });
}

export function duplicateObject(
  s: EditorState,
  id: string,
): { state: EditorState; id: string } | null {
  const o = s.objects.find((x) => x.id === id);
  if (!o) return null;
  const nid = nextObjectId(s.objects);
  const copy: SceneObject = {
    ...o,
    id: nid,
    name: `${o.name} 복제`,
    base: { ...o.base, id: nid },
    transform: {
      ...o.transform,
      position: [o.transform.position[0] + 1, o.transform.position[1] + 1, o.transform.position[2]],
    },
    material: { ...o.material, id: `mat-${nid}` },
  };
  return { state: { ...s, objects: [...s.objects, copy] }, id: nid };
}

export function removeObject(s: EditorState, id: string): EditorState {
  return { ...s, objects: s.objects.filter((o) => o.id !== id) };
}

const nextId = (prefix: string, ids: readonly string[]): string => {
  let n = ids.length + 1;
  while (ids.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

export function addSource(s: EditorState): { state: EditorState; id: string } {
  const id = nextId(
    's',
    s.sources.map((x) => x.id),
  );
  const c = domainCenter(s.domain);
  const src: PointSource = {
    kind: 'point',
    id,
    name: `음원 ${s.sources.length + 1}`,
    position: [c[0], c[1], c[2]],
    lw: flatBands(94),
  };
  return { state: { ...s, sources: [...s.sources, src] }, id };
}

export function addReceiver(s: EditorState): { state: EditorState; id: string } {
  const id = nextId(
    'r',
    s.receivers.map((x) => x.id),
  );
  const c = domainCenter(s.domain);
  const r: Receiver = {
    id,
    name: `R${s.receivers.length + 1}`,
    position: [c[0] + 1, c[1], c[2]],
    radius: 0.5,
  };
  return { state: { ...s, receivers: [...s.receivers, r] }, id };
}

export function updateSource(s: EditorState, id: string, patch: Partial<PointSource>): EditorState {
  return { ...s, sources: s.sources.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

export function updateReceiver(s: EditorState, id: string, patch: Partial<Receiver>): EditorState {
  return { ...s, receivers: s.receivers.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

export const removeSource = (s: EditorState, id: string): EditorState => ({
  ...s,
  sources: s.sources.filter((x) => x.id !== id),
});
export const removeReceiver = (s: EditorState, id: string): EditorState => ({
  ...s,
  receivers: s.receivers.filter((x) => x.id !== id),
});

/** 면음원 설정(Lw, 표본점 수)을 바꾼다. 표본점 수는 1~5로 제한. */
export function setEmitter(s: EditorState, id: string, patch: Partial<EmitterSpec>): EditorState {
  const o = s.objects.find((x) => x.id === id);
  if (!o?.emitter) return s;
  const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));
  const e = { ...o.emitter, ...patch };
  return updateObject(s, id, { emitter: { ...e, nu: clamp(e.nu), nv: clamp(e.nv) } });
}
