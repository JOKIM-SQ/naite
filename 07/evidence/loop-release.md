# S07 반복 재생·공개 배포 결과

2026-09-17. 사용자 요청: 다시 보기 버튼 제거, 애니메이션 계속 반복, 공개 배포 진행. 이전 배포 승인 대기는 이 명시적 요청으로 해소됐다.

## 변경 및 사전 검증

- 다시 보기 DOM·스타일·이벤트와 일회 종료 타이머 제거.
- 스캔 → 날짜·금액·품목 → 체크 → 완성 그림 유지 → 페이드 초기화를 5.2초 CSS 주기로 반복한다.
- 미리보기가 절반 이상 보이는 활성 탭에서 재생한다. 화면 밖·탭 숨김·움직임 줄이기에서 완성 그림으로 정지하며 조건 회복 시 자동 재개한다.
- `npx tsc --noEmit`, `npm run lint`, `npm test` **50개**, `npm run build`, `git diff --check` 통과. 기존 checkJs:false이므로 엄격한 타입 검증이라는 의미는 아니다.
- TDD: `analysis-loop-tdd.md`. 독립 코드 리뷰: `loop-code-review.md`, 남은 P1/P2 없음.
- 로컬 실제 브라우저: 두 번째 반복 진입, 화면 밖 정지(0개 애니메이션)·복귀 재생(7개), 움직임 줄이기 전환 확인. 320/390px 가로 넘침 없음.
- 배포 dry run에서 대상 디렉터리는 `07`, 23개 배포 파일이며 환경 파일·QA 서버·fixture·테스트·증거 자료가 제외됨을 확인했다.

## 배포 결과

| 항목 | 결과 |
| --- | --- |
| 공개 URL | https://s07-receipt-organizer.vercel.app |
| 배포 URL | https://s07-receipt-organizer-qrphwm17m-jokim-5226s-projects.vercel.app |
| 배포 ID | dpl_2BjAmYia3SasYJFTfVi6FwbuNQAs |
| 프로젝트 | s07-receipt-organizer |
| 대상·상태 | production · READY |
| 구현 커밋 | 6042003 |
| 구성 | 정적 HTML/JS + Vercel Node 함수, Framework Other |
| 원격 빌드 | 4초, JavaScript 구문 검사 통과 |

`vercel deploy --prod --yes --project s07-receipt-organizer`를 `07`에서 실행했고 기존 공개 도메인 alias가 새 배포로 갱신됐다. 다른 주차 프로젝트 또는 Git 원격은 변경하지 않았다.

## 공개 사이트 직접 검증

gstack `/browse`로 공개 주소에 접근해 다음을 관찰했다.

- 첫 관찰 iteration 0 → 5.7초 뒤 iteration 1. 모든 모션 duration 5200ms, iterations Infinity, playing=true. 추가 1.4초 뒤 날짜 opacity 1·금액 약0.98·품목 0으로 두 번째 순차 등장 확인. 다시 보기 버튼은 없다.
- 메인·CSS·모션 모듈·매니페스트·SVG/PNG 아이콘 4종·기획서·보고서 모두 HTTP 200. 모션 모듈은 application/javascript, 매니페스트는 application/manifest+json, PNG는 image/png로 응답.
- 1440px·390px에서 가로 넘침 없음. 모바일 화면 직접 시각 확인 완료.
- 공개 화면에서도 움직임 줄이기를 켜면 data-playing=false·애니메이션 0개·완성 필드 3개·안내 표시. 해제 후 자동 재생 7개로 복귀.
- 새 배포 대상으로 `vercel logs <배포 URL> --level error --since 10m` 조회: 해당 시간대 오류 수준 로그 없음.

증거: `loop-public.json`, `loop-public-desktop.png`, `loop-public-mobile.png`.

## 기존 연결 제한

공개 `/api/receipts`는 기존 키·SQL 설정 대기로 HTTP 503을 응답하며 업로드가 비활성화되어 있다. 이 작업은 UI와 애니메이션의 공개 배포·검증을 완료한 것이며 실제 Supabase 저장, Haiku OCR 또는 제출 갤러리 등록 완료를 주장하지 않는다. 키·SQL·외부 데이터는 변경하지 않았다.
