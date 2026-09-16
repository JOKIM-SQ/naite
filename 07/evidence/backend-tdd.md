# S07 백엔드 TDD 및 검증 기록

검증일: 2026-09-16. Node v22.22.3. 실제 서비스 키가 없는 상태의 로컬 검증이며, Supabase 저장·Claude OCR 실측 성공으로 해석하지 않는다.

## 테스트 우선 순서

`test-driven-development/SKILL.md`와 `writing-good-tests.md`를 먼저 읽었다. 네트워크 의존성만 `fetchImpl` 경계에서 대체하며, 라우트·쿠키·검증·Supabase 쿼리 작성·OCR 파싱·revision 계산은 실제 구현을 실행했다.

1. `node --test 07/lib/receipt-values.test.mjs`: 동작 없는 export scaffold에서 7개 실패를 확인했다. 첫 실행의 3MiB 검사에서 발생한 undefined 접근을 optional chaining으로 바꾼 뒤 다시 실행해 7개가 기대값 불일치/예외 누락으로 실패했다. 이어 값·파일 검증과 변경 필드 집계를 구현해 7/7 통과했다.
2. `node --test 07/lib/receipts.test.mjs`: HTTP 501을 반환하는 handler scaffold에서 10개 실패를 확인했다. 실제 Storage/PostgREST/Anthropic 연동 구현 후 10/10, 합계 17/17 통과했다.
3. 서버 모델 환경변수 전달 테스트를 추가했다. 지정 Sonnet 대신 기본 Haiku가 전송되어 1개 실패를 확인한 뒤 옵션을 연결해 합계 18/18 통과했다.
4. HTTP 출처가 HTTPS 호스트로 변경 요청하는 테스트를 추가했다. 예상 403 대신 201이 반환되는 실패를 확인한 뒤 Origin의 scheme까지 비교하여 합계 19/19 통과했다.

## 관찰한 동작

- 실제 존재하는 날짜, finite 0 이상·1e12 이하 숫자, ISO 통화, nullable 값과 품목 구조 검증.
- 추출의 잘못된 날짜·금액·통화는 null. 사용자 편집 오류는 422.
- JPEG/PNG/WebP magic bytes, MIME 일치, 정규 base64, 3MiB 경계 검사. 임의 URL 입력 거부.
- HttpOnly·SameSite=Lax 쿠키와 HTTPS Secure, SHA-256 세션 필터, 응답 no-store.
- 다른 세션의 목록은 빈 배열, 수정·재분석은 404.
- 원본 객체 저장 및 DB 행 생성 이후 OCR. base64 image와 `output_config.format.type=json_schema` 전송.
- AI 실패/timeout 후 원본과 failed 행 유지. 재시도 시 기존 행/객체 재사용.
- 원본 최초 추출과 사용자 수정값은 재분석 시 불변.
- 같은 revision 두 저장 중 하나만 성공하고 다른 하나는 409. 실제 변경된 최상위 필드만 correctionCount에 합산하며 items 변경은 1회.
- ready 이외 편집 거부. 진행 중 재시도 거부; 90초 지난 중단 처리행은 재시도 가능.
- 외부 오류 본문과 서비스 키는 응답에 포함하지 않음. 미설정 서버는 503이며 mock 결과를 반환하지 않음.
- Supabase 요청 5초, OCR 요청 30초에 abort. 재시도 경로 최대 순차 대기 예산은 약 55초로 함수의 60초 제한 안에 둠.

## 최종 실행

작업 디렉터리 `/Users/johnkim/workspace/naite/07`:

| 명령 | 결과 |
|---|---|
| `npx tsc --noEmit` | exit 0; 프로젝트 설정은 checkJs:false이므로 완전한 JS 타입 검증은 아님 |
| `npm run lint` | exit 0; Node 구문 검사 |
| `npm test` | 31개 통과, 실패 0: 백엔드 19 + UI/개발서버 12 |
| `npm run build` | exit 0; 이 정적 앱의 빌드는 구문 검사를 실행 |

추가 HTTP smoke 실행은 첫 시도가 샌드박스의 `listen EPERM`으로 차단되었고, 로컬 서버 실행 권한으로 재실행하여 통과했다. 임시 Node HTTP 서버에 production handler를 연결한 뒤 내장 fetch로 `GET 쿠키 생성 → POST 업로드 → PATCH 편집 → GET 재조회 → 새 쿠키 없는 세션 조회`를 실행했다. HTTP 200/201, 수정값 20과 최초값 14.5 보존, 다른 세션 빈 목록을 확인했다. 외부 Storage/OCR 응답은 테스트 대역이며 실제 외부 서비스에 접속하지 않았다.

## 아직 검증하지 못한 항목

- 실제 Supabase SQL 실행, Postgres trigger/RLS 및 기존 Storage 정책 조합.
- 실제 Supabase REST/Storage 인증, 업로드·서명 URL을 통한 사진 조회.
- 실제 Anthropic 계정에서 pinned Haiku의 이미지/구조화 출력 호출과 처리시간.
- 실제 영수증 3장의 날짜·최종금액 정확도 및 사용자의 수정 작업 횟수.
- 배포 환경 HTTP 실행과 브라우저/모바일 상호작용은 메인 작업에서 별도로 검증한다.

커밋 및 외부 서비스 변경은 이 백엔드 작업에서 수행하지 않았다.
