-- Run inside BEGIN/ROLLBACK on an existing bridge deployment.
do $$declare master uuid;before_ jsonb;after_ jsonb;begin
 select r.id,to_jsonb(i) into master,before_ from boy_central.master_runtime_links l
 join boy_central.master_catalog_rows r on r.id=l.master_row_id join boy_central.items i on i.id=l.item_id
 where r.record_key='ITEM-0336';
 update boy_central.master_catalog_rows set row_data=jsonb_set(row_data,'{ชื่อสินค้า}',to_jsonb('QA-lychee-'||gen_random_uuid())) where id=master;
 select to_jsonb(i) into after_ from boy_central.master_runtime_links l join boy_central.items i on i.id=l.item_id where l.master_row_id=master;
 if before_<>after_ then raise exception 'quarantined rename mutated historic bread';end if;
end $$;
select 'quarantine edit guard passed' result;
