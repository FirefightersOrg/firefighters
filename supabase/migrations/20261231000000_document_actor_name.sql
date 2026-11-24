-- SAN-122: printed documents must show who registered them to every user allowed to print them.
-- profiles is readable only as one's own row or with user.manage, so a direct join renders '—' for
-- treasurers/operators. This read-only function returns ONLY the registering user's full name of
-- one document, gated by the same permission as that document's print route:
--   payment        -> payments.created_by        (payment.view)
--   delivery_note  -> delivery_notes.created_by  (bond.view)
--   settlement     -> settlements.closed_by      (any settlement.* permission of the print route)
-- Unknown kind: 22023. Missing document or no actor: null. No writes, no audit rows.
create function public.document_actor_name(p_kind text, p_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  if p_kind is null or p_id is null then
    raise exception 'document kind and id are required' using errcode = '22023';
  end if;
  case p_kind
    when 'payment' then
      if not public.has_permission('payment.view') then
        raise exception 'payment.view required' using errcode = '42501';
      end if;
      select created_by into v_actor from public.payments where id = p_id;
    when 'delivery_note' then
      if not public.has_permission('bond.view') then
        raise exception 'bond.view required' using errcode = '42501';
      end if;
      select created_by into v_actor from public.delivery_notes where id = p_id;
    when 'settlement' then
      if not (public.has_permission('settlement.view') or public.has_permission('settlement.create')
          or public.has_permission('settlement.update_open') or public.has_permission('settlement.close')
          or public.has_permission('settlement.correct')) then
        raise exception 'settlement permission required' using errcode = '42501';
      end if;
      select closed_by into v_actor from public.settlements where id = p_id;
    else
      raise exception 'unknown document kind' using errcode = '22023';
  end case;
  if v_actor is null then return null; end if;
  return (select full_name from public.profiles where id = v_actor);
end $$;
revoke all on function public.document_actor_name(text, uuid) from public, anon, service_role;
grant execute on function public.document_actor_name(text, uuid) to authenticated;
