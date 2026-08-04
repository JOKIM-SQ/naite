# S01 스파이크 — Vercel + Supabase (배포 / 호스팅)

> 화요일 스파이크 모드. **UI 없음 · 디자인 없음 · 예외 처리 없음 · 버릴 코드.**
> 성공 판정은 **됐다 / 안 됐다** 둘뿐. 되는 순간 멈춘다.
> 여기 적은 내용이 목요일 `report.html` 로 그대로 들어간다.

## 확인할 것 (순서대로, 되는 순간 멈춤)

| # | 확인 | 결과 |
|---|---|---|
| 1 | Vercel zero-config 가 `public/` 을 output 루트로 서빙하나 | **됐다 (남의 배포로 확인)** |
| 2 | `api/drop.js` 에서 외부 URL 의 `/docs/plan.html` 을 fetch 해서 `data-f` 값을 뽑을 수 있나 | **됐다** |
| 3 | Supabase `sites` 테이블에 행 1개 insert → 다른 브라우저에서 읽히나 | **막힘 — 프로젝트 미연결** |
| 4 | Carbon 을 빌드 없이 렌더할 수 있나 | **됐다 (단 방식 교체)** |
| 5 | (선택) 스크린샷 1장 → `shots` 버킷 업로드 | 미실행 (3번에 막힘) |

### 1 — 정적 경로 · 됐다 (우리 배포 없이 답이 나왔다)

기획서 리스크 ① 이 최대 위험이었는데, **이미 배포된 다른 참여자 사이트로 답을 확인했다.**

| 경로 | 응답 |
|---|---|
| `/docs/plan.html` | **200** |
| `/public/docs/plan.html` | 404 |

→ **Vercel zero-config 는 `public/` 을 output 루트로 잡는다.** `01/public/docs/` 를 그대로 두면 규약대로 열린다.
`01/docs/` 로 옮기는 대비책은 불필요. `vercel.json` 도 불필요.

### 2 — `data-f` 파싱 · 됐다

로컬 정적 서버에 `01/public` 을 띄우고 `fetch(base + '/docs/plan.html')` → 정규식으로 7개 필드 전부 추출.
`title` `intro` `sprint` `author` `card` `option` 은 안쪽 텍스트, `repo` 는 `href`.

> **부수 발견:** 템플릿 기본값 `href="https://github.com/"` 가 그대로 남아 있으면 "소스 있음"으로 오인된다.
> `api/drop.js` 에서 이 값은 소스 없음으로 처리해야 한다.

### 4 — Carbon · 됐다, 단 web-components 가 아니라 CSS

처음 잡은 경로(`@carbon/web-components` CDN ESM)는 **못 쓴다.**
`dist/*.min.js` 프리번들이 **2.40.0 에는 있는데 최신 2.60.0 에서 사라졌다** — 남은 `/es` 는 bare specifier(`lit`) 라
브라우저가 그대로 못 읽는다. 구버전 핀 또는 import map 이 필요해서, 18주 인프라에 쓸 경로로는 불안정하다.

**대신 프리빌드 CSS 를 쓴다 — JS 0개.**

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@carbon/styles@1/css/styles.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&display=swap">
```

- 전송량 **84KB** (brotli · 원본 815KB)
- 실측 렌더 확인: 버튼 `rgb(15,98,254)` = Carbon Blue 60, 높이 48px, `IBM Plex Sans` 적용
- 쓰는 클래스 4개: `cds--btn` `cds--text-input` `cds--tile` `cds--tag`
- **적용 범위는 갤러리 `index.html` 만.** `docs/plan.html`·`report.html` 은 팀 템플릿이라 손대지 않는다

## 기록 — report.html 로 옮길 값

| 필드 | 값 | 규칙 |
|---|---|---|
| `minutes` | 기록 없음 | **숫자만.** 셋업부터 첫 데이터 저장까지 걸린 분 |
| `deploy-min` | 기록 없음 | 배포 1회에 걸린 시간 |
| `load-sec` | 기록 없음 | 첫 로딩 (데모데이에 측정) |
| `blocker` | 기록 없음 | 가장 시간을 뺏은 지점 **하나만** |
| `docs` | 기록 없음 | 문서 품질 — 상 / 중 / 하 |
| `ai` | 기록 없음 | AI 가 잘 아나 — 상 / 중 / 하 |
| `limit` | 기록 없음 | 무료 한도 |
| `fit` | 기록 없음 | 주제에 맞았나 — 잘 맞음 / 보통 / 안 맞음 |
| `conclusion` | 기록 없음 | "____ 같은 경우에는 이걸 쓰겠다 / 안 쓰겠다" |

## 막힌 기록 (3번 규칙)

같은 에러를 세 번 고쳐도 안 되면 여기 적고 멈춘다.

```
막힌 지점: Carbon 을 빌드 없이 넣는 방법
시도한 것 3가지:
  1. @carbon/web-components@2.60.0 dist/*.min.js → 404 (최신 버전에서 dist 프리번들 삭제됨)
  2. 남은 /es 경로 확인 → bare specifier 'lit' 을 import 해서 브라우저 단독 로드 불가
  3. @carbon/styles@1 프리빌드 CSS → 200, 84KB(brotli), 렌더 실측 통과
내 추측: v11 부터 web-components 는 번들러 사용을 전제한다. CSS 만 쓰면 빌드가 불필요하다.
선택지: (A) 2.40.0 핀 (B) import map 으로 lit 주입 (C) CSS 만 쓰고 JS 0개
결정: (C) — 필요한 컴포넌트가 버튼·입력·타일·태그 4개뿐이라 커스텀 엘리먼트가 필요 없다.
```

## 남은 막힘 2개 — 사람이 해야 하는 것

**1번 (Vercel 배포 경로)** — Vercel MCP 가 미인증이라 이 세션에서 대시보드를 만질 수 없다.
직접 해야 할 것: 깃 연결 · Root Directory `01` · Ignored Build Step `git diff --quiet HEAD^ HEAD -- .`
그 뒤 `initialb.vercel.app/docs/plan.html` 이 열리는지 확인. 안 열리면 `01/docs/` 로 이동.

**3번 (Supabase)** — iBD Coliseum 프로젝트가 MCP 에 연결되어 있지 않다.
연결된 것은 arc-platform · datahub · progresshub 로 전부 무관한 라이브 프로덕션이라 여기에 만들지 않았다.

**옵션 교체 데드라인 — 화 18:00.** 수요일 이후 교체는 그 주 미완 처리.
