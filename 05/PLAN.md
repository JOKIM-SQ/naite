# S05 PRD — Spigen iPhone Case Catalog

| | |
|---|---|
| 스프린트 | S05 |
| 스택 카드 | Postgres 심화 |
| 내 옵션 | Supabase Auth Google OAuth + Postgres RLS |

Amazon URL 또는 10자리 ASIN을 드롭하면 Spigen iPhone 케이스의 제품·색상 옵션·호환 iPhone을 수집하고, 로그인한 사용자의 카탈로그에 관계형으로 저장한다.

## 01 누가 쓰나

Spigen iPhone 케이스를 비교하는 사용자. Amazon 탭을 여러 개 열어 색상별 ASIN과 맞는 iPhone 모델을 직접 확인하지 않고, 한 제품군의 파생 변형을 내 카탈로그에서 찾고 싶다.

## 02 지금은

Amazon 상품 상세 페이지에서 색상을 바꿀 때마다 ASIN이 달라지고, 기기 모델을 바꿀 때도 별도 상품 변형으로 이동한다. 색상과 기기 조합을 비교하려면 URL·ASIN·호환 모델을 수동으로 기록해야 한다.

## 03 없앨 동작 하나

Amazon의 변형 선택기를 하나씩 눌러 색상별 ASIN과 iPhone 모델을 옮겨 적는 동작을 없앤다.

## 04 핵심 기능

Amazon URL 또는 ASIN을 넣으면 제품 정보를 수집한 뒤, 파생 색상과 파생 iPhone 모델을 모달에서 골라 내 계정 전용 카탈로그에 저장한다.

## 05 Supabase OAuth

- 인증은 Supabase Auth의 **Google OAuth**를 사용한다. 이메일·비밀번호 폼이나 임시 게스트 모드는 만들지 않는다.
- 첫 방문자는 기능 설명과 `Google로 시작하기` 버튼만 보며, 로그인 성공 뒤에는 즉시 개인 카탈로그로 돌아온다.
- 세션이 남아 있으면 로그인 화면을 다시 거치지 않는다. 로그아웃은 사이드바 하단의 계정 메뉴에 둔다.
- `auth.users.id`를 `products.owner_id`에 저장하고, 이 사용자 id를 RLS의 유일한 소유권 기준으로 쓴다.

## 06 입력·수집 흐름

1. 사용자가 Amazon 상품 URL 또는 10자리 ASIN을 입력한다. ASIN만 입력하면 서버가 `https://www.amazon.com/dp/{ASIN}`으로 정규화한다.
2. 서버 함수가 Amazon HTML을 `fetch`하고 Cheerio로 제품명·대표 이미지·가격·현재 색상·현재 iPhone 모델을 추출한다.
3. 서버는 Amazon의 `inline-twister` 변형 행을 읽는다.
   - 색상: `#inline-twister-row-color_name li[data-asin]`에서 색상명·child ASIN·판매 가능 여부를 읽는다.
   - 기기: `#inline-twister-row-size_name li[data-asin]`에서 iPhone 모델명·child ASIN·판매 가능 여부를 읽는다.
4. 판매 가능한 파생 ASIN만 모달 후보로 만든다. 판매 불가·품절 변형은 저장·카운트·모달 목록 모두에서 제외한다.
5. 사용자가 모달에서 URL 기준만 저장하거나, 색상·기기 파생 ASIN을 선택한다.
6. 선택 ASIN은 각각 다시 수집해 실제 색상과 iPhone 모델 조합을 확인한다. 한 응답에 없는 필드는 다음 응답의 결과로 채운다.
7. 선택한 모든 ASIN에 필요한 정보가 채워지면 카탈로그에 노출한다.

## 07 누적 수집과 임시 저장

수집기는 한 번의 HTML 응답이 완전할 것을 요구하지 않는다. 제품 draft와 모델별 draft에 매 요청 결과를 병합한다. 이미 확보한 값은 유지하고, 비어 있던 필드만 이후 응답에서 채운다.

- 제품 필수값: 제품명, 대표 이미지, 가격, 기준 ASIN
- 기기 필수값: iPhone 모델명, 기기 변형 ASIN
- 옵션 필수값: 색상명, 색상 child ASIN, 판매 가능 여부
- 재시도: ASIN별 최대 100회. 필요한 모든 빈칸이 채워지면 즉시 멈춘다.
- 실패: 100회 뒤에도 완성되지 않으면 `needs_retry` 상태로 남기며, 불완전한 행은 메인 카탈로그에서 보이지 않는다.

임시 상태는 별도 테이블을 추가하지 않는다. `products.import_status`, `compatible_devices.import_status`와 이미 수집된 옵션 행으로 누적 상태를 보존한다. 메인 조회는 `products.import_status = 'complete'`인 행만 대상으로 한다.

## 08 파생 ASIN 선택 모달

기준 상품을 파싱한 직후 모달을 연다. 현재 URL의 조합은 상단에 기준 정보로 고정해 보여주며, 기본 선택에는 넣지 않는다.

```text
현재 기준: Clear · iPhone 17 Pro Max · B0FD1TT96X

[ 같은 기기 · 다른 색상 (N) ] [ 같은 색상 · 다른 기기 (N) ]

선택된 ASIN 0개                              [취소] [선택 항목 저장]
```

- **같은 기기 · 다른 색상** 탭: 현재 iPhone 모델을 유지한 색상 변형을 색상명·ASIN으로 표시한다.
- **같은 색상 · 다른 기기** 탭: 현재 색상을 유지한 iPhone 모델 변형을 모델명·ASIN으로 표시한다.
- 두 탭을 오가도 체크 상태와 탭별 스크롤 위치를 유지한다.
- 탭 제목에는 저장 가능한 후보 수를 표시한다.
- 모달 상단과 하단에는 선택된 **고유 ASIN** 총수를 표시한다. 동일 ASIN은 두 탭에서 한 번만 센다.
- `URL 기준만 저장`은 현재 URL의 조합만 저장한다. `선택 항목 저장`은 체크한 파생 ASIN만 저장한다.
- 색상 탭의 선택은 `새 색상 + 현재 기기`, 기기 탭의 선택은 `현재 색상 + 새 기기`로 저장한다. 서로 다른 탭에서 고른 항목의 색상×기기 조합을 임의로 만들지 않는다.

## 09 데이터 모델

앱 테이블은 정확히 세 개이며, 관계는 제품 → 호환 기기 → 색상 옵션의 체인이다.

```text
auth.users
  └─ products
       └─ compatible_devices
            └─ product_options
```

### `products`

`id`, `owner_id`, `source_asin`, `source_url`, `title`, `image_url`, `displayed_price`, `import_status`, `created_at`

- `owner_id`는 `auth.users.id`를 참조한다.
- 기준 상품과 카탈로그 전체 수집 상태를 가진다.

### `compatible_devices`

`id`, `product_id`, `model_name`, `variant_asin`, `import_status`

- 하나의 제품에 여러 iPhone 모델이 연결될 수 있다.
- 기기 변형 ASIN과 모델명을 함께 보존한다.

### `product_options`

`id`, `device_id`, `color_name`, `variant_asin`, `is_available`

- 색상은 특정 기기 변형에 종속된다.
- `(device_id, variant_asin)`은 중복될 수 없다.

이 체인은 색상과 기기를 각각 제품에 독립 연결해 잘못된 색상×기기 조합을 만드는 문제를 막는다.

## 10 RLS

- `products`: `owner_id = auth.uid()`인 행만 읽기·쓰기·삭제할 수 있다.
- `compatible_devices`: 상위 `products.owner_id = auth.uid()`일 때만 접근할 수 있다.
- `product_options`: 상위 기기와 제품을 거쳐 `products.owner_id = auth.uid()`일 때만 접근할 수 있다.
- 다른 계정으로 로그인하면 상대 제품, 기기, 옵션 및 JOIN 결과가 모두 보이지 않아야 한다.

## 11 카탈로그 화면과 JOIN

메인 화면은 한 번의 관계 조회로 제품·기기·색상 옵션을 함께 읽는다.

```sql
products
JOIN compatible_devices ON compatible_devices.product_id = products.id
JOIN product_options ON product_options.device_id = compatible_devices.id
```

카드에는 대표 이미지, 제품명, iPhone 모델, 색상, ASIN을 표시한다. `collecting`과 `needs_retry` 제품은 목록에서 숨긴다.

### 모델·색상 사이드바

사이드바는 별도 카테고리 테이블이 아니라 위 JOIN 결과를 집계해 만든다.

```text
전체 제품
▾ iPhone 17 Pro Max
   • Clear
   • Clear Deep Blue
▸ iPhone 17 Pro
▸ iPhone 16 Pro Max
```

- 기기 모델 클릭: 해당 기기용 케이스로 필터한다.
- 펼친 기기 아래의 색상 클릭: 기기와 색상 조건을 함께 적용한다.
- 전체 제품 클릭: 모든 완료된 카탈로그 항목을 보여준다.

## 12 UI/UX 기준

카탈로그는 범용 관리자 대시보드가 아니라, 케이스 변형을 탐색하는 정돈된 제품 라이브러리처럼 보여야 한다. 정보의 우선순위는 **제품 이미지 → 제품명 → iPhone 모델 → 색상 → ASIN** 순서다.

- **인증 화면**: 기능을 한 문장으로 설명하고 Google OAuth 버튼 하나를 가장 먼저 보여준다. 로그인 전에는 빈 카탈로그나 비활성 기능을 노출하지 않는다.
- **카탈로그 첫 화면**: Amazon URL/ASIN 입력 영역을 가장 눈에 띄는 위치에 둔다. 저장 데이터가 없을 때는 첫 URL을 넣으면 무엇이 자동으로 정리되는지 명확히 보여준다.
- **수집 진행**: 진행 중인 제품에는 현재 단계, 채워진 필드 수, 선택 ASIN별 상태를 표시한다. 완료 전 데이터는 실제 카드 목록과 섞지 않는다.
- **파생 ASIN 모달**: 기준 조합은 고정 영역에, 두 탭과 선택 목록은 본문에, 고유 ASIN 총수와 저장 버튼은 고정 하단에 둔다. 탭 전환은 화면 깜빡임 없이 즉시 일어나며 체크 상태를 유지한다.
- **사이드바**: 데스크톱에서는 항상 보이는 기기 → 색상 계층으로, 좁은 화면에서는 필터 버튼이 여는 드로어로 바꾼다. 현재 적용된 기기·색상 필터는 메인 영역에도 표시하고 한 번에 해제할 수 있어야 한다.
- **카드와 상태**: 긴 제품명은 두 줄까지만 보이고 ASIN은 복사 가능한 보조 정보로 둔다. 수집 실패·빈 카탈로그·필터 결과 없음에는 각각 다음 행동이 있는 상태 화면을 제공한다.
- **접근성·반응형**: 모달은 키보드로 닫고 탭을 이동할 수 있으며, 모바일에서는 화면을 넘지 않는 전체폭 시트로 연다. 터치 대상과 대비는 모바일에서도 충분해야 한다.

## 13 스키마 비교 팝업

메인 화면의 스키마 보기 팝업에서 다음 네 카드를 나란히 보여준다.

1. `auth.users`
2. `products`
3. `compatible_devices`
4. `product_options`

각 카드에는 핵심 열과 PK/FK 관계선을 표시한다. 이는 앱 테이블 3개와 인증 사용자 테이블 1개가 어떻게 연결되는지 30초 안에 설명할 수 있게 한다.

## 14 성공 판정

- Amazon URL과 10자리 ASIN 입력이 모두 동작한다.
- Google OAuth 로그인·로그아웃이 동작하고, 로그인 사용자의 카탈로그만 첫 화면에 보인다.
- 샘플 ASIN `B0FD1TT96X`에서 제품명·이미지·가격·현재 색상·현재 iPhone 모델을 자동 수집한다.
- 모달의 두 탭에서 색상 후보와 기기 후보를 각각 표시하고, 탭을 오가도 선택 상태가 유지된다.
- 모달의 선택 ASIN 수는 중복 없이 정확히 표시된다.
- 선택한 파생 ASIN은 누적 수집 후 색상·기기 조합이 검증된 경우에만 저장된다.
- 세 앱 테이블이 FK로 연결되고, 한 화면에서 세 테이블의 JOIN 결과가 보인다.
- 계정 A가 저장한 행은 계정 B에서 RLS로 조회되지 않는다.
- 사이드바에서 기기 → 색상 순으로 필터링하면 메인 카드가 즉시 좁혀진다.
- 팝업에서 `auth.users`와 앱 테이블 3개의 관계를 비교할 수 있다.
- 데스크톱 사이드바와 모바일 필터 드로어 모두에서 같은 기기·색상 필터가 동작한다.
- 수집 중·실패·빈 카탈로그 상태에서 사용자가 다음 행동을 이해할 수 있다.

## 15 안 만드는 것

1. Spigen 외 브랜드와 Amazon 전체 카탈로그 크롤링
2. 색상×기기 전체 조합을 추측해 생성하는 기능
3. 가격 변동 추적, 알림, 구매·장바구니 기능

## 16 리스크와 스파이크 근거

Amazon HTML 구조와 자동 요청 차단은 변할 수 있다. 변형 정보가 없거나 필요한 필드가 빈 응답은 draft에 병합한 뒤 재시도하며, 완료 전에는 노출하지 않는다.

현재 샘플 `B0FD1TT96X` 검증에서 제품 기본 필드는 첫 요청에 수집됐다. `inline-twister`에서 색상 13개와 iPhone 기기 16개의 ASIN을 분리했으며, `Clear Deep Blue` child ASIN `B0FR85ZZVF`를 다시 수집해 `Clear Deep Blue · iPhone 17 Pro Max` 조합을 확인했다.
