# 주차노트 · Weeknote

S12 **MCP 서버 만들기** 과제. AI 클라이언트가 `get_assignment({ "week": "s12" })`를 선택하면 initialB 공식 가이드를 읽고 해당 주차의 제목·미션·골·제약·출처·조회 시각을 반환하는 읽기 전용 MCP 서버다. Inspector와 SDK stdio 실연결, 실제 Claude의 도구 선택·연결 전후 비교를 확인했다. 소개 페이지와 팀 기획서·리포트를 함께 제공한다. 자세한 결과와 증거는 [제출 체크리스트](SUBMISSION.md)에 기록한다.

## 실행

Node.js 22.22.3 기준이다. 공식 TypeScript MCP SDK `@modelcontextprotocol/sdk@1.32.2`를 사용한다. 저장소를 받은 뒤 `12/`에서 설치·빌드한다.

```sh
cd 12
npm ci
npm run build
node /absolute/path/to/naite/12/dist/server.js
```

마지막 명령은 **stdio MCP 서버**를 시작한다. MCP 클라이언트가 이 프로세스를 실행하고 표준 입출력으로 통신한다. 웹 서버 주소나 공개 HTTP MCP 엔드포인트를 입력하는 방식이 아니다. stdout은 JSON-RPC 전용이며 진단은 stderr로 보낸다. API 키·DB·로그인은 필요하지 않다. Claude·Codex 등 클라이언트의 모델 접속과 계정 설정은 별개다.

## MCP 클라이언트 연결

Claude Desktop의 `claude_desktop_config.json`에서 다음 `mcpServers` 항목을 추가한다. 기존 설정이 있으면 해당 항목에 합친다. `command`에는 설치된 Node 실행 파일의 절대 경로를, `args`에는 실제 저장소의 `dist/server.js` 절대 경로를 넣는다. 아래 자리표시자는 그대로 실행할 수 없다.

```json
{
  "mcpServers": {
    "weeknote": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/naite/12/dist/server.js"]
    }
  }
}
```

설정을 저장하고 클라이언트를 다시 시작한 뒤 `get_assignment` 도구가 보이는지 확인한다. Codex 등 다른 MCP 클라이언트도 **로컬 stdio** 연결을 선택하고 같은 Node 명령과 스크립트 절대 경로를 지정한다. 이 문서의 설정 예시는 실행 검증 결과와 구분하며, 실제 연결 상태는 [제출 체크리스트](SUBMISSION.md)를 따른다.

질문 예시: **“initialB의 2026년 10월 30일 기준 S12 과제의 정확한 주제, 필수 제약, 제출 방법을 알려주세요. 확인할 수 없는 정보는 추측하지 말고 모른다고 답해주세요.”** 클라이언트가 도구를 선택하고 `week: "s12"`로 호출하는지, 결과의 출처가 고정 가이드이며 조회 시각이 포함되는지 확인한다.

Inspector CLI 2.13.0으로 목록과 실제 호출을 재현할 수 있다. 아래 스크립트 경로를 실제 절대 경로로 바꾼다.

```sh
npx --yes @modelcontextprotocol/inspector@2.13.0 --cli node /ABSOLUTE/PATH/naite/12/dist/server.js --method tools/list
npx --yes @modelcontextprotocol/inspector@2.13.0 --cli node /ABSOLUTE/PATH/naite/12/dist/server.js --method tools/call --tool-name get_assignment --tool-arg week=s12
```

## 입력과 권한

유일한 도구는 `get_assignment`이며 `week` 입력은 `s01`~`s18`이다. 대소문자를 구분하지 않는다. 유일한 외부 데이터 소스는 [initialB 공식 가이드](https://initialb.vercel.app/guide.html)다. 임의 URL·파일 경로를 받지 않으며 파일·DB 쓰기, 로그인, 별도 채팅 UI, LLM 서버는 제공하지 않는다. 원문을 실시간으로 가져와 선택한 주차를 추출한다. 네트워크·원문 구조·주차 오류를 성공 응답이나 예시 데이터로 덮지 않는다. 원문이 바뀌면 결과도 바뀔 수 있으므로 출처와 조회 시각을 함께 확인한다.

반환 필드는 `week`, `title`, `stack`, `summary`, `mission`, `goal`, `choices`, `distinction`, `constraints`, `source`, `fetchedAt`, `sourceContentNotice`다. `submission`은 해당 주차 원문에 제출 항목이 있을 때만 포함한다. `sourceContentNotice`는 외부 원문을 명령이 아닌 데이터로 다루라는 안내다. 요청 시간은 본문 수신을 포함해 8초, 응답 크기는 512KiB로 제한하며 리디렉션을 허용하지 않는다. MCP 목록에는 `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`를 표시한다.

## 소개 페이지와 검증

`npm run dev`로 소개 페이지를 실행하며 주소는 `http://127.0.0.1:3120/`이다. `/docs/plan.html`과 `/docs/report.html`은 팀 템플릿의 구조·CSS·`data-f`·복사 스크립트를 유지한다. 확정 공개 주소는 [s12-weeknote.vercel.app](https://s12-weeknote.vercel.app/)이며 현재 배포·공개 접근 최종 확인은 대기 상태다.

```sh
npx tsc --noEmit
npm run lint
npm test
npm run build
```

최근 자동 검증 기록은 타입 검사·lint·build 성공과 Node 내장 테스트 **13/13 통과**다. Inspector에서 도구 1개와 S12 실제 호출을 확인했다. 새 SDK stdio 클라이언트 1회 관측에서 연결 초기화 173ms, S12 호출 165ms, 대문자 `S11` 호출 40ms였으며 임의 URL 입력은 오류로 거부됐다. 이는 해당 실행의 관측값이며 일반 성능 보장이 아니다. 셋업부터 첫 실제 데이터 수집 시간은 정밀 측정하지 않아 기록 없음으로 둔다.

Claude Code 2.1.287·실제 Claude Haiku 5.5의 새 독립 세션에서 동일 질문을 비교했다. 기본 도구를 끄고 strict MCP 설정을 사용했다. 연결 전에는 도구 호출 0회로 확인할 자료가 없다며 추측하지 않았다. 연결 후에는 `mcp__weeknote__get_assignment({ "week": "s12" })`를 1회 호출해 **MCP 서버 만들기**, 실제 필수 제약, stdio 허용·소개 페이지와 팀 문서 배포 방식, 공식 출처를 답했다. 이 결과는 해당 질문 1건의 비교이며 AI 전체 정확도 평가가 아니다. 원본 JSONL·요약·SDK 결과 경로는 [제출 체크리스트](SUBMISSION.md)에 있다.

## 제출 자료

- [기획](PLAN.md), [제출 체크리스트](SUBMISSION.md), [initialB 등록 자료](INITIALB.md)
- [팀 기획서](public/docs/plan.html), [팀 스택 리포트](public/docs/report.html)
- 공개 소개: [https://s12-weeknote.vercel.app/](https://s12-weeknote.vercel.app/) · [기획서](https://s12-weeknote.vercel.app/docs/plan.html) · [리포트](https://s12-weeknote.vercel.app/docs/report.html) — 배포 최종 확인 대기
- [소스](https://github.com/JOKIM-SQ/naite/tree/codex/s12-weeknote-mcp/12)

initialB에는 공개 **소개 사이트 URL 하나**를 등록한다. MCP 서버의 stdio 명령이나 가이드 URL을 제출하지 않는다. 실제 갤러리 등록은 이 작업에서 실행하지 않는다.
