# Stockroom · S08 실시간 팀 재고 보드

Google 로그인 → 보드 만들기/초대 참여 → 품목 등록 → 입출고 → 다른 탭에서 최신 수량 확인.

## 로컬 실행

```sh
cd 08
npm ci
cp .env.example .env.local
npm run dev
```

`.env.local`에는 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` 두 공개 연결 값만 필요하다. 앱 서버는 service-role 키를 사용하지 않는다. 기본 주소는 http://127.0.0.1:3080/ 이다.

Supabase에는 `SUPABASE.sql`을 실행하고 Google 제공자를 활성화한다. 기존 OAuth 설정을 유지하며 Redirect URLs에 `http://127.0.0.1:3080/`와 배포한 주소의 `/`를 추가한다. Google 콘솔의 callback은 해당 Supabase 프로젝트 `/auth/v1/callback`이다. 다른 주차의 Site URL을 덮어쓰지 않는다.

## 데이터와 권한

- `s08_boards`, `s08_members`, `s08_items`, `s08_movements`는 S08 전용이다.
- 보드 생성자는 초대 링크를 복사할 수 있다. 초대 링크를 가진 로그인 사용자는 해당 보드에 참여한다.
- RLS로 가입한 보드의 품목만 조회한다. 변경은 멤버십을 확인하는 RPC로만 허용한다.
- 입출고는 기존 수량에 delta를 더한다. 요청 UUID를 기록해 응답 유실 후 같은 요청을 재시도해도 두 번 반영되지 않는다.
- 품목 변경 이벤트는 최신 스냅샷을 재조회하는 신호다. 재연결·탭 복귀에도 최신값을 조회한다.
- 목록 아래 지연 시간은 수량 변경의 최초 요청 전송 시각부터 이 탭이 Realtime UPDATE를 받은 시각까지다. 화면 렌더링 시간은 포함하지 않는다. 같은 기기 두 탭으로 비교하며, 다른 기기는 시계 차이로 값이 달라질 수 있다. 최초 조회·구버전 요청·잘못된 시각은 지연 값으로 만들지 않는다.
- 품목의 `입출고 기록` 버튼으로 수량 조정/기록 탭을 연다. 수행자 이름·시간·입출고량·변경 전후 수량을 최신순 20건씩 조회한다. 최초 등록 수량은 포함하지 않는다. 이름은 현재 Google 프로필 표시 이름이며 이력의 수행자 ID는 저장 시점의 사용자다.
- 기존 설치에는 `migrations/20260924_latency.sql`, `migrations/20260924_item_history.sql`을 순서대로 적용한다. 신규 설치는 두 변경이 포함된 `SUPABASE.sql` 하나를 사용한다. 기존 재고와 이력은 보존된다.

## 검증

```sh
npx tsc --noEmit
npm run lint
npm test
npm run build
```

단위/통합 테스트와 실제 서비스 검증은 구분한다. PGlite 테스트는 PostgreSQL 함수·권한 동작을 검증하지만 네트워크와 실제 다중 접속의 증거는 아니다. 실제 관찰 결과는 `SPIKE.md`에 기록한다.

`node scripts/live-check.mjs --run`은 기존 `07/.env.local`의 서비스 키를 **로컬 검증 과정에만** 사용해 임시 QA 계정 3개와 테스트 보드를 생성한다. 일반 앱 실행·배포에는 이 키가 필요하지 않다. 브라우저 확인 후 `node scripts/live-check.mjs --cleanup`으로 해당 실행이 만든 계정·보드만 정리한다. `.qa/`는 비공개 임시 파일이며 커밋·배포 대상이 아니다.

## 배포

Vercel 프로젝트는 `s08-stockroom`, 공개 주소는 https://s08-stockroom.vercel.app/ 이다. `08` 폴더에서 CLI로 배포하므로 현재 프로젝트 Root Directory는 `.`이다. 추후 Git 자동 배포를 연결할 때는 저장소 기준 Root Directory를 `08`로 지정하고 Git 빌드 범위를 이 폴더로 제한한다.

production 환경에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 등록한다. Supabase Redirect URLs에는 `https://s08-stockroom.vercel.app/`를 추가하고 다른 주차 URL은 유지한다. `.vercel`을 다른 주차에서 복사하지 않는다. `.vercelignore`로 로컬 환경변수·QA 기록·Supabase 임시 파일을 업로드에서 제외한다.

배포에는 Vercel CLI 59.26.0을 `npx --yes vercel@59.26.0`으로 실행한다. 전역 CLI를 갱신하려면 `npm i -g vercel@latest`를 사용한다.

기획서 https://s08-stockroom.vercel.app/docs/plan.html, 리포트 https://s08-stockroom.vercel.app/docs/report.html 은 팀 템플릿을 유지한다.

제출 조건·실제 등록 방법·미확인 항목은 [SUBMISSION.md](SUBMISSION.md)에 정리했다. 현재 initial-b는 URL 드랍 시 두 문서를 읽어 카드와 스택 비교표를 자동으로 만든다.

## 3분 시연

1. Google로 로그인해 같은 보드를 두 탭에 연다.
2. 한 탭에서 품목을 등록한다.
3. 입고·출고하고 다른 탭의 수량·지연 시간을 확인한 뒤 품목의 입출고 기록을 연다.
4. 두 탭에서 동시에 출고한다.
5. 한 탭을 오프라인으로 전환했다가 복구해 최신 수량을 확인한다.
