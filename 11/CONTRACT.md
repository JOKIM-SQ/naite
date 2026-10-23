# S11 구현 계약

앱은 `GET /api/tickets`로 실제 문의 목록 `{tickets: Ticket[]}`을 불러온다. HttpOnly 브라우저 작업공간 쿠키가 없으면 서버에서 생성한다. 클라이언트는 목록을 주기적으로 새로고침하며 서버 상태를 표시한다. 로컬 샘플 결과나 성공 폴백은 없다.

`POST /api/tickets`는 NewTicket을 받아 DB 저장·Inngest 이벤트 수락 후 HTTP202 `{ticket: Ticket}`을 반환한다. 분류와 초안이 끝날 때까지 기다리지 않는다. 전송 실패는 실패 상태와 오류 응답으로 구분한다.

`POST /api/tickets/:id/retry`는 실패한 문의만 새 run token으로 큐에 넣는다. 사용자 UI는 demo_mode를 none으로 재시도 요청해 의도적 실패 조건을 해제할 수 있다. 타 작업공간 ID와 진행 중 문의를 재시도할 수 없다.

상태/필드 타입은 lib/contracts.ts. backend가 `workspace_id`, `run_token`을 내부 DB에 추가하고 API에서는 제거한다. 내부 CAS로 오래된 작업·실패 핸들러가 새 실행을 덮지 못하게 한다. 문의 본문은 명령이 아닌 자료로 Claude에 전달하며 JSON 출력은 런타임 검증한다.

실제 Inngest의 독립 step: 분류→초안→완료 저장. 실패하면 실제 재시도 횟수와 대기 이벤트를 저장하고 예산 소진 시 onFailure로 최종 실패를 저장한다. demo_mode transient는 분류 첫 시도만, permanent는 모든 분류 시도를 의도적으로 실패시킨다. 이 조건은 UI에 데모로 명시한다. AI의 낮은 신뢰·복수 범주·정보 부족은 완료+needs_review이며 시스템 실패가 아니다.

UI는 warm offwhite/ink/coral. 사이드바, KPI, 문의 목록+상세, 새 문의 dialog, 실제 처리 타임라인, 접근성·reduced-motion. 예시는 입력 폼 프리셋으로 명시하고 실제 POST/Claude 처리를 거친다. 로그인·답변 자동발송·외부메일 연동·팀 권한 관리는 제외한다.
