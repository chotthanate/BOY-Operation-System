-- Run after migration, within BEGIN/ROLLBACK; no business records are written.
do $test$
declare actor uuid;b record;v jsonb;denied boolean:=false;
begin
 select user_id into actor from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 for b in select code from boy_central.branches where code in('TAWANA','BURGER','GRILL','BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA') loop
  v:=boy_central.get_finance_entry_sync_version(b.code);
  if (v->>'revision')::int is distinct from (boy_central.get_finance_entry_workspace(b.code)->>'revision')::int then raise exception 'revision mismatch %',b.code;end if;
  if (select count(*) from jsonb_object_keys(v))<>1 then raise exception 'payload not metadata only';end if;
 end loop;
 if has_function_privilege('anon','boy_central.get_finance_entry_sync_version(text)','execute') or has_function_privilege('anon','boy_central_private.get_finance_entry_sync_version(text)','execute') then raise exception 'anonymous access';end if;
 if (select prosecdef from pg_proc where oid='boy_central.get_finance_entry_sync_version(text)'::regprocedure) then raise exception 'exposed definer';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform boy_central_private.get_finance_entry_sync_version('TAWANA');exception when others then denied:=true;end;
 if not denied then raise exception 'missing auth accepted';end if;
end $test$;
