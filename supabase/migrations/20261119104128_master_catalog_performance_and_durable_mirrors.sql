create table boy_central.master_mirror_control(enabled boolean not null default false);
insert into boy_central.master_mirror_control values(false);
alter table boy_central.master_mirror_control enable row level security;
revoke all on boy_central.master_mirror_control from public,anon,authenticated;

create function boy_central_private.master_server_mirror_enabled() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from boy_central.master_mirror_control limit 1),false)
$$;
revoke all on function boy_central_private.master_server_mirror_enabled() from public,anon;
grant execute on function boy_central_private.master_server_mirror_enabled() to authenticated;

create function boy_central.get_master_catalog_versions(sheet_names text[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(s.sheet_name,jsonb_build_object('version',s.source_revision,
 'serverMirror',s.sheet_name like 'M\_%' escape '\' and boy_central_private.master_server_mirror_enabled())),'{}'::jsonb)
 from boy_central.master_catalog_sheets s
 where s.sheet_name=any(sheet_names) and s.active and cardinality(sheet_names)<=40
 and boy_central_private.is_company_member(s.company_id)
$$;
revoke all on function boy_central.get_master_catalog_versions(text[]) from public,anon;
grant execute on function boy_central.get_master_catalog_versions(text[]) to authenticated;

create function boy_central_private.queue_master_copy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not boy_central_private.master_server_mirror_enabled() or new.row_id is null then return new;end if;
 if not exists(select 1 from boy_central.master_catalog_sheets where id=new.sheet_id and sheet_name like 'M\_%' escape '\') then return new;end if;
 insert into boy_central.mirror_jobs(company_id,branch_id,entity_type,entity_id,revision)
 select new.company_id,b.id,'master_row',new.row_id,new.id::text from boy_central.branches b
 where b.company_id=new.company_id and b.code='TAWANA' on conflict do nothing;
 if not found then raise exception 'master mirror central branch missing';end if;
 return new;
end $$;
revoke all on function boy_central_private.queue_master_copy() from public,anon,authenticated;
create trigger queue_master_copy after insert on boy_central.master_catalog_changes
for each row execute function boy_central_private.queue_master_copy();

do $patch$
declare def text;
begin
 select pg_get_functiondef('boy_central.get_master_catalog(text)'::regprocedure) into def;
 def:=replace(def,'''sourceRevision'',s.source_revision,','''sourceRevision'',s.source_revision,'||chr(10)||'''serverMirror'',s.sheet_name like ''M\_%'' escape ''\'' and boy_central_private.master_server_mirror_enabled(),');
 if position('serverMirror' in def)=0 then raise exception 'catalog capability patch mismatch';end if;
 execute def;
 select pg_get_functiondef('boy_central.claim_mirror_jobs(integer)'::regprocedure) into def;
 def:=replace(def,' if j.entity_type=''daily_document'' then',
 ' if j.entity_type=''master_row'' then'||chr(10)||
 '  select jsonb_build_object(''sheet_name'',s.sheet_name,''id_header'',s.id_header,''readonly_headers'',s.readonly_headers,''record_key'',r.record_key,''data'',r.row_data,''source_version'',r.source_version,''revision'',extract(epoch from r.updated_at)*1000) into body from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id where r.id=j.entity_id and r.company_id=j.company_id;'||chr(10)||
 ' elsif j.entity_type=''daily_document'' then');
 if position('''master_row''' in def)=0 then raise exception 'claim patch mismatch';end if;
 execute def;
 select pg_get_functiondef('boy_central.finish_mirror_job(uuid,boolean,text)'::regprocedure) into def;
 def:=replace(def,' if j.entity_type=''bigc_workflow'' then',
 ' if j.entity_type=''master_row'' then'||chr(10)||
 '  update boy_central.master_catalog_changes c set mirror_status=case when not success then ''failed'' when c.after_data is not distinct from r.row_data then ''synced'' else ''not_required'' end,mirror_error=case when success then null else left(error_message,500) end,mirrored_at=case when success then now() else null end from boy_central.master_catalog_rows r where c.id=j.revision::uuid and c.row_id=r.id and r.id=j.entity_id;'||chr(10)||
 ' end if;'||chr(10)||' if j.entity_type=''bigc_workflow'' then');
 if position('''master_row''' in def)=0 then raise exception 'finish patch mismatch';end if;
 execute def;
end $patch$;
notify pgrst,'reload schema';
