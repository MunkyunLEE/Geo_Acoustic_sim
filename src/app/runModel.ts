import type { CompiledScene } from '../solver/core/compile';
import type { LevelSelection } from '../solver/physics/direct';
import type { FieldOptions } from '../solver/physics/field';
import { buildEchogram, type Echogram } from '../solver/physics/echogram';
import { powerToDb } from '../solver/core/db';
import type { MultiField } from '../solver/physics/multiField';
import { evaluateMulti, levelAt, makeMultiField } from '../solver/physics/multiField';
import { computeSlice, type SliceGrid } from '../solver/receivers/slice';
import type { DiffuseField } from '../solver/physics/diffuse';
import type { PerBand, PointSource, Scene } from '../types';
import { buildWaveModel, makeSpreadLut, type WaveModel } from '../visualization/wavefrontModel';
import type { ResultRow } from '../ui/ResultsPanel';
import type { WaveView } from '../ui/Viewport';

export const WAVE_LEVEL = 6; // 파면 icosphere 세분 단계 (광선 약 4만 개)
export const SLICE_CELLS = 100; // 슬라이스 한 변 셀 수

/** Run 시점에 고정한 입력과 무거운 중간 결과 (편집해도 바뀌지 않는다). */
export interface RunSnapshot {
  id: number; // Run 번호
  rev: number; // Run 시점의 편집 번호 (현재 번호와 다르면 오래된 결과)
  scene: Scene; // Run 시점의 장면
  compiled: CompiledScene;
  sources: PointSource[];
  alpha: PerBand<number>; // 공기 흡음 [dB/m]
  c: number; // 음속 [m/s]
  options: FieldOptions;
  diffuse: DiffuseField | null; // 확산 몬테카를로 결과 (끄면 null)
  models: WaveModel[]; // 음원별 파면 모델
  rMax: number; // 최대 경로 길이 [m]
}

/** 표시 설정(레벨 선택, 슬라이스 높이)에 따라 달라지는 결과. */
export interface Derived {
  key: string; // snapshot.id|sel|z
  slice: SliceGrid;
  rows: ResultRow[];
  waves: Omit<WaveView, 'style'>[];
  truncated: boolean;
  echoes: { name: string; echo: Echogram }[]; // 수신점별 에코그램
  surface: Map<string, Float32Array> | null; // 객체 id → 삼각형별 입사 레벨 [dB] (확산 계산을 켠 경우만)
}

export function buildSnapshot(
  id: number,
  rev: number,
  scene: Scene,
  compiled: CompiledScene,
  sources: PointSource[],
  alpha: PerBand<number>,
  c: number,
  options: FieldOptions,
  diffuse: DiffuseField | null = null,
): RunSnapshot {
  const models = sources.map((s) =>
    buildWaveModel(compiled, s.position, options.maxOrder, WAVE_LEVEL),
  );
  return {
    id,
    rev,
    scene,
    compiled,
    sources,
    alpha,
    c,
    options,
    diffuse,
    models,
    rMax: Math.max(1, ...models.map((m) => m.rMax)),
  };
}

export function derive(snap: RunSnapshot, sel: LevelSelection, z: number): Derived {
  const mf = makeMultiField(
    snap.compiled,
    snap.sources,
    snap.alpha,
    snap.c,
    snap.options,
    sel,
    snap.diffuse,
  );
  const d = snap.scene.domain;
  const slice = computeSlice({
    min: d.min,
    max: d.max,
    z,
    level: (p) => levelAt(mf, p),
    maxCells: SLICE_CELLS,
  });
  const rows: ResultRow[] = snap.scene.receivers.map((r, ri) => {
    const f = evaluateMulti(mf, r.position, ri);
    return {
      name: r.name,
      distance: f.distance,
      delayMs: (f.distance / snap.c) * 1000,
      visible: f.visible,
      bandDb: f.bandDb,
      totalDb: f.totalDb,
      directDb: f.directDb,
      reflDb: f.reflDb,
      diffDb: f.diffDb,
      scatDb: f.scatDb,
      scatSeDb: f.scatSeDb,
      nRefl: f.nRefl,
      nDiff: f.nDiff,
    };
  });
  const lut = makeSpreadLut(snap.rMax, snap.alpha);
  const waves = snap.models.map((model, i) => ({
    model,
    lut,
    weights: mf.weights[i]!.map((w) => w * mf.scales[i]!),
    thickness: Math.max(0.12, snap.rMax * 0.02),
    c: snap.c,
    level: WAVE_LEVEL,
  }));
  const echoes = snap.scene.receivers.map((r, ri) => ({
    name: r.name,
    echo: buildEchogram(mf, r.position, ri, snap.c),
  }));
  return {
    key: `${snap.id}|${String(sel)}|${z}`,
    slice,
    rows,
    waves,
    truncated: mf.ctxs.some((x) => x.images.truncated),
    echoes,
    surface: surfaceLevels(snap, mf),
  };
}

/** 객체 삼각형별 표면 입사 레벨 [dB] (자유장 1 m = 0 dB). 몬테카를로 입사 에너지를 음원·밴드 가중으로 합친다. */
function surfaceLevels(snap: RunSnapshot, mf: MultiField): Map<string, Float32Array> | null {
  const d = mf.diffuse;
  if (!d) return null;
  const out = new Map<string, Float32Array>();
  let offset = 0; // bvhAll 삼각형 번호의 시작 (영역 면이 앞)
  for (const m of snap.compiled.allMeshes) {
    const n = m.indices.length / 3;
    if (snap.scene.meshes.some((x) => x.id === m.id)) {
      const lv = new Float32Array(n);
      for (let t = 0; t < n; t++) {
        let sum = 0;
        for (let s = 0; s < d.nSrc; s++)
          for (let b = 0; b < 6; b++)
            sum += mf.scales[s]! * mf.weights[s]![b]! * d.surf[(s * 6 + b) * d.nTri + offset + t]!;
        lv[t] = powerToDb(sum);
      }
      out.set(m.id, lv);
    }
    offset += n;
  }
  return out;
}
