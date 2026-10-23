# RELAY · 릴레이

S11 CS 문의 트리아지. 문의를 즉시 접수한 뒤 Inngest에서 Claude 분류와 답변 초안을 생성하도록 구현한 로컬 MVP다. 실제 문의 저장·Inngest 자동 재시도·최종 실패·수동 재접수·작업공간 분리는 확인했다. **Claude API 키 설정이 남아 있어 정상 분류·초안 생성은 아직 실제 검증하지 못했다.** 전체 판정은 [제출 체크리스트](SUBMISSION.md)에서 확인한다.

## 구성

Next.js 16.4.2 · React 19.3.1 · TypeScript · Inngest 4.26.0 · AI SDK 7 · Supabase를 사용한다. `ANTHROPIC_API_KEY`가 있으면 `ANTHROPIC_MODEL`로 지정한 Claude에 직접 연결한다. 직접 연결 키가 없을 때는 AI Gateway의 `AI_MODEL`을 사용하며 기본값은 `anthropic/claude-haiku-5.5`이다. 전용 Vercel 프로젝트는 `jokim-5226s-projects/s11-relay`이며 Inngest 무료 Hobby 리소스 설치와 공개 배포 완료는 별개다. 공개 배포 URL은 기록 없음이다.

## 로컬 실행

현재 Node.js 22.22.3에서 검증했다. 아래 npm 12 설치 명령은 Node.js 22.22.2 이상인 22.x 또는 24.15.0 이상인 24.x에서 사용한다. 명령은 저장소의 `11/`에서 실행한다.

```sh
cd 11
npx --yes npm@12.2.1 ci
```

npm 10의 설치 중 peer 의존성 처리 문제를 피하기 위해 npm 12.2.1로 설치했다. 위 재현 명령은 전역 npm을 변경하지 않고 현재 `package-lock.json`을 사용한다. 환경 파일은 커밋하지 않는다.

- `../07/.env.local`: 기존 `weekly-awe-project` Supabase 및 기존 서버 연결 값을 읽는다. 이전 주차 파일을 수정하지 않으며, S11 전용 테이블과 RPC를 사용한다.
- `.env.local`: S11 Inngest·Vercel OIDC 관련 값과 프로젝트별 서버 설정.
- `.env.ai.local`: S11 Claude 직접 연결의 모델·키 등 로컬 AI 설정.

`scripts/development.mjs`가 위 순서대로 파일을 읽어 비어 있지 않은 값을 뒤 파일의 값으로 덮어쓰고 `INNGEST_DEV=1`을 설정한다. 없는 파일은 건너뛰며 `[SENSITIVE]` 자리표시는 주입하지 않는다. 새 환경에서는 `.env.example`의 서버 설정 이름을 참고해 S11 환경 파일에 필요한 값을 지정한다. 값 자체를 문서·로그·브라우저에 출력하지 않는다.

현재 필요한 설정은 `11/.env.ai.local`의 **실제 `ANTHROPIC_API_KEY`**다. 파일 안의 `ANTHROPIC_MODEL=claude-haiku-5-5`와 함께 사용한다. 모델 ID는 [Anthropic 공식 모델 문서](https://platform.claude.com/docs/en/models/overview)를 기준으로 한다. 키는 채팅에 붙여 넣지 않고 로컬 파일에 직접 지정한 뒤 개발 서버를 다시 시작한다. 현재 AI Gateway 요청은 카드 등록 요구로 HTTP 403을 반환하며, 기존 프로덕션의 민감한 키는 내보낼 수 없어 재사용하지 못했다.

```sh
npm run dev
```

`npm run dev`는 `node scripts/dev.mjs`를 실행하고 위 환경을 주입해 Next.js 개발 서버를 시작한다.

별도 터미널에서 실제 Inngest Dev Server를 실행한다.

```sh
cd 11
npm run inngest:dev
```

`inngest:dev`는 `npx --yes inngest-cli@latest dev -u http://127.0.0.1:3110/api/inngest`를 실행한다. 앱 주소는 `http://127.0.0.1:3110`이다. Inngest 실행기가 없으면 백그라운드 분류와 초안 작업은 완료되지 않는다.

## 데이터와 동작

문의는 브라우저별 HttpOnly 작업공간 쿠키로 분리한다. 로그인 기능은 없으며 브라우저 또는 쿠키가 바뀌면 같은 작업공간을 복원하는 기능도 없다. Supabase `s11_tickets`와 관련 RPC는 서버의 service_role만 접근한다. 서버 비밀키를 클라이언트에 전달하지 않는다.

- `GET /api/tickets`: 현재 작업공간 문의 목록
- `POST /api/tickets`: 저장·이벤트 수락 후 HTTP 202 접수 응답
- `POST /api/tickets/:id/retry`: 현재 작업공간의 실패한 문의를 새 run token으로 재접수
- `/api/inngest`: 실제 Inngest 실행 연동

단계는 분류 → 초안 → 완료 저장이다. 오류는 재시도 또는 최종 실패로 표시한다. 불확실한 결과의 `검토 필요`는 처리 오류와 구분한다. 입력 예시는 실제 API로 전달되는 원문이며 AI 결과를 흉내 내지 않는다. 문의 본문은 AI에 전달되므로 데모에는 비식별 예시를 사용한다.

## 검증 명령

```sh
npx tsc --noEmit
npm run lint
npm test
npm run build
```

`npm test`는 Vitest 전체 실행(`vitest run`)이다. 현재 7개 파일의 31개 테스트, TypeScript, ESLint, 프로덕션 빌드가 통과했고 독립 코드 리뷰의 차단 지적 3건을 해결했다. 증거는 [제출 체크리스트](SUBMISSION.md)에 기록했다. 단위 테스트와 빌드 통과는 실제 Claude 연결 성공을 뜻하지 않는다.

실제 Inngest Dev Server에서 지속 실패 데모가 3번 시도한 뒤 최종 실패와 8개 처리 기록을 저장했다. 수동 재접수는 데모 조건을 해제하고 새 작업을 시작했지만 Claude 연결 문제로 다시 실패했다. 정상 분류·초안, 애매한 문의의 실제 AI 검토 표시, 일시 실패 후 성공은 키 설정 후 재검증해야 한다.

## 제출 문서

- [기획](PLAN.md), [화면 설계](DESIGN.md), [제출 준비](SUBMISSION.md)
- 로컬 팀 기획서: `http://127.0.0.1:3110/docs/plan.html`
- 로컬 팀 리포트: `http://127.0.0.1:3110/docs/report.html`

아직 공개 URL이 없어 리포트 URL은 `기록 없음`이며 `href="../"`를 둔다. 공개 배포 후 실제 URL로 교체하기 전에는 레지스트리 복사 결과를 제출하지 않는다. 미측정 시간·평가·무료 한도 수치는 만들어 넣지 않는다.

회원가입·로그인, 외부 메일함 연결, 답변 외부 발송은 범위에 없다.
