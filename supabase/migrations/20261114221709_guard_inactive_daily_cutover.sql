-- Installing the backend does not activate finance reporting or background
-- Sheet writes. Those switch only after the mirror has been verified.
do $patch$
declare signature text; definition text; target text;
begin
 foreach signature in array array['get_dashboard_daily(date)','get_dashboard_monthly(integer,integer)','get_branch_dashboard(text,date,date)'] loop
  target:=case signature when 'get_dashboard_daily(date)' then 'boy_central.get_dashboard_daily_before_close_policy(target_date)'
   when 'get_dashboard_monthly(integer,integer)' then 'boy_central.get_dashboard_monthly_before_close_policy(target_year,target_month)'
   else 'boy_central.get_branch_dashboard_before_close_policy(target_branch_code,date_from,date_to)' end;
  select pg_get_functiondef(('boy_central.'||signature)::regprocedure) into definition;
  definition:=replace(definition,'begin'||chr(10),'begin'||chr(10)||' if not boy_central.daily_finance_active() then return '||target||';end if;'||chr(10));
  execute definition;
 end loop;
 select pg_get_functiondef('boy_central_private.dispatch_mirror_worker()'::regprocedure) into definition;
 definition:=replace(definition,'begin'||chr(10),'begin'||chr(10)||' if not boy_central.daily_finance_active() then return null;end if;'||chr(10));
 execute definition;
end $patch$;
notify pgrst,'reload schema';
