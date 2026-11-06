# initialB 등록 준비

- 프로젝트: Folio · 폴리오
- 스프린트: S13
- 만든 사람: John Kim
- 스택 카드: 벡터DB + RAG
- 내 옵션: Supabase pgvector + Voyage AI + Claude
- 한 줄 소개: 제품 매뉴얼을 읽고, 근거 문장과 함께 답한다.
- 소스: https://github.com/JOKIM-SQ/naite/tree/codex/s12-weeknote-mcp/13
- 공개 URL: 기록 없음 — 배포 전

배포 후 사이트 루트 URL을 initialB에 등록한다. 소개 화면에서 `/docs/plan.html`과 `/docs/report.html`로 이동할 수 있어야 한다. 배포 URL이 확인되면 report.html의 `data-f="url"` href와 텍스트를 실제 주소로 바꾸고 제출 상태를 갱신한다.

등록 전 확인: 실제 공개 접근, 3+1 RAG 시연, 근거 문장 표시, 가상 제품 표시, 비밀키 미노출. report.html의 레지스트리 복사는 7열, 비교표 복사는 11열이다. 공개 URL이 비어 있는 현재 상태에서는 복사 결과를 최종 제출하지 않는다.
