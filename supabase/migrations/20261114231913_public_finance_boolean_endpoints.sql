-- Apps Script is not a signed-in employee. These deliberately public APIs
-- expose only a boolean, never a key or business row. Use the narrow wrappers
-- rather than granting anon USAGE on the whole finance schema.
alter function public.verify_central_mirror(text,text,text) security definer;
alter function public.verify_central_mirror(text,text,text) set search_path='';
alter function public.daily_finance_active() security definer;
alter function public.daily_finance_active() set search_path='';
revoke all on function public.verify_central_mirror(text,text,text),public.daily_finance_active() from public;
grant execute on function public.verify_central_mirror(text,text,text),public.daily_finance_active() to anon,authenticated;
notify pgrst,'reload schema';
