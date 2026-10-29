import { describe, expect, it } from 'vitest';
import { boxRoomScene } from '../../src/data/examples';
import { EMPTY_HISTORY, record, redo, undo } from '../../src/editor/history';
import { addPrimitive, setTransform } from '../../src/editor/ops';
import { stateFromScene } from '../../src/editor/state';

const s0 = stateFromScene(boxRoomScene);
const s1 = addPrimitive(s0, 'box').state;
const move = (s: typeof s1, x: number) =>
  setTransform(s, s.objects[0]!.id, { ...s.objects[0]!.transform, position: [x, 0, 0] });

describe('편집 이력', () => {
  it('추가 → 취소 → 다시 실행', () => {
    let h = record(EMPTY_HISTORY, s0, s1, 1000);
    const u = undo(h, s1)!;
    expect(u.state).toBe(s0);
    h = u.history;
    const r = redo(h, u.state)!;
    expect(r.state).toBe(s1);
  });
  it('0.5초 안의 연속 이동(드래그)은 한 단계로 합쳐진다', () => {
    let h = record(EMPTY_HISTORY, s0, s1, 1000);
    let cur = s1;
    for (let i = 1; i <= 20; i++) {
      const next = move(cur, i);
      h = record(h, cur, next, 2000 + i * 10);
      cur = next;
    }
    expect(h.past.length).toBe(2); // [s0, s1]  (이동 20번 = 1단계)
    const u = undo(h, cur)!;
    expect(u.state).toBe(s1);
  });
  it('개수가 바뀌는 편집은 합치지 않는다', () => {
    let h = record(EMPTY_HISTORY, s0, s1, 1000);
    const s2 = addPrimitive(s1, 'plane').state;
    h = record(h, s1, s2, 1100);
    expect(h.past.length).toBe(2);
  });
  it('새 편집은 redo 목록을 비운다, 빈 이력의 undo는 null', () => {
    expect(undo(EMPTY_HISTORY, s0)).toBeNull();
    let h = record(EMPTY_HISTORY, s0, s1, 1000);
    h = undo(h, s1)!.history;
    expect(h.future.length).toBe(1);
    h = record(h, s0, s1, 5000);
    expect(h.future.length).toBe(0);
  });
});
