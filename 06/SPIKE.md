# S06 스파이크 — 서버리스 래핑

- 목표: Amazon PDP에 즉시 보이는 상위 리뷰를 서버에서 읽고 Claude로 구조화 JSON을 받을 수 있는지 확인
- 현재 결과: PDP URL 정규화·차단 페이지 감지·상위 5개 리뷰 파싱·Claude 요청 구성은 자동 테스트로 확인됨
- 실제 API 호출: Amazon PDP 표본은 봇 방지 화면을 반환했고, `ANTHROPIC_API_KEY`도 로컬·프로젝트 환경에 없어 미실행
- 다음 검증: Vercel 환경변수 설정 후 공개 리뷰가 보이는 PDP URL로 `/api/analyze`를 호출하고, 브라우저 개발자도구에서 키가 보이지 않는지 확인
