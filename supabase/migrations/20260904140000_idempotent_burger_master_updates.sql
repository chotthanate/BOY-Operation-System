create table if not exists boy_central_private.client_mutation_receipts (
  user_id uuid not null,
  idempotency_key uuid not null,
  operation_type text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

revoke all on boy_central_private.client_mutation_receipts from public, anon, authenticated;

create or replace function boy_central.admin_update_burger_master_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_key uuid := nullif(payload->>'idempotency_key', '')::uuid;
  saved_result jsonb;
begin
  if actor_id is null then
    raise exception 'authentication required';
  end if;
  if request_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || request_key::text, 0)
  );

  select r.result into saved_result
  from boy_central_private.client_mutation_receipts r
  where r.user_id = actor_id
    and r.idempotency_key = request_key
    and r.operation_type = 'burger_master';

  if saved_result is not null then
    return saved_result || jsonb_build_object('status', 'duplicate');
  end if;

  saved_result := boy_central.admin_update_burger_master(payload);

  insert into boy_central_private.client_mutation_receipts
    (user_id, idempotency_key, operation_type, result)
  values
    (actor_id, request_key, 'burger_master', saved_result);

  return saved_result;
end;
$$;

revoke all on function boy_central.admin_update_burger_master_v2(jsonb) from public, anon;
grant execute on function boy_central.admin_update_burger_master_v2(jsonb) to authenticated;

notify pgrst, 'reload schema';
