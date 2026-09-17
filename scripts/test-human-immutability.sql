begin;
do $$
declare uid uuid:=gen_random_uuid(); lid uuid; pid uuid; wid uuid; qid uuid;
begin
-- Eigenaarsaccount bestaat mogelijk al (login-flow): herbruik dan het
 -- bestaande id; maak anders de fixture aan. Rollback maakt alles ongedaan.
 if exists (select 1 from auth.users where email = 'silvijn@silvijnstudio.com' and is_sso_user = false) then
   select id into uid from auth.users where email = 'silvijn@silvijnstudio.com' and is_sso_user = false;
   update auth.users set email_confirmed_at = now() where id = uid and email_confirmed_at is null;
 else
   insert into auth.users(id,email,email_confirmed_at) values(uid,'silvijn@silvijnstudio.com',now());
 end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','email','silvijn@silvijnstudio.com')::text,true);
 insert into public.leads(business_name,industry,city,province,website_status,source) values('IMMUTABILITY TRANSACTION FIXTURE','test','test','test','no_website','manual') returning id into lid;
 insert into public.projects(lead_id,name) values(lid,'IMMUTABILITY TRANSACTION FIXTURE') returning id into pid;
 -- Synthetic artifact only to exercise database guards, not a generated/validated theme.
 insert into public.generated_websites(project_id,lead_id,slug,business_name,status,generation_status,website_type,framework,template,specification,preview_url,build_status,version)
 values(pid,lid,gen_random_uuid()::text,'fixture','approved','completed','business_standard','shopify','business_standard','{}','/fixture','passed',1) returning id into wid;
 insert into public.quality_controls(generated_website_id,project_id,lead_id,website_version,status,overall_result,mode,model,approval)
 values(wid,pid,lid,1,'completed','pass','live','fixture',jsonb_build_object('action','approved','by',uid)) returning id into qid;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 begin
  update public.generated_websites set specification='{"tampered":true}' where id=wid;
  raise exception 'TEST: service modified approved content';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.generated_websites where id=wid;
  raise exception 'TEST: service deleted approved website';
 exception when insufficient_privilege then null; end;
 begin
  update public.quality_controls set approval='{"action":"approved","by":"AI"}' where id=qid;
  raise exception 'TEST: service forged QC approval';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.projects(lead_id,name,status) values(lid,'forged','approved');
  raise exception 'TEST: service inserted approved project';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','email','silvijn@silvijnstudio.com')::text,true);
 perform public.review_studio_website(wid,'revision_requested','Explicit fixture revision');
 if (select status from public.generated_websites where id=wid)<>'needs_revision' then raise exception 'TEST: owner revision failed'; end if;
 if not exists(select 1 from public.audit_events where entity_id=wid::text and action='revision_requested' and actor_id=uid) then raise exception 'TEST: owner revision unaudited'; end if;
end $$;
rollback;
select 'PASS: service cannot change/delete approved artifact, forge QC approval or insert approved project. Owner revision is auditable. Synthetic fixtures rolled back.' result;
