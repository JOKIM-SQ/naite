# S11 제출 준비

현재 상태: **구현·실패 경로 검증 완료 / Claude 정상 처리 검증은 API 키 설정 대기 / 공개 배포·갤러리 등록 전**. 문서 준비와 전체 앱 완료는 구분한다. 아래 증거 경로는 이 저장소에 기록된 실행 결과다.

## 준비 체크

- [x] `PLAN.md`와 `DESIGN.md`를 실제 소스·실패 화면과 대조
- [x] 팀 기획서·리포트의 구조·CSS·data-f·TSV 스크립트 보존 확인 — `.omo/evidence/s11-docs-schema.json`
- [x] 실행 명령과 환경 파일 주입 순서 확인 — `scripts/development.mjs`
- [x] 확인된 실제 검증 결과와 미검증 범위를 구분해 기록

## 실제 검증

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| TypeScript | PASS · `npx tsc --noEmit` 종료 0 | [실행 결과](../.omo/evidence/s11-backend-review-fixes-20261022.json) |
| ESLint | PASS · `npm run lint` 종료 0 | [실행 결과](../.omo/evidence/s11-backend-review-fixes-20261022.json) |
| Vitest 전체 테스트 | PASS · 7개 파일, 31/31 | [실행 결과](../.omo/evidence/s11-backend-review-fixes-20261022.json) |
| Next.js 빌드 | PASS · `npm run build` 종료 0 | [통합 실행 기록](../.omo/evidence/s11-root-20261022.md), [스파이크 기록](SPIKE.md) |
| 독립 코드 리뷰 | APPROVE · 차단 지적 3건 해결, 비차단 정리 권고 1건 | [최종 재검토](../.omo/evidence/s11-code-review-20261022.md) |
| 문의 접수 응답 | PASS · 네이티브 폼 접수 HTTP 202, 서버 관측 203ms 1회 | [통합 실행 기록](../.omo/evidence/s11-root-20261022.md) |
| Supabase 권한·상태 경계 | PASS · RLS·CAS·중복 이벤트·타 작업공간 재시도 거절·완료 보존, 검증 후 롤백 | [검증 SQL](.qa/verify-database.sql), [실행 기록](SPIKE.md) |
| 지속 실패 → 실제 자동 재시도·최종 실패 | PASS · 실제 Inngest 3회 시도, 최종 failed, 이벤트 8개 | [원본 API 결과](.qa/permanent-result.json) |
| 수동 재접수 | PASS · demo_mode none 전환, 새 queued 기록 추가 | [원본 API 결과](.qa/manual-retry-result.json) |
| 수동 재접수 후 정상 완료 | 미검증 · Claude 연결 불가로 다시 failed | [원본 API 결과](.qa/manual-retry-result.json) |
| 실제 Claude 분류·초안 완료 | 미검증 · API 키 설정 필요 | AI Gateway 403, 직접 키 미설정 |
| 일시 실패 후 정상 완료 | 미검증 · API 키 설정 필요 | 기록 없음 |
| 애매한 입력 → 실제 AI 검토 필요 | 미검증 · API 키 설정 필요 | 기록 없음 |
| 다른 작업공간 조회·재시도 차단 | PASS · 목록 0개, 재시도 HTTP 409 | [분리 검사](.qa/isolation-result.json) |
| 공개 API 내부값 비노출 | PASS · 내부 필드 미노출, 이벤트 ID 해시 처리 | [분리 검사](.qa/isolation-result.json) |
| 데스크톱 실패 화면 | 확인 · 실제 저장된 실패 상세·타임라인 표시 | [전체 화면](.qa/relay-desktop-final.png), [실패 상세](.qa/relay-failed-final.png) |
| 모바일 가로 넘침·수정 후 콘솔 | PASS · 375×812에서 scrollWidth 375, 오류 없음 | [통합 관측 기록](../.omo/evidence/s11-root-20261022.md) |
| 키보드·모션 감소 | 소스·단위 테스트 확인; 실제 브라우저 전체 시나리오는 미검증 | [UI 소스 대조](../.omo/evidence/s11-docs-ui-source.txt) |

접수 203ms는 한 번의 서버 관측이며 일반 성능 보장이나 셋업 시간 측정이 아니다. 초기 접수 오류 수정 후의 관측과 이전 실패 이력은 구분한다. 단위 테스트와 코드 리뷰는 실제 Claude 정상 연결을 입증하지 않는다.

## 정상 처리 검증을 재개하는 조건

`11/.env.ai.local`에 실제 `ANTHROPIC_API_KEY`를 직접 지정한다. 모델 설정은 `ANTHROPIC_MODEL=claude-haiku-5-5`이다. 키를 채팅이나 제출 문서에 붙여 넣지 않는다. `npm run dev`를 다시 시작하고 Inngest Dev Server가 연결된 상태에서 일반 문의 완료, 복합 문의의 검토 필요, 일시 실패 후 성공을 재검증한다.

## 공개 제출 전 별도 단계

- [ ] 공개 배포를 실행하고 다른 사용자가 여는 실제 URL 확인
- [ ] `report.html`의 URL 텍스트와 `href`를 실제 공개 주소로 교체
- [ ] 리포트 복사 버튼의 실제 TSV 값 확인
- [ ] initialB 갤러리에 실제 등록

이번 구현 요청에는 공개 배포·갤러리 등록이 포함되지 않는다. 리포트 URL의 `기록 없음`과 `../`는 제출 완료 값이 아니다. `minutes`, 문서 품질, AI 이해도, 적합성 등 미확인 필드의 `기록 없음` 역시 측정·평가 전 임시 표기다.

## 현재 확인 가능한 실패 경로 데모

1. 새 문의 → 예시 · 결제 · 환불
2. 데모 시나리오 설정 → 계속 실패 → 최종 실패 표시 → 문의 접수하기
3. 접수된 문의 → 처리 기록 → 최종 실패
4. 새로고침 → 같은 문의 → 처리 기록
5. 다시 처리하기 → 새 접수 기록 → 데모 실패 조건 해제

데모 제목: **이걸 n8n으로 했으면 몇 분이었을까**. n8n 구현 시간과 3분 시연 전체 소요 시간은 미측정이다. 정상 분류·초안·검토 필요 데모는 API 키 설정과 실제 성공 검증 뒤에 추가한다.
