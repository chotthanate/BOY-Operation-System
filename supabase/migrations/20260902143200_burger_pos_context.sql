create or replace function boy_central.get_burger_pos_context()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare burger_id uuid;
begin
  select id into burger_id from boy_central.branches where code='BURGER' and active limit 1;
  if burger_id is null then raise exception 'active Burger branch not found'; end if;
  if (select auth.uid()) is null
    or not boy_central_private.has_branch_access(burger_id, null) then
    raise exception 'branch access denied';
  end if;
  return boy_central.get_pos_sync_bootstrap(burger_id);
end;
$$;

revoke all on function boy_central.get_burger_pos_context() from public, anon;
grant execute on function boy_central.get_burger_pos_context() to authenticated;
notify pgrst, 'reload schema';
