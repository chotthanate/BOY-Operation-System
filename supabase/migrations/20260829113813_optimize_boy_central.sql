-- Add supporting indexes for every foreign key in the isolated BOY Central schema.
-- The left-prefix check avoids duplicating an index that already covers the FK.
do $$
declare
  fk record;
  index_name text;
begin
  for fk in
    select
      c.conname,
      cls.relname as table_name,
      (
        select string_agg(quote_ident(a.attname), ', ' order by key_column.ord)
        from unnest(c.conkey) with ordinality key_column(attnum, ord)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = key_column.attnum
      ) as column_list
    from pg_constraint c
    join pg_class cls on cls.oid = c.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where c.contype = 'f'
      and n.nspname = 'boy_central'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid
          and i.indisready
          and i.indnkeyatts >= cardinality(c.conkey)
          and not exists (
            select 1
            from unnest(c.conkey) with ordinality constraint_key(attnum, ord)
            join unnest(i.indkey::smallint[]) with ordinality index_key(attnum, ord)
              on index_key.ord = constraint_key.ord
            where constraint_key.attnum <> index_key.attnum
          )
      )
  loop
    index_name := left(fk.conname || '_idx', 63);
    execute format(
      'create index if not exists %I on boy_central.%I (%s)',
      index_name,
      fk.table_name,
      fk.column_list
    );
  end loop;
end $$;

-- A batch can be company-wide or tied to one branch. Keep this as one SELECT
-- policy so Postgres does not need to evaluate two permissive policies per row.
drop policy if exists import_batches_branch_select on boy_central.import_batches;
drop policy if exists import_batches_company_select on boy_central.import_batches;

create policy import_batches_access_select on boy_central.import_batches
for select to authenticated
using (
  (
    branch_id is null
    and (select boy_central_private.is_company_member(company_id))
  )
  or (
    branch_id is not null
    and (select boy_central_private.has_branch_access(branch_id, null))
  )
);
