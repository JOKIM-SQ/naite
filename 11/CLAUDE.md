# S11 RELAY · 릴레이

S11 과제는 CS 문의 트리아지다. 상위 문서의 S07 영수증 지시는 적용하지 않는다. 작업 범위는 이 저장소의 `11/`이며 다른 주차는 수정하지 않는다.

사용자 승인: Inngest와 이전 주차 수준의 유려한 UI/UX. Next.js·TypeScript·Inngest·기존 Supabase·Claude를 사용한다. 실제 이벤트로 접수→분류→답변 초안을 처리하고 재시도·최종 실패를 표시한다. 불확실한 분류는 처리 실패와 구분해 검토 필요로 표시한다. 답변은 초안이며 외부로 발송하지 않는다.

테스트를 먼저 작성하고 실패를 확인한 뒤 구현한다. 핵심 단위 후 `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`를 실행하고 한국어 커밋과 `TODO: Phase X 완료`를 남긴다. 공유 작업자의 변경과 루트의 기존 미커밋 변경은 보존한다. 파일 편집은 apply_patch를 사용한다.

비밀키는 서버에만 둔다. 브라우저별 HttpOnly 작업공간 쿠키로 문의를 분리하며 Supabase 테이블/RPC는 service_role만 접근한다. 타임라인과 횟수는 실제 작업 기록이며 가짜 진행률·가짜 AI 결과·연결 실패의 성공 폴백을 만들지 않는다.

로컬 앱 http://127.0.0.1:3110, 실제 Inngest Dev Server를 함께 실행한다. 클라우드 Inngest 무료 리소스 s11-relay는 설치 완료했다. 2026-10-23 사용자가 공개 배포와 initialB 등록 준비를 승인했다. 공개 주소는 https://s11-relay.vercel.app/ 이며 프로덕션에서 실제 처리·재시도와 제출 문서를 확인한다. initialB 실제 등록과 등록 준비 완료를 구분하며, 실제 제출은 별도 요청 없이 실행하지 않는다.

문서 `/docs/plan.html`과 `/docs/report.html`은 `_template/public/docs` 구조·CSS·data-f·TSV 스크립트를 보존한다. 미측정 값은 기록 없음. UI의 색상과 애니메이션을 팀 제출 문서에 적용하지 않는다.
