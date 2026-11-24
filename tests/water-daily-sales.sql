begin;
do $test$
declare actor uuid;company uuid; south uuid; token text:='water-daily-test-'||gen_random_uuid();prefix text:='WATER-DAILY-ROLLBACK-'||gen_random_uuid();
 report jsonb;row_ jsonb;baseline jsonb;shift text;order_id text;i integer;stamp timestamptz;amount numeric;method text;dec_before numeric;jan_before numeric;
begin
 select user_id,company_id into actor,company from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select id into south from boy_central.branches where code='BIGC-SOUTH-PATTAYA';
 baseline:=boy_central.get_dashboard_daily('2026-12-31');
 update boy_central.branch_revenue_policies set effective_date='2099-12-31' where branch_id=south;
 -- The remaining four branches must not change when only Water's policy changes.
 for row_ in select value from jsonb_array_elements(baseline->'branches') where value->>'code'<>'BIGC-SOUTH-PATTAYA' loop
   if not exists(select 1 from jsonb_array_elements(boy_central.get_dashboard_daily('2026-12-31')->'branches') r where r->>'code'=row_->>'code' and r=row_) then raise exception 'unrelated branch changed';end if;
 end loop;
 dec_before:=(boy_central.get_dashboard_monthly(2026,12)#>>'{summary,income}')::numeric;
 jan_before:=(boy_central.get_dashboard_monthly(2027,1)#>>'{summary,income}')::numeric;
 insert into boy_central.pos_devices(company_id,branch_id,device_code,device_name,status,access_token_hash)
 values(company,south,prefix,'rollback only','active',encode(extensions.digest(token,'sha256'),'hex'));
 shift:=prefix||'-shift';
 perform boy_central.sync_water_pos_event(token,jsonb_build_object('event_type','SHIFT_OPEN','external_id',shift,'occurred_at','2026-12-31T16:00:00Z','data',jsonb_build_object('id',shift,'openingCash',0)));
 for i in 1..5 loop
   order_id:=prefix||'-order-'||i;
   stamp:=case when i in(1,5) then '2026-12-31T16:59:59Z'::timestamptz else '2026-12-31T17:00:00Z'::timestamptz end;
   amount:=case i when 1 then 100 when 2 then 200 when 3 then 50 when 4 then 25 else 999 end;
   method:=case i when 1 then 'cash' when 2 then 'transfer' when 3 then 'government' when 4 then 'other' else 'cash' end;
   perform boy_central.sync_water_pos_event(token,jsonb_build_object('event_type','ORDER','external_id',order_id,'occurred_at',stamp,'stock_deltas','[]'::jsonb,'data',jsonb_build_object('id',order_id,'shiftId',shift,'orderNo',order_id,'subtotal',amount,'total',amount,'payment',method,'items',jsonb_build_array(jsonb_build_object('id',order_id||'-line','name','rollback drink','qty',1,'total',amount,'options','[]'::jsonb)))));
 end loop;
 perform boy_central.sync_water_pos_event(token,jsonb_build_object('event_type','VOID','external_id',prefix||'-order-5','occurred_at','2026-12-31T16:59:59Z','stock_deltas','[]'::jsonb,'data',jsonb_build_object('id',prefix||'-order-5','refundMethod','original','voidReason','rollback test')));
 report:=boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2026-12-31','2026-12-31');
 if (report#>>'{totals,revenue}')::numeric<>100 or (report#>>'{totals,orders}')::int<>1 then raise exception 'open shift December sales missing or void counted';end if;
 report:=boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2027-01-01','2027-01-01');
 if (report#>>'{totals,revenue}')::numeric<>275 or (report#>>'{totals,orders}')::int<>3 then raise exception 'Bangkok midnight split incorrect';end if;
 select r into row_ from jsonb_array_elements(boy_central.get_dashboard_daily('2027-01-01')->'branches') r where r->>'code'='BIGC-SOUTH-PATTAYA';
 if (row_->>'income')::numeric<>275 or (row_->>'transfer')::numeric<>200 or (row_->>'government')::numeric<>50 or (row_->>'other')::numeric<>25 then raise exception 'daily channel totals incorrect';end if;
 if (boy_central.get_dashboard_monthly(2026,12)#>>'{summary,income}')::numeric-dec_before<>100 or (boy_central.get_dashboard_monthly(2027,1)#>>'{summary,income}')::numeric-jan_before<>275 then raise exception 'monthly reports do not sum sale dates';end if;
 -- Close the same shift a week later: keep a period summary, never move daily sales.
 perform boy_central.sync_water_pos_event(token,jsonb_build_object('event_type','SHIFT_CLOSE','external_id',shift,'occurred_at','2027-01-07T12:00:00Z','data',jsonb_build_object('id',shift,'countedCash',100,'cash',100,'transfer',200,'government',50,'other',25,'order_count',4,'metrics',jsonb_build_object('revenue',375,'expectedCash',100))));
 if not exists(select 1 from boy_central.financial_closes where branch_id=south and source_key=shift and cash=100 and transfer=200 and government=50 and other=25) then raise exception 'period shift summary missing';end if;
 if (boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2027-01-07','2027-01-07')#>>'{totals,revenue}')::numeric<>0 then raise exception 'close date wrongly owns weekly sales';end if;
 if (boy_central.get_branch_dashboard('BIGC-SOUTH-PATTAYA','2026-12-31','2027-01-01')#>>'{totals,revenue}')::numeric<>375 then raise exception 'close changed sale dates or double counted';end if;
 if (select effective_date from boy_central.branch_revenue_policies where branch_id=south)<>'2099-12-31'::date then raise exception 'close reenabled day-by-close policy';end if;
end $test$;
select 'PASS: open-shift live sales, Bangkok midnight/year/month boundaries, cash/transfer/government/other, void excluded, week-long close retained separately, no double count, other branches unchanged. ROLLBACK follows.' result;
rollback;
