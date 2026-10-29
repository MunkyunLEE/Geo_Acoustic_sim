import { BAND_CENTERS, type Vec3 } from '../../types';
import { computeDirect, spreadingGain } from './direct';
import { diffractionGains } from './diffraction';
import type { MultiField } from './multiField';
import { validatePath } from './reflection';

/** 수신점 하나의 에코그램. 값은 시간 구간(폭 dtMs)마다의 선택 레벨 에너지 이득 (자유장 1 m = 1, 선형). */
export interface Echogram {
  dtMs: number; // 구간 폭 [ms]
  nBins: number; // 구간 수
  direct: Float64Array; // 직접음 (투과 포함)
  refl: Float64Array; // 정반사 (이미지 음원)
  diff: Float64Array; // 회절 (가장 짧은 우회 경로의 도달 시간에 모아서 표시)
  scat: Float64Array; // 확산·고차 정반사 (몬테카를로)
}

/** 구간별 합. */
export const echoTotal = (e: Echogram, i: number): number =>
  e.direct[i]! + e.refl[i]! + e.diff[i]! + e.scat[i]!;

/**
 * 수신점의 에코그램을 만든다. 직접음·정반사·회절은 도달 시간(경로 길이 / c)의 구간에 충격으로 넣고,
 * 확산 성분은 몬테카를로 시간 히스토그램을 쓴다. 모두 에너지 합(비간섭)이며 구간 합 = 총 이득이다.
 */
export function buildEchogram(
  mf: MultiField,
  rcv: Vec3,
  rIndex: number,
  c: number, // 음속 [m/s]
  dtMsDefault = 2,
  maxMsDefault = 400,
): Echogram {
  const dtMs = mf.diffuse ? mf.diffuse.echoDt * 1000 : dtMsDefault;
  const nBins = mf.diffuse ? mf.diffuse.echoBins : Math.ceil(maxMsDefault / dtMsDefault);
  const mk = () => new Float64Array(nBins);
  const out: Echogram = { dtMs, nBins, direct: mk(), refl: mk(), diff: mk(), scat: mk() };
  const bin = (lenM: number) => Math.min(nBins - 1, Math.floor(lenM / c / (dtMs / 1000)));
  mf.ctxs.forEach((ctx, s) => {
    const k = mf.scales[s]!;
    const w = mf.weights[s]!;
    const wsum = (g: (fc: (typeof BAND_CENTERS)[number]) => number) =>
      k * BAND_CENTERS.reduce((a, fc, i) => a + w[i]! * g(fc), 0);
    const d = computeDirect(ctx.src, rcv, ctx.c.bvhObjects, ctx.alpha, ctx.c.objTrans);
    if (ctx.options.direct) out.direct[bin(d.distance)]! += wsum((fc) => d.gain[fc]);
    if (ctx.options.maxOrder > 0) {
      for (const path of ctx.images.paths) {
        if (!validatePath(ctx.c, path, rcv)) continue;
        const img = path.images[path.order]!;
        const len = Math.hypot(rcv[0] - img[0], rcv[1] - img[1], rcv[2] - img[2]);
        out.refl[bin(len)]! += wsum((fc) => path.refl[fc] * spreadingGain(len, ctx.alpha[fc]));
      }
    }
    if (ctx.options.diffraction && !d.visible) {
      const r = diffractionGains(ctx.c, ctx.src, rcv, ctx.speed, ctx.alpha);
      if (r.paths.length > 0) {
        const dmin = Math.min(...r.paths.map((p) => p.delta));
        out.diff[bin(d.distance + dmin)]! += wsum((fc) => r.gain[fc]);
      }
    }
    if (mf.diffuse) {
      const dd = mf.diffuse;
      for (let q = 0; q < nBins; q++) {
        out.scat[q]! += wsum((fc) => {
          const b = BAND_CENTERS.indexOf(fc);
          return dd.echo[((s * dd.nRcv + rIndex) * 6 + b) * dd.echoBins + q]!;
        });
      }
    }
  });
  return out;
}
