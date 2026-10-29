import { describe, expect, it } from 'vitest';
import {
  boundingBox,
  diagonal,
  makeBoxMesh,
  makePlaneMesh,
  triangleCount,
} from '../../src/geometry/primitives';

/** 삼각형 i의 면적과 (비정규) 법선, 중심을 반환한다. */
function tri(mesh: ReturnType<typeof makeBoxMesh>, i: number) {
  const p = mesh.positions;
  const [a, b, c] = [0, 1, 2].map((k) => (mesh.indices[i * 3 + k] as number) * 3);
  const v = (o: number) => [p[o] as number, p[o + 1] as number, p[o + 2] as number];
  const [A, B, C] = [v(a as number), v(b as number), v(c as number)] as [
    number[],
    number[],
    number[],
  ];
  const e1 = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!];
  const e2 = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
  const n = [
    e1[1]! * e2[2]! - e1[2]! * e2[1]!,
    e1[2]! * e2[0]! - e1[0]! * e2[2]!,
    e1[0]! * e2[1]! - e1[1]! * e2[0]!,
  ];
  const centroid = [0, 1, 2].map((k) => (A[k]! + B[k]! + C[k]!) / 3);
  return { area: 0.5 * Math.hypot(n[0]!, n[1]!, n[2]!), n, centroid };
}

describe('기본 도형', () => {
  const box = makeBoxMesh('b', 'box', [0, 0, 0], [10, 8, 3], 'm');

  it('박스는 삼각형 12개, 꼭짓점 8개', () => {
    expect(triangleCount(box)).toBe(12);
    expect(box.positions.length / 3).toBe(8);
  });

  it('박스 총 면적 = 2(ab+bc+ca)', () => {
    let total = 0;
    for (let i = 0; i < 12; i++) total += tri(box, i).area;
    expect(total).toBeCloseTo(2 * (10 * 8 + 8 * 3 + 3 * 10), 4);
  });

  it('박스의 모든 삼각형 법선이 바깥쪽을 향한다', () => {
    const center = [5, 4, 1.5];
    for (let i = 0; i < 12; i++) {
      const { n, centroid } = tri(box, i);
      const dot = n.reduce((s, v, k) => s + v * (centroid[k]! - center[k]!), 0);
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('평면은 삼각형 2개, 면적 = 가로 × 세로, 법선 +z', () => {
    const plane = makePlaneMesh('g', 'ground', [0, 0, 0], 60, 40, 'm');
    expect(triangleCount(plane)).toBe(2);
    const t0 = tri(plane, 0);
    const t1 = tri(plane, 1);
    expect(t0.area + t1.area).toBeCloseTo(2400, 6);
    expect(t0.n[2]).toBeGreaterThan(0);
    expect(t1.n[2]).toBeGreaterThan(0);
  });

  it('바운딩 박스와 대각선', () => {
    const bb = boundingBox([box], [[12, 0, 0]]);
    expect(bb).not.toBeNull();
    expect(bb!.min).toEqual([0, 0, 0]);
    expect(bb!.max).toEqual([12, 8, 3]);
    expect(diagonal({ min: [0, 0, 0], max: [3, 4, 0] })).toBe(5);
    expect(boundingBox([])).toBeNull();
  });
});
