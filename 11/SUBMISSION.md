# S11 제출 준비

현재 상태: **2026-10-23 실제 Claude 연결의 정상·복합 문의·자동 복구·수동 복구 4개 시나리오 검증 완료 / 공개 배포·갤러리 등록 전**. 아래 증거 경로는 이 저장소에 기록된 실행 결과다. `.qa/` 원본 스냅샷은 Git·배포에서 제외되며, 공유 가능한 검증 요약은 [SPIKE.md](SPIKE.md)의 2026-10-23 절에 남긴다.

## 준비 체크

- [x] `PLAN.md`와 `DESIGN.md`를 실제 소스·실패 화면과 대조
- [x] 팀 기획서·리포트의 구조·CSS·data-f·TSV 스크립트 보존 확인 — [2026-10-23 통합 기록](../.omo/evidence/s11-claude-20261023.md)
- [x] 실행 명령과 환경 파일 주입 순서 확인 — `scripts/development.mjs`
- [x] 확인된 실제 검증 결과와 미검증 범위를 구분해 기록

## 실제 검증

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| TypeScript | PASS · 2026-10-23 재실행, `npx tsc --noEmit` 종료 0 | [통합 실행 기록](../.omo/evidence/s11-claude-20261023.md) |
| ESLint | PASS · 2026-10-23 재실행, `npm run lint` 종료 0 | [통합 실행 기록](../.omo/evidence/s11-claude-20261023.md) |
| Vitest 전체 테스트 | PASS · 2026-10-23 재실행, 7개 파일·31/31 | [통합 실행 기록](../.omo/evidence/s11-claude-20261023.md) |
| Next.js 빌드 | PASS · 2026-10-23 재실행, `npm run build` 종료 0 | [통합 실행 기록](../.omo/evidence/s11-claude-20261023.md), [스파이크 기록](SPIKE.md) |
| 독립 코드 리뷰 | APPROVE · 차단 지적 3건 해결, 비차단 정리 권고 1건 | [최종 재검토](../.omo/evidence/s11-code-review-20261022.md) |
| 문의 접수 응답 | PASS · 네이티브 폼 접수 HTTP 202, 서버 관측 203ms 1회 | [통합 실행 기록](../.omo/evidence/s11-root-20261022.md) |
| Supabase 권한·상태 경계 | PASS · RLS·CAS·중복 이벤트·타 작업공간 재시도 거절·완료 보존, 검증 후 롤백 | [검증 SQL](.qa/verify-database.sql), [실행 기록](SPIKE.md) |
| 지속 실패 → 실제 자동 재시도·최종 실패 | PASS · 실제 Inngest 3회 시도, 최종 failed, 이벤트 8개 | [원본 API 결과](.qa/permanent-result.json) |
| 수동 재접수 | PASS · demo_mode none 전환, 새 queued 기록 추가 | [원본 API 결과](.qa/manual-retry-result.json) |
| 수동 재접수 후 정상 완료 | PASS · 3회 실패 후 새 실행 1회차에 account·초안 완료, 누적 이벤트 14개 | [재접수 전](.qa/claude-before-manual-20261023.json), [최종 결과](.qa/claude-final-20261023.json) |
| 실제 Claude 분류·초안 완료 | PASS · 일반 문의 billing·1회 시도·초안 449자 | [최종 API 결과](.qa/claude-final-20261023.json) |
| 일시 실패 후 정상 완료 | PASS · 첫 강제 실패 후 실제 2회차에 technical·초안 완료, 이벤트 8개 | [최종 API 결과](.qa/claude-final-20261023.json) |
| 복합 입력 → 실제 AI 검토 필요 | PASS · account·needs_review true, 로그인+배송 복수 요청과 담당 부서 분배 확인 사유·초안 | [최종 API 결과](.qa/claude-final-20261023.json) |
| 다른 작업공간 조회·재시도 차단 | PASS · 목록 0개, 재시도 HTTP 409 | [분리 검사](.qa/isolation-result.json) |
| 공개 API 내부값 비노출 | PASS · 내부 필드 미노출, 이벤트 ID 해시 처리 | [분리 검사](.qa/isolation-result.json) |
| 데스크톱 실패 화면 | 확인 · 실제 저장된 실패 상세·타임라인 표시 | [전체 화면](.qa/relay-desktop-final.png), [실패 상세](.qa/relay-failed-final.png) |
| 모바일 가로 넘침·수정 후 콘솔 | PASS · 375×812에서 scrollWidth 375, 오류 없음 | [통합 관측 기록](../.omo/evidence/s11-root-20261022.md) |
| 키보드·모션 감소 | 소스·단위 테스트 확인; 실제 브라우저 전체 시나리오는 미검증 | [UI 소스 대조](../.omo/evidence/s11-docs-ui-source.txt) |

접수 203ms는 한 번의 서버 관측이며 일반 성능 보장이나 셋업 시간 측정이 아니다. 초기 접수 오류 수정 후의 관측과 이전 실패 이력은 구분한다. 단위 테스트와 코드 리뷰는 실제 Claude 정상 연결을 입증하지 않는다.

## 2026-10-23 실제 Claude 관측

사용자가 직접 설정한 키로 `claude-haiku-5-5`에 연결하고 실제 Supabase·Inngest 작업을 실행했다. 2026-10-22의 Gateway 403과 수동 재접수 후 실패는 과거 이력이며, 아래는 2026-10-23 새 문의의 관측값이다.

| 합성 시나리오 | 문의 ID | 최종 결과 | 관측 시간 |
| --- | --- | --- | --- |
| 일반 결제 문의 | `0f5588ed-ab51-4cb1-b636-b4be8f377b07` | billing·completed·1회 시도·검토 필요 false | 8,379ms |
| 로그인+배송 복합 문의 | `6297483b-a948-4d76-92cb-5ee97a1e80b8` | account·completed·1회 시도·검토 필요 true | 8,358ms |
| 일시 실패 후 자동 복구 | `4dcd7940-94f2-4df9-b05f-f84e54000df2` | technical·completed·2회 시도·초안 생성 | 41,293ms |
| 최종 실패 후 수동 복구 | `002598c0-7a0b-4c97-9504-700e6ae5334a` | failed 3회 → mode none → account·completed·새 실행 1회·초안 467자 | 재접수부터 약 8.3초 |

네 건 모두 최종 completed이며 초안이 저장됐다. 일반·복합·일시 실패 시간은 최초 저장부터 완료까지, 수동 복구 시간은 새 queued 기록부터 완료까지의 개별 관측이다. 처리 성능 보장·일반 분류 정확도·셋업 시간 측정이 아니다. 모델의 confidence 또한 실제 정확도를 뜻하지 않는다.

## 공개 제출 전 별도 단계

- [ ] 공개 배포를 실행하고 다른 사용자가 여는 실제 URL 확인
- [ ] `report.html`의 URL 텍스트와 `href`를 실제 공개 주소로 교체
- [ ] 리포트 복사 버튼의 실제 TSV 값 확인
- [ ] initialB 갤러리에 실제 등록

이번 구현 요청에는 공개 배포·갤러리 등록이 포함되지 않는다. 리포트 URL의 `기록 없음`과 `../`는 제출 완료 값이 아니다. `minutes`, 문서 품질, AI 이해도, 적합성 등 미확인 필드의 `기록 없음` 역시 측정·평가 전 임시 표기다.

## 3분 데모 순서 초안

1. 새 문의 → 예시 · 결제 · 환불 → 문의 접수하기 → 분류·답변 초안
2. 새 문의 → 예시 · 복합 문의 → 문의 접수하기 → 검토 필요·사유
3. 새 문의 → 예시 · 기술 지원 → 첫 분류 실패 → 자동 재시도 → 문의 접수하기 → 완료
4. 새 문의 → 예시 선택 → 계속 실패 → 최종 실패 표시 → 문의 접수하기 → 최종 실패
5. 다시 처리하기 → 새 접수 기록 → 분류·답변 초안 완료

데모 제목: **이걸 n8n으로 했으면 몇 분이었을까**. n8n 구현 시간과 3분 시연 전체 소요 시간은 미측정이다.
