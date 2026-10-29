import { useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLE_SCENES } from '../data/examples';
import { EMPTY_HISTORY, record, redo, undo, type History as EditHistory } from '../editor/history';
import { OPEN_BOUNDARY_MATERIAL, OPEN_MATERIAL_ID, EXAMPLE_MATERIALS } from '../data/materials';
import {
  updateObject,
  addPrimitive,
  addReceiver,
  addSource,
  finishDraw,
  removeObject,
  removeReceiver,
  removeSource,
  setTransform,
  updateReceiver,
  updateSource,
  type PrimitiveKind,
} from '../editor/ops';
import {
  nextObjectId,
  objectFromMesh,
  parseState,
  serializeState,
  stateFromScene,
  toScene,
} from '../editor/state';
import type { EditorState, ObjectRole, Transform } from '../editor/types';
import { boundingBox } from '../geometry/primitives';
import {
  DEFAULT_AIR,
  NO_AIR_ABSORPTION,
  airAbsorptionPerBand,
  speedOfSound,
} from '../solver/core/airAbsorption';
import { compileScene } from '../solver/core/compile';
import { hasErrors, validateScene } from '../solver/core/validation';
import { DEFAULT_FIELD_OPTIONS, type FieldOptions } from '../solver/physics/field';
import type { MeshSurface, PointSource, Scene } from '../types';
import { Colorbar } from '../ui/Colorbar';
import { ControlPanel } from '../ui/ControlPanel';
import { EditorPanel, INITIAL_DRAW, type DrawState } from '../ui/EditorPanel';
import { InfoPanel } from '../ui/InfoPanel';
import { Inspector } from '../ui/Inspector';
import { ResultsPanel } from '../ui/ResultsPanel';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Viewport, type GizmoMode, type ViewportHandle } from '../ui/Viewport';
import { EchoPlot } from '../ui/EchoPlot';
import { ExportPanel, type GifOptions } from '../ui/ExportPanel';
import { surfaceColors } from '../visualization/surfaceColors';
import { echoCsv, resultsCsv, sliceCsv } from '../io/exportCsv';
import { encodeGif, type RgbaFrame } from '../io/gif';
import { drawOverlay } from '../io/frameOverlay';
import { downloadBlob, downloadCsv } from '../io/download';
import {
  DEFAULT_RUN_SETTINGS,
  type AirSettings,
  type DisplaySettings,
  type RunSettings,
} from '../ui/controlTypes';
import type { Selection } from '../visualization/editLayer';
import type { EditLevel, SubSel } from '../visualization/subLayer';
import { getWeld, moveGroups } from '../editor/subedit';
import { WaveClock } from '../visualization/waveClock';
import { docsUrl } from './docsUrl';
import { CANCELLED, startDiffuse, type DiffuseJob } from './diffuseClient';
import { DEFAULT_DIFFUSE } from '../solver/tracing/diffuseTrace';
import { buildSnapshot, derive, type Derived, type RunSnapshot } from './runModel';
import { useTheme } from './theme';

/** 시계 상태를 100 ms 간격으로 읽어 UI에 반영한다 (매 프레임 React 갱신을 피함). */
function useClockReadout(clock: WaveClock) {
  const [r, setR] = useState({ t: 0, playing: false });
  useEffect(() => {
    const id = setInterval(() => {
      setR((o) =>
        o.t === clock.t && o.playing === clock.playing ? o : { t: clock.t, playing: clock.playing },
      );
    }, 100);
    return () => clearInterval(id);
  }, [clock]);
  return r;
}

const DOMAIN_MATERIALS = [...EXAMPLE_MATERIALS]; // 영역 반사 면에 고를 수 있는 재료
const ROUND = (v: number) => Math.round(v * 100) / 100;

/** 가져온 메시가 영역 밖이면 영역을 메시 + 여유만큼 넓힌다 (줄이지는 않는다). */
function growDomain(s: EditorState, mesh: MeshSurface): EditorState {
  const box = boundingBox([mesh]);
  if (!box) return s;
  const min = [...s.domain.min] as [number, number, number];
  const max = [...s.domain.max] as [number, number, number];
  let changed = false;
  for (let i = 0; i < 3; i++) {
    const pad = Math.max(0.5, (box.max[i]! - box.min[i]!) * 0.1);
    if (box.min[i]! < min[i]!) {
      min[i] = ROUND(box.min[i]! - pad);
      changed = true;
    }
    if (box.max[i]! > max[i]!) {
      max[i] = ROUND(box.max[i]! + pad);
      changed = true;
    }
  }
  return changed ? { ...s, domain: { ...s.domain, min, max } } : s;
}

export function App() {
  const { setting, resolved, setSetting } = useTheme();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [editor, setEditorRaw] = useState<EditorState>(() => stateFromScene(EXAMPLE_SCENES[0]!));
  const [editRev, setEditRev] = useState(0); // 편집·설정 변경 번호 (결과가 오래됐는지 판단)
  const [selection, setSelection] = useState<Selection | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [editLevel, setEditLevelRaw] = useState<EditLevel>('object');
  const [subSel, setSubSel] = useState<SubSel | null>(null);
  const [snap, setSnap] = useState({ on: true, step: 0.5 });
  const [draw, setDraw] = useState<DrawState>(INITIAL_DRAW);
  const [fitKey, setFitKey] = useState(0);
  const [options, setOptionsRaw] = useState<FieldOptions>(DEFAULT_FIELD_OPTIONS);
  const [air, setAirRaw] = useState<AirSettings>({ ...DEFAULT_AIR, enabled: true });
  const [display, setDisplay] = useState<DisplaySettings>({
    sel: 'total',
    minDb: -60,
    showSlice: true,
    showWave: true,
    showSurface: true,
    waveStyle: 'points',
    sliceZ: 3,
  });
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(0.01);
  const clock = useRef(new WaveClock()).current;
  const viewportRef = useRef<ViewportHandle>(null);
  const [gifProgress, setGifProgress] = useState<number | null>(null);
  const readout = useClockReadout(clock);

  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSettings, setRunSettingsRaw] = useState<RunSettings>(DEFAULT_RUN_SETTINGS);
  const [progress, setProgress] = useState<number | null>(null); // 확산 계산 진행률
  const [cancelled, setCancelled] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const runId = useRef(0);

  // 편집 이력: 최신 상태는 ref에도 둬서 뷰포트 콜백(드래그)에서 항상 최신 값으로 계산한다
  const editorRef = useRef(editor);
  const history = useRef<EditHistory>(EMPTY_HISTORY);
  const [, setHistTick] = useState(0); // 버튼 활성 상태 갱신용
  const setEditor = (next: EditorState | ((s: EditorState) => EditorState)) => {
    const cur = editorRef.current;
    const val = typeof next === 'function' ? next(cur) : next;
    if (val === cur) return;
    history.current = record(history.current, cur, val, performance.now());
    editorRef.current = val;
    setEditorRaw(val);
    setEditRev((n) => n + 1);
    setHistTick((n) => n + 1);
  };
  const applyHistory = (r: { history: EditHistory; state: EditorState } | null) => {
    if (!r) return;
    history.current = r.history;
    editorRef.current = r.state;
    setEditorRaw(r.state);
    setEditRev((n) => n + 1);
    setHistTick((n) => n + 1);
    setSubSel(null);
    setSelection((sel) =>
      sel && sel.kind === 'object' && !r.state.objects.some((o) => o.id === sel.id) ? null : sel,
    );
  };
  const doUndo = () => applyHistory(undo(history.current, editorRef.current));
  const doRedo = () => applyHistory(redo(history.current, editorRef.current));
  useEffect(() => {
    setSubSel((ss) =>
      ss && selection?.kind === 'object' && selection.id === ss.objectId ? ss : null,
    );
  }, [selection]);
  const setEditLevel = (l: EditLevel) => {
    setEditLevelRaw(l);
    setSubSel(null);
  };
  const deleteSelected = () => {
    if (!selection || selection.kind === 'domain' || editLevel !== 'object') return; // 하위 요소 편집 중에는 객체 삭제 안 함
    setEditor((st) =>
      selection.kind === 'object'
        ? removeObject(st, selection.id)
        : selection.kind === 'source'
          ? removeSource(st, selection.id)
          : removeReceiver(st, selection.id),
    );
    setSelection(null);
  };
  const setOptions = (o: FieldOptions) => (setOptionsRaw(o), setEditRev((n) => n + 1));
  const setRunSettings = (r: RunSettings) => (setRunSettingsRaw(r), setEditRev((n) => n + 1));
  const setAir = (a: AirSettings) => (setAirRaw(a), setEditRev((n) => n + 1));

  const scene = useMemo(() => toScene(editor), [editor]);
  const issues = useMemo(() => {
    const list = validateScene(scene);
    if (scene.sources.length === 0)
      list.push({
        severity: 'error',
        code: 'no-source',
        message: '음원이 없습니다. 음원을 하나 이상 추가하세요.',
      });
    return list;
  }, [scene]);
  const blocked = hasErrors(issues);

  // 영역·격자 표시용 장면 (객체·음원 없이 영역 + 영역 재료만)
  const domainScene = useMemo<Scene>(
    () => ({
      ...scene,
      meshes: [],
      sources: [],
      receivers: [],
      materials: [...EXAMPLE_MATERIALS, OPEN_BOUNDARY_MATERIAL],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor.domain],
  );

  const loadScene = (state: EditorState, index?: number) => {
    history.current = EMPTY_HISTORY; // 장면을 통째로 바꾸면 이력을 비운다
    editorRef.current = state;
    setEditorRaw(state);
    setEditRev((n) => n + 1);
    setSelection(null);
    setSubSel(null);
    setDraw(INITIAL_DRAW);
    setSnapshot(null);
    setDerived(null);
    setElapsed(null);
    clock.seek(0);
    clock.playing = false;
    setDisplay((d) => ({ ...d, sliceZ: state.sources[0]?.position[2] ?? 1.5 }));
    setFitKey((k) => k + 1);
    if (index !== undefined) setSceneIndex(index);
  };

  // 단축키: Ctrl/⌘+Z 취소, Ctrl/⌘+Shift+Z 또는 Ctrl+Y 다시 실행, Delete 삭제, Esc 선택·그리기 해제
  const keyRef = useRef({
    doUndo,
    doRedo,
    deleteSelected,
    draw,
    editLevel,
    hasSub: subSel !== null,
    clearSub: () => setSubSel(null),
  });
  keyRef.current = {
    doUndo,
    doRedo,
    deleteSelected,
    draw,
    editLevel,
    hasSub: subSel !== null,
    clearSub: () => setSubSel(null),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'))
        return;
      const k = keyRef.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) k.doRedo();
        else k.doUndo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        k.doRedo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        k.deleteSelected();
      } else if (e.key === 'Escape') {
        if (k.draw.active) setDraw((d) => ({ ...d, active: false, points: [] }));
        else if (k.editLevel !== 'object' && k.hasSub) k.clearSub();
        else setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Run ----
  // 순서: 장면 컴파일(메인) → 확산 몬테카를로(Web Worker, 진행률·취소) → 파면 모델·결과 표(메인)
  const doRun = () => {
    if (blocked || running) return;
    setRunning(true);
    setRunError(null);
    setCancelled(false);
    setProgress(runSettings.diffuse ? 0 : null);
    setTimeout(() => {
      void (async () => {
        try {
          const t0 = performance.now();
          const sc = toScene(editor);
          const compiled = compileScene(sc);
          const pointSources = sc.sources.filter((x): x is PointSource => x.kind === 'point'); // 면음원 표본점 포함
          const alpha = air.enabled ? airAbsorptionPerBand(air) : NO_AIR_ABSORPTION;
          const c = speedOfSound(air.temperatureC);
          let diffuse = null;
          if (runSettings.diffuse) {
            const job: DiffuseJob = startDiffuse(
              {
                scene: sc,
                sources: pointSources,
                alpha,
                c,
                options,
                settings: {
                  ...DEFAULT_DIFFUSE,
                  raysPerBand: runSettings.rays,
                  maxBounces: runSettings.maxBounces,
                  seed: runSettings.seed,
                },
              },
              (done, total) => setProgress(done / total),
            );
            cancelRef.current = job.cancel;
            diffuse = await job.promise;
          }
          cancelRef.current = null;
          const snap = buildSnapshot(
            ++runId.current,
            editRev,
            sc,
            compiled,
            pointSources,
            alpha,
            c,
            options,
            diffuse,
          );
          const d = derive(snap, display.sel, display.sliceZ);
          setSnapshot(snap);
          setDerived(d);
          setElapsed(performance.now() - t0);
          clock.seek(0);
          clock.playing = false;
        } catch (e) {
          if (e instanceof Error && e.message === CANCELLED) setCancelled(true);
          else setRunError(e instanceof Error ? e.message : '계산에 실패했습니다.');
        } finally {
          cancelRef.current = null;
          setProgress(null);
          setRunning(false);
        }
      })();
    }, 30);
  };
  const doCancel = () => cancelRef.current?.();

  // 표시 레벨·슬라이스 높이가 바뀌면 고정된 Run 결과에서 다시 만든다 (편집 내용은 반영하지 않음)
  const [deferredZ, setDeferredZ] = useState(display.sliceZ);
  useEffect(() => {
    const id = setTimeout(() => setDeferredZ(display.sliceZ), 60);
    return () => clearTimeout(id);
  }, [display.sliceZ]);
  useEffect(() => {
    if (!snapshot) return;
    if (derived?.key === `${snapshot.id}|${String(display.sel)}|${deferredZ}`) return;
    setDerived(derive(snapshot, display.sel, deferredZ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, display.sel, deferredZ]);

  const stale = snapshot !== null && snapshot.rev !== editRev;
  const waves = useMemo(
    () => (derived ? derived.waves.map((w) => ({ ...w, style: display.waveStyle })) : []),
    [derived, display.waveStyle],
  );

  // 시계 설정 반영
  const tMax = snapshot ? snapshot.rMax / snapshot.c : 0;
  clock.tMax = tMax;
  clock.speed = speed;
  clock.loop = loop;
  if (clock.t > clock.tMax) clock.seek(clock.tMax);
  const c = snapshot?.c ?? speedOfSound(air.temperatureC);

  // ---- 편집 동작 ----
  const add = (kind: PrimitiveKind) => {
    const r = addPrimitive(editor, kind);
    setEditor(r.state);
    setSelection({ kind: 'object', id: r.id });
  };
  const onImport = (mesh: MeshSurface, role: ObjectRole) => {
    const id = nextObjectId(editor.objects);
    const next = growDomain(editor, mesh);
    setEditor({ ...next, objects: [...next.objects, objectFromMesh(id, mesh, role, mesh.name)] });
    setSelection({ kind: 'object', id });
    if (next !== editor) setFitKey((k) => k + 1);
  };
  const onFinishDraw = () => {
    const r = finishDraw(editor, draw);
    if (!r) return;
    setEditor(r.state);
    setSelection({ kind: 'object', id: r.id });
    setDraw({ ...draw, active: false, points: [] });
  };
  const onSave = () => {
    const url = URL.createObjectURL(
      new Blob([serializeState(editor)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editor.name.replace(/[^\w가-힣-]+/g, '_') || 'scene'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const onLoad = async (file: File) => {
    try {
      loadScene(parseState(await file.text()));
    } catch (e) {
      setRunError(e instanceof Error ? e.message : '장면을 불러오지 못했습니다.');
    }
  };

  // ---- 내보내기 ----
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const onPng = () => {
    const cv = viewportRef.current?.canvas();
    if (!cv) return;
    viewportRef.current?.drawAt(clock.t);
    cv.toBlob((b) => b && downloadBlob(`acoustic_view_${stamp()}.png`, b), 'image/png');
  };
  const onGif = (o: GifOptions) => {
    const vp = viewportRef.current;
    const cv = vp?.canvas();
    if (!vp || !cv || gifProgress !== null) return;
    const wasPlaying = clock.playing;
    clock.playing = false;
    const t0 = clock.t;
    setGifProgress(0);
    void (async () => {
      try {
        const w = o.width;
        const h = Math.max(2, Math.round((w * cv.height) / Math.max(1, cv.width)));
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const g = tmp.getContext('2d', { willReadFrequently: true });
        if (!g) throw new Error('2D 캔버스를 만들 수 없습니다.');
        const frames: RgbaFrame[] = [];
        for (let i = 0; i < o.frames; i++) {
          const t = (clock.tMax * i) / Math.max(1, o.frames - 1);
          vp.drawAt(t);
          g.drawImage(cv, 0, 0, w, h);
          drawOverlay(g, w, h, `t = ${(t * 1000).toFixed(1)} ms`, display.minDb);
          frames.push({ data: g.getImageData(0, 0, w, h).data, width: w, height: h });
          setGifProgress(((i + 1) / o.frames) * 0.8);
          await new Promise((r) => setTimeout(r, 0)); // UI가 멈추지 않도록 양보
        }
        await new Promise((r) => setTimeout(r, 0));
        const bytes = encodeGif(frames, o.delayMs);
        downloadBlob(
          `acoustic_wave_${stamp()}.gif`,
          new Blob([bytes.slice().buffer], { type: 'image/gif' }),
        );
      } catch (e) {
        setRunError(e instanceof Error ? e.message : 'GIF를 만들지 못했습니다.');
      } finally {
        clock.seek(t0);
        clock.playing = wasPlaying;
        vp.drawAt(clock.t);
        setGifProgress(null);
      }
    })();
  };

  const runStatus = {
    running,
    hasResult: derived !== null,
    stale,
    blocked,
    elapsedMs: elapsed,
    truncated: derived?.truncated ?? false,
    progress,
    cancelled,
    rays: snapshot?.diffuse?.rays ?? null,
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">
          Acoustic Simulator <span className="ver">STEP 6</span>
        </div>
        <label className="scene-select">
          예시 장면
          <select
            value={sceneIndex}
            onChange={(e) => {
              const i = Number(e.target.value);
              loadScene(stateFromScene(EXAMPLE_SCENES[i]!), i);
            }}
          >
            {EXAMPLE_SCENES.map((s, i) => (
              <option key={s.name} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn primary" disabled={running || blocked} onClick={doRun}>
          {running ? '계산 중…' : '▶ Run'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={history.current.past.length === 0}
          onClick={doUndo}
          title="실행 취소 (Ctrl+Z)"
        >
          ↶ 취소
        </button>
        <button
          type="button"
          className="btn"
          disabled={history.current.future.length === 0}
          onClick={doRedo}
          title="다시 실행 (Ctrl+Shift+Z)"
        >
          ↷ 다시
        </button>
        {stale ? <span className="stale-tag">오래된 결과</span> : null}
        <span className="spacer" />
        <ThemeToggle value={setting} onChange={setSetting} />
        <a href={docsUrl('physics')} target="_blank" rel="noopener">
          📘 물리 문서
        </a>
        <a href={docsUrl('roadmap')} target="_blank" rel="noopener">
          🗺️ 로드맵
        </a>
      </header>
      <main className="content">
        <div className="stage">
          <Viewport
            ref={viewportRef}
            surfaceColors={
              display.showSurface && !stale && derived?.surface
                ? surfaceColors(derived.surface, display.minDb)
                : null
            }
            domainScene={domainScene}
            editor={editor}
            selection={selection}
            gizmoMode={gizmoMode}
            snap={snap}
            draw={{ active: draw.active, points: draw.points, z: draw.z }}
            fitKey={fitKey}
            theme={resolved}
            slice={derived?.slice ?? null}
            showSlice={display.showSlice}
            minDb={display.minDb}
            waves={waves}
            showWave={display.showWave}
            clock={clock}
            onSelect={setSelection}
            onTransform={(id: string, t: Transform) => setEditor((s) => setTransform(s, id, t))}
            onMoveMarker={(kind, id, p) =>
              setEditor((s) =>
                kind === 'source'
                  ? updateSource(s, id, { position: p })
                  : updateReceiver(s, id, { position: p }),
              )
            }
            onDrawPoint={(p) => setDraw((d) => ({ ...d, points: [...d.points, p] }))}
            editLevel={editLevel}
            subSel={subSel}
            onSubPick={setSubSel}
            onSubMove={(id, groups, delta) =>
              setEditor((s) => {
                const o = s.objects.find((x) => x.id === id);
                if (!o) return s;
                return updateObject(s, id, {
                  base: moveGroups(o.base, getWeld(o.base), groups, delta),
                });
              })
            }
          />
          {derived && display.showSlice ? <Colorbar minDb={display.minDb} /> : null}
        </div>
        <aside className="panel">
          <EditorPanel
            state={editor}
            selection={selection}
            onSelect={setSelection}
            editLevel={editLevel}
            onEditLevel={setEditLevel}
            subCount={subSel?.groups.length ?? 0}
            gizmoMode={gizmoMode}
            onGizmoMode={setGizmoMode}
            snap={snap}
            onSnap={setSnap}
            draw={draw}
            onDraw={setDraw}
            onFinishDraw={onFinishDraw}
            onAdd={add}
            onAddSource={() => {
              const r = addSource(editor);
              setEditor(r.state);
              setSelection({ kind: 'source', id: r.id });
            }}
            onAddReceiver={() => {
              const r = addReceiver(editor);
              setEditor(r.state);
              setSelection({ kind: 'receiver', id: r.id });
            }}
            onImport={onImport}
            onSave={onSave}
            onLoad={(f) => void onLoad(f)}
          />
          <h3>속성</h3>
          <Inspector
            state={editor}
            selection={selection}
            onChange={setEditor}
            onSelect={setSelection}
            domainMaterials={DOMAIN_MATERIALS.filter((m) => m.id !== OPEN_MATERIAL_ID)}
          />
          <ControlPanel
            options={options}
            onOptions={setOptions}
            air={air}
            onAir={setAir}
            run={runStatus}
            onRun={doRun}
            onCancel={doCancel}
            runSettings={runSettings}
            onRunSettings={setRunSettings}
            display={display}
            onDisplay={setDisplay}
            zRange={[editor.domain.min[2], editor.domain.max[2]]}
            playing={readout.playing}
            onPlaying={(p) => {
              if (p && clock.t >= clock.tMax) clock.seek(0);
              clock.playing = p;
            }}
            speed={speed}
            onSpeed={setSpeed}
            loop={loop}
            onLoop={setLoop}
            tMs={readout.t * 1000}
            tMaxMs={clock.tMax * 1000}
            radius={readout.t * c}
            onSeekMs={(ms) => clock.seek(ms / 1000)}
          />
          {runError ? <div className="err">{runError}</div> : null}
          <h3>결과 (직접 + 반사 + 회절){stale ? ' · 오래된 결과' : ''}</h3>
          {derived ? (
            <>
              <ResultsPanel rows={derived.rows} />
              <div className="controls">
                <EchoPlot echoes={derived.echoes} />
              </div>
              <div className="controls">
                <ExportPanel
                  hasResult
                  stale={stale}
                  onResultsCsv={() =>
                    downloadCsv(`acoustic_results_${stamp()}.csv`, resultsCsv(derived.rows))
                  }
                  onEchoCsv={() => {
                    const e = derived.echoes[0];
                    if (e)
                      downloadCsv(`acoustic_echogram_${e.name}_${stamp()}.csv`, echoCsv(e.echo));
                  }}
                  onSliceCsv={() =>
                    downloadCsv(`acoustic_slice_${stamp()}.csv`, sliceCsv(derived.slice))
                  }
                  onPng={onPng}
                  onGif={onGif}
                  gifProgress={gifProgress}
                />
              </div>
            </>
          ) : (
            <div className="muted">Run 후에 표시됩니다.</div>
          )}
          <InfoPanel scene={scene} issues={issues} />
        </aside>
      </main>
    </div>
  );
}
