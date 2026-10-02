-- Keep BOY Central's schema private while exposing only the token-protected POS API.
-- Every underlying function validates either the one-time pairing code or the
-- per-device token before returning or changing branch data.

create or replace function public.pos_claim_device(
  target_branch_code text,
  target_device_code text,
  pairing_code text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select boy_central.claim_pos_device(target_branch_code, target_device_code, pairing_code);
$$;

create or replace function public.pos_device_bootstrap(device_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select boy_central.get_pos_device_bootstrap(device_token);
$$;

create or replace function public.pos_sync_event(device_token text, event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if upper(coalesce(event->>'event_type', '')) = 'STOCK_ADJUST' then
    return boy_central.sync_pos_stock_adjustment(device_token, event);
  end if;
  return boy_central.sync_pos_event(device_token, event);
end;
$$;

revoke all on function public.pos_claim_device(text, text, text) from public;
revoke all on function public.pos_device_bootstrap(text) from public;
revoke all on function public.pos_sync_event(text, jsonb) from public;

grant execute on function public.pos_claim_device(text, text, text) to anon, authenticated;
grant execute on function public.pos_device_bootstrap(text) to anon, authenticated;
grant execute on function public.pos_sync_event(text, jsonb) to anon, authenticated;
