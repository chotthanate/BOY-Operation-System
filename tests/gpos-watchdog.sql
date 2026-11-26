-- Run after the watchdog migration using a trusted database admin.
-- This test does not fetch any Vault secret value. It only calls the tick
-- when the token is absent, so it never exercises the outbound HTTPS path.
begin isolation level repeatable read read only;
set local lock_timeout = '5s';

do $test$
declare
  checked_at constant timestamptz := '2026-11-26 16:00:00+07';
  example record;
  app_role text;
  routine record;
  before_state jsonb;
  after_state jsonb;
  tick_result text;
begin
  for example in
    select * from (values
      ('missing snapshot', null::timestamptz, true),
      ('just captured', checked_at, false),
      ('recent', checked_at - interval '5 minutes', false),
      ('just under threshold', checked_at - interval '24 minutes 59.999999 seconds', false),
      ('exact 25-minute threshold', checked_at - interval '25 minutes', true),
      ('just over threshold', checked_at - interval '25 minutes 0.000001 seconds', true),
      ('missed scheduled interval', checked_at - interval '30 minutes', true),
      ('stale for hours', checked_at - interval '5 hours', true),
      ('capture time slightly ahead', checked_at + interval '1 second', false),
      ('same instant, UTC input', timestamptz '2026-11-26 09:00:00+00', false)
    ) examples(label, captured_at, expected)
  loop
    if boy_central_private.gpos_watchdog_due(example.captured_at, checked_at)
        is distinct from example.expected then
      raise exception 'Unexpected GPOS watchdog freshness: %', example.label;
    end if;
  end loop;
  if boy_central_private.gpos_watchdog_due(null,null) is distinct from false
     or boy_central_private.gpos_watchdog_due(checked_at,null) is distinct from false then
    raise exception 'The freshness rule must fail closed without a check time';
  end if;

  foreach app_role in array array['anon','authenticated'] loop
    if has_table_privilege(app_role,'boy_central_private.gpos_watchdog_state',
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_any_column_privilege(app_role,'boy_central_private.gpos_watchdog_state',
          'SELECT, INSERT, UPDATE, REFERENCES') then
      raise exception 'GPOS watchdog exposed to %', app_role;
    end if;
    for routine in
      select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='boy_central_private'
        and p.proname in ('gpos_watchdog_due','gpos_watchdog_tick','gpos_watchdog_http')
    loop
      if has_function_privilege(app_role,routine.oid,'EXECUTE') then
        raise exception 'GPOS watchdog or outbound HTTP helper exposed to %',app_role;
      end if;
    end loop;
  end loop;
  -- The managed extension may retain its owner's SQL ACL. The browser roles
  -- cannot connect directly and PostgREST must not expose extensions.
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated') and rolcanlogin)
    or exists (
      select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) as setting
      where s.setrole='authenticator'::regrole and setting like 'pgrst.db_schemas=%'
        and 'extensions' = any(regexp_split_to_array(split_part(setting,'=',2),'\s*,\s*'))
    ) then
    raise exception 'HTTP extension must not be exposed via browser roles or the Data API';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','boy_central')
      and p.proname in ('gpos_watchdog_due','gpos_watchdog_tick','gpos_watchdog_http')
  ) then
    raise exception 'Watchdog must not have a Data API wrapper';
  end if;
  if (select provolatile from pg_proc
      where oid='boy_central_private.gpos_watchdog_due(timestamptz,timestamptz)'::regprocedure)
      is distinct from 'i' then
    raise exception 'Freshness rule must be immutable';
  end if;
  if (select count(*) from boy_central_private.gpos_watchdog_state) > 1 then
    raise exception 'Expected singleton GPOS watchdog state';
  end if;

  -- Both checks see the same committed Vault metadata. Acquiring the same
  -- advisory lock first means a simultaneous cron tick cannot change the
  -- result to 'locked' while testing the 'missing_token' guard.
  if not exists (select 1 from vault.secrets where name='gpos_watchdog_github_token') then
    perform pg_advisory_xact_lock(hashtextextended('boy:gpos-snapshot-watchdog',0));
    select jsonb_agg(to_jsonb(s)) into before_state from boy_central_private.gpos_watchdog_state s;
    tick_result := boy_central_private.gpos_watchdog_tick();
    if tick_result is distinct from 'missing_token' then
      raise exception 'Unconfigured watchdog must fail closed, returned %',tick_result;
    end if;
    select jsonb_agg(to_jsonb(s)) into after_state from boy_central_private.gpos_watchdog_state s;
    if after_state is distinct from before_state then
      raise exception 'Unconfigured watchdog must not change state';
    end if;
  else
    raise notice 'Skipping live tick because the watchdog credential is configured.';
  end if;
end $test$;

select 'GPOS watchdog freshness, permissions and safe activation assertions passed' as result;
rollback;
