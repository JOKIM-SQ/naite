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

Vercel 프로젝트 Root Directory를 `08`로 지정한다. 설정된 두 환경변수를 등록하고 OAuth 반환 주소를 허용한다. `.vercel`을 다른 주차에서 복사하지 않는다. Git 빌드 범위는 이 폴더로 제한한다.

현재 Vercel CLI 59.15.0은 최신 59.26.0보다 오래되어, 배포 전 `npm i -g vercel@latest` 업데이트를 권장한다.

기획서 `/docs/plan.html`, 리포트 `/docs/report.html`은 팀 템플릿을 유지한다. 배포 후 리포트의 URL을 실제 공개 주소로 교체한다.

## 3분 시연

1. Google로 로그인해 같은 보드를 두 탭에 연다.
2. 한 탭에서 품목을 등록한다.
3. 입고·출고하고 다른 탭 수량을 확인한다.
4. 두 탭에서 동시에 출고한다.
5. 한 탭을 오프라인으로 전환했다가 복구해 최신 수량을 확인한다.
