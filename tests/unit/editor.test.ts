import { describe, expect, it } from 'vitest';
import { barrierScene, boxRoomScene } from '../../src/data/examples';
import {
  objectFromMesh,
  objectFromShape,
  parseState,
  serializeState,
  stateFromScene,
  toScene,
} from '../../src/editor/state';
import {
  extrudePolyline,
  meshArea,
  polygonFace,
  signedArea2,
  triangulate,
  unitBox,
  unitCylinder,
  unitPlane,
} from '../../src/editor/shapes';
import { objectMesh, transformPoint } from '../../src/editor/transform';
import { compileScene } from '../../src/solver/core/compile';
import { validateScene, hasErrors } from '../../src/solver/core/validation';
import {
  DEFAULT_FIELD_OPTIONS,
  evaluateField,
  makeFieldContext,
} from '../../src/solver/physics/field';
import { flatBands } from '../../src/solver/core/bands';
import { NO_AIR_ABSORPTION } from '../../src/solver/core/airAbsorption';

describe('변환', () => {
  it('크기 → 회전 → 이동 순서 (z축 90° 회전: (1,0,0) → (0,1,0))', () => {
    const p = transformPoint(
      { position: [10, 0, 0], rotationDeg: [0, 0, 90], scale: [2, 1, 1] },
      [1, 0, 0],
    );
    expect(p[0]).toBeCloseTo(10, 6);
    expect(p[1]).toBeCloseTo(2, 6);
    expect(p[2]).toBeCloseTo(0, 6);
  });
  it('단위 박스에 scale (4,2,3) → 세계 부피 24, 면적 2(8+12+6)=52', () => {
    const o = objectFromShape('a', unitBox(), '박스', 'reflect', [5, 5, 1.5], [4, 2, 3]);
    const m = objectMesh(o);
    expect(meshArea(m)).toBeCloseTo(52, 4);
    const xs = Array.from(m.positions).filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(3, 5);
    expect(Math.max(...xs)).toBeCloseTo(7, 5);
  });
  it('단위 평면은 열린 서페이스: 삼각형 2개, 면적 = scale 곱', () => {
    const m = objectMesh(
      objectFromShape('p', unitPlane(), '평면', 'reflect', [0, 0, 0], [6, 3, 1]),
    );
    expect(m.indices.length / 3).toBe(2);
    expect(meshArea(m)).toBeCloseTo(18, 5);
  });
  it('원기둥 옆면 면적 ≈ π d h (n=96, 오차 < 0.1 %)', () => {
    const m = objectMesh(
      objectFromShape('c', unitCylinder(96, false), '원기둥', 'reflect', [0, 0, 0], [2, 2, 5]),
    );
    expect(meshArea(m) / (Math.PI * 2 * 5)).toBeCloseTo(1, 2);
  });
});

describe('폴리라인 extrude와 면', () => {
  const rect: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ];
  it('열린 폴리라인(3점) → 벽 2장, 삼각형 4개, 면적 = 길이×높이', () => {
    const m = extrudePolyline(
      [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
      0,
      2.5,
      { closed: false, capBottom: false, capTop: false },
    );
    expect(m.indices.length / 3).toBe(4);
    expect(meshArea(m)).toBeCloseTo((4 + 3) * 2.5, 5);
  });
  it('닫힌 직사각형 + 뚜껑 → 면적 = 둘레×높이 + 2×바닥', () => {
    const m = extrudePolyline(rect, 1, 2, { closed: true, capBottom: true, capTop: true });
    expect(meshArea(m)).toBeCloseTo(14 * 2 + 2 * 12, 5);
  });
  it('닫힌 폴리라인 뚜껑 없음 → 옆면만', () => {
    expect(
      meshArea(extrudePolyline(rect, 0, 2, { closed: true, capBottom: false, capTop: false })),
    ).toBeCloseTo(28, 5);
  });
  it('오목 L자 다각형 삼각분할: 면적 보존 (면적 4 + 2 = 6)', () => {
    const L: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 3],
      [0, 3],
    ];
    expect(meshArea(polygonFace(L, 0))).toBeCloseTo(6, 6);
    expect(triangulate(L).length).toBe(12);
  });
  it('시계 방향 입력도 같은 면적', () => {
    const cw = [...rect].reverse();
    expect(signedArea2(cw)).toBeLessThan(0);
    expect(meshArea(polygonFace(cw, 0))).toBeCloseTo(12, 6);
  });
});

describe('장면 변환과 저장', () => {
  it('예시 장면 → 편집기 → Scene: 메시 면적 유지', () => {
    const st = stateFromScene(barrierScene);
    const sc = toScene(st);
    expect(sc.meshes.length).toBe(1);
    expect(meshArea(sc.meshes[0]!)).toBeCloseTo(meshArea(barrierScene.meshes[0]!), 3);
  });
  it('JSON 왕복: 객체·변환·재료·음원·수신점이 그대로', () => {
    const st = stateFromScene(barrierScene);
    st.objects[0]!.transform = { position: [3, 4, 5], rotationDeg: [10, 20, 30], scale: [1, 2, 3] };
    const back = parseState(serializeState(st));
    expect(back.objects[0]!.transform).toEqual(st.objects[0]!.transform);
    expect(back.objects[0]!.material).toEqual(st.objects[0]!.material);
    expect(Array.from(back.objects[0]!.base.positions)).toEqual(
      Array.from(st.objects[0]!.base.positions),
    );
    expect(back.sources).toEqual(st.sources);
    expect(back.receivers).toEqual(st.receivers);
    expect(meshArea(toScene(back).meshes[0]!)).toBeCloseTo(meshArea(toScene(st).meshes[0]!), 5);
  });
  it('다른 파일은 거부', () => {
    expect(() => parseState('{"a":1}')).toThrow();
  });
  it('임포트 메시는 중심 기준 국소 좌표 + 위치 = 중심', () => {
    const o = objectFromMesh('x', barrierScene.meshes[0]!);
    expect(o.transform.position[0]).toBeCloseTo(15, 5);
    const b = Array.from(o.base.positions).filter((_, i) => i % 3 === 0);
    expect(Math.min(...b)).toBeCloseTo(-0.2, 5);
  });
});

describe('편집한 장면을 솔버에 넣기', () => {
  it('얇은 평면 한 장(열린 서페이스)도 차폐한다', () => {
    const st = stateFromScene(boxRoomScene);
    st.domain = { ...st.domain, min: [-10, -10, 0], max: [10, 10, 10] };
    st.sources = [{ ...st.sources[0]!, position: [-5, 0, 3], lw: flatBands(94) }];
    st.receivers = [{ ...st.receivers[0]!, position: [5, 0, 3] }];
    // x=0 에 세운 평면 (YZ), 크기 8×8
    const plane = objectFromShape('wall', unitPlane(), '벽', 'reflect', [0, 0, 3], [8, 8, 1]);
    plane.transform.rotationDeg = [0, 90, 0];
    st.objects = [plane];
    const sc = toScene(st);
    expect(hasErrors(validateScene(sc))).toBe(false);
    const c = compileScene(sc);
    const ctx = makeFieldContext(c, [-5, 0, 3], flatBands(94), NO_AIR_ABSORPTION, 343, {
      ...DEFAULT_FIELD_OPTIONS,
      maxOrder: 0,
    });
    const f = evaluateField(ctx, [5, 0, 3]);
    expect(f.visible).toBe(false);
    expect(f.diffraction[1000]).toBeGreaterThan(0);
  });
  it('소산벽(α=1)은 반사하지 않는다', () => {
    const st = stateFromScene(boxRoomScene);
    const wall = objectFromShape('w', unitPlane(), '소산벽', 'open', [5, 5, 1], [4, 4, 1]);
    st.objects = [wall];
    const c = compileScene(toScene(st));
    expect(c.planes.some((p) => p.materialId === 'mat-w')).toBe(false);
  });
});
