-- Remove only the obsolete memo prototype. Submission data and access controls stay intact.
begin;

drop table if exists public.notelet_notes;
drop function if exists public.notelet_set_updated_at();
drop function if exists public.notelet_has_access();
drop function if exists notelet_private.has_access();
drop table if exists notelet_private.allowed_emails;
drop schema if exists notelet_private;

commit;
