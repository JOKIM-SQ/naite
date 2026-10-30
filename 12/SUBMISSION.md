# S12 제출 체크리스트 — 주차노트 · Weeknote

현재 상태: **구현·Inspector·SDK stdio·실제 Claude 비교 확인 / 최초 공개 배포·비로그인 접근 확인 / initialB 실제 등록 미실행**. 문서 최종 재배포 뒤 실제 TSV 복사 값은 별도 확인 항목이다.

## 과제와 범위

- 실제 미션: [S12 MCP 서버 만들기](https://initialb.vercel.app/guide.html#s12)
- 도구: `get_assignment({ "week": "s12" })` 하나
- 데이터 소스: `https://initialb.vercel.app/guide.html` 하나
- 전송: 로컬 stdio, 공식 TypeScript MCP SDK `1.32.2`
- 권한: 고정 외부 가이드 읽기. 임의 URL·파일 경로·쓰기·DB·로그인·LLM 서버·별도 채팅 UI 없음
- 응답: 선택한 주차의 제목·미션·골·제약·출처·조회 시각. 하드코딩·성공 폴백 없음

## 검증 기록

| 성공 기준 | 정확한 시나리오·실행 | 판정할 관측값 | 상태·증거 |
| --- | --- | --- | --- |
| 타입 검사 | `cd 12` 후 `npx tsc --noEmit` | 타입 오류 없음 | 확인 · `.omo/evidence/s12-review-fix-typecheck.log` |
| lint | `npm run lint` | lint 오류 없음 | 확인 · `.omo/evidence/s12-review-fix-lint.log` |
| 전체 테스트 | `npm test` | Node 내장 테스트 13/13 통과 | 확인 · `.omo/evidence/s12-review-fix-test.log` |
| build | `npm run build` | `dist/server.js` 생성·tsc 오류 없음 | 확인 · `.omo/evidence/s12-review-fix-build.log` |
| Inspector 목록 | 아래 Inspector CLI 2.13.0의 `tools/list` | `get_assignment` 하나와 week 입력·설명·권한 힌트 | 확인 · `12/.qa/inspector-tools.json` |
| Inspector 호출 | 아래 `tools/call`에 `week=s12` 전달 | 실제 S12 내용·출처·조회 시각 | 확인 · `12/.qa/inspector-s12.json` |
| SDK 실제 stdio | `node .qa/verify-mcp.mjs` | S12·대문자 S11의 실제 제목 및 출처·조회 시각 | 확인 · `12/.qa/live-mcp-verification.json` |
| 오류 처리 | 위 SDK URL 입력 및 전체 테스트의 잘못된 주차·네트워크·원문 오류 | URL 입력 `isError: true`, 실패의 성공 대체 없음 | 확인 · 위 SDK JSON 및 테스트 로그 |
| AI 클라이언트 | 아래 동일 질문을 Claude Code의 새 독립 세션에서 수행 | 실제 `mcp__weeknote__get_assignment` 1회와 응답 사용 | 확인 · `12/.qa/claude-with.jsonl` |
| 연결 전후 비교 | 기본 도구 비활성화·strict MCP로 동일 질문 수행 | 연결 전 0회·자료 없음, 연결 후 1회·원문 근거 응답 | 확인 · `12/.qa/claude-without.jsonl`, `12/.qa/claude-with.jsonl` |
| 연결 보고 | 새 SDK 클라이언트 시작→stdio 연결 초기화 | 173ms 1회 관측·고정 원문 설명·읽기 권한 | 확인 · `12/.qa/live-mcp-verification.json` |
| 소개·팀 문서 | `http://127.0.0.1:3120/`, `/docs/plan.html`, `/docs/report.html` 열기 | 로컬 소개 1280/375px 가로 넘침 없음·콘솔 오류 0, 팀 문서 템플릿 보존 | 로컬 확인 · `12/.qa/intro-desktop.png`, `12/.qa/intro-mobile.png`, `.omo/evidence/s12-docs.md`; 최종 복사 동작 확인 대기 |
| 공개 접근 | 공개 기본 도메인의 `/`, `/docs/plan.html`, `/docs/report.html`, `/icon.svg`를 credentials omit·redirect manual로 요청 | 모두 HTTP 200·redirect false, S12 메타데이터·리포트 canonical 정확 | 확인 · `12/.qa/public-first-deploy.json` |

## 측정과 평가

| 항목 | 값 |
| --- | --- |
| 셋업 → 첫 실제 데이터 수집 | 기록 없음 |
| MCP 클라이언트 연결 시간 | SDK 새 클라이언트 초기화 173ms, 해당 실행 1회 관측 |
| 배포 시간 | 최초 Vercel 서버 createdAt→ready 13.756초 = 0.229266분, 리포트 0.23분 |
| 첫 로딩 | 공개 사이트 브라우저 첫 탐색 201.9ms, 리포트 0.20초 |
| 가장 막힌 지점 | 대소문자 정규식의 i 플래그가 JSON Schema에서 빠져, `[sS]` 패턴과 회귀 테스트로 수정 |
| 문서 품질 / AI가 잘 아나 / 주제 적합성 | 기록 없음 / 기록 없음 / 기록 없음 |
| 무료 한도 | 기록 없음 |

MCP 서버 자체는 API 키를 요구하지 않는다. 모델 접속·요금·사용 한도는 사용자가 선택한 AI 클라이언트의 조건이며 서버 무료 한도 평가와 섞지 않는다. 미측정 수치와 미완료 데모를 추정해서 채우지 않는다.

최초 공개 배포는 Vercel `dpl_EPBxsZTeEwNYBHRmYTkgPkfKiGDh`, 상태 READY다. 서버 `createdAt=1793376686895`부터 `ready=1793376700651`까지 13,756ms를 배포 시간으로 기록했다. 브라우저 첫 탐색 201.9ms는 `12/.qa/public-first-deploy.json`에서 확인했다. 이 두 수치는 각각 최초 실행 1회 관측이며 전체 셋업 시간·최종 재배포 시간·일반 성능 보장이 아니다. 공개 브라우저 콘솔 오류는 0건이었다.

## 호출과 비교 재현

`12/`에서 설치·빌드한 뒤 아래 스크립트 절대 경로를 실제 경로로 바꾼다. 연결 방법은 [README](README.md)에 있다.

```sh
npx --yes @modelcontextprotocol/inspector@2.13.0 --cli node /ABSOLUTE/PATH/naite/12/dist/server.js --method tools/list
npx --yes @modelcontextprotocol/inspector@2.13.0 --cli node /ABSOLUTE/PATH/naite/12/dist/server.js --method tools/call --tool-name get_assignment --tool-arg week=s12
```

MCP 설명은 “initialB s01~s18 주차별 실제 제목·미션·목표·제약과 스택·선택지·제출 안내를 확인할 때 사용”하도록 안내하고, 고정 공식 가이드 하나만 읽는다고 명시한다. 권한 힌트는 `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`다. 임의 URL·파일 경로·쓰기 권한을 제공하지 않는다. 본문 수신을 포함한 요청 상한 8초·응답 상한 512KiB·리디렉션 금지를 적용한다.

실제 비교 질문은 **“initialB의 2026년 10월 30일 기준 S12 과제의 정확한 주제, 필수 제약, 제출 방법을 알려주세요. 확인할 수 없는 정보는 추측하지 말고 모른다고 답해주세요.”**다. Claude Code 2.1.287·Claude Haiku 5.5에서 `--bare`, `--strict-mcp-config`, `--tools ''`, `--no-session-persistence`를 사용한 새 독립 세션 두 개를 비교했다. 모델 API 키는 검증 프로세스에만 환경변수로 전달했고 원본 로그에서 가렸다. MCP 서버·소개 사이트는 키를 요구하지 않는다.

| 조건 | 실제 도구 호출 | 관측한 응답 |
| --- | --- | --- |
| 연결 전 | 0회 | 과제 자료·도구가 없어 확인할 수 없으며 추측하지 않겠다고 답함 |
| 연결 후 | `mcp__weeknote__get_assignment({"week":"s12"})` 1회 | MCP 서버 만들기·읽기 전용 1도구/1소스/1기능·하드코딩 금지·stdio 허용·소개와 팀 문서 웹 배포를 원문 근거로 답하고 출처·조회 시각 제시 |

원본은 `12/.qa/claude-without.jsonl`, `12/.qa/claude-with.jsonl`, 요약은 각각 `claude-without-summary.json`, `claude-with-summary.json`이다. `.qa/` 원본은 Git·공개 배포에서 제외되며 공개 저장소에서 열리지 않는다. 외부 검토용 결과는 이 문서와 [검증 요약](SPIKE.md)에 남긴다. SDK JSON의 S12 실제 조회 시각은 `2026-10-30T16:07:10.375Z`이며 S12 제목은 `MCP 서버 만들기`, 대문자 `S11` 제목은 `CS 문의 트리아지`다. SDK의 S12 호출 165ms·S11 호출 40ms는 해당 실행 관측값이며 성능 보장이 아니다. 연결 초기화 173ms를 셋업→첫 실제 데이터 수집 시간으로 대입하지 않는다. 이 질문 한 건의 비교를 AI 전체 정확도나 품질 점수로 확대하지 않는다.

## 등록 준비

| 항목 | 값 |
| --- | --- |
| 공개 사이트 URL | https://s12-weeknote.vercel.app/ — 최초 공개 배포·비로그인 접근 확인 |
| 기획서 | https://s12-weeknote.vercel.app/docs/plan.html |
| 스택 리포트 | https://s12-weeknote.vercel.app/docs/report.html |
| 소스 | https://github.com/JOKIM-SQ/naite/tree/codex/s12-weeknote-mcp/12 |
| initialB 등록 | 미실행 |

공개 배포·비로그인 접근을 확인했으며 [initialB 등록 자료](INITIALB.md)의 소개 사이트 URL 하나로 등록 자료를 준비했다. 문서 최종 재배포·TSV 복사 값을 확인한 뒤 사용자가 갤러리 상단 입력란에 이 주소를 넣어 최종 제출할 수 있다. stdio MCP 서버는 제출 URL이 아니다.
