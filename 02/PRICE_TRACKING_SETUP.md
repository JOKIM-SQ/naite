# 가격 추적 및 커스텀 태그 설정

Supabase SQL Editor에서 [WEEKLY_PROJECTS_SCHEMA.sql](./WEEKLY_PROJECTS_SCHEMA.sql) 전체를 실행한다. 이 파일은 `weekly_projects` 전용 스키마를 만들고 기존 S02 데이터를 복사한다.

실행 후 Supabase Dashboard의 **Settings → API → Exposed schemas**에 `weekly_projects`를 추가하고 저장한다. 커스텀 스키마는 이 설정과 SQL의 권한 부여가 모두 있어야 REST API에서 읽고 쓸 수 있다.

새 배포가 `weekly_projects`에서 정상 동작하는 것을 확인한 뒤에만 [CLEANUP_PUBLIC_S02.sql](./CLEANUP_PUBLIC_S02.sql)을 실행한다. 이 파일은 S02 전용 `public` 테이블·삭제 함수를 제거하며, 다른 `public` 테이블은 건드리지 않는다.

Vercel의 `jokim-5226's projects / cart-hoarders` Production 환경변수에 `CRON_SECRET`을 추가한다. 값은 임의의 긴 랜덤 문자열이어야 하며 외부에 노출하지 않는다.

배포 후 Vercel Cron은 매일 UTC 13:00과 14:00에 호출된다. 함수는 `America/Los_Angeles` 기준 실제 오전 6:00 호출만 실행하므로, 서머타임 변화에도 태평양 시간 오전 6시 가격을 한 번만 확인한다.

Amazon이 가격을 제공하지 않거나 방어 응답을 보내면 해당 제품은 건너뛰며 기존 가격과 변동 배지는 유지한다.
