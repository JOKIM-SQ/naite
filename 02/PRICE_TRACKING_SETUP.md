# 가격 추적 및 커스텀 태그 설정

Supabase SQL Editor에서 [SUPABASE_PRICE_AND_CUSTOM_TAGS.sql](./SUPABASE_PRICE_AND_CUSTOM_TAGS.sql) 전체를 실행한다.

Vercel의 `jokim-5226's projects / cart-hoarders` Production 환경변수에 `CRON_SECRET`을 추가한다. 값은 임의의 긴 랜덤 문자열이어야 하며 외부에 노출하지 않는다.

배포 후 Vercel Cron은 매일 UTC 13:00과 14:00에 호출된다. 함수는 `America/Los_Angeles` 기준 실제 오전 6:00 호출만 실행하므로, 서머타임 변화에도 태평양 시간 오전 6시 가격을 한 번만 확인한다.

Amazon이 가격을 제공하지 않거나 방어 응답을 보내면 해당 제품은 건너뛰며 기존 가격과 변동 배지는 유지한다.
