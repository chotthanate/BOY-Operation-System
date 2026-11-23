-- Applied production migration version: 20261123211924.
-- Metadata-only reads keep cross-device draft checks small. No data is written.
create function boy_central_private.get_finance_entry_sync_version(branch_code text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b boy_central.branches%rowtype;
begin
 b:=boy_central_private.finance_entry_branch(branch_code);
 return jsonb_build_object('revision',coalesce((select revision from boy_central.expense_entry_drafts where branch_id=b.id),0));
end $$;
revoke all on function boy_central_private.get_finance_entry_sync_version(text) from public,anon;
grant execute on function boy_central_private.get_finance_entry_sync_version(text) to authenticated;
create function boy_central.get_finance_entry_sync_version(branch_code text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select boy_central_private.get_finance_entry_sync_version(branch_code)
$$;
revoke all on function boy_central.get_finance_entry_sync_version(text) from public,anon;
grant execute on function boy_central.get_finance_entry_sync_version(text) to authenticated;
