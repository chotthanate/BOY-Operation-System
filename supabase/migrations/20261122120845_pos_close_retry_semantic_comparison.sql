-- Applied migration version: 20261122120845.
-- Keep the older device close RPC compatible with the canonical POS shift
-- trigger. New calls supply the same metrics and use its Bangkok close date.
-- Existing shifts, closes and balances are not rewritten.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('boy_central.record_pos_shift_close(text,jsonb)'::regprocedure);
 needle:='date_value:=((payload->>''opened_at'')::timestamptz at time zone ''Asia/Bangkok'')::date;';
 if strpos(d,needle)=0 then raise exception 'POS close date definition changed';end if;
 d:=replace(d,needle,'date_value:=((payload->>''closed_at'')::timestamptz at time zone ''Asia/Bangkok'')::date;');
 needle:='if previous.fingerprint<>fp then';
 if strpos(d,needle)=0 then raise exception 'POS duplicate definition changed';end if;
 d:=replace(d,needle,'if previous.business_date is distinct from date_value or previous.cash is distinct from round(cash,2) or previous.transfer is distinct from round(transfer,2) or previous.government is distinct from round(government,2) or previous.other is distinct from round(other,2) or coalesce(previous.order_count,0) is distinct from coalesce((payload->>''order_count'')::integer,0) then');
 needle:='closing_cash,expected_cash,status)';
 if strpos(d,needle)=0 then raise exception 'POS shift fields changed';end if;
 d:=replace(d,needle,'closing_cash,expected_cash,status,raw_payload)');
 needle:='(payload->>''counted_cash'')::numeric,(payload->>''expected_cash'')::numeric,''closed'')';
 if strpos(d,needle)=0 then raise exception 'POS shift values changed';end if;
 d:=replace(d,needle,'(payload->>''counted_cash'')::numeric,(payload->>''expected_cash'')::numeric,''closed'',payload)');
 d:=replace(d,'status=''closed'',updated_at=now()','status=''closed'',raw_payload=excluded.raw_payload,updated_at=now()');
 execute d;
end $patch$;
