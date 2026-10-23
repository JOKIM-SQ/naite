# RELAY · 릴레이

S11 CS 문의 트리아지. 문의를 즉시 접수한 뒤 Inngest에서 Claude 분류와 답변 초안을 생성하도록 구현한 로컬 MVP다. 2026-10-23 실제 Supabase·Inngest·Claude 연결에서 **일반 문의, 복합 문의의 검토 필요, 일시 실패 후 자동 복구, 최종 실패 후 수동 복구** 4개 시나리오를 확인했다. 작업공간 분리도 검증했다. 전체 판정은 [제출 체크리스트](SUBMISSION.md)에서 확인한다.

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

2026-10-23 사용자가 지정한 `ANTHROPIC_API_KEY`와 `ANTHROPIC_MODEL=claude-haiku-5-5`로 직접 Claude 연결을 확인했다. 새 환경에서도 `11/.env.ai.local`에 직접 키와 모델을 지정하고 개발 서버를 다시 시작한다. 모델 ID는 [Anthropic 공식 모델 문서](https://platform.claude.com/docs/en/models/overview)를 기준으로 한다. 키는 채팅·로그·문서에 넣지 않는다. 2026-10-22의 AI Gateway 카드 등록 요구 HTTP 403과 프로덕션 민감 키 내보내기 제한은 과거 연결 실패 이력이며, 현재 검증은 직접 Anthropic API 경로로 진행했다.

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

2026-10-23 일반 문의는 billing·1회 시도로 초안을 생성했고, 로그인과 배송을 묶은 복합 문의는 account·검토 필요 사유와 초안을 생성했다. 일시 실패 데모는 첫 강제 실패 후 실제 Inngest 재시도 2회차에 완료됐다. 지속 실패 데모는 3회 시도 후 실패했으며, UI의 다시 처리하기로 조건을 해제하자 새 실행 1회차에 초안까지 완료됐다.

관측 시간은 일반·복합 각각 약 8.4초, 자동 복구 약 41.3초, 수동 재접수부터 완료까지 약 8.3초였다. 이는 개별 합성 시나리오의 관측값이며 일반 성능 보장이나 정확도 평가가 아니다. AI confidence는 모델의 자체 판단이며 실제 정확도가 아니다. [스파이크 기록](SPIKE.md)의 2026-10-23 절에 결과를 정리했고, 원본 API 스냅샷은 Git·배포에서 제외된 `.qa/claude-final-20261023.json`에 보관했다.

## 제출 문서

- [기획](PLAN.md), [화면 설계](DESIGN.md), [제출 준비](SUBMISSION.md)
- 로컬 팀 기획서: `http://127.0.0.1:3110/docs/plan.html`
- 로컬 팀 리포트: `http://127.0.0.1:3110/docs/report.html`

아직 공개 URL이 없어 리포트 URL은 `기록 없음`이며 `href="../"`를 둔다. 공개 배포 후 실제 URL로 교체하기 전에는 레지스트리 복사 결과를 제출하지 않는다. 미측정 시간·평가·무료 한도 수치는 만들어 넣지 않는다.

회원가입·로그인, 외부 메일함 연결, 답변 외부 발송은 범위에 없다.
