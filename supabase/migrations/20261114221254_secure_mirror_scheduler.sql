-- A narrowly scoped signing key, generated inside Vault. It is never included
-- in browser configuration, migration source, or the Google Sheet workbook.
do $$begin
 if not exists(select 1 from vault.secrets where name='boy_central_mirror_worker') then
 perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'boy_central_mirror_worker','BOY central mirror worker only');
 end if;
end $$;
create function boy_central.get_central_mirror_key()
returns text language sql stable security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where name='boy_central_mirror_worker'
$$;
revoke all on function boy_central.get_central_mirror_key() from public,anon,authenticated;
grant execute on function boy_central.get_central_mirror_key() to service_role;

create function boy_central.verify_mirror_signature(request_timestamp text,payload_json text,signature text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare key text;
begin
 if request_timestamp!~'^[0-9]{13}$' or signature!~'^[a-f0-9]{64}$' or octet_length(payload_json)>1000000 then return false;end if;
 if abs(extract(epoch from now())*1000-request_timestamp::numeric)>300000 then return false;end if;
 key:=boy_central.get_central_mirror_key();
 return coalesce(encode(extensions.hmac(request_timestamp||E'\n'||payload_json,key,'sha256'),'hex')=signature,false);
end $$;
revoke all on function boy_central.verify_mirror_signature(text,text,text) from public;
grant execute on function boy_central.verify_mirror_signature(text,text,text) to anon,authenticated;
create function public.verify_central_mirror(request_timestamp text,payload_json text,signature text)
returns boolean language sql stable security invoker set search_path='' as $$
 select boy_central.verify_mirror_signature(request_timestamp,payload_json,signature)
$$;
revoke all on function public.verify_central_mirror(text,text,text) from public;
grant execute on function public.verify_central_mirror(text,text,text) to anon,authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create function boy_central_private.dispatch_mirror_worker()
returns bigint language plpgsql security definer set search_path='' as $$
declare request_id bigint;
begin
 if not exists(select 1 from boy_central.mirror_jobs where available_at<=now() and (status in ('pending','error') or(status='processing' and lease_until<now())))then return null;end if;
 select net.http_post(
  url:='https://qfyszyzonvrchgbpowvs.supabase.co/functions/v1/central-mirror-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-boy-worker-key',boy_central.get_central_mirror_key()),
  body:='{}'::jsonb,timeout_milliseconds:=75000) into request_id;
 return request_id;
end $$;
revoke all on function boy_central_private.dispatch_mirror_worker() from public,anon,authenticated;
select cron.schedule('boy-central-mirror','*/5 * * * *','select boy_central_private.dispatch_mirror_worker()');

-- Only expired leases are retried. Successful pointer metadata may be pruned;
-- actual documents, requests, orders and stock movements are never deleted.
select cron.schedule('boy-central-mirror-maintenance','23 3 * * *',
 $job$delete from boy_central.mirror_jobs where status='synced' and synced_at<now()-interval '30 days';
 delete from cron.job_run_details where end_time<now()-interval '14 days' and jobid in(select jobid from cron.job where jobname in('boy-central-mirror','boy-central-mirror-maintenance'));$job$);

create function boy_central.get_mirror_health()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from boy_central.profiles where user_id=auth.uid() and active and company_role='admin')then raise exception 'admin required';end if;
 return jsonb_build_object('pending',(select count(*) from boy_central.mirror_jobs where status<>'synced'),
 'oldest_pending',(select min(created_at) from boy_central.mirror_jobs where status<>'synced'),
 'last_success',(select max(synced_at) from boy_central.mirror_jobs where status='synced'),
 'errors',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from(select branch_id,entity_type,last_error,attempts from boy_central.mirror_jobs where status='error' order by available_at limit 10)e));
end $$;
revoke all on function boy_central.get_mirror_health() from public,anon;
grant execute on function boy_central.get_mirror_health() to authenticated;
notify pgrst,'reload schema';
