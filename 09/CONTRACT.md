# S09 모듈 계약

## 이미지 처리 — public/processing.mjs

- `validateImageFile(file)` JPEG/PNG/WebP, 12MiB 이하를 검사한다.
- `gridDimensions(width, height, columns)` 가로 칸 수와 원본 비율로 격자 크기를 계산한다.
- `samplePixelGrid(pixels, width, height, columns)` 원본 RGBA 배열에서 격자 중심 픽셀을 그대로 선택하여 `{ data, width, height }`를 반환한다. 양자화·팔레트 재색칠·보간을 하지 않는다.
- `processImage(file, { columns = 64, extractPalette } = {})`는 실제 브라우저 Canvas로 디코딩·Color Thief 5색·픽셀 변환을 수행한다. 반환값: `{ sourceBlob, thumbnailBlob, pixelBlob, palette, width, height, columns, gridWidth, gridHeight }`.
- `renderPixelArt(sourceBlob, columns)`은 원본 Blob에서 픽셀아트만 재생성하고 `{ pixelBlob, gridWidth, gridHeight }`를 반환한다.
- Color Thief 호출은 `extractPalette(canvas)`로 주입하며 5색 Color 배열 또는 HEX 배열을 받는다. 적은 고유 색은 실제 추출색을 반복해 5칸을 채우고 `palette`는 항상 5개 HEX다. 완전 투명·색 추출 실패는 명시적으로 거절한다.

## 저장 — public/storage.mjs

- `createBoardStore(factory = globalThis.indexedDB, name = 's09-chroma')` async → `{ list(), put(record), remove(id), close() }`.
- 카드 모델: `{ id, name, createdAt, sourceBlob, thumbnailBlob, pixelBlob, palette, width, height, columns, gridWidth, gridHeight }`.
- transaction 완료 후만 저장 성공을 반환한다. list는 최신 createdAt 순서다. 변경도 전체 record put으로 저장한다. 실패는 호출자에게 전달한다.

## 화면 — public/index.html, style.css, icon.svg

앱 타이틀 Chroma. 밝은 중성 배경·큰 이미지·5색 스트립·절제된 보라 포인트. 빈 화면에 가짜 저장 카드를 넣지 않는다.

컨트롤러용 ID: `file-input`(multiple file), `drop-zone`, `upload-trigger`, `status-message`, `board`, `empty-state`, `board-count`, `processing-indicator`, `toast`, `detail-dialog`, `detail-close`, `detail-name`(input), `detail-meta`, `detail-source-tab`, `detail-pixel-tab`, `detail-image`, `detail-palette`, `pixel-columns`(select 32/64/128), `download-pixel`, `delete-card`, `delete-dialog`, `delete-cancel`, `delete-confirm`.

동적 카드 DOM은 메인 컨트롤러가 만든다. 카드 class 계약: `.mood-card`, `.card-media`, `.card-image`, `.card-tabs`, `.card-tab`, `.card-body`, `.card-name`, `.card-caption`, `.card-palette`, `.swatch`, `.swatch-code`, `.card-actions`, `.card-open`, `.card-download`.

모든 상태·에러·사용자 파일명은 textContent로 표시한다. 원본·변환 Blob URL은 카드 제거·화면 재구성 시 해제한다.
