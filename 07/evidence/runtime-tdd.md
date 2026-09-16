# 로컬 서버 검증

- RED: 정적 경로 함수 테스트를 먼저 추가; dev.mjs 미구현으로 실패 확인.
- GREEN: index·문서 쿼리스트링 처리 및 URL-encoded 상위 경로/숨김 파일 차단 구현 후 node --test scripts/dev.test.mjs 통과 (1 test).
- CLI --help 실행 확인. 실제 HTTP/브라우저 결과는 QA.md에 기록.
