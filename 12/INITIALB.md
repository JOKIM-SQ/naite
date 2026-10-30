# 주차노트 · Weeknote initialB 등록 자료

현재 상태: **Inspector·실제 Claude 비교 확인 / 최초 공개 배포·비로그인 접근 확인 / initialB 실제 등록 미실행**.

## 입력할 자료

| 항목 | 값 |
| --- | --- |
| 사이트 URL | https://s12-weeknote.vercel.app/ |
| 기획서 URL | https://s12-weeknote.vercel.app/docs/plan.html |
| 스택 리포트 URL | https://s12-weeknote.vercel.app/docs/report.html |
| 제목 | 주차노트 · Weeknote |
| 한 줄 소개 | AI에게 주차를 물으면 공식 가이드에서 과제를 찾아준다. |
| 스프린트 | S12 |
| 만든 사람 | John Kim |
| 스택 카드 | MCP · 도구 연동 |
| 선택 스택 | 공식 TypeScript MCP SDK 1.32.2 · 로컬 stdio |
| 소스 | https://github.com/JOKIM-SQ/naite/tree/codex/s12-weeknote-mcp/12 |

갤러리에는 **공개 소개 사이트 URL 하나**를 입력한다. `get_assignment`는 로컬 stdio MCP 도구이므로 서버 실행 명령·HTTP MCP 엔드포인트·가이드 URL을 등록 자료로 넣지 않는다.

```text
https://s12-weeknote.vercel.app/
```

이 기본 도메인에서 소개·기획서·리포트·아이콘 모두 비로그인 HTTP 200과 리디렉션 없음을 확인했다. 최초 Vercel 배포는 READY였다. 서버 createdAt→ready 구간 0.23분과 브라우저 첫 탐색 0.20초는 각각 1회 관측이다.

## 등록 순서

1. [제출 체크리스트](SUBMISSION.md)에서 공개 소개 페이지·기획서·리포트의 비로그인 접근과 MCP 데모 결과를 확인한다.
2. 이 문서와 스택 리포트의 URL 필드가 위 기본 도메인이며, 제목·만든 사람·스택·소개·소스가 일치하는지 확인한다.
3. [initialB 갤러리](https://initialb.vercel.app/) 상단 URL 입력란에 공개 소개 사이트 주소 하나를 붙여 넣는다.
4. 사용자가 최종 등록할 때 **Enter** 또는 **드랍**을 누른다. 이 동작이 실제 제출이며 현재 작업에서는 실행하지 않는다.
5. 등록 후 S12 카드·기획서·리포트·소스 링크를 확인한다. 팀 비교표가 필요하면 리포트의 한 줄 복사 버튼을 사용한다.

## MCP 시연 순서

1. MCP 연결 전 AI 클라이언트에 **“initialB의 2026년 10월 30일 기준 S12 과제의 정확한 주제, 필수 제약, 제출 방법을 알려주세요. 확인할 수 없는 정보는 추측하지 말고 모른다고 답해주세요.”**라고 질문하고 응답을 기록한다.
2. 빌드한 서버를 stdio MCP로 연결한다. 연결 시간·도구 설명·권한 범위를 기록한다. API 키가 필요 없는 고정 가이드 읽기 도구임을 설명한다.
3. MCP Inspector에서 도구 목록과 `get_assignment({ "week": "s12" })`의 실제 호출 결과를 보여준다.
4. 같은 AI 클라이언트에 1번과 동일한 질문을 보낸다. AI의 실제 도구 선택·호출과 공식 가이드 출처·조회 시각이 담긴 결과를 확인한다.
5. 연결 전후 두 응답을 나란히 비교한다. 실제로 관측한 차이만 설명하고, 직접 검증하지 않은 성능·정확도 향상을 주장하지 않는다.

Inspector CLI 2.13.0의 정확한 목록·호출 명령과 원본 증거 경로는 [제출 체크리스트](SUBMISSION.md)에 있다. 실제 Claude Code 2.1.287·Claude Haiku 5.5 독립 세션 비교에서 연결 전 0회·연결 후 get_assignment 1회 호출을 확인했다. 연결 후 답변은 공식 S12 주제·제약·stdio 허용·소개와 팀 문서 배포 방식을 출처와 함께 제시했다. SDK 새 stdio 연결 초기화는 173ms 한 번의 관측이며, 셋업 전체 시간이나 일반 성능을 뜻하지 않는다. 셋업→첫 실제 데이터 수집·리포트 평가 점수는 기록 없음이다.
