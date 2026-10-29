import type { DiffuseField } from '../solver/physics/diffuse';
import { runDiffuseJob, type DiffuseRequest } from '../solver/worker/diffuseJob';

export interface DiffuseJob {
  promise: Promise<DiffuseField>;
  cancel: () => void; // 워커를 즉시 종료한다 (promise는 CANCELLED로 reject)
}

export const CANCELLED = 'CANCELLED';

/** 확산 계산을 Web Worker에서 시작한다. 워커를 쓸 수 없으면 메인 스레드에서 실행한다. */
export function startDiffuse(
  req: DiffuseRequest,
  onProgress: (done: number, total: number) => void,
): DiffuseJob {
  if (typeof Worker === 'undefined') {
    return {
      promise: Promise.resolve().then(() => runDiffuseJob(req, onProgress)),
      cancel: () => undefined,
    };
  }
  const worker = new Worker(new URL('../solver/worker/diffuseWorker.ts', import.meta.url), {
    type: 'module',
  });
  let fail: (e: Error) => void = () => undefined;
  const promise = new Promise<DiffuseField>((resolve, reject) => {
    fail = reject;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as
        | { type: 'progress'; done: number; total: number }
        | { type: 'done'; result: DiffuseField }
        | { type: 'error'; message: string };
      if (m.type === 'progress') onProgress(m.done, m.total);
      else if (m.type === 'done') {
        worker.terminate();
        resolve(m.result);
      } else {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || '워커 오류'));
    };
    worker.postMessage(req);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      fail(new Error(CANCELLED));
    },
  };
}
