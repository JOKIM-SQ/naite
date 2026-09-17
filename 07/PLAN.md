# S07 영수증 정리기 — 구현 계획

## 목표와 범위
사진 최대 3장을 한 번에 선택하면 원본을 Supabase Storage에 보관하고 Claude Haiku 4.5로 날짜·최종 결제금액·통화·품목을 추출한다. 원본 옆 표에서 틀린 값을 수정하면 자동 저장한다. 사용자 요청으로 Google OAuth를 포함한다. 별도 비밀번호 회원가입, 관리자 페이지, CSV·회계 연동은 만들지 않는다.

- 출처: https://initialb.vercel.app/guide.html#s07 (2026-09-16 확인)
- 스택: 기존 Supabase 프로젝트의 Storage + Postgres, Claude 직접 Messages API, 정적 HTML/JS + Vercel Node 함수
- 모델: claude-haiku-4-5-20251001
- 파일/키: 실제 파일은 private Storage, DB에는 경로와 추출·수정 JSON. 비밀키는 서버 환경변수 전용, Auth 공개키만 브라우저에 전달.
- Google 계정으로 본인 영수증만 복원한다. 전환 상태는 `AUTH.md`에 기록한다.
- 결과가 불확실하면 null. 날짜는 YYYY-MM-DD, 금액은 최종 결제금액, 통화는 ISO 코드 또는 null.
- 업로드 뒤 분석·저장은 자동. 사용자 작업 횟수는 데모에서 직접 관찰해 3회 이하를 검증한다. 화면의 correctionCount는 서버에 저장된 최상위 변경 필드 수(items 전체=1)이며 실제 클릭/필드 편집 횟수와 같다고 주장하지 않는다.
- 정확도: 정답과 비교한 수정 전 날짜·최종금액이 모두 맞은 영수증 N/3. 정답 확인 전에는 정확도 수치를 표시하지 않는다. 실제 영수증 없이는 달성으로 기록하지 않는다.
- 일정: 웹 가이드의 목 18:00 제출·금 09:30 데모를 적용. 기존 로컬 문서의 화/금 마감과 차이가 있으며 S07 문서에 명시한다.

## 순서 / 현재 상태
1. [완료] API 계약·데이터 구조·기획서 고정, 기존 연결 상태 확인 (실제 키는 외부 의존성으로 분리)
2. [완료] 테스트 우선 핵심 API와 한 화면 구현
3. [완료/외부 대기] 자동 검사35개·브라우저/모바일 fixture QA 완료. 실제 저장·Haiku는 키/SQL 대기
4. [완료/외부 대기] 구현 커밋 및 검토용 사이트 배포 완료. 문서 초안과 검증 한계 기록. 실제 실측·갤러리/비교표 제출은 키/SQL 적용 후 진행.

## 요구사항과 관찰할 결과
| 요구사항 | 검증 |
|---|---|
| 영수증 3장 | 3개 독립 결과, 한 장 실패가 나머지를 막지 않음 |
| 실제 스토리지 | 업로드한 원본 다시 열기 |
| 날짜·금액·항목 | 사진 원본과 최초 OCR 값 대조 |
| 손수 수정 | 입력 수정 후 새로고침에도 유지 |
| 3회 이하 작업 | 업로드 뒤 강제 클릭 0회, 수정 횟수 실측 |
| 정확도 발표 | 최초 결과 보존, 실제 정답 비교 N/3 기록 |
| 배포 | 다른 브라우저에서 공개 URL 열림 |
| 모바일/첫 화면 | 390px에서 넘침 없음, 제목·입력·설명 즉시 인지 |
| 문서 | /docs/plan.html 및 /docs/report.html, 템플릿 CSS·data-f 유지 |
| 데모/제외 기능 | 3분 이내 시연, 제외 3개 명시 |
| 보안 최소선 | 서버 비밀키 미노출, 다른 계정의 영수증 접근 불가 |

## API 계약
- 모든 응답: JSON, 오류는 `{message}`. 캐시는 no-store.
- `GET /api/receipts`: Supabase access token 검증 및 계정 소유권 확인. `{receipts: Receipt[]}` 최근 최대 30개.
- `POST /api/receipts`: `{action:"upload", fileName, mediaType, data}`. data=순수 base64, JPEG/PNG/WebP 최대 3 MiB. `{receipt}` 반환. 업로드 후 OCR 실패면 저장된 `status:"failed"` receipt도 반환해 재시도 가능.
- `POST /api/receipts`: `{action:"retry", id}`. 소유 계정 검사 후 저장 원본으로 다시 분석.
- `PATCH /api/receipts`: `{id, values: Values, revision}`. optimistic revision; 서버 기준 변경 필드 수로 correctionCount 증가. `{receipt}`. 충돌 409.
- Receipt: `{id,fileName,imageUrl,status:"processing"|"ready"|"failed",error,original:Values|null,values:Values|null,correctionCount,revision,createdAt}`.
- Values: `{merchant:string|null,date:string|null,total:number|null,currency:string|null,items:[{name:string,quantity:number|null,amount:number|null}]}`.
- original은 최초 성공 추출 후 불변. imageUrl은 짧은 만료 서명 URL로 GET마다 생성.
- DB: `weekly_projects.s07_receipts`; private bucket: `s07-receipts`.
- 모든 영수증 API는 Bearer access token을 Auth 서버에서 검증한다. `user_id`로 행과 원본 경로를 제한한다. 기존 익명 행은 NULL 소유자로 보존한다. 테이블 anon/authenticated 공개 정책 없음.

## 현재 외부 의존성
기존 Supabase 프로젝트 연결 및 Google 제공자 활성 상태를 확인했다. 실제 SQL 전환, Google 동의 흐름, Anthropic 키와 OCR 실측의 상태는 `AUTH.md`에 기록한다. 실서비스 확인 전까지 성공을 주장하지 않는다.
