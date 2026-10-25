-- Recalculate open receipts when an administrator adds or changes a canonical
-- fruit mapping, usable yield, or average raw weight per piece.

create or replace function boy_central_private.revalue_bigc_costs_after_rule_setting()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform boy_central_private.revalue_bigc_costs_for_month(
      old.company_id,old.effective_month,null
    );
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform boy_central_private.revalue_bigc_costs_for_month(
      new.company_id,new.effective_month,null
    );
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;

revoke all on function boy_central_private.revalue_bigc_costs_after_rule_setting()
  from public,anon,authenticated;

drop trigger if exists revalue_bigc_costs_after_rule_setting
  on boy_central.bigc_interbranch_cost_rules;
create trigger revalue_bigc_costs_after_rule_setting
after insert or delete or update of company_id,received_item_id,raw_item_id,effective_month,active,counted_by_piece
on boy_central.bigc_interbranch_cost_rules
for each row execute function boy_central_private.revalue_bigc_costs_after_rule_setting();

create or replace function boy_central_private.revalue_bigc_costs_after_yield_setting()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  rule_record boy_central.bigc_interbranch_cost_rules%rowtype;
begin
  select * into rule_record
  from boy_central.bigc_interbranch_cost_rules
  where id=case when tg_op='DELETE' then old.cost_rule_id else new.cost_rule_id end;

  if rule_record.id is not null then
    if tg_op in ('UPDATE','DELETE') then
      perform boy_central_private.revalue_bigc_costs_for_month(
        rule_record.company_id,old.effective_month,null
      );
    end if;
    if tg_op in ('INSERT','UPDATE') then
      perform boy_central_private.revalue_bigc_costs_for_month(
        rule_record.company_id,new.effective_month,null
      );
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;

revoke all on function boy_central_private.revalue_bigc_costs_after_yield_setting()
  from public,anon,authenticated;

drop trigger if exists revalue_bigc_costs_after_yield_setting
  on boy_central.bigc_interbranch_yields;
create trigger revalue_bigc_costs_after_yield_setting
after insert or delete or update of cost_rule_id,effective_month,yield_ratio
on boy_central.bigc_interbranch_yields
for each row execute function boy_central_private.revalue_bigc_costs_after_yield_setting();

create or replace function boy_central_private.revalue_bigc_costs_after_piece_weight_setting()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform boy_central_private.revalue_bigc_costs_for_month(
      old.company_id,old.effective_month,null
    );
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform boy_central_private.revalue_bigc_costs_for_month(
      new.company_id,new.effective_month,null
    );
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;

revoke all on function boy_central_private.revalue_bigc_costs_after_piece_weight_setting()
  from public,anon,authenticated;

drop trigger if exists revalue_bigc_costs_after_piece_weight_setting
  on boy_central.bigc_raw_fruit_piece_weights;
create trigger revalue_bigc_costs_after_piece_weight_setting
after insert or delete or update of company_id,raw_item_id,effective_month,kg_per_piece
on boy_central.bigc_raw_fruit_piece_weights
for each row execute function boy_central_private.revalue_bigc_costs_after_piece_weight_setting();
