-- Pyroom: metadata in Postgres, opaque .py files in a private Storage bucket.
begin;

create schema if not exists submission_private;
revoke all on schema submission_private from public, anon;
grant usage on schema submission_private to authenticated;
create table if not exists submission_private.allowed_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table submission_private.allowed_emails enable row level security;
revoke all on submission_private.allowed_emails from public, anon, authenticated;
insert into submission_private.allowed_emails(email) values ('magon8696@naver.com') on conflict do nothing;

create or replace function submission_private.has_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join submission_private.allowed_emails a on a.email = lower(u.email)
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  );
$$;
revoke execute on function submission_private.has_access() from public, anon;
grant execute on function submission_private.has_access() to authenticated;
create or replace function public.submission_has_access()
returns boolean language sql stable security invoker set search_path = '' as $$
  select submission_private.has_access();
$$;
revoke execute on function public.submission_has_access() from public, anon;
grant execute on function public.submission_has_access() to authenticated;

create table if not exists public.team_submissions (
  id uuid primary key,
  team_name text not null check (char_length(team_name) between 1 and 80 and team_name = btrim(team_name)),
  file_name text not null check (char_length(file_name) between 3 and 255 and lower(right(file_name, 3)) = '.py' and position('/' in file_name) = 0 and position(chr(92) in file_name) = 0),
  file_size bigint not null check (file_size between 0 and 5242880),
  storage_bucket text not null default 'team-python-files' check (storage_bucket = 'team-python-files'),
  storage_path text not null unique,
  submitted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
-- Preserve existing authenticated submissions while allowing public submissions.
alter table public.team_submissions alter column submitted_by drop not null;
alter table public.team_submissions drop constraint if exists team_submissions_check;
alter table public.team_submissions drop constraint if exists team_submissions_storage_path_check;
alter table public.team_submissions add constraint team_submissions_storage_path_check check (
  (submitted_by is not null and storage_path = submitted_by::text || '/' || id::text || '.py')
  or (submitted_by is null
    and storage_path ~ '^public/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.py$'
    and split_part(storage_path, '/', 3) = id::text || '.py')
);
create index if not exists team_submissions_created_idx on public.team_submissions(created_at desc, id);
create index if not exists team_submissions_submitter_idx on public.team_submissions(submitted_by);
alter table public.team_submissions enable row level security;
revoke all on public.team_submissions from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.team_submissions to authenticated;
drop policy if exists team_submissions_read on public.team_submissions;
create policy team_submissions_read on public.team_submissions for select to authenticated
  using ((select submission_private.has_access()));

-- Bucket creation/configuration via SQL is supported by Supabase.
-- Object bytes are uploaded only through the Storage API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-python-files', 'team-python-files', false, 5242880, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/octet-stream'];

drop policy if exists team_files_upload on storage.objects;
create policy team_files_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'team-python-files' and (select submission_private.has_access())
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.py$'
);

-- Public uploads need INSERT only; the bucket remains private.
-- The random token in the path proves possession when registering/retrying metadata.
drop policy if exists team_files_public_upload on storage.objects;
create policy team_files_public_upload on storage.objects for insert to anon, authenticated with check (
  bucket_id = 'team-python-files'
  and name ~ '^public/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.py$'
);

-- Restrictive guards keep this bucket private even if another bucket has broad policies.
drop policy if exists team_files_guard_upload on storage.objects;
create policy team_files_guard_upload on storage.objects as restrictive for insert to authenticated with check (
  bucket_id <> 'team-python-files'
  or name ~ '^public/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.py$'
  or (
    (select submission_private.has_access())
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.py$'
  )
);
drop policy if exists team_files_deny_anon_upload on storage.objects;
drop policy if exists team_files_guard_public_upload on storage.objects;
create policy team_files_guard_public_upload on storage.objects as restrictive for insert to anon with check (
  bucket_id <> 'team-python-files'
  or name ~ '^public/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.py$'
);
drop policy if exists team_files_no_browser_read on storage.objects;
create policy team_files_no_browser_read on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'team-python-files');
drop policy if exists team_files_no_browser_update on storage.objects;
create policy team_files_no_browser_update on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'team-python-files') with check (bucket_id <> 'team-python-files');
drop policy if exists team_files_no_browser_delete on storage.objects;
create policy team_files_no_browser_delete on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'team-python-files');

-- Registers only metadata. Never downloads, reads, parses or executes file contents.
-- Retrying the same submission ID returns the existing row without creating duplicates.
create or replace function public.register_team_submission(p_id uuid, p_team_name text, p_file_name text)
returns public.team_submissions language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  object_path text;
  object_size bigint;
  saved public.team_submissions;
begin
  if who is null or not submission_private.has_access() then
    raise exception 'PYROOM_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_id is null or p_team_name is null or p_file_name is null then
    raise exception 'PYROOM_INVALID_INPUT' using errcode = '22023';
  end if;
  select * into saved from public.team_submissions where id = p_id;
  if found then
    if saved.submitted_by is distinct from who or saved.team_name <> btrim(p_team_name) or saved.file_name <> p_file_name then
      raise exception 'PYROOM_SUBMISSION_CONFLICT' using errcode = '22023';
    end if;
    return saved;
  end if;
  object_path := who::text || '/' || p_id::text || '.py';
  select (o.metadata->>'size')::bigint into object_size from storage.objects o
    where o.bucket_id = 'team-python-files' and o.name = object_path and o.owner_id = who::text;
  if not found or object_size is null then
    raise exception 'PYROOM_FILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into public.team_submissions (id, team_name, file_name, file_size, storage_path, submitted_by)
    values (p_id, btrim(p_team_name), p_file_name, object_size, object_path, who) returning * into saved;
  return saved;
end;
$$;
revoke execute on function public.register_team_submission(uuid, text, text) from public, anon;
grant execute on function public.register_team_submission(uuid, text, text) to authenticated;

-- The public API exposes only display metadata, never Storage paths or upload tokens.
create or replace function public.list_public_team_submissions(p_offset integer default 0, p_limit integer default 500)
returns table (id uuid, team_name text, file_name text, file_size bigint, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.team_name, s.file_name, s.file_size, s.created_at
  from public.team_submissions s
  order by s.created_at desc, s.id
  limit least(greatest(coalesce(p_limit, 500), 0), 500)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.list_public_team_submissions(integer, integer) from public;
grant execute on function public.list_public_team_submissions(integer, integer) to anon, authenticated;

create or replace function public.register_public_team_submission(p_id uuid, p_upload_token uuid, p_team_name text, p_file_name text)
returns table (id uuid, team_name text, file_name text, file_size bigint, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  object_path text;
  object_size bigint;
  saved public.team_submissions;
begin
  if p_id is null or p_upload_token is null or p_team_name is null or p_file_name is null
    or char_length(btrim(p_team_name)) not between 1 and 80
    or char_length(p_file_name) not between 3 and 255
    or lower(right(p_file_name, 3)) <> '.py'
    or position('/' in p_file_name) > 0 or position(chr(92) in p_file_name) > 0 then
    raise exception 'PYROOM_INVALID_INPUT' using errcode = '22023';
  end if;
  object_path := 'public/' || p_upload_token::text || '/' || p_id::text || '.py';
  select s.* into saved from public.team_submissions s where s.id = p_id;
  if not found then
    -- Checks object metadata only. File contents are never fetched by this RPC.
    select (o.metadata->>'size')::bigint into object_size from storage.objects o
      where o.bucket_id = 'team-python-files' and o.name = object_path;
    if not found or object_size is null then
      raise exception 'PYROOM_FILE_NOT_FOUND' using errcode = 'P0001';
    end if;
    insert into public.team_submissions (id, team_name, file_name, file_size, storage_path, submitted_by)
      values (p_id, btrim(p_team_name), p_file_name, object_size, object_path, null)
      on conflict on constraint team_submissions_pkey do nothing returning * into saved;
    if not found then
      select s.* into saved from public.team_submissions s where s.id = p_id;
    end if;
  end if;
  if saved.storage_path is distinct from object_path then
    raise exception 'PYROOM_RECEIPT_INVALID' using errcode = '22023';
  end if;
  if saved.team_name <> btrim(p_team_name) or saved.file_name <> p_file_name then
    raise exception 'PYROOM_SUBMISSION_CONFLICT' using errcode = '22023';
  end if;
  return query select saved.id, saved.team_name, saved.file_name, saved.file_size, saved.created_at;
end;
$$;
revoke execute on function public.register_public_team_submission(uuid, uuid, text, text) from public;
grant execute on function public.register_public_team_submission(uuid, uuid, text, text) to anon, authenticated;

commit;
