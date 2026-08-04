# S01 실행 플랜 — DropBoard

> 기획서(무엇을) = [public/docs/plan.html](public/docs/plan.html) · 스파이크(되나) = [SPIKE.md](SPIKE.md) · **이 문서 = 어떤 순서로**
> Task 하나가 끝나면 **로컬에서 실제로 떠야** 다음으로 넘어간다. 반쯤 만든 걸 커밋하고 넘어가지 않는다.

## 만들 파일 — 3개로 끝

```
01/
├─ public/index.html   갤러리 (Carbon CSS · 드랍 입력 · 카드 그리드)
├─ api/drop.js     서버 함수 1개 — GET=목록 / POST=드랍
└─ public/docs/        plan.html · report.html (팀 템플릿 — 손대지 않는다)
```

## 착수 전에 확정한 것 2개

**① 서버 함수는 1개다. 목록 조회도 `api/drop.js` 가 한다 (`GET`).**
기획서의 「구현 형태」가 서버 함수 1개고, CLAUDE.md 규칙 6 이 "API 키를 클라이언트 코드에 두지 마라" 다.
클라이언트에서 Supabase 를 직접 읽으면 키가 브라우저에 박힌다. `api/sites.js` 를 새로 만들면 함수가 2개가 된다.
`GET`/`POST` 를 한 파일에서 갈라 쓰면 둘 다 지킨다.

**② DB 는 서버 함수만 만진다.** 브라우저가 Supabase 를 직접 부르지 않으므로 키가 노출되지 않는다.
함수는 `SUPABASE_ANON_KEY`(publishable) 로 접근한다 — RLS 가 이 키의 읽기·쓰기를 허용한다.

### SQL 은 실행하지 않는다 — `sites` 는 이미 있다

`sites` 테이블은 **iBD Coliseum 에 이미 존재하고, 다른 참여자의 라이브 갤러리가 이걸 읽고 있다.**
CLAUDE.md 가 지정한 공유 레지스트리이므로 **읽고 쓰되 스키마는 건드리지 않는다. DDL 0개.**

| 우리가 쓸 컬럼 | 비고 |
|---|---|
| `url` | unique |
| `sprint` `title` `author` `intro` `repo` | `data-f` 에서 그대로 |
| `stack_option` | ← `data-f="option"`. 우리 초안의 `option_name` 이 아니다 |
| `shot_url` | 스크린샷 **전체 공개 URL**. 버킷 경로가 아니다 |
| `created_at` | default now() |

> **`card`(스택 카드) 컬럼은 없다. 추가하지 않는다** — 공유 테이블에 DDL 을 치는 것은 남의 라이브 사이트를 건드리는 일이다.
> 그래서 필터 칩은 `stack_option` 기준으로 간다. (카드 기준이 더 깔끔하지만 이번 주 범위 밖)

> **업서트 금지.** `Prefer: resolution=merge-duplicates` 는 공유 테이블에서 남의 행을 덮어쓴다.
> 일반 insert 를 쓰고, `url` 중복은 "이미 등록됨" 으로 사용자에게 알린다.

### Vercel 환경변수 2개

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://mathlgugjqnnhsexvqjy.supabase.co` (iBD Coliseum) |
| `SUPABASE_ANON_KEY` | publishable 키 — **서버 함수에서만 읽는다** |

> **service_role 키는 쓰지 않는다.** 실측 결과 `sites` 의 RLS 가 anon 읽기·쓰기를 모두 허용한다
> (publishable 키로 READ 200, INSERT 는 RLS 통과 후 not-null 위반 400).
> DDL 도 없으므로 Supabase CLI 로그인·service_role 키가 전혀 필요 없다.

---

## Task 의존 그래프

```
Wave 1 (병렬)   A ─┐        B ─┐
Wave 2                 └──────┴─→ C   (Supabase 필요)
Wave 3                            ├─→ D  (happy path 완성 지점)
                                  └─→ E  (선택 — 실패하면 버린다)
Wave 4                                 └─→ F  (배포 확인 필요)
```

**A · B 는 지금 막힌 것과 무관하다** — Carbon·파싱 스파이크가 이미 통과했으므로 바로 착수 가능.
**C 부터 Supabase, F 는 배포 확인이 선행이다.**

---

## Task A — 갤러리 첫 화면

**파일:** `01/public/index.html` (신규) · **의존:** 없음

Step

1. Carbon 프리빌드 CSS + IBM Plex Sans `<link>` 2개 — 스파이크 4번에서 확정한 경로
   `https://cdn.jsdelivr.net/npm/@carbon/styles@1/css/styles.min.css`
2. 헤더 — 제목 + 한 줄 설명. **5초 안에 뭐 하는 사이트인지 읽히게** (완료 판정 항목)
3. 드랍 영역 — `cds--text-input` + `cds--btn`. 아직 아무 동작 없음
4. 카드 그리드 — `cds--tile` 하드코딩 더미 1장으로 레이아웃만 확인. **D 에서 반드시 지운다**
5. 모바일 폭 375px 에서 안 깨지는지 확인 (완료 판정 항목)

검증: 로컬에서 열어 Carbon 스타일이 먹고 375px 에서 레이아웃 유지
커밋: `feat(01): 갤러리 첫 화면 (A)`

## Task B — 기획서 파싱 서버 함수

**파일:** `01/api/drop.js` (신규) · **의존:** 없음

Step

1. `POST` 로 `{ url }` 받기. 끝 슬래시 제거
2. `fetch(url + '/docs/plan.html')` → `data-f` 7개 추출 — **스파이크 2번 코드를 그대로 옮긴다**
   `title` `intro` `sprint` `author` `card` `option` 은 안쪽 텍스트, `repo` 는 `href`
3. `repo` 가 템플릿 기본값 `https://github.com/` 이면 `null` — 스파이크 2번 부수 발견
4. 아직 DB 없음. 파싱 결과 JSON 을 그대로 응답
5. `01/public/index.html` 의 드랍 버튼을 이 함수에 연결 — 결과를 `console.log` 로만 확인

검증: 로컬에서 규약 준수 URL 하나 드랍 → 7개 필드가 콘솔에 찍힌다
커밋: `feat(01): 기획서 파싱 서버 함수 (B)`

## Task C — Supabase 저장 + 폴백

**파일:** `01/api/drop.js` · **의존:** B + 환경변수 2개

Step

1. 환경변수 2개 등록 (SQL 은 없다 — 테이블이 이미 있다)
2. 파싱 성공 → `sites` insert (REST `POST /rest/v1/sites`, `apikey` 헤더에 publishable 키)
3. **파싱 실패 → 도메인 카드 폴백.** `title` 에 호스트명, 나머지는 `null` 로 insert.
   기획서 성공 판정: "드랍 실패는 없다"
4. `url` 중복(409) → **덮어쓰지 않고** "이미 등록됨" 으로 응답. 공유 테이블이라 업서트 금지
5. `GET` 분기 추가 — `sites` 를 `created_at desc` 로 조회해 JSON 응답

검증: 규약 준수 URL·미준수 URL 각 1개 드랍 → 행 2개 추가, `GET` 이 기존 행까지 반환
커밋: `feat(01): Supabase 저장 + 폴백 (C)`

## Task D — 카드 목록 렌더 · **happy path 완성 지점**

**파일:** `01/public/index.html` · **의존:** A + C

Step

1. **A 의 더미 카드를 지운다** — 기획서 제약 "데이터 하드코딩 금지"
2. 로드 시 `GET /api/drop` → 카드 렌더. 카드 클릭 시 해당 사이트로 이동
3. 스택 칩 `cds--tag` 표시 — **토글 필터 하나만.** 복합 조건·정렬·검색은 안 만드는 것 1번
4. 드랍 성공 후 목록 갱신
5. 카드 0장일 때 빈 화면 문구

검증: 드랍 → 새로고침 → 카드가 늘어난다. **다른 브라우저(시크릿 창)에서도 보인다**
커밋: `feat(01): 카드 목록 렌더 (D)`

> **여기까지가 이번 주 성공 조건이다.** E 는 선택, F 는 제출물.

## Task D-2 — UI 리디자인 (handoff 적용) · 완료

**파일:** `01/public/index.html` · **의존:** D · 근거: `Downloads/갤러리 UI 현대화 디자인.zip`

디자인 handoff(Carbon g100 다크·Montserrat+Inter·pill 필터)를 기존 바닐라 패턴에 재구현했다.
프레임워크 도입 없음, `api/drop.js` 변경 없음 — handoff README 의 지시대로.

Step

1. Carbon `--cds-g100` 다크 토큰 + Montserrat/Inter 웹폰트로 교체
2. 상단 바(sticky, 진행 바) · 히어로 · pill 필터 · 카드 그리드 재구현
3. **필터를 주차·스택·등록자 3종 AND 드롭다운으로 확장** — 「안 만드는 것 1」을 이 범위로 재정의(PLAN.md 05 참조)
4. **스택이 복수(`"Vercel, Supabase"`)면 배지를 각각 분리해 단다** — 칩 1개짜리 문자열 가정을 깸
5. 썸네일 없으면 도메인 이니셜 플레이스홀더 (Task E 의 실제 스크린샷으로 대체될 자리)

검증(로컬, 실제 스키마 데이터 주입): 카드 렌더·필터 3종 토글·카운트·바깥 클릭 닫힘·카드 클릭 이동 통과.
375px 에서 상단 바 pill 이 안 줄어들어 13px 가로 스크롤 발생 → `.pill` 을 `flex:0 1 232px` 로 수정해 해결.
커밋: `feat(01): UI 리디자인 — Carbon g100 다크 + 필터 3종 (D-2)`

## Task E — 썸네일 (선택)

**파일:** `01/public/index.html` · **의존:** C · **실패하면 버린다**

**방식 변경 — 서버가 아니라 클라이언트에서 찍는다.**
다른 참여자 구현을 확인한 결과 `api.microlink.io` 를 **브라우저에서** 호출한다. 키가 필요 없고
Vercel 함수 실행 시간·번들 제한을 아예 안 건드린다 — 기획서 리스크 ② 가 이 방식으로 사라진다.

Step

1. 드랍 직전에 브라우저에서 `api.microlink.io` 로 스크린샷 요청 (10초쯤 걸린다 — 진행 문구 표시)
2. 받은 이미지 URL 을 `POST /api/drop` 에 같이 넘겨 `shot_url` 에 저장
3. **실패해도 드랍은 성공해야 한다** — try/catch, `shot_url` 은 `null`
4. 카드에 썸네일 표시, 없으면 지금 모양 유지

검증: 드랍 1회에 썸네일이 붙는다. 스크린샷 요청을 막아도 드랍은 성공한다
커밋: `feat(01): 썸네일 (E)`

## Task F — 제출물

**파일:** `01/public/docs/report.html` · **의존:** 배포 완료

Step

1. **셀프 드랍** — 갤러리에 `dropboard-pi.vercel.app` 을 드랍해 자기 규약 준수를 검증
2. `report.html` 의 `data-f` 텍스트만 채운다. `minutes` `deploy-min` `blocker` `docs` `ai` `limit` `fit` `conclusion`
   → 근거는 [SPIKE.md](SPIKE.md). **추측으로 채우지 말고 모르면 `기록 없음`**
3. `data-f="url"` 의 `href` 를 배포 주소로
4. `plan.html` 과 실제로 만든 것이 어긋난 곳 확인 — 특히 안 만드는 것 3개
5. 데모 3분 클릭 순서 5줄

커밋: `docs(01): 스택 리포트 (F)`

---

## 멈추는 조건

- 같은 에러 **3번** 고쳐도 안 되면 멈추고 보고 (막힌 지점 / 시도 3가지 / 추측 / 선택지 3개)
- **목요일에 새 기능 시작 금지.** 배포와 첫 화면 정리만
- **금 09:00 이후 커밋은 데모에서 무효** (git 로그로 확인된다)

## 안 만드는 것 — Task 안에서 재확인

| 안 만드는 것 | 어디서 지켜지나 |
|---|---|
| 필터 심화 | D-3 — 스택 칩 토글 하나만 |
| 검색 | 어느 Task 에도 없음 |
| 수정·삭제 UI | 어느 Task 에도 없음. `api/drop.js` 는 `GET`·`POST` 만 |
