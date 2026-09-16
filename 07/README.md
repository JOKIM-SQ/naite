# S07 영수증 정리기

Supabase Storage에 원본을 저장하고 Claude Haiku 4.5로 날짜·최종 결제금액·품목을 추출하는 한 화면 앱. 로그인 없이 브라우저 쿠키별로 영수증을 분리한다.

## 실행

1. 기존 Supabase 프로젝트의 SQL Editor에서 `SUPABASE.sql`을 실행한다. S07 테이블·private bucket만 추가하며 기존 주차 데이터는 변경하지 않는다.
2. `.env.example`을 참고해 `07/.env.local`에 실제 세 값을 설정한다. `[SENSITIVE]`는 키가 아니다. 키를 Git이나 대화에 올리지 않는다.
3. `cd 07 && npm ci && npm run dev`, http://127.0.0.1:3070 열기.
4. `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` 실행.

TypeScript 명령은 기존 JavaScript를 emit 없이 컴파일 확인한다. checkJs는 끄며 엄격한 타입 검증을 했다고 주장하지 않는다. 의미 있는 동작 경계는 node:test로 검증한다.

## 사용

- JPEG/PNG/WebP, 장당 3MiB 이하를 한 번에 최대 3장 선택.
- 원본 저장 후 자동 분석. 읽을 수 없는 값은 비워 둔다.
- 날짜·총액·품목을 수정하면 자동 저장. 금액은 소계·세금이 아니라 최종 결제금액.
- 수정 횟수 표시는 서버에 저장된 변경 필드 수다. 품목 배열은 한 필드로 세므로 실제 사용자의 작업 3회 이하 판정은 데모에서 별도 관찰한다.
- 최초 추출 결과는 보존. `N/3 정확도`는 원본과 대조해 따로 기록한다. 모델 자체 확신을 정확도로 쓰지 않는다.
- 같은 브라우저·같은 사이트에서 새로고침하면 복원된다. 쿠키를 지우거나 다른 브라우저를 쓰면 이전 목록에 접근할 수 없다.

## 배포와 제출

- 전용 Vercel 프로젝트 `s07-receipt-organizer`. Git 연결 시 Root Directory `07`, Build `npm run build`, Output `public`.
- 서버 환경변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`; 모델 선택 시 `ANTHROPIC_MODEL`.
- Git 자동배포 연결 시 Ignored Build Step `git diff --quiet HEAD^ HEAD -- .`로 주차별 변경만 빌드.
- `/docs/plan.html`, `/docs/report.html`은 팀 템플릿 CSS·data-f 규약을 유지한다.
- 공식 현재 가이드: 목 18:00 갤러리에 URL 제출, 금 09:30 데모. S07은 9월 17일 제출, 9월 18일 데모. 공통 원본 템플릿은 그대로 두고 S07 문서의 마감 문구만 현재 가이드에 맞췄다. 레이아웃·CSS·data-f는 유지한다.
- 갤러리 드랍/스택 비교표 게시 여부는 실제 완료 후 기록한다. 사이트 배포만으로 제출 완료라고 하지 않는다.

## 3분 데모 순서

1. 사진 3장을 한 번에 선택한다.
2. 자동으로 채워진 날짜·총액·품목과 원본을 비교한다.
3. 틀린 값이 있으면 수정하고 저장 표시를 확인한다.
4. 새로고침해 수정값과 원본이 유지되는지 확인한다.
5. 최초 추출 정확도 N/3, 수정 횟수, 스택 리포트를 보여준다.

## 제외 범위

로그인·회원가입 / 관리자 페이지 / CSV 다운로드·회계 연동.

## 외부 서비스 없이 화면 회귀 검증

`node scripts/qa-server.mjs`는 3071 포트의 **테스트 전용 서버**다. 실제 API·UI·검증·세션·저장 충돌 코드를 사용하되 Supabase/Claude HTTP 응답은 테스트 fixture로 대체한다. 이 결과는 실제 OCR 정확도나 외부 저장 성공의 증거가 아니다. 이 파일과 fixture는 Vercel 배포에서 제외한다.
