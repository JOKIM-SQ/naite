# S08 구현 계약

정적 HTML/ES modules + Supabase JS v2 + Vercel Node 설정 API. DB/Postgres Changes/Auth는 기존 Supabase 실제 프로젝트를 사용한다. prefix는 s08_.

## DB/API

- `public.s08_boards`: id(uuid), name, owner_id, invite_code(uuid), created_at. 클라이언트가 invite_code를 테이블 SELECT로 읽지 못하도록 column grant 제한.
- `public.s08_members`: board_id, user_id, role(owner/member), joined_at. PK(board_id,user_id).
- `public.s08_items`: id, board_id, name, sku, quantity(integer 0..1000000), unit, low_stock(integer 0..1000000), revision(integer), updated_at, updated_by, change_sent_at(nullable timestamptz). 보드 내 SKU 대소문자 무시 중복 금지.
- `public.s08_movements`: request_id(uuid PK), board_id, item_id, actor_id, delta, quantity_after, revision_after, created_at. 원자적 변경과 재시도 중복 방지용.
- 모든 테이블 RLS. 멤버만 품목 SELECT. 클라이언트 직접 INSERT/UPDATE/DELETE 금지; 아래 RPC만 authenticated에 EXECUTE. 함수 내 auth.uid와 멤버/소유자 검증. SECURITY DEFINER 함수 search_path=''.
- `s08_list_boards()` → [{id,name,role}], 자신의 가입 보드만.
- `s08_create_board(p_name text)` → uuid. 생성자 owner 멤버 등록을 한 트랜잭션으로.
- `s08_join_board(p_invite_code uuid)` → uuid. 로그인 필수, 같은 멤버 재참여는 성공. 초대 링크가 있는 사람만 가입 가능.
- `s08_get_invite(p_board_id uuid)` → uuid, 소유자만.
- `s08_add_item(p_board_id uuid,p_name text,p_sku text,p_quantity integer,p_unit text,p_low_stock integer)` → JSON item.
- `s08_adjust_stock(p_item_id uuid,p_delta integer,p_request_id uuid)` → JSON {item_id,quantity,revision,request_id}. qty+=delta 단일 트랜잭션, 0..1000000 제한. 같은 요청 ID/사용자/품목/delta 재전송은 같은 결과; 다르면 거절.
- `s08_adjust_stock(p_item_id uuid,p_delta integer,p_request_id uuid,p_sent_at timestamptz)` overload는 최초 요청 전송 시각을 변경 행에 저장한다. 동일 요청 재전송은 최초 timestamp/행을 그대로 두며 legacy 3인자 새 변경은 timestamp를 NULL로 초기화한다. 4인자에 DEFAULT를 두지 않아 API 호출을 모호하게 만들지 않는다.
- `s08_list_item_movements(p_item_id uuid,p_before_created_at timestamptz default null,p_before_request_id uuid default null,p_limit integer default 20)` → [{request_id,actor_id,actor_name,delta,quantity_before,quantity_after,created_at}]. 멤버만 조회하며 이름만 auth 메타데이터에서 읽고 이메일은 반환하지 않는다. 시각·요청 ID 복합 커서로 1~50건 페이지 조회한다.
- UI는 RPC 응답을 낙관적으로 덮어쓰기보다 최신 snapshot을 재조회한다.
- `supabase_realtime` publication에 s08_items만 추가. 삭제/아카이브는 이번 범위에서 제외하므로 DELETE 이벤트에 의존하지 않음.

## 클라이언트

- `/api/config` → {url,publishableKey,provider:'google'} 공개 설정만. 응답오류는 설정 미완료 화면. 서버 비밀키가 포함되면 API가 거부.
- 공식 SDK는 build 시 `public/vendor/supabase.js`에 준비하고 `globalThis.supabase.createClient` 사용.
- Google PKCE, storageKey `s08-stockroom-auth`, onAuthStateChange에서 비동기 DB 처리는 콜백 밖으로 넘김.
- `#invite=<uuid>`를 로그인 전 sessionStorage에 보관하고 OAuth 복귀 후 가입 RPC로 사용; 주소에서 초대값 제거. 팀 초대는 소유자만 버튼으로 링크 복사.
- 여러 가입 보드가 있으면 상단 선택 하나로 전환. 새 보드 만들기/초대 참여는 빈 상태에서 진입.
- Realtime: event handler 먼저 등록→SUBSCRIBED→snapshot. 이벤트가 조회 중 도착하면 dirty 표시 후 재조회. 재연결/탭 복귀 때 재조회. 로그아웃·보드 변경 시 채널 및 오래된 응답 정리.
- 저장·연결·오류·빈 상태 표시. ±1 빠른 입출고와 signed delta 입력. 실패한 조정은 같은 request_id로 재시도하고 성공 여부가 불명확할 때 새 ID로 다시 보내지 않음.
- 지연은 최초 요청 전송→Realtime 이벤트 수신이며 DOM 반영 시간과 구분한다. 현재 구독 세대의 새로운 UPDATE revision만 측정한다. 최초 snapshot·등록·중복·오래된 구독은 측정하지 않으며 시계 불일치/NULL은 측정불가로 표시한다.
- 품목 상세의 조정/기록 탭은 ARIA 탭 및 키보드 이동을 지원한다. 기록 페이지는 최신순으로 더 보고, 다른 품목·보드·탭·로그아웃·오프라인으로 넘어간 뒤 도착한 이전 응답은 무시한다. 표시 이름은 textContent로만 넣는다.

## UI hook

UI는 `public/index.html`, `public/style.css`. controller는 `public/app.mjs`, reusable 순수/상태 로직은 `public/inventory.mjs`.

필수 ID: app-status(role=status), toast(role=status), login-panel, sign-in, account-panel, user-name, sign-out, setup-panel, create-board-form, board-name, join-board-form, invite-code, workspace, board-select, board-title, invite-button, connection-status, retry-connect, total-items, total-quantity, low-stock-count, items-list, empty-state, add-item-button, item-dialog, item-form, item-name, item-sku, item-quantity, item-unit, item-low-stock, item-form-error, item-cancel, item-submit, adjust-dialog, adjust-form, adjust-item-name, adjust-delta, adjust-error, adjust-cancel, adjust-submit.

앱 문구는 한국어로 작성한다. 기본 section은 hidden 속성으로 전환, controller가 렌더링하는 row는 `.inventory-row`, `.item-identity`, `.item-sku`, `.item-stock`, `.stock-value`, `.stock-controls`, `.stock-step`, `.stock-adjust`, `.stock-status` 클래스. 각 품목 container data-item-id, 버튼 data-action=(increase/decrease/adjust), data-item-id. toast 역할과 dialog 접근성 유지. 외부 이미지 없는 자체 SVG 아이콘, 좁은 모바일에서도 조작 가능.
