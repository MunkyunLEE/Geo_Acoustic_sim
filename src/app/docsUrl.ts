/** 문서 페이지 이름. public/docs/ 아래 파일과 일치한다. */
export type DocPage = 'physics' | 'roadmap';

/**
 * 앱 → 문서 링크. BASE_URL을 붙여 GitHub Pages 하위 경로(/acoustic-simulator/)에서도 동작한다.
 * 앵커 예: '#receiver' (물리 문서 장 id)
 */
export function docsUrl(
  page: DocPage = 'physics', // 열 문서
  anchor = '', // '#' 로 시작하는 장 id (선택)
  base: string = import.meta.env.BASE_URL, // 테스트에서 주입 가능
): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}docs/${page}.html${anchor}`;
}
