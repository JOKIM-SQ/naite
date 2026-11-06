# initialB 등록 준비 완료

- 프로젝트: Folio · 폴리오
- 스프린트: S13
- 만든 사람: John Kim
- 스택 카드: 벡터DB + RAG
- 내 옵션: Supabase pgvector + Voyage AI + Claude
- 한 줄 소개: 제품 매뉴얼을 읽고, 근거 문장과 함께 답한다.
- 소스: https://github.com/JOKIM-SQ/naite/tree/codex/s12-weeknote-mcp/13
- 공개 URL: **https://s13-folio.vercel.app/**
- 기획서: https://s13-folio.vercel.app/docs/plan.html
- 스택 리포트: https://s13-folio.vercel.app/docs/report.html

기본 자료는 'Tesla Model 3 사용 설명서' PDF 전체 329쪽 영문 추출 텍스트다. 002 SQL을 적용하고 정규화 937,449자·1,904청크의 실제 임베딩·DB exact count·ready 및 두 세션 공용 조회를 확인했다. 2026-11-05(PST) production에서 전화기·타이어 라벨·FSD 해제 질문은 각각 3,463ms·3,262ms·3,819ms에 원문을 인용했고, 한국 무감독 FSD 출시일은 2,986ms·인용 0개로 모른다고 답했다. 실제 외부 API 3+1 모두 첫 시도 PASS이며 임베딩·검색·답변·검증 단계 이벤트도 수신했다. 이전 로컬의 번역 오류 및 재시도 이력은 SPIKE.md에 구분해 보존했다. 원본 PDF 파일 공개와 그림 OCR은 지원하지 않는다.

공개 앱·기획서·리포트·차량 이미지의 익명 HTTP 200 및 report.html의 `data-f="url"` href·텍스트 반영을 완료했다. 제출 준비는 끝났으며 사용자는 initialB에 **https://s13-folio.vercel.app/** 하나를 등록한다.

홈에는 2026 Tesla Model 3 Premium RWD · Stealth Grey 생성 이미지와 차량 애니메이션을 적용했다. 움직임 줄이기 설정에서는 애니메이션을 멈춘다. 원본 PDF·비밀키·로컬 캐시는 배포에서 제외했다. report.html의 레지스트리 복사는 7열, 비교표 복사는 11열이다. 셋업·배포 소요 시간과 첫 로딩 시간은 기록 없음이다.

- [x] 실제 공개 접근·전체 사전 인덱싱·production 3+1 검증·문서 URL 반영
- [ ] initialB에 사이트 루트 URL 등록 (사용자)
