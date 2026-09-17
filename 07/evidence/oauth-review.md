# S07 Google OAuth 검증 기록

2026-09-17. UI는 gstack `/browse`로 직접 조작했다. 코드 검토는 독립 에이전트가 수행했다. 아래 로컬 인증·OCR fixture는 실제 Google 로그인이나 Haiku 정확도의 근거가 아니다.

## 브라우저에서 관찰한 동작

`http://127.0.0.1:3098/`의 테스트 전용 서버에서 공식 Supabase SDK를 실행했다.

- 로그인 전 Google 버튼만 활성화. 업로드·개인 기록은 잠김.
- PKCE 로그인 후 QA 계정 A로 사진 3장 선택 → 결과 카드 3개와 원본 이미지 3개 표시.
- 상호명을 수정하고 ‘모든 변경사항을 저장했어요’ 확인 → 새로고침 후 수정값 및 3장 복원.
- 로그아웃 직후 카드 0개, 이미지 0개, 계정 표시 숨김, 업로드 비활성화.
- QA 계정 B로 로그인 → A의 기록이 보이지 않고 0개 표시. A로 돌아오면 3장 복원.
- Google 취소 응답 → 한국어 취소 안내와 활성화된 재로그인 버튼. URL의 오류 파라미터 제거.
- 서버에서 QA 세션 만료 후 업로드 → 401, 모든 카드 제거, 업로드 잠금, 한국어 재로그인 안내 표시.
- 320/390/768/1440px에서 페이지 가로 넘침 없음. 모바일 Google·업로드 버튼 48px, 로그아웃 버튼 44px.

스크린샷: `oauth-signed-out-desktop.png`, `oauth-signed-in-mobile.png`, `oauth-signed-out-mobile.png`, `oauth-cancel-mobile.png`. 모두 테스트 계정만 포함한다.

## 실제 외부 서비스에서 확인한 범위

- 대상 Supabase 프로젝트 `kmfoeoxvsadlurpmkqwh` 접근 성공, Google 제공자 활성화.
- REST로 기존 S07 테이블 존재 및 컬럼 확인. Storage bucket `s07-receipts`는 private.
- 실제 Auth에서 누락·위조 토큰 거절. 저장·OCR 요청은 실행되지 않음.
- 실제 앱 `http://127.0.0.1:3070/`에서 Google 버튼 클릭 → `accounts.google.com` 로그인 화면 도착. Google 클라이언트의 반환 주소는 대상 Supabase Auth callback.
- Google 계정 입력·동의·앱 복귀는 수행하지 않았다. 현재 등록된 Google OAuth 앱 표시명은 기존 클라이언트의 `Gemini Chatbot`이며 공유 설정은 변경하지 않았다.
- Vercel Production의 Supabase URL·공개키·서버키 등록 완료. 비밀키는 출력·커밋하지 않았다.

## 검토에서 발견한 보완 항목

- 인증 오류 메시지의 hidden 속성 해제 누락.
- 이전 로그아웃 완료가 새 로그인 PKCE verifier를 삭제하는 경쟁 조건.
- SDK 초기화의 PKCE 교환 실패가 getSession 오류로 전파되지 않는 경계.
- 만료 토큰의 갱신 실패 시 로그아웃이 저장 세션을 남기는 경계.

위 4건 모두 수정 후 독립 재검토에서 종료 확인. 실제 공식 SDK 회귀 테스트 4개를 포함한 전체 85개 테스트, tsc·lint·build·diff 검사 통과. 최종 브라우저에서 빠른 로그아웃→재로그인 후 기록 3장 복원, 재사용 코드 한글 오류 및 URL 정리를 다시 확인했다.

SQL은 별도 임시 PGlite 0.5.8 / PostgreSQL 18.3 WASM에서 17개 검증 통과. 구버전 스키마·익명 행 보존, 계정 A/B INSERT·FK, 익명 신규 입력/소유자 변경/기존 행 귀속/원본 변경 차단, revision 충돌, RLS 권한, 신규 설치와 재적용을 실행했다. 이 결과는 실제 Supabase PostgreSQL 17에 적용했다는 뜻이 아니다. 검증 스크립트는 `/private/tmp/s07-pglite-OdPNAJ/verify.mjs`; 앱 의존성은 추가하지 않았다.

## 남은 외부 확인

- 기존 테이블에 OAuth SQL 마이그레이션 적용, Auth Redirect URLs에 공개·로컬 앱 추가.
- 실제 Google 동의 후 앱 복귀 및 본인 기록 복원.
- `ANTHROPIC_API_KEY` 등록 후 실제 영수증 3장 저장·OCR·수정·복원 및 정확도 실측.

공식 CLI의 프로젝트 조회·키 조회는 성공하지만 SQL 명령은 로그인 토큰을 인식하지 못했다. 최신 CLI에서도 동일했다. 키체인 직접 조회는 자동 승인 검토가 자격증명 탐색 위험으로 거부하여 중단했고, 사용자에게 준비된 SQL과 대시보드 설정을 안내했다.
