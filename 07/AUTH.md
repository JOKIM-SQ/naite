# S07 OAuth 로그인 전환

2026-09-17. 사용자가 공용 기록으로 전환하는 대신 OAuth 로그인을 요청했다. 브라우저 쿠키 식별을 계정 소유권으로 바꾸되 영수증 원본과 기록은 본인만 볼 수 있도록 유지한다. 기존 계획의 로그인 제외 항목은 이 요청 범위에서 변경한다.

## 확인 결과와 상태

1. [완료] Google 선택과 기존 API·UI·소유권 전환 설계.
2. [완료] Supabase CLI 로그인, 대상 프로젝트 접근, 실제 Auth Google 제공자 활성화, S07 테이블과 private bucket 존재 확인. 공개·서버 키는 출력 없이 로컬 환경파일에 저장.
3. [완료] PKCE 로그인·API 토큰 검증·계정별 저장 및 UI 전환 구현. 전체 85개 테스트, tsc·lint·build 통과. 독립 검토 4건 수정 및 실제 SDK 재검증 완료.
4. [외부 설정 대기] 기존 CLI 및 최신 CLI의 SQL 명령에서 Access token not provided 오류. 프로젝트·키 조회는 성공한다. 키체인 직접 조회는 자동 승인 검토가 거부하여 중단했다. 사용자에게 대시보드 SQL 실행 및 Redirect URLs 추가를 요청했다.
5. [진행 중] 브라우저 로그인/계정 분리/빠른 재로그인/오류/모바일 검증 완료. 공개 배포 준비. 실제 Google 동의·복귀는 사용자 외부 단계로 남음.

기존 Supabase 프로젝트: `kmfoeoxvsadlurpmkqwh`. 새 프로젝트나 별도 인증 서비스는 생성하지 않았다. 기존 익명 방식의 테이블에 user_id 컬럼은 아직 없다(REST 스키마 조회). 서버키는 Git·대화·브라우저에 노출하지 않는다.

## 로그인 제공자 설정

사용자가 Google 로그인을 선택했다. 기존 Supabase Auth에 Google 제공자를 연결한다.

연결 설정 (1~3은 기존 제공자 설정으로 확인 완료):

1. Google Auth Platform에서 Web application OAuth 클라이언트의 Client ID·Client Secret을 준비한다.
2. Authorized redirect URI: `https://kmfoeoxvsadlurpmkqwh.supabase.co/auth/v1/callback`.
3. Supabase Authentication → Sign In / Providers → Google에 위 Client ID·Client Secret을 입력하고 활성화한다. Google 비밀값을 Vercel이나 대화창에 붙여 넣을 필요는 없다.
4. Supabase Authentication → URL Configuration의 기존 Site URL과 다른 주차 설정은 유지한다. 앱 반환 허용 URL에 공개 사이트 `/`와 로컬 검증용 `http://127.0.0.1:3070/`를 추가한다.
5. Vercel S07 Production의 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` 등록 완료. `ANTHROPIC_API_KEY`는 아직 미설정이다. 서버용 비밀키는 클라이언트에 전달하지 않는다.

참조: https://supabase.com/docs/guides/auth/social-login/auth-google

## 구현 범위

- Supabase 공식 클라이언트의 OAuth PKCE 로그인·세션 복원·갱신·로그아웃을 사용한다. 별도 회원가입 폼은 만들지 않는다.
- 로그인 전에는 로그인 안내와 분석 그래픽을 보여 주며 업로드·저장 기록은 잠근다. 로그인 후 현재 계정의 최근 30장을 복원한다.
- 클라이언트는 Supabase access token을 API에 전달한다. 서버는 Supabase Auth에서 토큰을 검증한 `user.id`만 소유권에 사용한다. 요청 본문의 user_id 또는 JWT 단순 디코딩을 신뢰하지 않는다.
- 조회·수정·재분석·원본 서명 URL 발급에는 검증된 계정 필터를 적용한다. 서버용 키가 RLS를 우회하므로 이 API 필터가 반드시 필요하다.
- 로그인·로그아웃·다른 계정으로 바뀔 때 기존 화면 데이터와 대기 중 요청이 다른 계정 화면에 섞이지 않도록 정리한다.

서버 검증 근거: https://supabase.com/docs/reference/javascript/auth-getuser

## 데이터 전환

- 기존 테이블에도 적용되는 명시적 ALTER 마이그레이션으로 `user_id` 외래키와 계정별 인덱스를 추가한다. CREATE TABLE IF NOT EXISTS만 수정하지 않는다.
- 신규 행의 소유자는 검증된 사용자 ID로 저장하며 업로드 경로도 사용자 ID 기준으로 바꾼다. 기존 session_hash·경로 제약과 불변성 트리거를 함께 조정한다.
- 기존 익명 행은 삭제하지 않고 user_id=NULL로 보존한다. 로그인 계정에 자동 귀속하거나 공용으로 공개하지 않는다.

## 검증 경계

- 미인증·만료·위조·다른 프로젝트 토큰을 거부하고 저장/OCR을 호출하지 않는지 확인한다.
- 다른 계정의 조회·편집·재분석·원본 접근 차단, 동일 계정의 다른 브라우저 복원, 익명 기존 행 비노출을 확인한다.
- OAuth 취소·반환 오류·세션 만료·로그아웃·계정 전환 후 화면/요청 경계를 확인한다.
- 기존 원본 보존·revision 충돌·자동 저장·모바일 검증을 유지한다.
- 실제 제공자 로그인 완료 후에만 OAuth 연결 성공으로 기록한다. 테스트 응답은 실서비스 로그인 성공의 근거로 사용하지 않는다.
