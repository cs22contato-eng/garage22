-- =============================================================================
-- CS22 Garage — Migration 002: Direct Browser-to-Supabase Support (Cloudflare Pages)
-- Safe & idempotent: adds vehicle_photos DELETE policy and slug check RPC
-- =============================================================================

-- 1. Permitir que membros ativos excluam/reordenem fotos dos veículos da própria garagem
drop policy if exists "vehicle_photos_delete_member" on public.vehicle_photos;
create policy "vehicle_photos_delete_member" on public.vehicle_photos
  for delete to authenticated
  using (public.is_company_member(company_id) and public.company_has_active_access(company_id));

-- 2. RPC seguro para verificar disponibilidade de slug sem expor empresas de terceiros
create or replace function public.check_company_slug_available(
  p_slug text,
  p_exclude_company_id uuid default null
)
returns table (
  available boolean,
  reserved boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clean_slug text := lower(trim(coalesce(p_slug, '')));
  v_reserved boolean := v_clean_slug = any(array[
    'admin', 'api', 'app', 'assets', 'g', 'login', 'entrar', 'planos',
    'cadastro', 'onboarding', 'recuperar-senha', 'manifest', 'sw', 'offline',
    'favicon', 'icon', 'robots', 'sitemap', 'health', 'webhooks', 'suporte',
    'termos', 'privacidade'
  ]);
  v_taken boolean := false;
begin
  if v_clean_slug = '' or v_clean_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    return query select false, false;
    return;
  end if;

  if v_reserved then
    return query select false, true;
    return;
  end if;

  select exists (
    select 1
    from public.companies c
    where c.slug = v_clean_slug
      and (p_exclude_company_id is null or c.id <> p_exclude_company_id)
  ) into v_taken;

  return query select (not v_taken), false;
end;
$$;

grant execute on function public.check_company_slug_available(text, uuid) to authenticated;

-- 3. Atualizar lista de slugs reservados em create_company para proteger rotas na raiz
create or replace function public.create_company(
  p_name text,
  p_slug text,
  p_whatsapp text,
  p_instagram text default '',
  p_address text default '',
  p_opening_hours text default '',
  p_logo_url text default '',
  p_cover_url text default ''
)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clean_slug text := lower(trim(p_slug));
  v_clean_whatsapp text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_company public.companies;
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;

  if exists (select 1 from public.company_members where user_id = v_user_id) then
    raise exception 'Usuário já possui uma garagem vinculada';
  end if;

  if v_clean_slug = any(array[
    'admin', 'api', 'app', 'assets', 'g', 'login', 'entrar', 'planos',
    'cadastro', 'onboarding', 'recuperar-senha', 'manifest', 'sw', 'offline',
    'favicon', 'icon', 'robots', 'sitemap', 'health', 'webhooks', 'suporte',
    'termos', 'privacidade'
  ]) then
    raise exception 'Endereço reservado pelo sistema';
  end if;

  if v_clean_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Slug inválido para a vitrine';
  end if;

  if char_length(v_clean_whatsapp) < 10 then
    raise exception 'WhatsApp inválido';
  end if;

  insert into public.companies (
    name, slug, whatsapp, instagram, address, opening_hours, logo_url, cover_url
  )
  values (
    trim(p_name),
    v_clean_slug,
    v_clean_whatsapp,
    nullif(trim(coalesce(p_instagram, '')), ''),
    nullif(trim(coalesce(p_address, '')), ''),
    coalesce(trim(p_opening_hours), ''),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_cover_url, '')), '')
  )
  returning * into v_company;

  insert into public.company_members (company_id, user_id, role)
  values (v_company.id, v_user_id, 'owner');

  insert into public.subscriptions (company_id, plan_code, monthly_price, status, grace_days)
  values (v_company.id, 'mensal_5990', 49.90, 'trialing', 5);

  return v_company;
end;
$$;
