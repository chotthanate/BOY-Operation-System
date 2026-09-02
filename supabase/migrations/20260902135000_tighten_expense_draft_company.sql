drop policy expense_drafts_own_insert on boy_central.expense_drafts;
drop policy expense_drafts_own_update on boy_central.expense_drafts;

create policy expense_drafts_own_insert on boy_central.expense_drafts
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and company_id = (select b.company_id from boy_central.branches b where b.id=branch_id)
  and (select boy_central_private.has_branch_access(branch_id,array['admin','manager','staff']))
);

create policy expense_drafts_own_update on boy_central.expense_drafts
for update to authenticated
using (user_id=(select auth.uid()) and (select boy_central_private.has_branch_access(branch_id,array['admin','manager','staff'])))
with check (
  user_id = (select auth.uid())
  and company_id = (select b.company_id from boy_central.branches b where b.id=branch_id)
  and (select boy_central_private.has_branch_access(branch_id,array['admin','manager','staff']))
);
