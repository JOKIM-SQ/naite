# S07 OAuth 로그인 전환

2026-09-17. 사용자가 공용 기록으로 전환하는 대신 OAuth 로그인을 요청했다. 브라우저 쿠키 식별을 계정 소유권으로 바꾸되 영수증 원본과 기록은 본인만 볼 수 있도록 유지한다. 기존 계획의 로그인 제외 항목은 이 요청 범위에서 변경한다.

## 확인 결과와 상태

1. [완료] 현재 쿠키 기반 API·저장 경로·SQL·UI 및 계정 소유권 전환 지점 검토. 독립 백엔드 검토 완료.
2. [차단: 외부 연결 필요] Google 로그인으로 확정했다. Vercel S07 Production 환경변수 0개, 연결된 Supabase MCP 4개 모두 대상 프로젝트와 다름. 대상 대시보드는 로그인 화면으로 이동한다. 설치된 Supabase CLI의 프로젝트 조회도 Access token not provided로 실패했다.
3. [차단: 2번 선행] 실제 Auth 연결 후 로그인·로그아웃·API 인증·DB 마이그레이션·계정 분리 테스트·브라우저 검증·공개 배포를 진행한다. OAuth 코드나 배포를 완료한 상태가 아니다.

기존 Supabase 프로젝트: `kmfoeoxvsadlurpmkqwh`. 새 Supabase 프로젝트나 별도 인증 서비스는 생성하지 않았다. 기존 공개 사이트는 유지한다.

다음 외부 작업: 사용자가 터미널에서 `supabase login`으로 기존 계정에 로그인한다. 로그인 후 대상 프로젝트의 Auth 설정을 확인하고, Google OAuth 클라이언트가 이미 연결되어 있는지부터 검사한다. 액세스 토큰이나 Google Client Secret을 대화창에 공유할 필요는 없다.

## 로그인 제공자 설정

사용자가 Google 로그인을 선택했다. 기존 Supabase Auth에 Google 제공자를 연결한다.

필요한 외부 설정:

1. Google Auth Platform에서 Web application OAuth 클라이언트의 Client ID·Client Secret을 준비한다.
2. Authorized redirect URI: `https://kmfoeoxvsadlurpmkqwh.supabase.co/auth/v1/callback`.
3. Supabase Authentication → Sign In / Providers → Google에 위 Client ID·Client Secret을 입력하고 활성화한다. Google 비밀값을 Vercel이나 대화창에 붙여 넣을 필요는 없다.
4. Supabase Authentication → URL Configuration의 Site URL은 `https://s07-receipt-organizer.vercel.app`로 설정한다. 앱 반환 허용 URL에 공개 사이트 `/`와 로컬 검증용 `http://127.0.0.1:3070/`를 추가한다.
5. Vercel S07 Production에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`와 브라우저 Auth 초기화용 공개키 `SUPABASE_PUBLISHABLE_KEY`를 설정한다. 서버용 비밀키는 클라이언트에 전달하지 않는다.

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
