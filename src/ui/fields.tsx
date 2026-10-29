import { docsUrl } from '../app/docsUrl';
import { BAND_CENTERS, type PerBand, type Vec3 } from '../types';

/** 물리 문서의 해당 장으로 가는 ⓘ 링크. */
export function Help({ anchor, label }: { anchor: string; label: string }) {
  return (
    <a
      className="help"
      href={docsUrl('physics', anchor)}
      target="_blank"
      rel="noopener"
      title={label}
    >
      ⓘ
    </a>
  );
}

/** x, y, z 숫자 입력 한 줄. */
export function PosInput({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  step?: number; // 화살표 한 번의 증가량
}) {
  return (
    <div className="pos-row">
      <span className="pos-label">{label}</span>
      {([0, 1, 2] as const).map((i) => (
        <input
          key={i}
          type="number"
          step={step}
          value={Number(value[i].toFixed(3))}
          aria-label={`${label} ${'xyz'[i]}`}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            onChange([i === 0 ? v : value[0], i === 1 ? v : value[1], i === 2 ? v : value[2]]);
          }}
        />
      ))}
    </div>
  );
}

/** 밴드별 값 6개 입력 (흡음률, 산란 계수, Lw 등). */
export function BandInputs({
  label,
  value,
  onChange,
  step = 0.05,
  min,
  max,
}: {
  label: string;
  value: PerBand<number>;
  onChange: (band: number, v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <div className="muted">{label}</div>
      <table className="bands">
        <thead>
          <tr>
            {BAND_CENTERS.map((f) => (
              <th key={f}>{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {BAND_CENTERS.map((f) => (
              <td key={f}>
                <input
                  type="number"
                  className="band-in"
                  step={step}
                  min={min}
                  max={max}
                  value={value[f]}
                  aria-label={`${label} ${f} Hz`}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) onChange(f, v);
                  }}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** 투과손실 TL [dB] 밴드 입력. 저장 값은 투과율 τ = 10^(−TL/10)이고 τ = 0이면 칸을 비워 둔다 (투과 없음). */
export function TlInputs({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PerBand<number> | undefined;
  onChange: (band: number, tau: number) => void;
}) {
  return (
    <div>
      <div className="muted">{label}</div>
      <table className="bands">
        <thead>
          <tr>
            {BAND_CENTERS.map((f) => (
              <th key={f}>{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {BAND_CENTERS.map((f) => {
              const tau = value?.[f] ?? 0;
              return (
                <td key={f}>
                  <input
                    type="number"
                    className="band-in"
                    step={1}
                    min={0}
                    placeholder="∞"
                    value={tau > 0 ? Number((-10 * Math.log10(tau)).toFixed(1)) : ''}
                    aria-label={`투과손실 TL ${f} Hz`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const tl = Number(raw);
                      onChange(
                        f,
                        raw === '' || !Number.isFinite(tl)
                          ? 0
                          : Math.pow(10, -Math.max(0, tl) / 10),
                      );
                    }}
                  />
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
