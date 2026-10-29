import { useState } from 'react';

export interface GifOptions {
  frames: number; // 프레임 수
  width: number; // 가로 픽셀
  delayMs: number; // 프레임 간격 [ms]
}

export interface ExportPanelProps {
  hasResult: boolean; // Run 결과가 있음
  stale: boolean; // 결과가 오래됨
  onResultsCsv: () => void;
  onEchoCsv: () => void;
  onSliceCsv: () => void;
  onPng: () => void;
  onGif: (o: GifOptions) => void;
  gifProgress: number | null; // 0~1, 만드는 중이 아니면 null
}

/** 결과 내보내기: CSV(표·에코그램·슬라이스), 3D 뷰 PNG, 재생 GIF. */
export function ExportPanel(p: ExportPanelProps) {
  const [g, setG] = useState<GifOptions>({ frames: 60, width: 640, delayMs: 80 });
  const off = !p.hasResult;
  return (
    <details open>
      <summary>내보내기 (CSV · PNG · GIF)</summary>
      <div className="row wrap">
        <button type="button" className="btn" disabled={off} onClick={p.onResultsCsv}>
          결과 표 CSV
        </button>
        <button type="button" className="btn" disabled={off} onClick={p.onEchoCsv}>
          에코그램 CSV
        </button>
        <button type="button" className="btn" disabled={off} onClick={p.onSliceCsv}>
          슬라이스 CSV
        </button>
        <button type="button" className="btn" disabled={off} onClick={p.onPng}>
          3D 뷰 PNG
        </button>
      </div>
      <div className="grid3">
        <label className="field">
          GIF 프레임 수
          <input
            type="number"
            min={10}
            max={200}
            step={10}
            value={g.frames}
            onChange={(e) =>
              setG({ ...g, frames: Math.min(200, Math.max(10, Number(e.target.value) || 60)) })
            }
          />
        </label>
        <label className="field">
          가로 [px]
          <select value={g.width} onChange={(e) => setG({ ...g, width: Number(e.target.value) })}>
            {[480, 640, 800, 960].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          간격 [ms]
          <select
            value={g.delayMs}
            onChange={(e) => setG({ ...g, delayMs: Number(e.target.value) })}
          >
            {[40, 60, 80, 100, 150].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        className="btn primary"
        disabled={off || p.gifProgress !== null}
        onClick={() => p.onGif(g)}
      >
        {p.gifProgress !== null
          ? `GIF 만드는 중… ${(p.gifProgress * 100).toFixed(0)} %`
          : '재생 GIF 만들기'}
      </button>
      <div className="muted">
        GIF는 Run 결과의 파면 재생(0 ms ~ 끝)을 현재 카메라 시점으로 프레임마다 그려 만듭니다.
        {p.stale ? ' 장면이 편집되어 오래된 결과를 내보내게 됩니다.' : ''}
      </div>
    </details>
  );
}
