-- Read-only regression checks for the two explicitly approved public endpoints.
do $test$
declare stamp text:=floor(extract(epoch from clock_timestamp())*1000)::bigint::text;
 body text:='{"qa":true}'; signature text;
begin
 if has_schema_privilege('anon','boy_central','usage') then raise exception 'anon schema access widened';end if;
 if has_table_privilege('anon','boy_central.transactions','select') then raise exception 'anon transaction read';end if;
 if has_function_privilege('anon','boy_central.get_central_mirror_key()','execute') then raise exception 'anon key read';end if;
 if not has_function_privilege('anon','public.verify_central_mirror(text,text,text)','execute') or not has_function_privilege('anon','public.daily_finance_active()','execute') then raise exception 'boolean API unavailable';end if;
 signature:=encode(extensions.hmac(stamp||E'\n'||body,boy_central.get_central_mirror_key(),'sha256'),'hex');
 if not public.verify_central_mirror(stamp,body,signature) then raise exception 'valid signature rejected';end if;
 if public.verify_central_mirror(stamp,body||' ',signature) then raise exception 'tampered body accepted';end if;
 if public.verify_central_mirror('1',body,signature) then raise exception 'expired signature accepted';end if;
 if public.daily_finance_active() is null then raise exception 'activation status missing';end if;
end $test$;
select 'boolean APIs passed without anon business/key access' as result;
