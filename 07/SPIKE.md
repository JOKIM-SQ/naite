# S07 스파이크 기록

- 날짜: 2026-09-16
- 선택 스택: Supabase Storage + Postgres / Claude Haiku 4.5 Vision
- 검증 목표: 영수증 1장 원본 저장 → Claude 실제 이미지 추출 → JSON 검증 → 정답 대조.
- 실제 첫 저장까지 걸린 시간: 기록 없음
- 막힌 지점: 기존 S06 환경파일의 SUPABASE_SERVICE_ROLE_KEY 및 ANTHROPIC_API_KEY가 [SENSITIVE]로 가려져 있다. Vercel 운영 환경 pull도 민감값을 반환하지 않는다. 사용자의 키 설정이 필요하다.
- 기존 Supabase 프로젝트: kmfoeoxvsadlurpmkqwh (S06과 동일). 현재 제공 MCP는 다른 프로젝트를 가리켜 사용하지 않음.
- 판정: 실제 연결 검증 대기. mock 결과로 성공 처리하지 않는다.
- 공식 문서 확인: https://platform.claude.com/docs/en/build-with-claude/vision / https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- 검증 샘플 후보: 공개 SROIE 영수증 000.jpg,001.jpg,002.jpg. 원본과 key 정답 대조 예정. https://github.com/zzzDavid/ICDAR-2019-SROIE
- 문서 품질·AI 적합성·실제 비용: 검증 후 기록. 미관측 숫자는 기록 없음.
