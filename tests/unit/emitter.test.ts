import { describe, expect, it } from 'vitest';
import { boxRoomScene } from '../../src/data/examples';
import { addPrimitive, setEmitter, setMaterialBand } from '../../src/editor/ops';
import { emitterPoints, stateFromScene, toScene } from '../../src/editor/state';
import { hasErrors, validateScene } from '../../src/solver/core/validation';
import { lwToWatts } from '../../src/solver/core/db';

describe('면음원', () => {
  const s0 = stateFromScene(boxRoomScene);
  it('표본점 파워 합 = 면 전체 파워 (비간섭 합 보존)', () => {
    const { state, id } = addPrimitive(s0, 'area-source');
    for (const [nu, nv] of [
      [1, 1],
      [3, 3],
      [5, 2],
    ] as const) {
      const s = setEmitter(state, id, { nu, nv });
      const pts = emitterPoints(s);
      expect(pts.length).toBe(nu * nv);
      const w = pts.reduce((a, p) => a + lwToWatts(p.lw[1000]), 0);
      expect(Math.abs(w / lwToWatts(94) - 1)).toBeLessThan(1e-9);
    }
  });
  it('면음원 객체는 메시에서 빠지고(투명), 표본점이 음원 목록에 들어감', () => {
    const { state, id } = addPrimitive(s0, 'area-source');
    const sc = toScene(state);
    expect(sc.meshes.some((m) => m.id === id)).toBe(false);
    expect(sc.sources.length).toBe(s0.sources.length + 9);
    expect(hasErrors(validateScene(sc))).toBe(false);
  });
  it('표본점 수는 1~5로 제한', () => {
    const { state, id } = addPrimitive(s0, 'area-source');
    const s = setEmitter(state, id, { nu: 99, nv: 0 });
    expect(s.objects.find((o) => o.id === id)?.emitter).toMatchObject({ nu: 5, nv: 1 });
  });
});

describe('투과 입력 결합', () => {
  it('투과율을 올리면 α+τ ≤ 1을 넘지 않도록 제한', () => {
    const { state, id } = addPrimitive(stateFromScene(boxRoomScene), 'box');
    let s = setMaterialBand(state, id, 'absorption', 1000, 0.8);
    s = setMaterialBand(s, id, 'transmission', 1000, 0.9);
    const m = s.objects.find((o) => o.id === id)!.material;
    expect(m.absorption[1000] + (m.transmission?.[1000] ?? 0)).toBeLessThanOrEqual(1 + 1e-12);
  });
});
