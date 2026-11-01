-- All test fixtures are rolled back; no Sheets calls are made.
begin;
select set_config('request.jwt.claims', jsonb_build_object('sub',(
 select p.user_id from boy_central.profiles p join boy_central.branches b on b.company_id=p.company_id
 where p.active and p.company_role='admin' and b.code='BIGC-CENTRAL-PATTAYA' limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $test$
declare
 a jsonb; b jsonb; c jsonb; n integer; total numeric; wid uuid;
 key1 text := 'receipt-'||gen_random_uuid()::text;
 key2 text := 'receipt-'||gen_random_uuid()::text;
 line1 jsonb; line2 jsonb;
begin
 if exists(select 1 from boy_central.bigc_workflows where business_date='2099-01-01') then raise exception 'test date already has data'; end if;
 line1:=jsonb_build_object('line_key',key1,'source_line_key','qa-source-a','item_name','QA rollback receipt','unit_name','ชิ้น','quantity',2,'input_mode','quantity');
 a:=boy_central.append_bigc_v2_receive(jsonb_build_object('workflow_type','receive','business_date','2099-01-01','lines',jsonb_build_array(line1)));
 wid:=(a->>'workflow_id')::uuid;
 b:=boy_central.append_bigc_v2_receive(jsonb_build_object('workflow_type','receive','business_date','2099-01-01','lines',jsonb_build_array(line1)));
 if not coalesce((b->>'duplicate')::boolean,false) then raise exception 'retry was not idempotent'; end if;
 line2:=jsonb_build_object('line_key',key2,'item_name','QA rollback receipt','unit_name','ชิ้น','quantity',3,'input_mode','quantity');
 c:=boy_central.append_bigc_v2_receive(jsonb_build_object('workflow_type','receive','business_date','2099-01-01','lines',jsonb_build_array(line2)));
 select count(*),sum(quantity) into n,total from boy_central.bigc_workflow_lines where workflow_id=wid;
 if n<>2 or total<>5 or jsonb_array_length(c->'mirror_payload'->'lines')<>2 then raise exception 'append or cumulative mirror failed: %, %',n,total; end if;
 line1:=jsonb_set(line1,'{line_key}',to_jsonb('receipt-'||gen_random_uuid()::text));
 b:=boy_central.append_bigc_v2_receive(jsonb_build_object('workflow_type','receive','business_date','2099-01-01','lines',jsonb_build_array(line1)));
 select sum(quantity) into total from boy_central.bigc_workflow_lines where workflow_id=wid;
 if total<>5 then raise exception 'same order received twice'; end if;
 if jsonb_array_length(boy_central.get_bigc_v2_receive_history('2099-01-01'))<>2 then
  raise exception 'receipt history must have exactly two rounds';
 end if;
 if (boy_central.get_bigc_v2_receive_history('2099-01-01')->0->'lines'->0->>'quantity')::numeric<>2 then
  raise exception 'first round quantity changed';
 end if;
end $test$;
rollback;
select 'PASS: two timestamped history rounds, append rounds, cumulative mirror, retry deduplication, duplicate source protection; all test writes rolled back' as verification;
