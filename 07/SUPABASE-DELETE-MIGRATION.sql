begin;

alter table weekly_projects.s07_receipts
  drop constraint if exists s07_receipts_status_check;
alter table weekly_projects.s07_receipts
  add constraint s07_receipts_status_check
  check (status in ('processing', 'ready', 'failed', 'deleting'));

grant delete on weekly_projects.s07_receipts to service_role;

notify pgrst, 'reload schema';
commit;
