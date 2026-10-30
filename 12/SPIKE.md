# S12 주차노트 · Weeknote 검증 기록

2026-10-30, America/Los_Angeles. 사용자 승인: 주차별 과제 조회 MCP를 간단하게 구현하고 initialB 소개 페이지와 문서까지 준비.

## 선택과 범위

공식 TypeScript SDK 1.32.2, 로컬 stdio, `get_assignment` 도구 하나. 데이터 소스는 `https://initialb.vercel.app/guide.html` 하나다. 주차 s01~s18(대소문자 허용)만 입력받아 실제 원문을 조회한다. arbitrary URL·파일 경로·쓰기·삭제·DB·로그인·별도 채팅 UI를 추가하지 않았다. 소개 페이지는 연결 설명을 위한 정적 페이지이며 MCP 엔드포인트가 아니다.

최신 S12 가이드가 ‘MCP 서버 만들기’임을 실제 브라우저에서 확인했다. 지난주 갤러리의 다음 주 제목을 재사용하지 않았다. 실제 가이드 전체 DOM 111,827bytes와 S12 섹션을 비공개 `.qa/`에 보관해 파싱 결과와 대조했다. 런타임에서 이 스냅샷을 응답 폴백으로 사용하지 않는다.

## TDD와 MCP 실행

파싱·다른 주차 분리·입력 경계·네트워크 오류·리디렉션 거절·8초 제한·512KiB 상한·MCP 오류 응답·정적 소개 서버를 Node 내장 테스트로 확인했다. 구현 전에 실패한 assertion을 관찰하고 GREEN으로 전환했다. 근거는 저장소 루트 `.omo/evidence/s12-backend.md`와 RED/GREEN 로그에 남긴다.

공식 MCP Inspector 2.13.0으로 실제 `tools/list`와 `tools/call`을 실행했다. 도구 하나, readOnlyHint true·destructiveHint false, s12 실제 원문 반환을 확인했다. Inspector 실행 명령은 README에 기록했다. 대소문자 정규식의 i 플래그가 JSON Schema에서 사라지는 문제를 발견해 `[sS]` 패턴과 회귀 테스트로 수정했다.

별도 SDK Client로 실제 stdio 프로세스를 실행해 연결 시간과 조회 결과를 관측했다. 초기화 173ms, s12 조회 165ms, S11 조회 40ms였다. S12는 ‘MCP 서버 만들기’, S11은 ‘CS 문의 트리아지’로 반환됐고 URL을 주차에 넣은 요청은 isError true로 거부됐다. 원본 `.qa/live-mcp-verification.json`. 이 수치는 한 번의 로컬 관측이며 일반 속도 보장이 아니다. 전체 셋업 시작부터 최초 수집까지의 시간은 정밀 기록하지 않아 기록 없음으로 둔다.

## 실제 AI 클라이언트 연결 전후

Claude Code 2.1.287과 실제 Claude Haiku 5.5를 사용했다. `--bare`, `--strict-mcp-config`, 내장 도구 비활성화, 세션 저장 비활성화로 다른 도구나 이전 프로젝트 문맥이 끼어들지 않게 했다. 두 실행에 같은 질문을 사용했다.

> initialB의 2026년 10월 30일 기준 S12 과제의 정확한 주제, 필수 제약, 제출 방법을 알려주세요. 확인할 수 없는 정보는 추측하지 말고 모른다고 답해주세요.

- 연결 전: 도구 호출 0회. 자료와 도구가 없어 확인할 수 없으며 추측하지 않겠다고 답했다.
- 연결 후: Claude가 `mcp__weeknote__get_assignment`에 `{"week":"s12"}`를 넣어 실제 호출했다. ‘MCP 서버 만들기’, 읽기 전용 도구 1개·데이터 소스 1개 등의 제약, 로컬 stdio 허용, 소개 페이지·두 문서 배포와 사이트 URL 제출을 답했다. 출처와 조회 시각도 제시했다.

원본 `.qa/claude-without.jsonl`, `.qa/claude-with.jsonl` 및 각 summary.json에 기록했다. 이는 1개 질문의 실제 연결 비교이며 모델 전체 정확도 평가가 아니다. AI 클라이언트 검증에 사용한 기존 키는 실행 환경으로만 전달하고 로그에서 제거했다. MCP 서버와 소개 사이트 자체에는 API 키가 필요하지 않다. API 키·다른 주차 환경 파일·개인 설정은 Git에 포함하지 않는다.

## 소개 페이지와 제출

별도 JS 없는 정적 소개 페이지를 만들었다. 실제 브라우저 1280px·375px에서 가로 넘침 없음, 콘솔 오류 없음과 문서 링크를 확인했다. 화면 `.qa/intro-desktop.png`, `.qa/intro-mobile.png`를 직접 읽었다. 팀 문서 HTML은 원본 구조·CSS·data-f·TSV 스크립트를 보존한다.

정식 도메인 `https://s12-weeknote.vercel.app/`에 최초 정적 배포가 완료됐다(READY, `dpl_EPBxsZTeEwNYBHRmYTkgPkfKiGDh`). 익명 요청에서 소개·기획서·리포트·아이콘 모두 HTTP 200·리디렉션 없음, S12 메타데이터와 공개 canonical URL을 확인했다. 기존 접근 보호를 변경하거나 우회 토큰을 사용하지 않았다.

최초 Vercel 서버 기록 createdAt `1793376686895` → ready `1793376700651`, 13.756초를 0.23분으로 반올림했다. 전체 개발·셋업 시간이 아니다. 최초 브라우저 탐색의 load 완료는 201.900ms로 관측해 0.20초로 기록했다. 한 번의 관측이며 일반 성능 보장이 아니다. 근거 `.qa/deployment-first.json`, `.qa/public-first-deploy.json`.

공개 리포트의 최종 복사 동작과 마지막 재배포 결과는 후속 확인한다. initialB 실제 등록 버튼은 누르지 않는다.
