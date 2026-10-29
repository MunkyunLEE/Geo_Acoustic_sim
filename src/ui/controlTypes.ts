import type { AirConditions } from '../solver/core/airAbsorption';
import type { LevelSelection } from '../solver/physics/direct';
import type { WaveStyle } from './Viewport';

/** 표시 설정. */
export interface DisplaySettings {
  sel: LevelSelection; // 표시할 레벨 (밴드/전체/A가중 전체)
  minDb: number; // 컬러맵 하한 [dB], 상한은 0 dB
  showSlice: boolean; // 슬라이스 컬러맵 표시
  showWave: boolean; // 파면 표시
  showSurface: boolean; // 면 입사 에너지 색칠 (확산 계산을 켠 경우)
  waveStyle: WaveStyle; // 파면 표시 방식 (점/면)
  sliceZ: number; // 슬라이스 높이 [m]
}

/** 공기 흡음 설정. enabled=false면 α=0. */
export interface AirSettings extends AirConditions {
  enabled: boolean;
}

/** Run 설정 (확산 반사 몬테카를로). 레이 수는 음원·밴드당. */
export interface RunSettings {
  diffuse: boolean; // 확산 반사(몬테카를로) 계산
  rays: number; // 음원·밴드당 레이 수
  maxBounces: number; // 레이당 최대 반사 횟수
  seed: number; // 난수 시드 (같은 값이면 같은 결과)
}

export const DEFAULT_RUN_SETTINGS: RunSettings = {
  diffuse: true,
  rays: 5000,
  maxBounces: 60,
  seed: 20261021,
};

export const RAY_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 2000, label: '2,000 (프리뷰)' },
  { value: 5000, label: '5,000 (기본)' },
  { value: 20000, label: '20,000' },
  { value: 50000, label: '50,000 (느림)' },
];

export type PickTarget = 'off' | 'source' | 'receiver';

export const SPEED_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0.001, label: '1/1000 (매우 느림)' },
  { value: 0.003, label: '1/300' },
  { value: 0.01, label: '1/100 (기본)' },
  { value: 0.03, label: '1/30' },
  { value: 0.1, label: '1/10' },
  { value: 1, label: '1 (실제 속도)' },
];

/** 계산 품질 프리셋: 레이 수·최대 반사 횟수·정반사 차수를 한 번에 정한다 (값은 속도/정밀도 절충용 기본값, 검증값 아님). */
export interface QualityPreset {
  id: 'preview' | 'normal' | 'high';
  label: string;
  rays: number; // 음원·밴드당 레이 수
  maxBounces: number; // 레이당 최대 반사 횟수
  maxOrder: number; // 이미지 음원 최대 차수
}

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  { id: 'preview', label: 'Preview (빠름)', rays: 2000, maxBounces: 30, maxOrder: 1 },
  { id: 'normal', label: 'Normal (기본)', rays: 5000, maxBounces: 60, maxOrder: 2 },
  { id: 'high', label: 'High (느림)', rays: 20000, maxBounces: 100, maxOrder: 3 },
];
