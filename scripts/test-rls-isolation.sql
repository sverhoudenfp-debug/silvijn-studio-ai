begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('d29c4450-0000-4000-8000-000000000001','silvijn@silvijnstudio.com',now()),
 ('d29c4450-0000-4000-8000-000000000002','isolation-fixture@example.invalid',now());
select set_config('request.jwt.claims','{"sub":"d29c4450-0000-4000-8000-000000000002","role":"authenticated","email":"isolation-fixture@example.invalid"}',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.leads)<>0 then raise exception 'TEST: outsider read private leads'; end if;
 if (select count(*) from public.studio_members)<>0 then raise exception 'TEST: outsider read membership'; end if;
 if (select count(*) from public.audit_events)<>0 then raise exception 'TEST: outsider read audit'; end if;
 if public.is_studio_owner() then raise exception 'TEST: outsider owner'; end if;
 begin
  insert into public.payment_events(project_id,approval_id,amount,reference,actor_id,idempotency_key) values(gen_random_uuid(),gen_random_uuid(),1,'fixture',auth.uid(),gen_random_uuid());
  raise exception 'TEST: outsider direct payment write';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"d29c4450-0000-4000-8000-000000000001","role":"authenticated","email":"silvijn@silvijnstudio.com"}',true);
set local role authenticated;
do $$ begin
 if not public.is_studio_owner() then raise exception 'TEST: owner rejected'; end if;
 if (select count(*) from public.studio_members)<>1 then raise exception 'TEST: owner membership not readable'; end if;
 if (select count(*) from public.leads)=0 then raise exception 'TEST: owner cannot read preserved leads'; end if;
 begin
  update public.studio_members set enabled=false;
  raise exception 'TEST: direct membership mutation';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update auth.users set email_confirmed_at=null where id='d29c4450-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 if public.is_studio_owner() then raise exception 'TEST: unverified email became owner'; end if;
 if (select count(*) from public.leads)<>0 then raise exception 'TEST: unverified email read CRM'; end if;
end $$;
reset role;
rollback;
select 'PASS: real authenticated-role RLS enforces outsider isolation, owner-only reads, immutable membership, no direct payments and verified email. Fixtures rolled back.' result;
