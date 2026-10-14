-- Pending results default to X; preserve existing submissions and private files.
begin;
alter table public.team_submissions add column if not exists result text not null default 'X'
  check (char_length(result) between 1 and 1024 and result = btrim(result));
create index if not exists team_submissions_pending_idx on public.team_submissions(created_at, id) where result = 'X';

-- Recreate the RPC return types atomically when adding the result field.
drop function if exists public.list_public_team_submissions(integer, integer);
drop function if exists public.register_public_team_submission(uuid, uuid, text, text);

-- The public API exposes only display metadata, never Storage paths or upload tokens.
create or replace function public.list_public_team_submissions(p_offset integer default 0, p_limit integer default 500)
returns table (id uuid, team_name text, file_name text, file_size bigint, created_at timestamptz, result text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.team_name, s.file_name, s.file_size, s.created_at, s.result
  from public.team_submissions s
  order by s.created_at desc, s.id
  limit least(greatest(coalesce(p_limit, 500), 0), 500)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.list_public_team_submissions(integer, integer) from public;
grant execute on function public.list_public_team_submissions(integer, integer) to anon, authenticated;

create or replace function public.register_public_team_submission(p_id uuid, p_upload_token uuid, p_team_name text, p_file_name text)
returns table (id uuid, team_name text, file_name text, file_size bigint, created_at timestamptz, result text)
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
  return query select saved.id, saved.team_name, saved.file_name, saved.file_size, saved.created_at, saved.result;
end;
$$;
revoke execute on function public.register_public_team_submission(uuid, uuid, text, text) from public;
grant execute on function public.register_public_team_submission(uuid, uuid, text, text) to anon, authenticated;

commit;
