import type { ThemeSetting } from '../app/theme';

const LABELS: Record<ThemeSetting, string> = { system: '시스템', light: '라이트', dark: '다크' };

/** 테마 선택: 기본은 OS 설정을 따른다. 선택은 물리 문서 페이지에도 적용된다. */
export function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemeSetting;
  onChange: (s: ThemeSetting) => void;
}) {
  return (
    <label className="scene-select" title="화면 테마 (시스템 = 컴퓨터 설정을 따름)">
      테마
      <select value={value} onChange={(e) => onChange(e.target.value as ThemeSetting)}>
        {(Object.keys(LABELS) as ThemeSetting[]).map((k) => (
          <option key={k} value={k}>
            {LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
