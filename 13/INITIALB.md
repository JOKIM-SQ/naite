# initialB 등록 준비

- 프로젝트: Folio · 폴리오
- 스프린트: S13
- 만든 사람: John Kim
- 스택 카드: 벡터DB + RAG
- 내 옵션: Supabase pgvector + Voyage AI + Claude
- 한 줄 소개: 제품 매뉴얼을 읽고, 근거 문장과 함께 답한다.
- 소스: https://github.com/JOKIM-SQ/naite/tree/codex/s12-weeknote-mcp/13
- 공개 URL: 기록 없음 — 배포 전

현재 로컬 Tesla 샘플은 실제 파일 업로드(3,689자)·7개 청크 저장·3+1 질의·원문 쪽수 출처 확인을 완료했다. 질문별 실제 응답과 이전 MORI 검증 이력은 SUBMISSION.md에서 구분한다. 공개 배포와 initialB 등록은 아직 남아 있다.

배포 후 사이트 루트 URL을 initialB에 등록한다. 소개 화면에서 `/docs/plan.html`과 `/docs/report.html`로 이동할 수 있어야 한다. 배포 URL이 확인되면 report.html의 `data-f="url"` href와 텍스트를 실제 주소로 바꾸고 제출 상태를 갱신한다.

등록 전 확인: 실제 공개 접근, Tesla Model 3 FSD 샘플의 3+1 RAG 시연, 근거 문장과 원문 차종·지역·버전·쪽수 표시, 비공식 발췌·요약 안내, 비밀키 미노출. 원본 PDF 전체는 공개하지 않는다. report.html의 레지스트리 복사는 7열, 비교표 복사는 11열이다. 공개 URL이 비어 있는 현재 상태에서는 복사 결과를 최종 제출하지 않는다.
