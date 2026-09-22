-- 0028: studio_settings — persistent, owner-controlled operating settings.
-- First key: reply_handling_mode ('off' | 'review' | 'auto'). It decides what
-- the Gmail-ingest tick may do with newly matched prospect replies:
--   off    = ingest only (today's behaviour), AI never runs from the tick
--   review = AI analyses every confirmed reply; answers become drafts for
--            Silvijn's review (nothing is sent)
--   auto   = AI answers autonomously where the existing pipeline permits
--            (escalations, opt-outs, quality fails and price topics still go
--            to Silvijn; SQL guards 0011/0012 stay in force)
-- Writes only through the owner-only RPC (is_studio_owner); service_role and
-- anon can never change a setting. Every change is audited. Additive only.

-- studio_settings bestaat al sinds 0010 (key pricing = centrale prijsconfig;
-- RLS aan, anon niets, service_role/authenticated alleen select, owner-read
-- policy). 0028 voegt uitsluitend een auditkolom, één rij en één owner-only
-- RPC toe. De RPC accepteert ALLEEN 'reply_handling_mode'; pricing en elke
-- andere sleutel blijven onbereikbaar (UNKNOWN_SETTING), ook voor de owner.
alter table public.studio_settings add column if not exists updated_by uuid references auth.users(id);

insert into public.studio_settings(key, value) values ('reply_handling_mode', '"off"'::jsonb)
  on conflict (key) do nothing;

create function public.set_studio_setting(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  previous jsonb;
begin
  if not public.is_studio_owner() then
    raise exception 'HUMAN_AUTHORIZATION_REQUIRED' using errcode='42501';
  end if;
  if p_key = 'reply_handling_mode' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('off','review','auto') then
      raise exception 'INVALID_SETTING_VALUE' using errcode='22023';
    end if;
  else
    raise exception 'UNKNOWN_SETTING' using errcode='22023';
  end if;

  select value into previous from public.studio_settings where key = p_key for update;
  insert into public.studio_settings(key, value, updated_at, updated_by)
    values (p_key, p_value, now(), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  insert into public.audit_events(actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'studio_setting_changed', 'studio_setting', p_key,
            jsonb_build_object('previous', previous, 'next', p_value));
  return p_value;
end $$;
revoke all on function public.set_studio_setting(text, jsonb) from public, anon, service_role;
grant execute on function public.set_studio_setting(text, jsonb) to authenticated;
