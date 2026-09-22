create table if not exists boy_central.master_catalog_sheets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id) on delete cascade,
  sheet_name text not null,
  title text not null,
  description text,
  headers jsonb not null default '[]'::jsonb,
  required_headers jsonb not null default '[]'::jsonb,
  readonly_headers jsonb not null default '[]'::jsonb,
  id_header text,
  source_name text not null default 'google_sheets',
  source_revision text,
  last_imported_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, sheet_name)
);

create table if not exists boy_central.master_catalog_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id) on delete cascade,
  sheet_id uuid not null references boy_central.master_catalog_sheets(id) on delete cascade,
  row_number integer not null,
  record_key text,
  row_data jsonb not null default '{}'::jsonb,
  source_version text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sheet_id, row_number)
);

create unique index if not exists master_catalog_rows_record_key_idx
  on boy_central.master_catalog_rows(sheet_id, record_key)
  where record_key is not null and record_key <> '';
create index if not exists master_catalog_rows_company_sheet_idx
  on boy_central.master_catalog_rows(company_id, sheet_id, row_number);

create table if not exists boy_central.master_catalog_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id) on delete cascade,
  sheet_id uuid not null references boy_central.master_catalog_sheets(id) on delete cascade,
  row_id uuid references boy_central.master_catalog_rows(id) on delete set null,
  action text not null check (action in ('insert','update','delete','set_active','import')),
  before_data jsonb,
  after_data jsonb,
  actor_id uuid,
  actor_label text,
  mirror_status text not null default 'pending' check (mirror_status in ('pending','synced','failed','not_required')),
  mirror_error text,
  mirrored_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists master_catalog_changes_pending_idx
  on boy_central.master_catalog_changes(company_id, mirror_status, created_at);
create index if not exists master_catalog_changes_sheet_idx
  on boy_central.master_catalog_changes(sheet_id);
create index if not exists master_catalog_changes_row_idx
  on boy_central.master_catalog_changes(row_id);

drop trigger if exists set_master_catalog_sheets_updated_at on boy_central.master_catalog_sheets;
create trigger set_master_catalog_sheets_updated_at before update on boy_central.master_catalog_sheets
for each row execute function boy_central_private.set_updated_at();
drop trigger if exists set_master_catalog_rows_updated_at on boy_central.master_catalog_rows;
create trigger set_master_catalog_rows_updated_at before update on boy_central.master_catalog_rows
for each row execute function boy_central_private.set_updated_at();

alter table boy_central.master_catalog_sheets enable row level security;
alter table boy_central.master_catalog_rows enable row level security;
alter table boy_central.master_catalog_changes enable row level security;

drop policy if exists master_catalog_sheets_select on boy_central.master_catalog_sheets;
create policy master_catalog_sheets_select on boy_central.master_catalog_sheets
for select to authenticated using ((select boy_central_private.is_company_member(company_id)));
drop policy if exists master_catalog_sheets_admin on boy_central.master_catalog_sheets;
create policy master_catalog_sheets_admin on boy_central.master_catalog_sheets
for all to authenticated using ((select boy_central_private.is_company_admin(company_id)))
with check ((select boy_central_private.is_company_admin(company_id)));

drop policy if exists master_catalog_rows_select on boy_central.master_catalog_rows;
create policy master_catalog_rows_select on boy_central.master_catalog_rows
for select to authenticated using ((select boy_central_private.is_company_member(company_id)));
drop policy if exists master_catalog_rows_admin on boy_central.master_catalog_rows;
create policy master_catalog_rows_admin on boy_central.master_catalog_rows
for all to authenticated using ((select boy_central_private.is_company_admin(company_id)))
with check ((select boy_central_private.is_company_admin(company_id)));

drop policy if exists master_catalog_changes_select on boy_central.master_catalog_changes;
create policy master_catalog_changes_select on boy_central.master_catalog_changes
for select to authenticated using ((select boy_central_private.is_company_member(company_id)));
drop policy if exists master_catalog_changes_admin on boy_central.master_catalog_changes;
create policy master_catalog_changes_admin on boy_central.master_catalog_changes
for all to authenticated using ((select boy_central_private.is_company_admin(company_id)))
with check ((select boy_central_private.is_company_admin(company_id)));

grant select, insert, update, delete on boy_central.master_catalog_sheets to authenticated;
grant select, insert, update, delete on boy_central.master_catalog_rows to authenticated;
grant select, insert, update, delete on boy_central.master_catalog_changes to authenticated;

create or replace function boy_central.get_master_catalog(target_sheet_name text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'status','ok',
    'sheetName',s.sheet_name,
    'title',s.title,
    'description',coalesce(s.description,''),
    'headers',s.headers,
    'required',s.required_headers,
    'readonlyHeaders',s.readonly_headers,
    'idHeader',s.id_header,
    'source','supabase',
    'sourceRevision',s.source_revision,
    'lastImportedAt',s.last_imported_at,
    'rows',coalesce((
      select jsonb_agg(r.row_data || jsonb_build_object('__rowNumber',r.row_number,'__version',r.source_version) order by r.row_number)
      from boy_central.master_catalog_rows r where r.sheet_id=s.id and r.active
    ),'[]'::jsonb)
  )
  from boy_central.master_catalog_sheets s
  where s.sheet_name=target_sheet_name and s.active
    and boy_central_private.is_company_member(s.company_id)
  limit 1;
$$;
grant execute on function boy_central.get_master_catalog(text) to authenticated;

create or replace function boy_central.save_master_catalog_row(
  target_sheet_name text,
  target_row_number integer,
  payload jsonb,
  actor_name text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  target_sheet boy_central.master_catalog_sheets;
  target_row boy_central.master_catalog_rows;
  old_data jsonb;
  new_number integer;
  new_key text;
begin
  select * into target_sheet from boy_central.master_catalog_sheets s
  where s.sheet_name=target_sheet_name and s.active
    and boy_central_private.is_company_admin(s.company_id) limit 1;
  if target_sheet.id is null then raise exception 'ไม่พบตารางหรือไม่มีสิทธิ์แก้ไข'; end if;
  new_key := nullif(payload->>target_sheet.id_header,'');
  if target_row_number is null or target_row_number < 1 then
    select coalesce(max(row_number),1)+1 into new_number from boy_central.master_catalog_rows where sheet_id=target_sheet.id;
    insert into boy_central.master_catalog_rows(company_id,sheet_id,row_number,record_key,row_data,source_version)
    values(target_sheet.company_id,target_sheet.id,new_number,new_key,payload,extract(epoch from clock_timestamp())::text)
    returning * into target_row;
    insert into boy_central.master_catalog_changes(company_id,sheet_id,row_id,action,after_data,actor_id,actor_label)
    values(target_sheet.company_id,target_sheet.id,target_row.id,'insert',target_row.row_data,(select auth.uid()),actor_name);
  else
    select * into target_row from boy_central.master_catalog_rows where sheet_id=target_sheet.id and row_number=target_row_number for update;
    if target_row.id is null then raise exception 'ไม่พบรายการที่ต้องการแก้ไข'; end if;
    old_data := target_row.row_data;
    update boy_central.master_catalog_rows set row_data=row_data || payload,record_key=coalesce(new_key,record_key),source_version=extract(epoch from clock_timestamp())::text
    where id=target_row.id returning * into target_row;
    insert into boy_central.master_catalog_changes(company_id,sheet_id,row_id,action,before_data,after_data,actor_id,actor_label)
    values(target_sheet.company_id,target_sheet.id,target_row.id,'update',old_data,target_row.row_data,(select auth.uid()),actor_name);
  end if;
  return boy_central.get_master_catalog(target_sheet_name);
end;
$$;
grant execute on function boy_central.save_master_catalog_row(text,integer,jsonb,text) to authenticated;

comment on table boy_central.master_catalog_sheets is 'Supabase-primary catalog metadata; Google Sheets is an asynchronous mirror/archive.';
comment on table boy_central.master_catalog_rows is 'Protected editable BOY master data imported from the latest verified Google Sheet snapshot.';
