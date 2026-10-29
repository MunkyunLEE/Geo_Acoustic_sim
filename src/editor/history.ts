import type { EditorState } from './types';

/** 편집 이력 (실행 취소/다시 실행). 불변 상태 스냅샷을 쌓는다. */
export interface History {
  past: EditorState[]; // 이전 상태들 (마지막이 가장 최근)
  future: EditorState[]; // 취소한 상태들 (마지막이 다음 redo)
  lastAt: number; // 마지막 기록 시각 [ms]
}

export const EMPTY_HISTORY: History = { past: [], future: [], lastAt: 0 };
const MAX_STEPS = 100; // 보관할 최대 단계 수
const COALESCE_MS = 500; // 이 시간 안의 연속 변경(드래그, 숫자 입력)은 한 단계로 합친다

/** 개수가 바뀌지 않는 연속 편집인지 (객체·음원·수신점 수가 같음). */
const sameShape = (a: EditorState, b: EditorState) =>
  a.objects.length === b.objects.length &&
  a.sources.length === b.sources.length &&
  a.receivers.length === b.receivers.length;

/** prev에서 next로 바뀐 것을 기록한다. 연속 변경이면 이전 단계에 합친다. */
export function record(h: History, prev: EditorState, next: EditorState, now: number): History {
  if (prev === next) return h;
  const merge = h.past.length > 0 && now - h.lastAt < COALESCE_MS && sameShape(prev, next);
  const past = merge ? h.past : [...h.past, prev].slice(-MAX_STEPS);
  return { past, future: [], lastAt: now };
}

export function undo(
  h: History,
  cur: EditorState,
): { history: History; state: EditorState } | null {
  const prev = h.past[h.past.length - 1];
  if (!prev) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, cur], lastAt: 0 },
    state: prev,
  };
}

export function redo(
  h: History,
  cur: EditorState,
): { history: History; state: EditorState } | null {
  const next = h.future[h.future.length - 1];
  if (!next) return null;
  return {
    history: { past: [...h.past, cur], future: h.future.slice(0, -1), lastAt: 0 },
    state: next,
  };
}
