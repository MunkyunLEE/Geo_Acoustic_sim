import { describe, expect, it } from 'vitest';
import { meshArea, unitBox, unitCylinder } from '../../src/editor/shapes';
import {
  faceTriangles,
  getWeld,
  groupsCentroid,
  groupsOfTriangles,
  moveGroups,
  nearestEdge,
} from '../../src/editor/subedit';

const box = unitBox();

describe('꼭짓점·모서리·면 편집', () => {
  it('박스는 꼭짓점 8개, 용접 후에도 8개', () => {
    expect(getWeld(box).groups.length).toBe(8);
  });
  it('삼각형마다 꼭짓점이 따로인 메시(STL형)도 8개로 용접된다', () => {
    const idx = Array.from(box.indices);
    const pos: number[] = [];
    const ind: number[] = [];
    idx.forEach((v, i) => {
      pos.push(box.positions[v * 3]!, box.positions[v * 3 + 1]!, box.positions[v * 3 + 2]!);
      ind.push(i);
    });
    const soup = { ...box, positions: Float32Array.from(pos), indices: Uint32Array.from(ind) };
    expect(getWeld(soup).groups.length).toBe(8);
  });
  it('면 선택: 박스 한 면 = 삼각형 2개, 꼭짓점 4개', () => {
    const w = getWeld(box);
    const f = faceTriangles(box, w, 0);
    expect(f.length).toBe(2);
    expect(groupsOfTriangles(box, w, f).length).toBe(4);
  });
  it('원기둥 옆면 삼각형 하나는 같은 평면이 아니므로 면이 1~2개만 묶인다 (곡면은 쪼개짐)', () => {
    const cyl = unitCylinder(24, true);
    const f = faceTriangles(cyl, getWeld(cyl), 0);
    expect(f.length).toBeLessThanOrEqual(2);
  });
  it('면을 법선 방향으로 밀면 반대편은 그대로, 면적은 직육면체 공식', () => {
    const w = getWeld(box);
    const top = faceTriangles(box, w, 2); // 삼각형 2,3 = 위(+z)
    const g = groupsOfTriangles(box, w, top);
    const moved = moveGroups(box, w, g, [0, 0, 1]); // 위 면을 +z로 1 m
    const zs = Array.from(moved.positions).filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(1.5, 6);
    expect(Math.min(...zs)).toBeCloseTo(-0.5, 6);
    expect(meshArea(moved)).toBeCloseTo(2 * 1 + 4 * 2, 5); // 바닥·윗면 1×1 + 옆 4면 1×2
    expect(Array.from(box.positions)[2]).toBeCloseTo(-0.5, 8); // 원본 불변
  });
  it('꼭짓점 하나를 당기면 그 그룹의 모든 중복 꼭짓점이 같이 움직인다', () => {
    const soup = (() => {
      const pos: number[] = [];
      const ind: number[] = [];
      Array.from(box.indices).forEach((v, i) => {
        pos.push(box.positions[v * 3]!, box.positions[v * 3 + 1]!, box.positions[v * 3 + 2]!);
        ind.push(i);
      });
      return { ...box, positions: Float32Array.from(pos), indices: Uint32Array.from(ind) };
    })();
    const w = getWeld(soup);
    const moved = moveGroups(soup, w, [0], [0.3, 0, 0]);
    const w2 = getWeld(moved);
    expect(w2.groups.length).toBe(8); // 갈라지지 않음
  });
  it('모서리 선택: 삼각형 위 점에 가장 가까운 모서리', () => {
    const w = getWeld(box);
    const [a, b] = nearestEdge(box, w, 0, [0, -0.5, -0.5]);
    expect(a).not.toBe(b);
    const c = groupsCentroid(box, w, [a, b])!;
    expect(c[1]).toBeCloseTo(-0.5, 6); // 앞(−y) 면의 모서리 중 하나가 선택됨 또는 인접
  });
  it('선택 중심', () => {
    const w = getWeld(box);
    const all = w.groups.map((_, i) => i);
    const c = groupsCentroid(box, w, all)!;
    expect(c[0]).toBeCloseTo(0, 6);
    expect(groupsCentroid(box, w, [])).toBeNull();
  });
});
