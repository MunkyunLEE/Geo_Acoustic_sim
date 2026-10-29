import type { MeshSurface, Vec3 } from '../types';
import type { SceneObject, Transform } from './types';

const RAD = Math.PI / 180;

/** Euler XYZ(three.js 규약) 회전 행렬. R = Rx · Ry · Rz. 행 우선 9개. */
export function rotationMatrix(deg: Vec3): number[] {
  const [a, b, c] = [deg[0] * RAD, deg[1] * RAD, deg[2] * RAD];
  const [ca, sa, cb, sb, cc, sc] = [
    Math.cos(a),
    Math.sin(a),
    Math.cos(b),
    Math.sin(b),
    Math.cos(c),
    Math.sin(c),
  ];
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ]; // prettier-ignore
}

/** 국소 점을 세계 좌표로 변환한다. */
export function transformPoint(t: Transform, p: Vec3): Vec3 {
  const r = rotationMatrix(t.rotationDeg);
  const s: Vec3 = [p[0] * t.scale[0], p[1] * t.scale[1], p[2] * t.scale[2]];
  return [
    r[0]! * s[0] + r[1]! * s[1] + r[2]! * s[2] + t.position[0],
    r[3]! * s[0] + r[4]! * s[1] + r[5]! * s[2] + t.position[1],
    r[6]! * s[0] + r[7]! * s[1] + r[8]! * s[2] + t.position[2],
  ];
}

/** 객체의 세계 좌표 메시. 재료 id는 객체 재료를 가리킨다. */
export function objectMesh(o: SceneObject): MeshSurface {
  const src = o.base.positions;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const w = transformPoint(o.transform, [src[i]!, src[i + 1]!, src[i + 2]!]);
    out[i] = w[0];
    out[i + 1] = w[1];
    out[i + 2] = w[2];
  }
  return {
    id: o.id,
    name: o.name,
    positions: out,
    indices: o.base.indices,
    materialId: o.material.id,
  };
}
