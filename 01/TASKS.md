# S01 실행 플랜 — initial-B

> 기획서(무엇을) = [public/docs/plan.html](public/docs/plan.html) · 스파이크(되나) = [SPIKE.md](SPIKE.md) · **이 문서 = 어떤 순서로**
> Task 하나가 끝나면 **로컬에서 실제로 떠야** 다음으로 넘어간다. 반쯤 만든 걸 커밋하고 넘어가지 않는다.

## 만들 파일 — 3개로 끝

```
01/
├─ index.html      갤러리 (Carbon CSS · 드랍 입력 · 카드 그리드)
├─ api/drop.js     서버 함수 1개 — GET=목록 / POST=드랍
└─ public/docs/    plan.html · report.html (팀 템플릿 — 손대지 않는다)
```

## 착수 전에 확정한 것 2개

**① 서버 함수는 1개다. 목록 조회도 `api/drop.js` 가 한다 (`GET`).**
기획서의 「구현 형태」가 서버 함수 1개고, CLAUDE.md 규칙 6 이 "API 키를 클라이언트 코드에 두지 마라" 다.
클라이언트에서 Supabase 를 직접 읽으면 키가 브라우저에 박힌다. `api/sites.js` 를 새로 만들면 함수가 2개가 된다.
`GET`/`POST` 를 한 파일에서 갈라 쓰면 둘 다 지킨다.

**② DB 는 서버 함수만 만진다 — anon 정책을 열지 않는다.**
앞서 제안한 anon SELECT·INSERT 정책은 **취소한다.** 브라우저가 DB 를 직접 부르지 않으므로 불필요하고,
정책을 안 열면 RLS 가 전부 막은 상태로 남아 더 안전하다. 함수는 `SUPABASE_SERVICE_ROLE_KEY` 로 접근한다 (RLS 우회).

### 실행할 SQL (Supabase SQL 에디터)

```sql
create table sites (
  id bigint generated always as identity primary key,
  url text not null unique,
  sprint text, title text, author text, card text, option_name text, intro text, repo text,
  shot_path text,
  created_at timestamptz not null default now()
);
alter table sites enable row level security;   -- 정책 없음 = anon 전면 차단, service_role 만 통과

insert into storage.buckets (id, name, public) values ('shots', 'shots', true);
```

### Vercel 환경변수 2개

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | iBD Coliseum 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 — **서버 함수에서만 읽는다** |

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

**파일:** `01/index.html` (신규) · **의존:** 없음

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
5. `01/index.html` 의 드랍 버튼을 이 함수에 연결 — 결과를 `console.log` 로만 확인

검증: 로컬에서 규약 준수 URL 하나 드랍 → 7개 필드가 콘솔에 찍힌다
커밋: `feat(01): 기획서 파싱 서버 함수 (B)`

## Task C — Supabase 저장 + 폴백

**파일:** `01/api/drop.js` · **의존:** B + Supabase 세팅 · **막힘: 프로젝트 미연결**

Step

1. 위 SQL 실행 + 환경변수 2개 등록
2. 파싱 성공 → `sites` insert (REST `POST /rest/v1/sites`, `apikey` 헤더에 service_role)
3. **파싱 실패 → 도메인 카드 폴백.** `title` 에 호스트명, 나머지는 `null` 로 insert.
   기획서 성공 판정: "드랍 실패는 없다"
4. 같은 URL 재드랍 → `url` unique 충돌. `Prefer: resolution=merge-duplicates` 로 덮어쓴다
5. `GET` 분기 추가 — `sites` 를 `created_at desc` 로 조회해 JSON 응답

검증: 규약 준수 URL·미준수 URL 각 1개 드랍 → DB 에 행 2개, `GET` 이 둘 다 반환
커밋: `feat(01): Supabase 저장 + 폴백 (C)`

## Task D — 카드 목록 렌더 · **happy path 완성 지점**

**파일:** `01/index.html` · **의존:** A + C

Step

1. **A 의 더미 카드를 지운다** — 기획서 제약 "데이터 하드코딩 금지"
2. 로드 시 `GET /api/drop` → 카드 렌더. 카드 클릭 시 해당 사이트로 이동
3. 스택 칩 `cds--tag` 표시 — **토글 필터 하나만.** 복합 조건·정렬·검색은 안 만드는 것 1번
4. 드랍 성공 후 목록 갱신
5. 카드 0장일 때 빈 화면 문구

검증: 드랍 → 새로고침 → 카드가 늘어난다. **다른 브라우저(시크릿 창)에서도 보인다**
커밋: `feat(01): 카드 목록 렌더 (D)`

> **여기까지가 이번 주 성공 조건이다.** E 는 선택, F 는 제출물.

## Task E — 썸네일 (선택)

**파일:** `01/api/drop.js` · **의존:** C · **실패하면 버린다**

Step

1. 외부 스크린샷 API 1회 호출 (키 없는 것부터 시도)
2. 받은 바이트를 `shots` 버킷에 업로드 → 경로를 `shot_path` 에 저장
3. **실패해도 드랍은 성공해야 한다** — try/catch 로 감싸고 `shot_path` 는 `null`
4. `index.html` 카드에 썸네일 표시, 없으면 지금 모양 유지

검증: 드랍 1회에 썸네일이 붙는다. 스크린샷 API 를 죽여도 드랍은 성공한다
커밋: `feat(01): 썸네일 (E)`

> 함수 실행 시간·번들 제한에 걸리면 **그날 안에 버린다** (기획서 리스크 ②). 썸네일 없이도 성공 판정은 통과한다.

## Task F — 제출물

**파일:** `01/public/docs/report.html` · **의존:** 배포 완료

Step

1. **셀프 드랍** — 갤러리에 `initialb.vercel.app` 을 드랍해 자기 규약 준수를 검증
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
