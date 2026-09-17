# 앱 아이콘·분석 미리보기 검증

검증일: 2026-09-17. 사용자 요청에 따라 Paper trail 앱 아이콘과 메인 분석 그래픽/애니메이션을 추가했다. 브라우저 검증은 gstack `/browse`로 수행했다.

## 구현

- 기존 영수증 브랜드 마크를 SVG 파비콘, 192/512px PNG 앱 아이콘, 180px Apple 홈 화면 아이콘으로 연결했다. 웹 매니페스트와 서버 MIME을 추가했다.
- 메인 업로드 면에 영수증 스캔 → 날짜·금액·품목 그래픽을 넣었다. 실제 결과와 혼동하지 않도록 ‘정리 과정 미리보기’를 표시한다.
- 처음 절반 이상 보일 때 한 번 재생한다. 스캔은 3.8초, 재생 상태는 4.5초 후 종료하며 다시 보기로 재생한다. 별도 애니메이션 라이브러리는 없다.
- 움직임 줄이기 설정 및 탭 숨김 시 정지한다. 버튼 아이콘·접근 가능한 이름과 기존 업로드/저장 코드를 보존한다.
- 메뉴, 작업 단계, 사진 선택, 원본 확대, 삭제, 재시도 아이콘을 같은 선 스타일로 맞췄다.

## 실제 브라우저 관찰

| 시나리오 | 관찰 결과 |
| --- | --- |
| 최초 노출 및 다시 보기 | 실행 중 `data-playing=true`, 버튼 비활성, CSS 애니메이션 7개 실행. 종료 후 `false`, 버튼 활성, 애니메이션 0개, 모든 필드·체크 opacity 1 |
| 시간에 따른 실제 움직임 | 재생 시작 스캔 Y≈-14px. 1.5초 뒤 Y≈32px, 스캔 opacity 1, 날짜/금액/품목 opacity 1/0.64/0으로 순차 등장 확인 |
| 움직임 줄이기 초기 설정 | 재로드 후 정지 그림, 다시 보기 비활성, 설명 표시, 실행 애니메이션 0개 |
| 실행 중 설정 변경 | 즉시 정지. 설정 해제 후 자동 재시작 없이 다시 보기 활성 |
| 반응형 | 320/390/768/1440px에서 가로 넘침 없음. 모바일 입력 16px, 버튼·입력 최소 44px |
| 아이콘·매니페스트 | 개발 서버의 신규 자산 모두 HTTP 200. 매니페스트 `application/manifest+json`, PNG `image/png`, 모션 모듈 JavaScript MIME 확인. 브라우저에서 192/512/180px 실제 크기 확인 |
| 고대비 모드 | 삭제 mask 아이콘이 흰 배경으로 사라지는 문제를 재현. 시스템 `ButtonText`와 해당 아이콘에만 `forced-color-adjust:none` 적용 후 검정 아이콘 표시 확인 |
| 기존 작업 흐름 | 사진 3장 → ready 3개 → 상호 변경 → 저장 완료 → 새로고침 후 파일별 수정값 유지. 품목 추가·삭제 클릭 성공 |
| 연결 실패 | 실제 키가 없는 개발 서버의 기존 503 안내 및 업로드 비활성 유지. 미리보기는 독립 동작 |

QA 서버에서는 JavaScript 콘솔 오류가 없었다. 이후 실제 개발 서버를 연 공용 브라우저 로그의 503 한 건은 기존 서비스 미설정 응답이다.

## 자동 검사 및 독립 리뷰

- `npx tsc --noEmit`: 통과. 기존 `checkJs:false` 설정이므로 엄격한 타입 검증이라는 의미는 아니다.
- `npm run lint`: JavaScript 구문 검사 통과.
- `npm test`: **49개 통과**, 실패 0개. 신규 모션 경계 테스트 7개 포함.
- `npm run build`: 통과.
- `git diff --check`: 통과.
- 독립 검토: `animation-code-review.md`, 테스트 선행 근거: `analysis-motion-tdd.md`.

## 화면 근거

- `animation/desktop-complete.png`: 최종 데스크톱 화면
- `animation/mobile.png`, `animation/tablet.png`: 모바일·태블릿 정지 상태
- `animation/replay-start.png`, `animation/replay-middle.png`: 스캔 및 필드 순차 등장
- `animation/reduced-motion.png`: 정지 그림과 설정 안내
- `animation/forced-colors-before.png`, `animation/forced-colors-after.png`: 고대비 아이콘 수정 전후
- `animation/mobile-editor.png`: 모바일 편집 및 삭제 아이콘
- `animation/mobile-320-connection.png`: 좁은 화면의 실제 연결 대기 상태

## 검증 범위

3071 QA 서버는 실제 UI/API와 테스트용 외부 응답을 사용했다. 위 업로드·저장은 실제 Supabase 또는 Claude Haiku OCR 성공의 증거가 아니다. 실제 키·SQL 설정 대기는 기존 상태와 같다. 홈 화면 아이콘 파일·메타데이터는 검증했으나 실제 iOS 홈 화면 추가는 수행하지 않았다. 공개 배포는 앞서 자동 승인 검토가 명시적 승인 부족으로 거절한 상태이므로 이번 작업에서도 실행하지 않았다.
