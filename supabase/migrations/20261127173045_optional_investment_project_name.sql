-- Applied migration version: 20261127173045.
-- Allow an unnamed investment while preserving the category and posting checks.
do $patch$
declare
  definition text := pg_get_functiondef('boy_central.record_expense_v4(jsonb)'::regprocedure);
  required_name text := $old$if length(trim(coalesce(entry->>'project_name','')))=0 or length(entry->>'project_name')>160 then raise exception 'ระบุชื่อโครงการลงทุน (ไม่เกิน 160 ตัวอักษร)';end if;$old$;
  max_name text := $new$if length(entry->>'project_name')>160 then raise exception 'ชื่อโครงการลงทุนต้องไม่เกิน 160 ตัวอักษร';end if;$new$;
  name_value text := $old$'project_name',trim(entry->>'project_name')$old$;
  optional_value text := $new$'project_name',trim(coalesce(entry->>'project_name',''))$new$;
begin
  if strpos(definition, required_name) = 0 or strpos(definition, name_value) = 0 then
    raise exception 'optional investment name patch did not match';
  end if;
  execute replace(replace(definition, required_name, max_name), name_value, optional_value);
end $patch$;
