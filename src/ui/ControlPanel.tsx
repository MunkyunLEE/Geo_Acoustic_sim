import { BAND_CENTERS } from '../types';
import type { LevelSelection } from '../solver/physics/direct';
import type { FieldOptions } from '../solver/physics/field';
import { Help } from './fields';
import {
  QUALITY_PRESETS,
  RAY_OPTIONS,
  SPEED_OPTIONS,
  type AirSettings,
  type DisplaySettings,
  type RunSettings,
} from './controlTypes';
import type { WaveStyle } from './Viewport';

export interface RunStatus {
  running: boolean; // 계산 중
  hasResult: boolean; // 결과가 있음
  stale: boolean; // 결과 이후 장면이 편집됨
  blocked: boolean; // 입력 오류로 실행 불가
  elapsedMs: number | null; // 마지막 실행 시간
  truncated: boolean; // 반사 경로 상한 때문에 차수가 줄었는지
  progress: number | null; // 확산 계산 진행률 0~1 (계산 중이 아니면 null)
  cancelled: boolean; // 마지막 Run이 취소되었는지
  rays: number | null; // 마지막 결과에 쓰인 밴드당 레이 수 (확산 없음이면 null)
}

export interface ControlPanelProps {
  options: FieldOptions;
  onOptions: (o: FieldOptions) => void;
  air: AirSettings;
  onAir: (a: AirSettings) => void;
  run: RunStatus;
  onRun: () => void;
  onCancel: () => void;
  runSettings: RunSettings;
  onRunSettings: (s: RunSettings) => void;
  display: DisplaySettings;
  onDisplay: (d: DisplaySettings) => void;
  zRange: [number, number];
  playing: boolean;
  onPlaying: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
  loop: boolean;
  onLoop: (l: boolean) => void;
  tMs: number;
  tMaxMs: number;
  radius: number;
  onSeekMs: (ms: number) => void;
}

/** 계산 설정 · Run · 결과 표시와 재생. 편집은 EditorPanel/Inspector가 맡는다. */
export function ControlPanel(p: ControlPanelProps) {
  const d = p.display;
  const set = (patch: Partial<DisplaySettings>) => p.onDisplay({ ...d, ...patch });
  const r = p.run;
  const canShow = r.hasResult;
  return (
    <div className="controls">
      <details open>
        <summary>
          계산 설정 · Run <Help anchor="#image-source" label="이미지 음원법과 회절" />
        </summary>
        <label className="field">
          품질 프리셋 (레이 수 · 반사 횟수 · 차수 한 번에)
          <select
            value={
              QUALITY_PRESETS.find(
                (q) =>
                  q.rays === p.runSettings.rays &&
                  q.maxBounces === p.runSettings.maxBounces &&
                  q.maxOrder === p.options.maxOrder,
              )?.id ?? 'custom'
            }
            onChange={(e) => {
              const q = QUALITY_PRESETS.find((x) => x.id === e.target.value);
              if (!q) return;
              p.onRunSettings({ ...p.runSettings, rays: q.rays, maxBounces: q.maxBounces });
              p.onOptions({ ...p.options, maxOrder: q.maxOrder });
            }}
          >
            <option value="custom" disabled>
              사용자 지정
            </option>
            {QUALITY_PRESETS.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label} — {q.rays.toLocaleString()} 레이 · 반사 {q.maxBounces} · 차수 {q.maxOrder}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={p.options.direct}
            onChange={(e) => p.onOptions({ ...p.options, direct: e.target.checked })}
          />{' '}
          직접음
        </label>
        <label className="field">
          정반사 최대 차수 (0 = 끔)
          <select
            value={p.options.maxOrder}
            onChange={(e) => p.onOptions({ ...p.options, maxOrder: Number(e.target.value) })}
          >
            {[0, 1, 2, 3].map((o) => (
              <option key={o} value={o}>
                {o}
                {o === 2 ? ' (기본)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={p.options.diffraction}
            onChange={(e) => p.onOptions({ ...p.options, diffraction: e.target.checked })}
          />{' '}
          회절 (차폐 보정, ISO 9613-2)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={p.runSettings.diffuse}
            onChange={(e) => p.onRunSettings({ ...p.runSettings, diffuse: e.target.checked })}
          />{' '}
          확산 반사 (몬테카를로) <Help anchor="#diffuse" label="확산 반사와 수신 구 추정자" />
        </label>
        {p.runSettings.diffuse ? (
          <div className="grid3">
            <label className="field">
              레이 수 (밴드당)
              <select
                value={p.runSettings.rays}
                onChange={(e) =>
                  p.onRunSettings({ ...p.runSettings, rays: Number(e.target.value) })
                }
              >
                {RAY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              최대 반사 횟수
              <input
                type="number"
                min={1}
                max={500}
                step={10}
                value={p.runSettings.maxBounces}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (v >= 1 && v <= 500) p.onRunSettings({ ...p.runSettings, maxBounces: v });
                }}
              />
            </label>
            <label className="field">
              시드
              <input
                type="number"
                step={1}
                value={p.runSettings.seed}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) p.onRunSettings({ ...p.runSettings, seed: v });
                }}
              />
            </label>
          </div>
        ) : null}
        <details>
          <summary>공기 흡음 (ISO 9613-1)</summary>
          <label className="check">
            <input
              type="checkbox"
              checked={p.air.enabled}
              onChange={(e) => p.onAir({ ...p.air, enabled: e.target.checked })}
            />{' '}
            사용
          </label>
          <div className="grid3">
            <label className="field">
              온도 [°C]
              <input
                type="number"
                value={p.air.temperatureC}
                step={1}
                min={-20}
                max={50}
                onChange={(e) => p.onAir({ ...p.air, temperatureC: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              습도 [%]
              <input
                type="number"
                value={p.air.relativeHumidityPct}
                step={5}
                min={5}
                max={100}
                onChange={(e) => p.onAir({ ...p.air, relativeHumidityPct: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              기압 [kPa]
              <input
                type="number"
                value={p.air.pressureKPa}
                step={1}
                min={80}
                max={110}
                onChange={(e) => p.onAir({ ...p.air, pressureKPa: Number(e.target.value) })}
              />
            </label>
          </div>
        </details>
        <button
          type="button"
          className="btn primary run"
          disabled={r.running || r.blocked}
          onClick={p.onRun}
        >
          {r.running ? '계산 중…' : '▶ Run (해석 실행)'}
        </button>
        {r.running && r.progress !== null ? (
          <div>
            <progress value={r.progress} max={1} style={{ width: '100%' }} />
            <div className="row">
              <span className="muted">확산 계산 {(r.progress * 100).toFixed(0)} %</span>
              <button type="button" className="btn danger" onClick={p.onCancel}>
                계산 취소
              </button>
            </div>
          </div>
        ) : null}
        {r.cancelled && !r.running ? (
          <div className="notice">계산을 취소했습니다. 이전 결과가 그대로 남아 있습니다.</div>
        ) : null}
        {r.blocked ? (
          <div className="err">
            입력 오류가 있어 실행할 수 없습니다. 아래 검증 항목을 확인하세요.
          </div>
        ) : null}
        {r.hasResult && !r.stale && !r.running ? (
          <div className="ok">
            결과가 최신입니다{r.elapsedMs !== null ? ` (계산 ${r.elapsedMs.toFixed(0)} ms)` : ''}.
          </div>
        ) : null}
        {r.hasResult && r.rays !== null && !r.running ? (
          <div className="muted">
            확산 계산: 음원·밴드당 {r.rays.toLocaleString()}개 레이. 표준오차는 결과 표의 ±값 (배치
            8개 기준, 근사)입니다.
          </div>
        ) : null}
        {r.stale ? (
          <div className="notice">
            장면이 편집되어 아래 결과는 오래된 결과입니다. 다시 Run 하세요.
          </div>
        ) : null}
        {!r.hasResult && !r.running ? (
          <div className="muted">장면을 구성한 뒤 Run을 누르면 해석 결과가 만들어집니다.</div>
        ) : null}
        {r.truncated ? (
          <div className="notice">
            반사 경로 수가 상한에 도달해 일부 차수가 줄었습니다. 결과가 낮게 나올 수 있습니다.
          </div>
        ) : null}
      </details>

      <details open>
        <summary>결과 시뮬레이션 (재생)</summary>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!canShow}
            onClick={() => p.onPlaying(!p.playing)}
          >
            {p.playing ? '⏸ 멈춤' : '▶ 재생'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canShow}
            onClick={() => {
              p.onPlaying(false);
              p.onSeekMs(0);
            }}
          >
            ⏮ 처음
          </button>
          <label className="check">
            <input type="checkbox" checked={p.loop} onChange={(e) => p.onLoop(e.target.checked)} />{' '}
            반복
          </label>
        </div>
        <input
          type="range"
          className="slider"
          disabled={!canShow}
          min={0}
          max={Math.max(p.tMaxMs, 0.001)}
          step={Math.max(p.tMaxMs / 500, 0.001)}
          value={Math.min(p.tMs, p.tMaxMs)}
          aria-label="시간"
          onChange={(e) => p.onSeekMs(Number(e.target.value))}
        />
        <div className="muted">
          t = {p.tMs.toFixed(1)} / {p.tMaxMs.toFixed(1)} ms · 파면 반경 {p.radius.toFixed(2)} m
        </div>
        <label className="field">
          재생 속도 (실제 대비)
          <select value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))}>
            {SPEED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="muted">파면은 정반사를 따라 진행하며 회절파는 그리지 않습니다.</div>
      </details>

      <details open>
        <summary>결과 표시</summary>
        <label className="check">
          <input
            type="checkbox"
            checked={d.showSlice}
            onChange={(e) => set({ showSlice: e.target.checked })}
          />{' '}
          슬라이스 컬러맵
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={d.showWave}
            onChange={(e) => set({ showWave: e.target.checked })}
          />{' '}
          파면
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={d.showSurface}
            onChange={(e) => set({ showSurface: e.target.checked })}
          />{' '}
          면 입사 에너지 색칠 (확산 계산 켠 경우)
        </label>
        <label className="field">
          파면 표시 방식
          <select
            value={d.waveStyle}
            onChange={(e) => set({ waveStyle: e.target.value as WaveStyle })}
          >
            <option value="points">점</option>
            <option value="surface">면</option>
          </select>
        </label>
        <label className="field">
          슬라이스 높이 z = {d.sliceZ.toFixed(2)} m (Run 시점 값, 바꾸면 다시 Run)
          <input
            type="range"
            className="slider"
            min={p.zRange[0]}
            max={p.zRange[1]}
            step={0.05}
            value={Math.min(Math.max(d.sliceZ, p.zRange[0]), p.zRange[1])}
            onChange={(e) => set({ sliceZ: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          표시 레벨 (바꾸면 다시 Run)
          <select
            value={String(d.sel)}
            onChange={(e) => {
              const v = e.target.value;
              set({ sel: (v === 'total' || v === 'totalA' ? v : Number(v)) as LevelSelection });
            }}
          >
            <option value="total">전체 (에너지 평균)</option>
            <option value="totalA">전체 A가중</option>
            {BAND_CENTERS.map((f) => (
              <option key={f} value={f}>
                {f} Hz
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          컬러맵 하한 [dB]
          <input
            type="number"
            step={5}
            min={-120}
            max={-10}
            value={d.minDb}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v < -5) set({ minDb: v });
            }}
          />
        </label>
      </details>
    </div>
  );
}
