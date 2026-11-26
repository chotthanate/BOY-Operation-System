-- Applied production migration version: 20261126093407.
-- Cloud backup for GitHub's best-effort scheduled GPOS workflow. Dormant
-- without a repo-specific fine-grained GitHub credential in Vault.
-- Use synchronous HTTPS (extension default timeout; cron statement deadline),
-- not pg_net's persisted header queue.
create extension if not exists http with schema extensions;

-- Keep extensions outside the Data API. Revoke execution when the role that
-- installs the extension owns its ACLs (managed Supabase retains ownership).
do $lock_down_http$
declare routine regprocedure;
begin
  for routine in
    select p.oid::regprocedure from pg_proc p
    join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid
      and d.refclassid = 'pg_extension'::regclass and d.deptype = 'e'
    join pg_extension e on e.oid = d.refobjid where e.extname = 'http'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', routine);
  end loop;
end $lock_down_http$;

create table boy_central_private.gpos_watchdog_state (
  singleton boolean primary key default true check (singleton),
  last_attempt_at timestamptz not null,
  next_attempt_at timestamptz not null,
  last_outcome text not null,
  last_http_status integer,
  failure_count integer not null check (failure_count between 0 and 10),
  captured_at_on_attempt timestamptz
);
alter table boy_central_private.gpos_watchdog_state enable row level security;
revoke all on boy_central_private.gpos_watchdog_state from public, anon, authenticated;

create function boy_central_private.gpos_watchdog_due(captured_at timestamptz, checked_at timestamptz)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select checked_at is not null and (captured_at is null or captured_at <= checked_at - interval '25 minutes');
$$;
revoke all on function boy_central_private.gpos_watchdog_due(timestamptz,timestamptz) from public, anon, authenticated;

create function boy_central_private.gpos_watchdog_http(dispatch boolean, token text)
returns extensions.http_response language sql volatile security invoker
set search_path = ''
as $$
  select extensions.http(row(
    case when dispatch then 'POST' else 'GET' end,
    'https://api.github.com/repos/chotthanate/BOY-Operation-System/actions/workflows/gpos-dashboard-preview.yml' ||
      case when dispatch then '/dispatches' else '/runs?branch=main&per_page=12' end,
    array[
      extensions.http_header('Authorization', 'Bearer ' || token),
      extensions.http_header('Accept', 'application/vnd.github+json'),
      extensions.http_header('X-GitHub-Api-Version', '2026-03-10'),
      extensions.http_header('User-Agent', 'BOY-GPOS-Snapshot-Watchdog')
    ],
    case when dispatch then 'application/json' end,
    case when dispatch then '{"ref":"main"}' end
  )::extensions.http_request);
$$;
revoke all on function boy_central_private.gpos_watchdog_http(boolean,text) from public, anon, authenticated;

create function boy_central_private.gpos_watchdog_tick()
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  checked_at timestamptz := statement_timestamp();
  report_day date := (checked_at at time zone 'Asia/Bangkok')::date;
  captured timestamptz;
  token text;
  prior boy_central_private.gpos_watchdog_state%rowtype;
  response extensions.http_response;
  active_run boolean;
  outcome text;
  stage text := 'list';
  status_code integer;
  failures integer;
  retry_seconds integer;
  retry_minutes integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('boy:gpos-snapshot-watchdog',0)) then return 'locked'; end if;
  if not exists (select 1 from vault.secrets where name = 'gpos_watchdog_github_token') then return 'missing_token'; end if;

  select captured_at into captured from boy_central.gpos_dashboard_snapshots
    where branch_code = 'BIGC-CENTRAL-PATTAYA' and business_date = report_day;
  if not boy_central_private.gpos_watchdog_due(captured, checked_at) then return 'fresh'; end if;

  if exists (
    select 1 from boy_central.branches b
    join boy_central.financial_closes c on c.branch_id = b.id
    where b.code = 'BIGC-CENTRAL-PATTAYA' and b.active and c.business_date = report_day and c.source_type = 'manual'
  ) or exists (
    select 1 from boy_central.branches b
    join boy_central.bigc_workflows w on w.branch_id = b.id
    where b.code = 'BIGC-CENTRAL-PATTAYA' and b.active and w.business_date = report_day
      and w.workflow_type = 'return' and w.status = 'submitted'
  ) then return 'closed'; end if;

  select * into prior from boy_central_private.gpos_watchdog_state where singleton;
  if prior.next_attempt_at > checked_at then return 'backoff'; end if;
  select decrypted_secret into token from vault.decrypted_secrets where name = 'gpos_watchdog_github_token';
  if token is null or left(token,11) <> 'github_pat_' or token !~ '^github_pat_[A-Za-z0-9_]+$' then return 'invalid_token'; end if;

  begin
    response := boy_central_private.gpos_watchdog_http(false, token);
    status_code := response.status;
    if status_code <> 200 then
      outcome := 'list_rejected';
    elsif jsonb_typeof(response.content::jsonb->'workflow_runs') is distinct from 'array' then
      outcome := 'list_invalid';
    else
      select exists (
        select 1 from jsonb_array_elements(response.content::jsonb->'workflow_runs') as run
        where run->>'status' in ('queued','in_progress','waiting','requested','pending')
      ) into active_run;
      if active_run then
        outcome := 'active_run';
      else
        -- Recheck as the scheduled worker may have published while we listed runs.
        select captured_at into captured from boy_central.gpos_dashboard_snapshots
          where branch_code = 'BIGC-CENTRAL-PATTAYA' and business_date = report_day;
        if not boy_central_private.gpos_watchdog_due(captured, clock_timestamp()) then return 'fresh'; end if;
        stage := 'dispatch';
        response := boy_central_private.gpos_watchdog_http(true, token);
        status_code := response.status;
        outcome := case when status_code between 200 and 299 then 'dispatched' else 'dispatch_rejected' end;
      end if;
    end if;
    select max(least(value::numeric,3600))::integer into retry_seconds
    from unnest(response.headers) where lower(field) = 'retry-after' and value ~ '^[0-9]{1,10}$';
  exception when others then
    -- Never return GitHub response bodies, header values or error context.
    outcome := stage || '_unconfirmed';
    status_code := null;
  end;

  failures := case when outcome in ('dispatched','active_run') then 0
    when captured is distinct from prior.captured_at_on_attempt then 1
    else least(10,coalesce(prior.failure_count,0) + 1) end;
  retry_minutes := case
    when outcome = 'active_run' then 5
    -- A timeout can be an accepted dispatch; give the runner up to 10 minutes.
    when outcome in ('dispatched','dispatch_unconfirmed') then 15
    when status_code in (401,403,404) then 60
    else (array[5,15,30])[least(3,greatest(1,failures))] end;

  insert into boy_central_private.gpos_watchdog_state
    (singleton,last_attempt_at,next_attempt_at,last_outcome,last_http_status,failure_count,captured_at_on_attempt)
  values (true,checked_at,checked_at + make_interval(secs => greatest(retry_minutes*60,coalesce(retry_seconds,0))),
    outcome,status_code,failures,captured)
  on conflict (singleton) do update set
    last_attempt_at = excluded.last_attempt_at, next_attempt_at = excluded.next_attempt_at,
    last_outcome = excluded.last_outcome, last_http_status = excluded.last_http_status,
    failure_count = excluded.failure_count, captured_at_on_attempt = excluded.captured_at_on_attempt;
  return outcome;
end $$;
revoke all on function boy_central_private.gpos_watchdog_tick() from public, anon, authenticated;

select cron.schedule('boy-gpos-snapshot-watchdog','*/5 * * * *',
  'set statement_timeout = ''15s''; select boy_central_private.gpos_watchdog_tick();');
