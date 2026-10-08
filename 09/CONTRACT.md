# S09 모듈 계약

## 이미지 처리 — public/processing.mjs

- `validateImageFile(file)` JPEG/PNG/WebP, 12MiB 이하를 검사한다.
- `gridDimensions(width, height, columns)` 가로 칸 수와 원본 비율로 격자 크기를 계산한다.
- `samplePixelGrid(pixels, width, height, columns)` 원본 RGBA 배열에서 격자 중심 픽셀을 그대로 선택하여 `{ data, width, height }`를 반환한다. 양자화·팔레트 재색칠·보간을 하지 않는다.
- `processImage(file, { columns = 96, pixelMode = 'detail', extractPalette, detailRenderer } = {})`는 실제 브라우저 Canvas로 디코딩·Color Thief 5색·픽셀 변환을 수행한다. 반환값: `{ sourceBlob, thumbnailBlob, pixelBlob, palette, width, height, columns, gridWidth, gridHeight, pixelMode }`.
- `renderPixelArt(sourceBlob, columns, pixelMode = 'original', { detailRenderer } = {})`은 원본 Blob에서 픽셀아트만 재생성하고 `{ pixelBlob, gridWidth, gridHeight, pixelMode }`를 반환한다.
- `detail`은 별도 워커의 얇은 윤곽·색 보정·최대 Lab 64색 변환, `original`은 원본 RGBA 샘플링, `style`은 잔질감을 정리한 독립 32색 변환이다. Color Thief의 대표색 5개로 재색칠하지 않는다. 디더링은 사용하지 않는다. PNG는 격자의 정수 배율로 긴 변 1,600px 이내에서 확대한다.
- Color Thief 호출은 `extractPalette(canvas)`로 주입하며 5색 Color 배열 또는 HEX 배열을 받는다. 적은 고유 색은 실제 추출색을 반복해 5칸을 채우고 `palette`는 항상 5개 HEX다. 완전 투명·색 추출 실패는 명시적으로 거절한다.

## 세밀 변환 — pixel-detail-client.mjs / pixel-detail-worker.js / pixel-detail.mjs

- `renderDetailGrid(pixels,width,height,{width,height})`는 워커에서 `{data:Uint8ClampedArray,width,height}`를 받아 Promise로 반환한다. 입력 배열을 복사해 전송하고 호출자의 배열은 보존한다.
- 워커는 자체 주소의 OpenCV 런타임을 지연 로드한다. 오류·잘못된 결과·60초 시간 초과는 거절하고 다른 모드로 자동 대체하지 않는다. 각 호출의 완료·실패 시 워커를 종료한다.
- `detailGrid(cv,pixels,width,height,grid)`는 실제 OpenCV 처리 코어다. patch 8, thickness 1, 색 보정, 결정적 RGB 2-means 타일, Lab 최대 64색을 사용한다. 모든 Mat을 성공·실패 모두 해제하고 투명도를 유지한다. 내부 작업 `grid.width*grid.height*64`는 4백만 픽셀 이하만 허용한다.
- PixelOE Python 비교판과 타일 양자화가 다르므로 바이트 일치를 보장하지 않는다. 같은 브라우저 런타임·입력·설정의 재변환은 결정적이다.

## 기존 브라우저 카드 저장 — public/storage.mjs

- `createBoardStore(factory = globalThis.indexedDB, name = 's09-chroma')` async → `{ list(), put(record), remove(id), close() }`.
- 카드 모델: `{ id, name, createdAt, sourceBlob, thumbnailBlob, pixelBlob, palette, width, height, columns, gridWidth, gridHeight, pixelMode? }`. 이전 카드에서 pixelMode 누락은 original로 표시하고 기존 Blob을 변환 없이 복원한다.
- transaction 완료 후만 저장 성공을 반환한다. list는 최신 createdAt 순서다. 변경도 전체 record put으로 저장한다. 실패는 호출자에게 전달한다.
- 앱에서 이 저장소는 로그인 후 명시적 가져오기 대상으로 사용한다. 비로그인 상태에서 초기화·조회하지 않으며 가져온 뒤에도 로컬 원본을 보존한다.

## 로그인과 저장 공간 선택 — public/workspace.mjs / api/config.mjs

- `startWorkspace(options)`는 `/api/config`의 공개 Supabase 설정을 읽고 Google PKCE 세션을 확인한다. 비로그인 상태는 로그인 안내 hero만 표시하며 업로드·URL 입력·보드·로컬 카드 앱을 초기화하거나 조회하지 않는다. 확인된 로그인 계정에는 공유 클라우드 저장소를 주입한다. 인증 계정이 바뀌면 기존 보드를 숨기고 전체 공유 카드를 다시 불러온다.
- `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`만 브라우저에 전달한다. 공개 설정 누락·연결 실패는 안내 화면을 표시하고 게스트 보드로 우회하지 않는다. service_role·secret 키는 앱에 포함하지 않는다.
- 로그인 복귀 주소는 현재 origin의 `/`다. 공개 앱과 3090 개발 주소를 Supabase Auth의 redirect 허용 목록에 등록한다.
- 로그인·로그아웃·가져오기 전에 앱의 진행 중 작업이 끝나기를 기다린다. 로그아웃하면 로그인 안내로 돌아간다. 브라우저 카드 가져오기는 사용자가 로그인 후 명시적으로 실행하며 기존 클라우드 ID를 건너뛴다. 부분 성공은 유지하고 로컬 원본은 삭제하지 않는다.

## 공유 저장 — public/cloud-store.mjs / SUPABASE.sql

- `createCloudStore(client, userId)` async → `{ list(), put(record), remove(id), close() }`. UI에는 기존 BoardRecord 계약을 제공하며 `list()`는 사용자별 필터 없이 전체 공유 카드를 읽는다.
- Postgres `s09_cards`는 카드 메타데이터와 revision·최초 등록자 `user_id`·이미지 경로를 저장한다. 비공개 Storage `s09-chroma-images`는 `creator/card/version/source|thumbnail|pixel` 경로를 사용하고 타사용자 편집도 최초 등록자 prefix를 유지한다. DB·Storage RLS는 모든 인증 계정에 공유 읽기·수정·삭제를 허용하고 익명 접근을 거절한다. 신규 카드 등록자는 본인만 허용하며 직접 등록자 변경을 차단한다.
- `s09_save_card(p_card, p_expected_revision)`는 CAS로 읽었던 revision과 현재 revision이 일치할 때만 저장한다. 오래된 여러 사용자·탭의 저장은 SQLSTATE `P0001`·DETAIL `s09_revision_conflict`로 거절하고 다시 불러오도록 안내한다. 공유 보드는 별도 초대 없이 모든 인증 계정이 사용하며 변경은 새로고침 후 보인다. 실시간 자동 갱신은 제공하지 않는다.
- 변경된 Blob만 새 경로로 업로드하고 DB 저장을 커밋한다. 응답이 유실되면 DB를 다시 읽어 결과를 확인한다. 확정되지 않은 커밋의 파일은 잘못 삭제하지 않는다.
- `s09_delete_card(p_id)`는 advisory lock과 row lock으로 공유 카드 삭제를 직렬 처리하며 해당 이미지의 `s09_image_cleanup` 등록을 한 DB 트랜잭션에서 처리한다. 삭제 자체에는 expected revision 비교가 없다. 교체된 이전 파일도 저장 트랜잭션에서 정리 대기열에 넣는다.
- 정리 대기열의 `user_id`는 편집·삭제 실행자다. 실행자 계정의 목록 조회·저장·삭제 시 그 계정의 대기열만 재시도하며 다른 계정의 대기열은 조회·재시도하지 않는다. Storage 삭제 확인 후에만 대기열 항목을 제거하며 파일 정리 실패는 이미 커밋된 카드 변경을 실패로 되돌리지 않는다.
- 배포 전 `SUPABASE.sql` 실행이 필요하다. 기존 `s09_owner` 등 정책을 ALTER POLICY로 갱신하여 기존 DB 행·이미지를 삭제하지 않고 개인 보드에서 공유 보드로 업그레이드한다. 현재 자동 테스트 134/134개·타입·린트·빌드는 통과했다. 운영 SQL을 트랜잭션으로 적용하고 실제 SDK 두 계정의 동일 카드·원본 바이트 복원, 타계정 이름/픽셀 수정·삭제, 최초 등록자 보존·변조 거절, 오래된 저장 CAS 거절, 익명 DB·Storage·RPC 차단, 무관한 타계정 경로 업로드 거절과 정리 대기열 0개를 확인했다. 독립 리뷰는 CLEAR/APPROVE이며 초기 로딩·로그아웃 경합 재현 1/1과 관련 테스트 34/34도 통과했다. 공개 배포와 공개 브라우저 QA는 확인 전이다. 이전 개인 보드의 125개 테스트와 계정 분리 검증은 SPIKE.md의 이전 버전 기록이며 현재 공유 권한의 성공 근거로 사용하지 않는다. 실제 Google 계정 승인 전체 왕복은 미실시다.

## 화면 — public/index.html, style.css, icon.svg

앱 타이틀 Chroma. 밝은 중성 배경·큰 이미지·5색 스트립·절제된 보라 포인트. 빈 화면에 가짜 저장 카드를 넣지 않는다.

hero와 `/docs/plan.html`·`/docs/report.html`은 공개다. 로그인 필수 조건은 업로드·URL·보드 앱 작업 영역에 적용한다.

컨트롤러용 ID: `file-input`(multiple file), `drop-zone`, `upload-trigger`, `status-message`, `board`, `empty-state`, `board-count`, `processing-indicator`, `toast`, `detail-dialog`, `detail-close`, `detail-name`(input), `detail-meta`, `detail-source-tab`, `detail-pixel-tab`, `detail-image`, `detail-palette`, `pixel-columns`(select 32/64/96/128), `pixel-mode`(select detail/original/style), `download-pixel`, `delete-card`, `delete-dialog`, `delete-cancel`, `delete-confirm`.

동적 카드 DOM은 메인 컨트롤러가 만든다. 카드 class 계약: `.mood-card`, `.card-media`, `.card-image`, `.card-tabs`, `.card-tab`, `.card-delete`, `.card-body`, `.card-name`, `.card-caption`, `.card-palette`, `.swatch`, `.swatch-code`, `.card-actions`, `.card-open`, `.card-download`.

`.card-delete`와 상세 `delete-card`는 대상 이름을 표시하는 같은 확인 창을 연다. 취소·Escape는 대상을 비우고, 확인은 해당 ID를 고정해 queue의 `store.remove`를 실행한다. 저장소 성공 후 카드와 Blob URL을 정리하며 다른 카드의 열린 상세는 유지한다. 실패하면 기존 카드·다운로드가 유지된다.

모든 상태·에러·사용자 파일명은 textContent로 표시한다. 원본·변환 Blob URL은 카드 제거·화면 재구성 시 해제한다.

## 공개 이미지 주소 — public/image-url.mjs

- `loadImageURL(raw,{fetchImpl,timeoutMs=15000})` → 실제 다운로드한 `File`. HTTP/HTTPS만 허용하고 주소의 인증 정보는 거절한다.
- CORS·credentials omit·no-referrer로 읽는다. 응답은 JPG/PNG/WebP만 받으며 헤더와 실제 스트림 모두 12MiB 제한, 다운로드 전체에 15초 제한을 적용한다. 초과 시 취소하고 reader lock을 해제한다.
- CORS·네트워크 차단은 원본 파일 업로드 안내로 연결한다. 임의 HTML 페이지나 CORS를 우회하는 서버는 지원하지 않는다.
- `image-url-form`, `image-url-input`, `image-url-submit`은 처리 중 잠근다. 정상 저장 후에만 주소를 비우고 실패 시 유지한다. URL과 파일 모두 같은 변환·트랜잭션 저장 경로를 사용한다.
- 드롭은 실제 파일을 우선하고, 파일이 없으면 text/uri-list 또는 text/plain의 주소를 읽는다.

메인 SVG는 스캔·픽셀 조립·5색을 12초 간격으로 반복한다. 장식 그래픽은 aria-hidden이며 prefers-reduced-motion에서 애니메이션을 멈추고 완성 이미지를 표시한다.
