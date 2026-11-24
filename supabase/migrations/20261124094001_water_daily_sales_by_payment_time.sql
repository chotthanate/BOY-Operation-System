-- Use the same per-order daily reporting path as BURGER and GRILL.
-- Their deferred close-policy cutover is intentional: a shift may span days.
-- Water's normal sync_water_pos_event SHIFT_CLOSE retains the period summary
-- without activating record_pos_shift_close's separate close-ledger cutover.
do $$
begin
 if not exists(select 1 from boy_central.branch_revenue_policies p join boy_central.branches b on b.id=p.branch_id where b.code='BIGC-SOUTH-PATTAYA' and p.mode='pos_shift') then
   raise exception 'Water POS revenue policy missing; reconcile before applying';
 end if;
 update boy_central.branch_revenue_policies p
 set effective_date='2099-12-31',updated_at=now()
 from boy_central.branches b
 where b.id=p.branch_id and b.code='BIGC-SOUTH-PATTAYA' and p.mode='pos_shift';
end $$;
