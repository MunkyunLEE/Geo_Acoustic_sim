import { cssGradient } from '../visualization/colormap';

/** 컬러바: 위 0 dB(음원 1 m 자유장 기준), 아래 minDb. */
export function Colorbar({ minDb }: { minDb: number }) {
  return (
    <div className="colorbar" aria-label="상대 레벨 컬러바">
      <div className="colorbar-title">상대 레벨 [dB]</div>
      <div className="colorbar-body">
        <div className="colorbar-ramp" style={{ background: cssGradient('to top') }} />
        <div className="colorbar-ticks">
          <span>0</span>
          <span>{Math.round(minDb / 2)}</span>
          <span>{minDb}</span>
        </div>
      </div>
    </div>
  );
}
