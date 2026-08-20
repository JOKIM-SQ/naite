# S03 기획서 초안 — 오늘 커피 어디서 마실까요?

| | |
|---|---|
| 스프린트 | S03 (2026-08-17 ~ 08-21) |
| 스택 카드 | 인증 |
| 내 옵션 | Auth.js (`@auth/core`, Credentials + JWT 세션) |

로그인한 사람만 오늘 마실 커피 메뉴/장소 아이디어를 올릴 수 있고, 서로 투표해 팀이 갈 곳을 정한다.

## 핵심 기능

1. 이메일/비밀번호로 Auth.js Credentials 로그인 (세션은 JWT httpOnly 쿠키).
2. 로그인한 사용자가 커피 아이디어 제목(1개 필드)을 올린다.
3. 본인 글은 수정·삭제할 수 있다 (서버 API가 세션 사용자 id로 소유권 강제).
4. 목록에서 본인 글을 제외한 아이디어에 찬성 투표한다.
5. 계정당 최대 3표, 같은 아이디어에는 1표만.
6. 목록은 투표수 내림차순으로 정렬돼 다른 계정에서도 같은 결과가 보인다.

## 성공 판정

- 테스트 계정 2개가 각자 로그인해 커피 아이디어를 올린다.
- 본인 글을 수정하면 목록에 바로 반영되고, 삭제하면 사라진다.
- 다른 계정의 글은 API가 403으로 막는다 (소유권 검증 확인).
- 서로의 아이디어에 투표하고, 투표 수가 두 계정 모두에서 동일하게 보인다.
- 본인 글에는 투표 버튼이 비활성화되거나 숨겨진다.
- 4번째 투표를 시도하면 막힌다 (계정당 3표 한도).
- 같은 아이디어를 두 번 누르면 중복 투표가 안 된다.
- 로그아웃 후 다시 로그인해도 이전 투표·글 상태가 유지된다.
- 첫 화면에서 로그인 방법과 아이디어 등록·투표 위치가 5초 안에 읽힌다.

## UI 방향

- 로그인 폼(이메일·비밀번호) → 로그인 후 커피 아이디어 보드로 전환.
- 아이디어는 카드 또는 리스트 행으로, 각 항목에 제목·투표수·투표 버튼.
- 본인 글은 수정·삭제 버튼을 노출하고, 투표 버튼 대신 "내 글" 표시.
- 잔여 투표 수(예: "2/3표 남음")를 화면 어딘가에 보여준다.

## 데이터 모델 · 아키텍처

```text
User (weekly_projects.s03_users)
  id, email, password_hash, created_at
  password_hash: PBKDF2(SHA-256, 100,000회, 계정마다 랜덤 salt 16byte)로 저장 — 평문 비밀번호는 저장하지 않는다

Idea (weekly_projects.s03_ideas)
  id, title, author_id, created_at, updated_at

Vote (weekly_projects.s03_votes)
  id, idea_id, voter_id
  unique(idea_id, voter_id)
```

Supabase Auth를 쓰지 않으므로 RLS 대신 **서버 함수가 직접 권한을 검증**한다:

- Vercel Edge 함수(`api/auth/[...authjs].js`)가 `@auth/core`의 `Auth()`로 로그인·로그아웃·세션 조회를 처리한다.
- `api/ideas.js`, `api/votes.js`는 요청 쿠키의 Auth.js JWT를 `getToken()`으로 검증해 사용자 id를 얻고, 이 id로 소유권·투표 한도·중복 투표를 코드에서 직접 확인한 뒤 Supabase Postgres에 `service_role` 키로만 접근한다 (anon/authenticated 역할에는 권한을 주지 않는다).
- 투표 한도(계정당 3표)는 저장 전 서버에서 해당 voter_id의 기존 투표 수를 세어 검증한다.
- 중복 투표는 `(idea_id, voter_id)` 유니크 제약으로 DB 레벨에서도 막는다.
- **비밀번호 암호화**: 처음엔 `bcrypt`를 쓰려 했으나 Vercel Edge 런타임 번들링에서 `bcryptjs`가 깨졌다(`W.default.hash is not a function`). 그래서 Edge에 기본 내장된 Web Crypto API로 **PBKDF2(SHA-256, 100,000 iteration, 계정별 랜덤 salt)** 해시를 직접 구현했다([03/lib/password.js](../03/lib/password.js)). bcrypt와 목적은 같다 — 평문 비밀번호를 절대 저장하지 않고, 느린 해시로 무차별 대입을 어렵게 만드는 것.

## 필요한 환경변수 (Vercel)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — 대시보드 API 설정에서만 발급, 클라이언트 코드에는 절대 노출하지 않는다
- `AUTH_SECRET` — `npx auth secret`으로 생성

## 안 만드는 것

1. 댓글
2. 회원가입 커스텀 UI·비밀번호 재설정·소셜 로그인
3. 검색·카테고리·투표순 외 추가 정렬

## 화요일 스파이크 합격 조건

- Auth.js Credentials로 로그인 후 `/api/auth/session`이 내 이메일을 돌려준다.
- 아이디어 1개를 저장하고 다른 계정으로 로그인해도 보인다.
- 본인 글 수정·삭제는 되고, 남의 글 수정·삭제는 API가 403으로 막는다.
- 본인 글 투표 차단과 계정당 3표 한도, `(idea_id, voter_id)` 중복 투표 차단이 동작한다.
