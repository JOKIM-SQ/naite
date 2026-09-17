# 분석 미리보기 모션 TDD

2026-09-17. 새 독립 모듈 `public/analysis-motion.mjs`의 상태 경계를 기존 `node:test`로 검증했다. 실제 API 호출·OCR 결과·브라우저 시각 검사와 무관한 UI 미리보기 테스트다.

## Red

테스트를 먼저 작성했다. 모듈 부재 확인 후 동작 없는 초기화 함수만 만든 상태에서 다음 7개 테스트가 모두 assertion 실패하는 것을 확인했다.

1. 첫 화면 노출 전 정지, 절반 이상 노출 시 1회 재생, 종료 후 추가 노출에는 정지 유지.
2. 재생 중 중복 클릭 차단, 유한 시간 내 종료, 다시 보기 재생, 버튼 내용 보존.
3. IntersectionObserver가 없는 경우에도 1회 재생 후 정지.
4. 처음부터 움직임 줄이기가 켜졌으면 정지 그림과 안내만 표시.
5. 재생 중 움직임 줄이기를 켜면 타이머 취소, 해제 후에는 수동 재생만 허용.
6. 첫 노출 전에 설정을 바꿔도 해제할 때 자동 재생을 다시 예약하지 않음.
7. 탭 숨김 시 정지, cleanup 시 타이머와 이벤트 제거.

## Green

- 모듈은 DOM·media query·observer·타이머를 주입받는다. Node에서는 자동 초기화하지 않는다.
- CSS 모션은 `data-playing=true`로만 시작한다. 4.5초 후에는 `false`인 완성 그림으로 돌아간다.
- CSS의 개별 애니메이션 이름이나 프레임 타이밍, 실제 영수증 API 상태에는 의존하지 않는다.
- `node --test public/*.test.mjs`: **29개 통과, 0개 실패**.
- `node --check public/analysis-motion.mjs`, `git diff --check`: 통과.

브라우저 통합 확인은 메인 작업 담당이다. 기존 `app.js`와 `receipt-view.mjs`는 변경하지 않았다.
