/// <reference lib="webworker" />
import { runDiffuseJob, type DiffuseRequest } from './diffuseJob';

/** 확산 몬테카를로 워커. 메시지: 요청 → progress* → done | error. 취소는 메인에서 terminate. */
self.onmessage = (e: MessageEvent<DiffuseRequest>) => {
  try {
    let last = 0;
    const result = runDiffuseJob(e.data, (done, total) => {
      const now = performance.now();
      if (now - last < 100 && done < total) return; // 진행률 메시지는 0.1초에 한 번
      last = now;
      self.postMessage({ type: 'progress', done, total });
    });
    self.postMessage({ type: 'done', result }, [
      result.rcv.buffer,
      result.rcvSe.buffer,
      result.vox.buffer,
    ]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
