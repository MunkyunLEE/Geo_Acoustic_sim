# Acoustic Simulator

브라우저 전용 3D 기하음향 시뮬레이터 (GitHub Pages). 현재 **STEP 6 (에코그램·표면 입사 에너지·CSV/PNG/GIF 내보내기, 면음원, 투과)** 단계입니다. 화면 테마는 OS 설정(라이트/다크)을 따르며 상단에서 바꿀 수 있습니다.

- 결과는 절대 SPL이 아니라 음원 대비 상대 레벨입니다 (자유장 1 m = 0 dB).
- 기하음향 근사 기반의 스크리닝 도구이며, 검증 전 결과는 "미검증 프리뷰"입니다.
- 문서: [로드맵](docs/ROADMAP.md) · [결정 기록](docs/decisions.md) · [가정](docs/assumptions.md) · [검증 현황](docs/validation.md) · 물리 기초 `public/docs/physics.html`

## 명령어

Node.js 22 이상을 권장합니다 (개발·검증은 Node 22.22, npm 10.9에서 수행).

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (http://localhost:5173/)
npm run test       # 테스트 (Vitest)
npm run lint       # ESLint
npm run build      # 타입 검사 + 프로덕션 빌드 (dist/)
npm run preview    # 빌드 결과 미리보기 (http://localhost:4173/)
```

## GitHub Pages 배포 (Deploy from a branch)

1. `npm run build`를 실행하면 `docs/`에 배포용 결과물이 만들어집니다 (저장소에 포함되어 있음).
2. 저장소 Settings → Pages → Source를 **Deploy from a branch**, Branch **main**, 폴더 **/docs**로 지정합니다.
3. 소스를 고친 뒤에는 다시 `npm run build` 후 `docs/` 변경분을 commit·push 합니다. (프로젝트 문서는 `project-docs/`에 있습니다.)

배포 주소는 `https://<계정>.github.io/<저장소이름>/`, 문서는 `.../docs/physics.html` 입니다.

## 폴더 구조

```
src/
  app/            앱 진입, 문서 링크(docsUrl)
  ui/             React 컴포넌트 (Viewport, InfoPanel)
  geometry/       기본 도형, 바운딩 박스
  solver/core/    단위, dB, 밴드, 벡터, 공기 흡음, 입력 검증 (React·three.js 비의존)
  solver/tracing/ 삼각형 BVH, 레이 교차, 가시선
  solver/physics/ 직접음 이득, 상대 레벨
  solver/receivers/ 수평 슬라이스 격자
  io/             STL/OBJ 임포트 (단위·Y-up 변환)
  visualization/  컬러맵, 파면 모델, 시계, Three.js 오브젝트 (표시 전용)
  data/           예시 재료, 예시 장면
  types/          Scene, Source, Material, Receiver, 밴드 타입
tests/unit/       단위 테스트
docs/             로드맵, 결정 기록, 가정, 검증 현황
public/docs/      웹에서 열리는 문서 (physics.html, roadmap.html)
```
