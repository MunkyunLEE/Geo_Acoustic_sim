import { describe, expect, it } from 'vitest';
import { makeDomain } from '../../src/geometry/domain';
import { makeBoxMesh } from '../../src/geometry/primitives';
import { EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL } from '../../src/data/materials';
import { NO_AIR_ABSORPTION, speedOfSound } from '../../src/solver/core/airAbsorption';
import { compileScene } from '../../src/solver/core/compile';
import {
  barrierDz,
  diffractionGains,
  findDiffractionPaths,
  kirchhoffHalfPlaneDb,
} from '../../src/solver/physics/diffraction';
import { flatBands } from '../../src/solver/core/bands';
import { SCENE_SCHEMA_VERSION, type MeshSurface, type Scene, type Vec3 } from '../../src/types';

/** 열린 영역 + 객체 하나로 장면을 만든다. */
function sceneWith(mesh: MeshSurface): Scene {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    name: 't',
    units: 'm',
    domain: makeDomain(
      [2000, 2000, 400],
      { type: 'open', materialId: 'open-boundary' },
      [-1000, -1000, 0],
    ),
    meshes: [mesh],
    materials: [...EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL],
    sources: [{ kind: 'point', id: 's', name: 's', position: [0, 0, 1], lw: flatBands(94) }],
    receivers: [],
  };
}
/** x = 0 평면에 놓인 두께 0의 수직 벽 (y: ±halfW, z: 0~h). */
function thinWall(halfW: number, h: number): MeshSurface {
  // prettier-ignore
  const positions = new Float32Array([0, -halfW, 0, 0, halfW, 0, 0, halfW, h, 0, -halfW, h]);
  return {
    id: 'w',
    name: 'w',
    positions,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    materialId: 'ex-reflective',
  };
}
const S: Vec3 = [-5, 0, 1.5],
  R: Vec3 = [5, 0, 1.5];

describe('차폐 감쇠 Dz (경험식)와 참조해', () => {
  it('Fresnel 참조해 사전 계산값 (scipy.special.fresnel)과 일치', () => {
    const ref: [number, number][] = [
      [0, 6.02],
      [1, 16.32],
      [4, 22.02],
      [16, 28.01],
    ];
    for (const [n, db] of ref) expect(kirchhoffHalfPlaneDb(n)).toBeCloseTo(db, 1);
  });
  it('ISO/Maekawa 식은 반평면 해보다 0.3~3 dB 작게 감쇠 (N = 0 ~ 16)', () => {
    for (const n of [0.05, 0.25, 1, 4, 16]) {
      const lambda = 1,
        delta = (n * lambda) / 2; // N = 2δ/λ
      const iso = 10 * Math.log10(3 + 40 * delta); // 상한 없는 식
      const diff = kirchhoffHalfPlaneDb(n) - iso;
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThan(3.1);
    }
  });
  it('상한: 단일 20 dB, 이중 25 dB / δ ≤ 0 이면 0', () => {
    expect(barrierDz(50, 0.1, 1, 0)).toBe(20);
    expect(barrierDz(50, 0.1, 2, 0.4)).toBe(25);
    expect(barrierDz(0, 1, 1, 0)).toBe(0);
  });
});

describe('우회 경로 탐색', () => {
  it('두께 0 벽: 위로 넘는 경로 δ = 2√(5²+4.5²) − 10, 모서리 1개', () => {
    const c = compileScene(sceneWith(thinWall(400, 6)));
    const top = findDiffractionPaths(c, S, R).find((p) => p.kind === 'top')!;
    expect(top.edges).toBe(1);
    expect(top.delta).toBeCloseTo(2 * Math.hypot(5, 4.5) - 10, 2);
  });
  it('두께 0.4 m 벽: 모서리 2개, δ = 2√(4.8²+4.5²) + 0.4 − 10', () => {
    const c = compileScene(
      sceneWith(makeBoxMesh('b', 'b', [-0.2, -400, 0], [0.2, 400, 6], 'ex-reflective')),
    );
    const top = findDiffractionPaths(c, S, R).find((p) => p.kind === 'top')!;
    expect(top.edges).toBe(2);
    expect(top.edgeSpan).toBeCloseTo(0.4, 2);
    expect(top.delta).toBeCloseTo(2 * Math.hypot(4.8, 4.5) + 0.4 - 10, 2);
  });
  it('좁은 기둥(폭 4 m, 매우 높음): 좌우 경로 δ = 2√(5²+2²) − 10, 대칭', () => {
    const c = compileScene(sceneWith(thinWall(2, 300)));
    const paths = findDiffractionPaths(c, S, R);
    const l = paths.find((p) => p.kind === 'left')!,
      r = paths.find((p) => p.kind === 'right')!;
    const exp = 2 * Math.hypot(5, 2) - 10;
    expect(l.delta).toBeCloseTo(exp, 2);
    expect(r.delta).toBeCloseTo(exp, 2);
  });
  it('가려지지 않은 쪽(벽 옆)에서는 경로가 없다', () => {
    const c = compileScene(sceneWith(thinWall(2, 6)));
    expect(findDiffractionPaths(c, [-5, 10, 1.5], [5, 10, 1.5])).toHaveLength(0);
  });
});

describe('회절 이득', () => {
  it('두께 0 벽, 125 Hz: 이득 = (1/d²)·10^(−Dz/10) (좌우 경로는 포화라 합산 제외)', () => {
    const c = compileScene(sceneWith(thinWall(400, 6)));
    const r = diffractionGains(c, S, R, speedOfSound(20), NO_AIR_ABSORPTION);
    const lambda = speedOfSound(20) / 125;
    const dzTop = barrierDz(2 * Math.hypot(5, 4.5) - 10, lambda, 1, 0);
    expect(r.gain[125]).toBeCloseTo(Math.pow(10, -dzTop / 10) / 100, 7);
  });
  it('모든 경로가 포화되는 고주파(4 kHz)는 상한 20 dB 하나만: 이득 = 10^(−2)/d²', () => {
    const c = compileScene(sceneWith(thinWall(400, 6)));
    const r = diffractionGains(c, S, R, speedOfSound(20), NO_AIR_ABSORPTION);
    expect(r.gain[4000]).toBeCloseTo(0.01 / 100, 9);
  });
  it('고주파일수록 더 크게 감쇠 (125 Hz > 4 kHz 이득)', () => {
    const c = compileScene(sceneWith(thinWall(400, 6)));
    const r = diffractionGains(c, S, R, speedOfSound(20), NO_AIR_ABSORPTION);
    expect(r.gain[125]).toBeGreaterThan(r.gain[4000]);
  });
});
