# S12 주차노트 · Weeknote

사용자 승인: 주차별 과제 조회 MCP를 작게 구현하고 initialB 제출용 소개 페이지와 문서를 준비한다. 범위는 `12/`이며 상위 문서의 S07 주제·요일별 개발 금지는 적용하지 않는다.

공식 TypeScript MCP SDK, 로컬 stdio, 읽기 전용 `get_assignment` 도구 1개만 사용한다. 데이터 소스는 `https://initialb.vercel.app/guide.html` 하나다. 응답을 하드코딩하거나 실패 시 예시로 대체하지 않는다. 입력으로 임의 URL·파일 경로를 받지 않는다. stdio stdout에는 JSON-RPC만 쓰고 진단은 stderr에 쓴다. 별도 채팅 UI·DB·로그인·쓰기 도구는 만들지 않는다.

실제 기능은 test-driven-development 스킬의 RED→GREEN을 따른다. Node 내장 테스트를 우선하고 규모를 작게 유지한다. 핵심 변경 후 타입 검사·lint·전체 테스트·build를 실행한다. 한국어 커밋 본문에 `TODO: Phase X 완료`를 남긴다. 공유 변경과 루트 `.gitignore`/`.omo/` 기존 변경을 보존하며 `12/`만 커밋한다. 파일 편집은 apply_patch를 사용한다.

모든 Codex 작업·위임·리뷰에 gpt-6-astra를 사용하지 않는다. 기본은 gpt-6.1-sol이다.

`public/docs/plan.html`, `public/docs/report.html`은 `_template/public/docs/`의 구조·스타일·data-f·복사 스크립트를 보존한다. 측정하지 않은 값은 기록 없음으로 둔다. 소개 페이지는 채팅 UI가 아닌 도구 설명·권한·연결 방법만 담는다. 로컬 소개 페이지 포트는 3120이다. 실제 initialB 등록 버튼은 누르지 않는다.
