-- Integration assertions against real schema. All fixtures are rolled back, including auth users.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); lead_id uuid; project_id uuid; approval_id uuid; event_id uuid; key_id uuid:=gen_random_uuid(); gate jsonb; count_before bigint;
begin
 select count(*) into count_before from public.leads;
-- Eigenaarsaccount bestaat mogelijk al (login-flow): herbruik dan het
 -- bestaande id; maak anders de fixture aan. Rollback maakt alles ongedaan.
 if exists (select 1 from auth.users where email = 'silvijn@silvijnstudio.com' and is_sso_user = false) then
   select id into owner_id from auth.users where email = 'silvijn@silvijnstudio.com' and is_sso_user = false;
   update auth.users set email_confirmed_at = now() where id = owner_id and email_confirmed_at is null;
 else
   insert into auth.users(id,email,email_confirmed_at) values(owner_id,'silvijn@silvijnstudio.com',now());
 end if;
 insert into auth.users(id,email,email_confirmed_at) values(outsider_id,'security-fixture@example.invalid',now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_id,'role','authenticated','email','security-fixture@example.invalid')::text,true);
 if public.is_studio_owner() then raise exception 'TEST: outsider became owner'; end if;
 begin
  perform public.approve_project_price(gen_random_uuid());
  raise exception 'TEST: anonymous approval accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 if public.is_studio_owner() then raise exception 'TEST: service role became human'; end if;
 begin
  perform public.confirm_project_payment(gen_random_uuid(),1,'fixture',gen_random_uuid());
  raise exception 'TEST: service payment accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','email','silvijn@silvijnstudio.com')::text,true);
 if not public.is_studio_owner() then raise exception 'TEST: verified owner rejected'; end if;
 insert into public.leads(business_name,industry,city,province,website_status,source) values('SECURITY TRANSACTION FIXTURE','test','test','test','no_website','manual') returning id into lead_id;
 insert into public.projects(lead_id,name,requirements) values(lead_id,'SECURITY TRANSACTION FIXTURE','{"websiteType":"business_website","numberOfPages":1}') returning id into project_id;
 insert into public.price_indications(id,project_id,status,base_price,subtotal,total,line_items) values(project_id::text,project_id,'ready',895,895,895,'[{"amount":895}]');
 approval_id:=public.approve_project_price(project_id);
 if approval_id is null then raise exception 'TEST: no approval'; end if;
 if public.approve_project_price(project_id)<>approval_id then raise exception 'TEST: duplicate approval'; end if;
 perform public.set_project_payment_plan(project_id,'split');
 gate:=public.project_production_gate(project_id);
 if (gate->>'allowed')::boolean then raise exception 'TEST: unpaid production allowed'; end if;
 event_id:=public.confirm_project_payment(project_id,447.50,'fixture-reference',key_id);
 if public.confirm_project_payment(project_id,447.50,'fixture-reference',key_id)<>event_id then raise exception 'TEST: duplicate payment'; end if;
 begin
  perform public.confirm_project_payment(project_id,1,'different',key_id);
  raise exception 'TEST: key reuse accepted';
 exception when raise_exception then if sqlerrm<>'IDEMPOTENCY_KEY_CONFLICT' then raise; end if; end;
 gate:=public.project_production_gate(project_id);
 if (gate->>'allowed')::boolean then raise exception 'TEST: incomplete requirements allowed'; end if;
 update public.projects set requirements_complete=true where id=project_id;
 gate:=public.project_production_gate(project_id);
 if not (gate->>'allowed')::boolean or (gate->>'fullyPaid')::boolean then raise exception 'TEST: deposit gate incorrect'; end if;
 update public.projects set requirements='{"websiteType":"business_website","numberOfPages":2}' where id=project_id;
 if (public.project_production_gate(project_id)->>'allowed')::boolean then raise exception 'TEST: changed scope reused approval'; end if;
 update public.projects set requirements='{"websiteType":"business_website","numberOfPages":1}' where id=project_id;
 perform public.confirm_project_payment(project_id,447.50,'balance-fixture',gen_random_uuid());
 if not (public.project_production_gate(project_id)->>'fullyPaid')::boolean then raise exception 'TEST: balance not recognized'; end if;
 begin
  perform public.confirm_project_payment(project_id,1,'overpayment',gen_random_uuid());
  raise exception 'TEST: overpayment accepted';
 exception when raise_exception then if sqlerrm<>'PAYMENT_EXCEEDS_APPROVED_TOTAL' then raise; end if; end;
 -- Full upfront alternative with no confirmations cannot start.
 insert into public.projects(lead_id,name,requirements,requirements_complete) values(lead_id,'FULL PAYMENT FIXTURE','{"websiteType":"business_website","numberOfPages":1}',true) returning id into project_id;
 insert into public.price_indications(id,project_id,status,total) values(project_id::text,project_id,'ready',895);
 perform public.approve_project_price(project_id); perform public.set_project_payment_plan(project_id,'full');
 perform public.confirm_project_payment(project_id,447.50,'partial-full',gen_random_uuid());
 if (public.project_production_gate(project_id)->>'allowed')::boolean then raise exception 'TEST: half payment enabled full upfront plan'; end if;
 if has_table_privilege('service_role','public.payment_events','INSERT') or has_table_privilege('authenticated','public.payment_events','INSERT') then raise exception 'TEST: direct payment writes possible'; end if;
 if has_function_privilege('service_role','public.confirm_project_payment(uuid,numeric,text,uuid)','EXECUTE') then raise exception 'TEST: service role granted human RPC'; end if;
 if has_table_privilege('anon','public.studio_members','SELECT') then raise exception 'TEST: public membership'; end if;
end $$;
rollback;
select 'PASS: owner/outsider/service authorization, pricing, split/full payments, idempotency, scope binding and privileges. Fixtures rolled back.' result;
