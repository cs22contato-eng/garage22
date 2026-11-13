-- =============================================================================
-- CS22 Garage (MVP - Fase 1) — Supabase PostgreSQL Schema, RLS, Views & Storage
-- 10 Tables, UUID PKs, numeric(12,2) money, composite company_id FKs, soft-delete
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. companies (A garagem)
-- -----------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  whatsapp text not null check (char_length(trim(whatsapp)) >= 10),
  instagram text,
  address text,
  logo_url text,
  cover_url text,
  show_sold boolean not null default false,
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. company_members (Quem acessa a garagem)
-- -----------------------------------------------------------------------------
create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'manager', 'seller')),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create index if not exists idx_company_members_user on public.company_members(user_id);

-- -----------------------------------------------------------------------------
-- 3. vehicles (O carro e a compra)
-- -----------------------------------------------------------------------------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  brand text not null check (char_length(trim(brand)) between 1 and 80),
  model text not null check (char_length(trim(model)) between 1 and 100),
  version text default '',
  manufacture_year int not null check (manufacture_year between 1940 and 2100),
  model_year int not null check (model_year between 1940 and 2100),
  mileage int not null default 0 check (mileage >= 0),
  fuel text not null default 'Flex',
  transmission text not null default 'Automático',
  color text not null default '',
  announced_price numeric(12,2) not null check (announced_price >= 0),
  description text default '',
  optionals text default '',
  plate text not null default '', -- NUNCA exposta na vitrine pública
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'disponivel' check (status in ('disponivel', 'reservado', 'vendido', 'inativo')),
  previous_status text check (previous_status in ('disponivel', 'reservado', 'inativo')),
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  purchase_date date not null default current_date,
  purchased_from text default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, slug)
);

create index if not exists idx_vehicles_company_status on public.vehicles(company_id, status) where deleted_at is null;
create index if not exists idx_vehicles_company_created on public.vehicles(company_id, created_at desc) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- 4. vehicle_photos (Fotos - até 10 por carro)
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  vehicle_id uuid not null,
  storage_path text not null,
  sort_order int not null default 0 check (sort_order between 0 and 9),
  created_at timestamptz not null default now(),
  constraint fk_vehicle_photos_vehicle
    foreign key (vehicle_id, company_id) references public.vehicles(id, company_id) on delete restrict
);

create index if not exists idx_vehicle_photos_vehicle on public.vehicle_photos(vehicle_id, sort_order);

-- -----------------------------------------------------------------------------
-- 5. vehicle_expenses (Despesas do carro — já pagas na Fase 1, soft cancel)
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  vehicle_id uuid not null,
  description text not null check (char_length(trim(description)) >= 1),
  category text not null check (category in (
    'documentacao', 'mecanica', 'funilaria_pintura', 'estetica',
    'pneus', 'transporte', 'comissao', 'outros'
  )),
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null default current_date,
  supplier text default '',
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fk_vehicle_expenses_vehicle
    foreign key (vehicle_id, company_id) references public.vehicles(id, company_id) on delete restrict
);

create index if not exists idx_vehicle_expenses_company_created on public.vehicle_expenses(company_id, created_at desc);
create index if not exists idx_vehicle_expenses_vehicle on public.vehicle_expenses(vehicle_id) where canceled_at is null;

-- -----------------------------------------------------------------------------
-- 6. vehicle_sales (A venda — uma ativa por carro, soft cancel)
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  vehicle_id uuid not null,
  sale_date date not null default current_date,
  sale_price numeric(12,2) not null check (sale_price > 0),
  buyer_name text not null check (char_length(trim(buyer_name)) >= 1),
  buyer_phone text default '',
  payment_method text not null default '',
  notes text default '',
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fk_vehicle_sales_vehicle
    foreign key (vehicle_id, company_id) references public.vehicles(id, company_id) on delete restrict
);

create unique index if not exists uq_active_sale_per_vehicle
  on public.vehicle_sales(vehicle_id)
  where canceled_at is null;

create index if not exists idx_vehicle_sales_company_date on public.vehicle_sales(company_id, sale_date desc);

-- -----------------------------------------------------------------------------
-- 7. vehicle_daily_stats (Visualizações e cliques no WhatsApp por dia)
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_daily_stats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  vehicle_id uuid not null,
  stat_date date not null default current_date,
  views int not null default 0 check (views >= 0),
  whatsapp_clicks int not null default 0 check (whatsapp_clicks >= 0),
  unique (vehicle_id, stat_date),
  constraint fk_vehicle_stats_vehicle
    foreign key (vehicle_id, company_id) references public.vehicles(id, company_id) on delete restrict
);

create index if not exists idx_vehicle_daily_stats_company on public.vehicle_daily_stats(company_id, stat_date desc);

-- -----------------------------------------------------------------------------
-- 8. subscriptions (Situação da assinatura no Asaas)
-- -----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete restrict,
  asaas_customer_id text,
  asaas_subscription_id text,
  plan_code text not null default 'mensal_5990' check (plan_code in ('fundador_3990', 'mensal_5990', 'anual_599')),
  payment_method text check (payment_method in ('PIX', 'BOLETO', 'CREDIT_CARD')),
  monthly_price numeric(12,2) not null default 59.90,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'overdue', 'suspended', 'canceled')),
  current_period_end timestamptz,
  grace_days int not null default 5 check (grace_days >= 0),
  overdue_since timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 9. asaas_events (Webhooks recebidos — idempotência e reprocessamento)
-- -----------------------------------------------------------------------------
create table if not exists public.asaas_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 10. audit_logs (Quem mudou o quê — venda, cancelamento, assinatura)
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  user_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_company_created on public.audit_logs(company_id, created_at desc);

-- =============================================================================
-- FUNÇÕES DE SEGURANÇA MULTI-TENANT & ASSINATURA
-- =============================================================================

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = auth.uid()
  );
$$;

create or replace function public.company_has_active_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.companies c
    left join public.subscriptions s on s.company_id = c.id
    where c.id = p_company_id
      and (
        (coalesce(s.status, 'trialing') = 'trialing' and c.trial_ends_at >= now())
        or s.status = 'active'
        or (s.status = 'overdue' and coalesce(s.overdue_since, now()) + make_interval(days => coalesce(s.grace_days, 5)) >= now())
        or (s.status = 'canceled' and coalesce(s.current_period_end, now()) >= now())
      )
  );
$$;

-- =============================================================================
-- CÁLCULOS FINANCEIROS NO BANCO (VIEW & FUNÇÃO) — NUNCA NO NAVEGADOR
-- =============================================================================

create or replace view public.v_vehicle_financials
with (security_invoker = true)
as
select
  v.id,
  v.company_id,
  v.brand,
  v.model,
  v.version,
  v.manufacture_year,
  v.model_year,
  v.mileage,
  v.fuel,
  v.transmission,
  v.color,
  v.announced_price,
  v.plate,
  v.slug,
  v.status,
  v.purchase_price,
  v.purchase_date,
  v.purchased_from,
  v.created_at,
  coalesce(exp.expenses_total, 0)::numeric(12,2) as expenses_total,
  (v.purchase_price + coalesce(exp.expenses_total, 0))::numeric(12,2) as total_cost,
  s.id as sale_id,
  s.sale_date,
  s.sale_price,
  s.buyer_name,
  s.payment_method,
  case
    when s.id is not null then (s.sale_price - (v.purchase_price + coalesce(exp.expenses_total, 0)))::numeric(12,2)
    else null
  end as profit,
  case
    when s.id is not null and s.sale_price > 0
      then ((s.sale_price - (v.purchase_price + coalesce(exp.expenses_total, 0))) / s.sale_price)
    else null
  end as margin_ratio,
  greatest(0, (coalesce(s.sale_date, current_date) - v.purchase_date))::int as days_in_stock
from public.vehicles v
left join (
  select vehicle_id, sum(amount) as expenses_total
  from public.vehicle_expenses
  where canceled_at is null
  group by vehicle_id
) exp on exp.vehicle_id = v.id
left join public.vehicle_sales s on s.vehicle_id = v.id and s.canceled_at is null
where v.deleted_at is null;

create or replace function public.get_company_dashboard(p_company_id uuid)
returns table (
  available_count int,
  sold_this_month_count int,
  month_profit numeric(12,2),
  tied_up_capital numeric(12,2),
  avg_days_in_stock int
)
language plpgsql
stable
security invoker
as $$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'Acesso negado à garagem';
  end if;

  return query
  select
    count(*) filter (where status = 'disponivel')::int as available_count,
    count(*) filter (
      where status = 'vendido'
        and sale_date >= date_trunc('month', current_date)::date
        and sale_date < (date_trunc('month', current_date) + interval '1 month')::date
    )::int as sold_this_month_count,
    coalesce(sum(profit) filter (
      where status = 'vendido'
        and sale_date >= date_trunc('month', current_date)::date
        and sale_date < (date_trunc('month', current_date) + interval '1 month')::date
    ), 0)::numeric(12,2) as month_profit,
    coalesce(sum(total_cost) filter (where status in ('disponivel', 'reservado', 'inativo')), 0)::numeric(12,2) as tied_up_capital,
    coalesce(round(avg(days_in_stock))::int, 0) as avg_days_in_stock
  from public.v_vehicle_financials
  where company_id = p_company_id;
end;
$$;

-- =============================================================================
-- VIEWS PÚBLICAS SEGURAS PARA A VITRINE (SEM PLACA, COMPRA, DESPESAS OU VENDA)
-- =============================================================================

create or replace view public.public_companies_view as
select
  c.id,
  c.name,
  c.slug,
  c.whatsapp,
  c.instagram,
  c.address,
  c.logo_url,
  c.cover_url,
  c.show_sold
from public.companies c
where public.company_has_active_access(c.id);

create or replace view public.public_vehicles_view as
select
  v.id,
  v.company_id,
  c.slug as company_slug,
  v.brand,
  v.model,
  v.version,
  v.manufacture_year,
  v.model_year,
  v.mileage,
  v.fuel,
  v.transmission,
  v.color,
  v.announced_price,
  v.description,
  v.optionals,
  v.slug,
  v.status,
  v.created_at,
  coalesce(
    (
      select jsonb_agg(jsonb_build_object('storage_path', vp.storage_path, 'sort_order', vp.sort_order) order by vp.sort_order)
      from public.vehicle_photos vp
      where vp.vehicle_id = v.id
    ),
    '[]'::jsonb
  ) as photos
from public.vehicles v
join public.companies c on c.id = v.company_id
where v.deleted_at is null
  and public.company_has_active_access(c.id)
  and (
    v.status = 'disponivel'
    or (v.status = 'vendido' and c.show_sold = true)
  );

-- Revogar acesso anônimo às tabelas base e liberar apenas views públicas
revoke all on public.companies, public.company_members, public.vehicles,
  public.vehicle_photos, public.vehicle_expenses, public.vehicle_sales,
  public.vehicle_daily_stats, public.subscriptions, public.asaas_events,
  public.audit_logs from anon;

grant select on public.public_companies_view, public.public_vehicles_view to anon, authenticated;

-- RPC público para incrementar visualizações e cliques no WhatsApp sem abrir tabela base
create or replace function public.track_public_vehicle_event(
  p_company_slug text,
  p_vehicle_slug text,
  p_event_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_vehicle_id uuid;
begin
  if p_event_type not in ('view', 'whatsapp_click') then
    return;
  end if;

  select v.company_id, v.id into v_company_id, v_vehicle_id
  from public.vehicles v
  join public.companies c on c.id = v.company_id
  where c.slug = p_company_slug
    and v.slug = p_vehicle_slug
    and v.deleted_at is null
    and v.status = 'disponivel'
    and public.company_has_active_access(c.id)
  limit 1;

  if v_vehicle_id is null then
    return;
  end if;

  insert into public.vehicle_daily_stats (company_id, vehicle_id, stat_date, views, whatsapp_clicks)
  values (
    v_company_id,
    v_vehicle_id,
    current_date,
    case when p_event_type = 'view' then 1 else 0 end,
    case when p_event_type = 'whatsapp_click' then 1 else 0 end
  )
  on conflict (vehicle_id, stat_date) do update
  set
    views = public.vehicle_daily_stats.views + (case when p_event_type = 'view' then 1 else 0 end),
    whatsapp_clicks = public.vehicle_daily_stats.whatsapp_clicks + (case when p_event_type = 'whatsapp_click' then 1 else 0 end);
end;
$$;

grant execute on function public.track_public_vehicle_event(text, text, text) to anon, authenticated;

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS MULTI-TENANT
-- =============================================================================

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_photos enable row level security;
alter table public.vehicle_expenses enable row level security;
alter table public.vehicle_sales enable row level security;
alter table public.vehicle_daily_stats enable row level security;
alter table public.subscriptions enable row level security;
alter table public.asaas_events enable row level security;
alter table public.audit_logs enable row level security;

-- companies
create policy "companies_select_member" on public.companies
  for select to authenticated using (public.is_company_member(id));
create policy "companies_update_member" on public.companies
  for update to authenticated using (public.is_company_member(id)) with check (public.is_company_member(id));

-- company_members
create policy "company_members_select_own" on public.company_members
  for select to authenticated using (user_id = auth.uid() or public.is_company_member(company_id));

-- vehicles
create policy "vehicles_all_member" on public.vehicles
  for all to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- vehicle_photos
create policy "vehicle_photos_all_member" on public.vehicle_photos
  for all to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- vehicle_expenses
create policy "vehicle_expenses_all_member" on public.vehicle_expenses
  for all to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- vehicle_sales
create policy "vehicle_sales_all_member" on public.vehicle_sales
  for all to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- vehicle_daily_stats
create policy "vehicle_daily_stats_select_member" on public.vehicle_daily_stats
  for select to authenticated using (public.is_company_member(company_id));

-- subscriptions
create policy "subscriptions_select_member" on public.subscriptions
  for select to authenticated using (public.is_company_member(company_id));

-- audit_logs (somente leitura para membros; escrita via trigger/service_role)
create policy "audit_logs_select_member" on public.audit_logs
  for select to authenticated using (public.is_company_member(company_id));

-- asaas_events: nenhuma policy pública (acesso exclusivo via service_role nas Edge Functions)

-- =============================================================================
-- STORAGE BUCKET & POLÍTICAS POR company_id
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', true)
on conflict (id) do nothing;

create policy "vehicle_photos_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and public.is_company_member((storage.foldername(name))[1]::uuid)
  );

create policy "vehicle_photos_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and public.is_company_member((storage.foldername(name))[1]::uuid)
  );
