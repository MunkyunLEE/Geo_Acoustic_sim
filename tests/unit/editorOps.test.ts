import { describe, expect, it } from 'vitest';
import { boxRoomScene } from '../../src/data/examples';
import {
  addPrimitive,
  addReceiver,
  addSource,
  duplicateObject,
  finishDraw,
  removeObject,
  setMaterialBand,
  setRole,
} from '../../src/editor/ops';
import { meshArea } from '../../src/editor/shapes';
import { stateFromScene, toScene } from '../../src/editor/state';
import { objectMesh } from '../../src/editor/transform';
import { validateScene, hasErrors } from '../../src/solver/core/validation';

const base = () => stateFromScene(boxRoomScene);
const draw = {
  z: 0,
  height: 3,
  closed: false,
  capBottom: false,
  capTop: false,
  asFace: false,
  role: 'reflect' as const,
};

describe('편집 연산', () => {
  it('박스 추가 → 영역 중앙 바닥 위, 면적 24, 장면 검증 통과', () => {
    const { state, id } = addPrimitive(base(), 'box');
    const o = state.objects.find((x) => x.id === id)!;
    expect(o.transform.position).toEqual([5, 5, 1]);
    expect(meshArea(objectMesh(o))).toBeCloseTo(24, 4);
    expect(hasErrors(validateScene(toScene(state)))).toBe(false);
  });
  it('평면은 열린 서페이스(삼각형 2개)이고 세워진 벽 4×3', () => {
    const { state, id } = addPrimitive(base(), 'plane');
    const m = objectMesh(state.objects.find((x) => x.id === id)!);
    expect(m.indices.length / 3).toBe(2);
    expect(meshArea(m)).toBeCloseTo(12, 4);
    const zs = Array.from(m.positions).filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(3, 4);
  });
  it('열린 폴리라인 extrude → 객체, 점 부족/높이 0은 null', () => {
    const ok = finishDraw(base(), {
      ...draw,
      points: [
        [1, 1],
        [6, 1],
        [6, 4],
      ],
    });
    expect(ok).not.toBeNull();
    expect(meshArea(objectMesh(ok!.state.objects[0]!))).toBeCloseTo((5 + 3) * 3, 4);
    expect(finishDraw(base(), { ...draw, points: [[1, 1]] })).toBeNull();
    expect(
      finishDraw(base(), {
        ...draw,
        points: [
          [1, 1],
          [2, 2],
        ],
        height: 0,
      }),
    ).toBeNull();
    expect(
      finishDraw(base(), {
        ...draw,
        closed: true,
        points: [
          [1, 1],
          [2, 2],
        ],
      }),
    ).toBeNull();
  });
  it('닫힌 폴리라인 면(asFace) → 높이 z의 한 장 면', () => {
    const r = finishDraw(base(), {
      ...draw,
      asFace: true,
      z: 2,
      points: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })!;
    const m = objectMesh(r.state.objects[0]!);
    expect(meshArea(m)).toBeCloseTo(12, 5);
    expect(new Set(Array.from(m.positions).filter((_, i) => i % 3 === 2))).toEqual(new Set([2]));
  });
  it('역할 변경 → 프리셋 값, 밴드 값 수정 → custom, 범위 0~1로 제한', () => {
    const { state, id } = addPrimitive(base(), 'box');
    const s1 = setRole(state, id, 'open');
    expect(s1.objects[0]!.material.absorption[1000]).toBe(1);
    const s2 = setMaterialBand(s1, id, 'absorption', 1000, 1.7);
    expect(s2.objects[0]!.role).toBe('custom');
    expect(s2.objects[0]!.material.absorption[1000]).toBe(1);
    expect(s2.objects[0]!.material.absorption[500]).toBe(1);
    const s3 = setMaterialBand(s2, id, 'absorption', 500, 0.25);
    expect(s3.objects[0]!.material.absorption[500]).toBe(0.25);
  });
  it('복제는 새 id·재료 id를 갖고 원본은 그대로, 삭제하면 사라진다', () => {
    const { state, id } = addPrimitive(base(), 'box');
    const d = duplicateObject(state, id)!;
    expect(d.state.objects.length).toBe(2);
    expect(new Set(d.state.objects.map((o) => o.material.id)).size).toBe(2);
    expect(hasErrors(validateScene(toScene(d.state)))).toBe(false);
    expect(removeObject(d.state, d.id).objects.length).toBe(1);
  });
  it('음원·수신점 추가는 id가 겹치지 않는다', () => {
    const a = addSource(base());
    const b = addSource(a.state);
    expect(b.state.sources.map((x) => x.id)).toEqual(['s1', 's2', 's3']);
    const r = addReceiver(b.state);
    expect(new Set(r.state.receivers.map((x) => x.id)).size).toBe(r.state.receivers.length);
    expect(hasErrors(validateScene(toScene(r.state)))).toBe(false);
  });
});
