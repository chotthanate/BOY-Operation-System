-- Mapping changes go through authenticated security-definer RPCs only.
drop policy if exists pos_master_mappings_branch_write on boy_central.pos_master_mappings;
revoke insert, update, delete on boy_central.pos_master_mappings from authenticated;
