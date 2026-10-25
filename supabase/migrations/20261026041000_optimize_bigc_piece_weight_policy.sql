-- Evaluate auth.uid() once per statement instead of once per candidate row.
drop policy if exists bigc_raw_fruit_piece_weights_read
  on boy_central.bigc_raw_fruit_piece_weights;
create policy bigc_raw_fruit_piece_weights_read
on boy_central.bigc_raw_fruit_piece_weights
for select to authenticated
using (exists (
  select 1
  from boy_central.profiles p
  where p.user_id=(select auth.uid())
    and p.company_id=bigc_raw_fruit_piece_weights.company_id
    and p.active
));
