# S11 RELAY · 릴레이 검증 기록

2026-10-22, America/Los_Angeles. 사용자 승인: Inngest 기반 CS 문의 트리아지와 이전 주차 수준의 UI/UX.

## 구현 상태

Next.js 16.4.2·React19.3.1·TypeScript·Inngest4.26.0·Supabase·AI SDK7을 연결했다. 따뜻한 오프화이트/산호색 인박스, 실제 문의 KPI·상태 필터·상세·입력 모달·처리 애니메이션·실제 이벤트 타임라인·초안 복사·실패 재접수를 구현했다. 로그인·메일 수집·외부 답변 발송은 포함하지 않았다.

전용 Vercel 프로젝트 `s11-relay`, 브랜치 `codex/s11-cs-triage`, 작업 폴더 `11/`. Inngest Hobby 무료 리소스는 약관 동의 후 실제 생성·연결됐다. 공개 배포와 initialB 등록은 실행하지 않았다.

## 자동 검사

- `npx tsc --noEmit`: exit0.
- `npm run lint`: exit0, 경고0.
- `npm test`: **31/31 pass**, 7개 파일. 백엔드20·UI9·개발환경2개.
- `npm run build`: exit0. Next 프로덕션 빌드에서 `/`, `/api/inngest`, `/api/tickets`, `/api/tickets/[id]/retry` 생성 확인.
- 독립 코드 리뷰 최종 APPROVE, 차단 사항 없음. 초기 작업공간 쿠키 경합·실행 토큰 노출·타입 오류를 수정하고 회귀 테스트로 확인했다. 공급자 입력의 JSON 왕복 단순화는 비차단 의견으로 남았다.

테스트 먼저 실패를 관찰하고 구현했다. backend 일부는 설치 대기 중 선행 작성된 코드를 제거한 뒤 최소 stub부터 실제 assertion 실패를 확인하고 다시 구현했다. npm10.9.8의 peer 그래프 `edgesOut` 내부 오류는 분리 캐시에서도 재현했으며, 전역 도구 변경 없이 `npx --yes npm@12.2.1 install`로 설치했다.

## 실제 저장소와 작업 실행

기존 Supabase `weekly-awe-project`의 테이블 이름을 먼저 확인한 뒤 S11 전용 `s11_tickets` 및 RPC만 추가했다. 브라우저 역할 권한을 제거하고 RLS를 켰다. SQL 롤백 검증에서 토큰 CAS·중복 이벤트·타 작업공간 재시도 거절·완료 상태 보존을 확인했다. 사용자 문의 데이터는 읽지 않았다.

로컬 앱 `http://127.0.0.1:3110/`와 실제 Inngest Dev Server `http://127.0.0.1:8288/`를 함께 실행했다. native 브라우저 폼으로 검증용 영구 실패 문의를 접수했다. 서버 관측은 **POST202 / 203ms** 한 번이며 모든 환경의 속도 보장이나 셋업 시간은 아니다. 분류 완료를 기다리지 않고 접수 응답을 반환했다.

실제 Inngest 실행에서 분류 **시도1→재시도 대기→시도2→재시도 대기→시도3→최종 실패**를 확인했다. 관리 UI는 본 실행 FAILED, 실패 핸들러 COMPLETED로 표시했다. DB/API와 앱에서도 failed·attempts3·이벤트8개가 유지됐고 새로고침 후 복원됐다. 가짜 AI 결과나 setTimeout 성공 처리는 없다.

`다시 처리하기`를 실제 클릭해 새 queued 이벤트와 demo_mode=none으로 실패 조건 해제를 확인했다. 이 실행도 아래 AI 연결 제약으로 최종 실패했다. 일시 실패 후 정상 성공을 검증했다는 뜻은 아니다.

같은 브라우저 작업공간은 문의1개, credentials omit으로 요청한 별도 작업공간은0개였다. 타 작업공간의 해당 문의 재시도는409로 거절됐다. API에는 workspace_id/run_token이 없고 이벤트 ID도 내부 토큰 대신64자리 SHA256 공개 ID다.

1280×720 첫 화면·처리 중·실패 화면을 직접 확인했고 375×812에서 scrollWidth=375, 가로 넘침 없음이었다. POST400 수정 이후 브라우저 콘솔 오류는 없었다. OS 입력기 전체 검증은 하지 않았다.

검증용 문의 ID 하나만 정확히 지정해 정리한 뒤 API 목록0개·빈 화면으로 복구했다. 실제 로컬 HTTP에서 기획서·리포트 모두200과 S11 메타를 확인했다. 사용자가 만든 문의는 정리하지 않았다.

## 실제로 막힌 지점

1. Next16 개발 서버는 request.url을 localhost로 정규화했으나 실제 Host/Origin은127.0.0.1이었다. Origin 비교가 정상 접수를 거절해 실제 Host와 URL 프로토콜 기준으로 수정했다. 위조 forwarded-host를 신뢰하지 않고 cross-site는 거절한다. 진단 로그는 제거했다.
2. AI Gateway 실제 요청은403과 카드 등록 필요 응답이었다. 기존 프로덕션 Claude 키도 Vercel의 민감 값 보호 때문에 자동 가져오기가 불가능했다. 사용자에게 Git에서 제외된 `.env.ai.local`에 직접 키를 설정하도록 요청했다. 키를 채팅·로그에 출력하지 않았다.

공식 Claude 모델 문서 `https://platform.claude.com/docs/en/models/overview`에서 직접 API ID `claude-haiku-5-5`를 확인했다. Gateway 모델은 `anthropic/claude-haiku-5.5`다. 직접 Anthropic API 키가 있으면 해당 연결을 우선 사용하고, 없으면 Gateway 경로를 사용한다.

**2026-10-22 당시 미검증:** 실제 Claude 정상 분류·초안 생성, 복합 문의의 검토 필요, 일시 실패 후 정상 성공. 이후 API 키 설정을 완료해 아래 2026-10-23 절에서 실제 결과를 확인했다. 총 개발/셋업 시간·공개 배포 시간·운영 비용은 기록 없음이다.

## 근거

`11/.qa/permanent-result.json`, `isolation-result.json`, `manual-retry-result.json`, `verify-database.sql`, `relay-empty.png`, `relay-processing.png`, `relay-failed-final.png`, `relay-desktop-final.png`. 실제 SQL 실행은 Supabase CLI `db query --linked --project-ref kmfoeoxvsadlurpmkqwh --file .qa/verify-database.sql` exit0이다.

저장소 루트 `.omo/evidence/s11-backend-20261022.md`, `s11-ui-20261022.md`, `s11-ui-bootstrap-20261022.json`, `s11-code-review-20261022.md`, `s11-docs-20261022.md`, `s11-root-20261022.md`. QA·환경 파일은 Git과 Vercel 업로드에서 제외한다.

## 2026-10-23 실제 Claude 분류·초안 검증

사용자가 로컬 서버 전용 키를 설정한 뒤 개발 서버를 다시 시작했다. `claude-haiku-5-5` 직접 API와 실제 Supabase·Inngest Dev Server를 사용했다. 비밀키는 로그·브라우저·Git에 기록하지 않았다. gstack `/browse`의 실제 브라우저에서 합성 문의를 입력하고 접수 버튼을 눌렀다. AI 응답을 대체하는 mock이나 성공 폴백은 사용하지 않았다.

| 시나리오 | 관측 결과 | 완료 시간 |
| --- | --- | --- |
| 중복 결제 확인 | billing, completed, 시도 1, 검토 필요 false, 답변 초안 저장 | 접수→완료 8.379초 |
| 로그인 오류 + 배송 지연 | account, completed, 검토 필요 true, 복수 요청·부서 배분 확인 사유, 두 요청을 나눈 답변 초안 | 접수→완료 8.358초 |
| 첫 분류 실패 | classification_retry 기록 뒤 시도 2에서 technical 분류와 초안 완료, 이벤트 8개 | 접수→완료 41.293초 |
| 지속 실패 후 수동 재접수 | 3회 시도 후 failed·이벤트 8개, UI의 다시 처리하기 → demo_mode none → account·초안 완료, 새 실행 시도 1·누적 이벤트 14개 | 재접수→완료 약 8.3초 |

네 시나리오 모두 실제 결과와 완료 저장을 확인했다. 시간은 각 한 번의 로컬 관측이며 처리 속도 보장이나 셋업 시간 측정이 아니다. 네 합성 시나리오의 통과는 분류 정확도 벤치마크가 아니며, 화면의 confidence는 모델 자체 판단이다.

생성된 네 초안을 직접 읽었다. 환불·배송·계정 수정을 완료했다는 주장은 없었고 확인 절차를 안내했다. 복합 문의는 로그인과 배송을 나누어 답변했다. 기술 지원 초안에는 직접 확인하지 않았다는 설명과 함께 “확인 중”이라는 표현이 있어 실제 담당자의 진행 상황과 대조해야 한다. 문장 길이와 어조까지 자동 승인한 것은 아니며, 답변은 사람의 사실 확인을 거치는 초안으로만 사용한다. 외부 발송은 하지 않았다.

새로고침 뒤 4건 복원, 검토 필요 필터 결과 1건, 실제 사유·초안 표시를 확인했다. 공개 API 내부 workspace_id/run_token 비노출, 브라우저 콘솔 오류 없음도 확인했다. 타입 검사·린트·Vitest 7개 파일 31/31·프로덕션 빌드를 재실행해 통과했다. 실제 API 스냅샷에 대한 상태·분류·초안·재시도·내부값 비노출 assertion도 `.qa/check-claude-20261023.mjs`에서 통과했다.

원본 API: `11/.qa/claude-final-20261023.json`, 수동 복구 전 실패: `11/.qa/claude-before-manual-20261023.json`. 화면: `11/.qa/claude-review-20261023.png`. 원본 QA 자료는 Git에서 제외한다. 공개 배포·initialB 등록은 진행하지 않았다.

검증 종료 후 이번에 만든 합성 문의 4건만 ID·제목 접두어·생성 시간·완료 상태로 제한해 정리했다. 사용자 문의는 수정하지 않았다. 검증 결과와 초안 원본은 위 비공개 QA 스냅샷에 남겼다.
