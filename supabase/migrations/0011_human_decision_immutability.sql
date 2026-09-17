begin;
-- Protect approved artifacts and signed decisions, including mutations through service_role.
create or replace function public.guard_human_project_fields() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then
  if new.price_status='approved' or new.price_approval_id is not null or new.status in ('approved','in_progress','completed') then
   if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
  end if;
 elsif (new.price_status='approved' and old.price_status is distinct from new.price_status)
 or old.price_approval_id is distinct from new.price_approval_id
 or old.payment_plan is distinct from new.payment_plan
 or (old.price_status='approved' and (old.estimated_price is distinct from new.estimated_price or old.price_status is distinct from new.price_status))
 or (new.status in ('approved','in_progress','completed') and old.status is distinct from new.status)
 then
  if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 end if;
 return new;
end $$;
drop trigger enforce_human_project_fields on public.projects;
create trigger enforce_human_project_fields before insert or update on public.projects for each row execute function public.guard_human_project_fields();
create function public.guard_approved_artifact() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='approved' and not public.is_studio_owner() then raise exception 'APPROVED_ARTIFACT_IMMUTABLE' using errcode='42501'; end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger protect_approved_artifact before update or delete on public.generated_websites for each row execute function public.guard_approved_artifact();
create function public.guard_qc_decision() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then
  if new.approval is not null and not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 elsif old.approval is not null or (TG_OP='UPDATE' and new.approval is not null) then
  if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger protect_qc_decision before insert or update or delete on public.quality_controls for each row execute function public.guard_qc_decision();
create function public.review_studio_website(p_website uuid,p_action text,p_reason text default '',p_issues jsonb default '[]',p_notes text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare w public.generated_websites; q public.quality_controls; next_status text;
begin
 if not public.is_studio_owner() then raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501'; end if;
 if p_action is null or p_action not in ('revision_requested','archived') then raise exception 'INVALID_REVIEW_ACTION'; end if;
 if p_action='revision_requested' and length(btrim(coalesce(p_reason,'')))<5 then raise exception 'REVISION_REASON_REQUIRED'; end if;
 if jsonb_typeof(p_issues)<>'array' then raise exception 'INVALID_ISSUES'; end if;
 select * into strict w from public.generated_websites where id=p_website for update;
 if w.status in ('generating','building','qc_running') then raise exception 'WEBSITE_BUSY'; end if;
 select * into q from public.quality_controls where generated_website_id=w.id order by created_at desc,id desc limit 1 for update;
 if p_action='revision_requested' and (q.id is null or q.status<>'completed' or w.status not in ('ready_for_silvijn','needs_revision','approved')) then raise exception 'REVISION_NOT_READY'; end if;
 next_status:=case when p_action='archived' then 'archived' else 'needs_revision' end;
 if q.id is not null then update public.quality_controls set approval=jsonb_build_object('action',p_action,'by',auth.uid(),'at',now(),'reason',left(p_reason,2000),'notes',left(p_notes,5000),'selectedIssueIds',p_issues,'websiteVersion',w.version) where id=q.id; end if;
 update public.generated_websites set status=next_status where id=w.id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,details) values(auth.uid(),p_action,'website',w.id::text,jsonb_build_object('version',w.version,'qcId',q.id,'reason',left(p_reason,2000)));
 return w.id;
end $$;
revoke all on function public.review_studio_website(uuid,text,text,jsonb,text) from public,anon,service_role;
grant execute on function public.review_studio_website(uuid,text,text,jsonb,text) to authenticated;
insert into public.studio_schema_migrations(version) values('0011_human_decision_immutability');
commit;
