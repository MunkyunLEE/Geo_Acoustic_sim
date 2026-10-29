import { useCallback, useEffect, useState } from 'react';

export type ThemeSetting = 'system' | 'light' | 'dark'; // 사용자 선택 (기본: 시스템 따라가기)
export type ThemeName = 'light' | 'dark'; // 실제 적용 테마

/** 물리 문서(public/docs)와 같은 키를 쓰므로 선택이 문서에도 반영된다. */
export const THEME_KEY = 'acoustic-theme';

export function loadThemeSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* 저장소 사용 불가: 시스템 설정으로 */
  }
  return 'system';
}

/** <html data-theme>를 설정한다. 'system'이면 속성을 지워 CSS의 prefers-color-scheme이 결정한다. */
export function applyThemeSetting(s: ThemeSetting): void {
  const root = document.documentElement;
  if (s === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s);
}

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

export function useTheme(): {
  setting: ThemeSetting;
  resolved: ThemeName;
  setSetting: (s: ThemeSetting) => void;
} {
  const [setting, setSettingState] = useState<ThemeSetting>(loadThemeSetting);
  const [systemDark, setSystemDark] = useState(() => query().matches);

  useEffect(() => {
    const mq = query();
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => applyThemeSetting(setting), [setting]);

  const setSetting = useCallback((s: ThemeSetting) => {
    setSettingState(s);
    try {
      localStorage.setItem(THEME_KEY, s);
    } catch {
      /* 저장 실패는 무시 */
    }
  }, []);
  const resolved: ThemeName = setting === 'system' ? (systemDark ? 'dark' : 'light') : setting;
  return { setting, resolved, setSetting };
}
