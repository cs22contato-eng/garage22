import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { slugify } from './db.ts';

function cleanEnvValue(raw: string | undefined): string {
  return (raw || '').trim().replace(/^['"]|['"]$/g, '');
}

export function normalizeSupabaseUrl(raw: string | undefined): string {
  const cleaned = cleanEnvValue(raw);
  if (!cleaned) return '';
  try {
    return new URL(cleaned).origin;
  } catch {
    return cleaned.replace(/\/+$/, '');
  }
}

const SUPABASE_URL = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL);
const SUPABASE_ANON_KEY = cleanEnvValue(process.env.VITE_SUPABASE_ANON_KEY);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

export const isSupabaseEnvConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY
);

export let isSupabaseBackendEnabled = false;

export async function refreshSupabaseReadiness(): Promise<boolean> {
  if (!isSupabaseEnvConfigured) {
    isSupabaseBackendEnabled = false;
    return false;
  }
  try {
    const admin = getSupabaseAdmin();
    const [{ error: errCompanies }, { error: errReminders }] = await Promise.all([
      admin.from('companies').select('id').limit(1),
      admin.from('due_reminders').select('id').limit(1),
    ]);
    if (!errCompanies && !errReminders) {
      isSupabaseBackendEnabled = true;
      await ensureSupabaseDemoSeed();
      return true;
    }
    lastSeedError = errCompanies?.message || errReminders?.message || 'Tabelas pendentes no Supabase.';
    isSupabaseBackendEnabled = false;
    return false;
  } catch (err) {
    lastSeedError = err instanceof Error ? err.message : String(err);
    isSupabaseBackendEnabled = false;
    return false;
  }
}

let adminClient: SupabaseClient | null = null;
let authClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

export function getSupabaseAuth(): SupabaseClient {
  if (!authClient) {
    authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return authClient;
}

const RESERVED_SLUGS = new Set(['admin', 'api', 'g', 'app', 'login', 'entrar', 'planos', 'cadastro', 'onboarding']);
const VALID_STATUSES = new Set(['preparacao', 'disponivel', 'reservado', 'vendido', 'inativo']);
const VALID_CATEGORIES = new Set([
  'documentacao',
  'mecanica',
  'funilaria_pintura',
  'estetica',
  'pneus',
  'transporte',
  'comissao',
  'outros',
]);
const VALID_REMINDER_CATEGORIES = new Set([
  'ipva',
  'licenciamento',
  'seguro',
  'revisao',
  'financiamento',
  'assinatura',
  'outros',
]);

export function computeSubscriptionState(company: any, sub: any) {
  const now = Date.now();
  const trialEndMs = company?.trial_ends_at ? new Date(company.trial_ends_at).getTime() : 0;
  const daysLeftInTrial = Math.max(0, Math.ceil((trialEndMs - now) / 86400_000));
  const status = sub?.status || 'trialing';

  let hasAccess = false;
  if (status === 'trialing') {
    hasAccess = trialEndMs >= now;
  } else if (status === 'active') {
    hasAccess = true;
  } else if (status === 'overdue') {
    const overdueMs = sub?.overdue_since ? new Date(sub.overdue_since).getTime() : now;
    const graceMs = (sub?.grace_days ?? 5) * 86400_000;
    hasAccess = overdueMs + graceMs >= now;
  } else if (status === 'canceled') {
    const periodEndMs = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : 0;
    hasAccess = periodEndMs >= now;
  } else {
    hasAccess = false;
  }

  return {
    has_access: hasAccess,
    days_left_in_trial: daysLeftInTrial,
  };
}

function normalizeCompany(row: any) {
  if (!row) return null;
  return {
    ...row,
    instagram: row.instagram ?? '',
    address: row.address ?? '',
    opening_hours: row.opening_hours ?? '',
    logo_url: row.logo_url ?? '',
    cover_url: row.cover_url ?? '',
    show_sold: Boolean(row.show_sold),
  };
}

function normalizeSubscription(row: any, company: any) {
  if (!row) return null;
  const access = computeSubscriptionState(company, row);
  return {
    ...row,
    monthly_price: Number(row.monthly_price ?? 0),
    grace_days: Number(row.grace_days ?? 5),
    has_access: access.has_access,
    days_left_in_trial: access.days_left_in_trial,
  };
}

export async function findSupabaseUserByEmail(email: string): Promise<User | null> {
  const admin = getSupabaseAdmin();
  const clean = email.trim().toLowerCase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u) => (u.email || '').toLowerCase() === clean);
    if (match) return match;
    if (data.users.length < 500) break;
    page += 1;
  }
  return null;
}

export async function getSupabaseUserById(userId: string): Promise<User | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return data.user;
}

async function ensureAuthUser(email: string, password: string, name: string): Promise<User> {
  const admin = getSupabaseAdmin();
  const existing = await findSupabaseUserByEmail(email);
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { ...(existing.user_metadata || {}), name },
    });
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data?.user) {
    throw new Error(`Falha ao criar usuário demo no Supabase: ${error?.message || 'erro desconhecido'}`);
  }
  return data.user;
}

let seedPromise: Promise<void> | null = null;
let lastSeedError: string | null = null;

export function getLastSeedError(): string | null {
  return lastSeedError;
}

export async function ensureSupabaseDemoSeed(): Promise<void> {
  if (!isSupabaseEnvConfigured) return;
  if (seedPromise) return seedPromise;

  lastSeedError = null;
  seedPromise = (async () => {
    const admin = getSupabaseAdmin();

    // Garagem 1: Premium Motors (somente semear se ainda não existir)
    const { data: existingA } = await admin
      .from('companies')
      .select('id')
      .eq('slug', 'premium-motors')
      .maybeSingle();

    let companyAId = existingA?.id as string | undefined;
    if (!companyAId) {
      const userA = await ensureAuthUser('contato@premiummotors.com.br', 'Garage@2026', 'Carlos Eduardo');
      const trialEndA = new Date(Date.now() + 7 * 86400_000).toISOString();
      const { data: compA, error: compAErr } = await admin
        .from('companies')
        .insert({
          name: 'Premium Motors',
          slug: 'premium-motors',
          whatsapp: '11998765432',
          instagram: '@premiummotors.sp',
          address: 'Av. Europa, 840 - Jardim Europa, São Paulo - SP',
          opening_hours: 'Seg a Sex 9h às 18h · Sáb 9h às 14h',
          logo_url: '/assets/aistudio/Logo_automotivo_CS22_Garage_deb1d1bd.png',
          cover_url: '/assets/aistudio/Logo_futurista_CS22_Garage_14b7e400.png',
          show_sold: true,
          trial_ends_at: trialEndA,
        })
        .select('id')
        .single();

      if (compAErr || !compA) throw new Error(compAErr?.message || 'Erro ao semear Premium Motors');
      companyAId = compA.id;

      await admin.from('company_members').upsert(
        { company_id: companyAId, user_id: userA.id, role: 'owner' },
        { onConflict: 'company_id,user_id' }
      );
      await admin.from('subscriptions').upsert(
        {
          company_id: companyAId,
          plan_code: 'mensal_5990',
          payment_method: 'PIX',
          monthly_price: 49.9,
          status: 'active',
          current_period_end: new Date(Date.now() + 25 * 86400_000).toISOString(),
          grace_days: 5,
        },
        { onConflict: 'company_id' }
      );

      const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

      // 4 veículos iniciais
      const vehiclesSeed = [
        {
          brand: 'Toyota',
          model: 'Corolla',
          version: 'XEi 2.0 Flex',
          manufacture_year: 2022,
          model_year: 2023,
          mileage: 34200,
          fuel: 'Flex',
          transmission: 'CVT',
          color: 'Prata',
          announced_price: 129900,
          description: 'Único dono, revisões em concessionária, laudo cautelar 100% aprovado.',
          optionals: 'Ar digital, Multimídia, Câmera de ré, Bancos em couro, Chave presencial',
          plate: 'BRA2E19',
          slug: 'toyota-corolla-2023',
          status: 'disponivel',
          purchase_price: 112000,
          purchase_date: daysAgo(18),
          purchased_from: 'Repasse Concessionária',
          photos: [
            'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1590362891991-f776e747a588?auto=format&fit=crop&w=1200&q=80',
          ],
          expenses: [
            { description: 'Polimento técnico e higienização', category: 'estetica', amount: 850, expense_date: daysAgo(16), supplier: 'Studio Car Detail' },
            { description: 'Transferência e laudo cautelar', category: 'documentacao', amount: 680, expense_date: daysAgo(15), supplier: 'Despachante Central' },
          ],
          stats: { views: 42, whatsapp_clicks: 6 },
        },
        {
          brand: 'Jeep',
          model: 'Compass',
          version: 'Longitude T270',
          manufacture_year: 2021,
          model_year: 2022,
          mileage: 48900,
          fuel: 'Flex',
          transmission: 'Automático',
          color: 'Cinza Granite',
          announced_price: 138900,
          description: 'Motor turbo T270, teto solar panorâmico, pneus novos.',
          optionals: 'Teto solar, Painel digital, Apple CarPlay, Faróis Full LED',
          plate: 'CSG4F88',
          slug: 'jeep-compass-2022',
          status: 'disponivel',
          purchase_price: 119000,
          purchase_date: daysAgo(72),
          purchased_from: 'Particular',
          photos: [
            'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=1200&q=80',
          ],
          expenses: [
            { description: 'Jogo com 4 pneus Pirelli Scorpion', category: 'pneus', amount: 3400, expense_date: daysAgo(68), supplier: 'PneuMax' },
            { description: 'Troca de óleo e pastilhas dianteiras', category: 'mecanica', amount: 1150, expense_date: daysAgo(65), supplier: 'Oficina Prime' },
          ],
          stats: { views: 64, whatsapp_clicks: 9 },
        },
        {
          brand: 'Volkswagen',
          model: 'Nivus',
          version: 'Highline 200 TSI',
          manufacture_year: 2023,
          model_year: 2023,
          mileage: 21500,
          fuel: 'Flex',
          transmission: 'Automático',
          color: 'Branco Cristal',
          announced_price: 118500,
          description: 'Garantia de fábrica, ACC, frenagem autônoma.',
          optionals: 'ACC, VW Play 10", Painel Active Info Display, Rodas 17"',
          plate: 'NVS9H22',
          slug: 'volkswagen-nivus-2023',
          status: 'disponivel',
          purchase_price: 103000,
          purchase_date: daysAgo(4),
          purchased_from: 'Leilão Financeira (Sem Sinistro)',
          photos: [
            'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1200&q=80',
          ],
          expenses: [
            { description: 'Frete cegonha até a garagem', category: 'transporte', amount: 650, expense_date: daysAgo(4), supplier: 'TransCar' },
          ],
          stats: { views: 19, whatsapp_clicks: 3 },
        },
        {
          brand: 'Honda',
          model: 'HR-V',
          version: 'EXL 1.5 Sensing',
          manufacture_year: 2023,
          model_year: 2023,
          mileage: 18400,
          fuel: 'Flex',
          transmission: 'CVT',
          color: 'Azul Cósmico',
          announced_price: 146900,
          description: 'Pacote Honda Sensing completo, impecável.',
          optionals: 'Alerta de colisão, Piloto adaptativo, Bancos em couro',
          plate: 'HRV7J11',
          slug: 'honda-hr-v-2023',
          status: 'disponivel',
          purchase_price: 128000,
          purchase_date: daysAgo(28),
          purchased_from: 'Particular',
          photos: [
            'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1200&q=80',
          ],
          expenses: [
            { description: 'Funilaria para-choque traseiro', category: 'funilaria_pintura', amount: 750, expense_date: daysAgo(22), supplier: 'Martelinho Ouro' },
            { description: 'Comissão comprador externo', category: 'comissao', amount: 1200, expense_date: daysAgo(5), supplier: 'Corretor Marcos' },
          ],
          sale: {
            sale_date: daysAgo(5),
            sale_price: 145500,
            buyer_name: 'Rafael Mendonça',
            buyer_phone: '11988881122',
            payment_method: 'Pix + Financiamento',
            notes: 'Entrega com tanque cheio',
          },
          stats: { views: 51, whatsapp_clicks: 8 },
        },
      ];

      let firstVehicleId: string | null = null;
      let secondVehicleId: string | null = null;

      for (let i = 0; i < vehiclesSeed.length; i += 1) {
        const v = vehiclesSeed[i];
        const { data: insertedVeh } = await admin
          .from('vehicles')
          .insert({
            company_id: companyAId,
            brand: v.brand,
            model: v.model,
            version: v.version,
            manufacture_year: v.manufacture_year,
            model_year: v.model_year,
            mileage: v.mileage,
            fuel: v.fuel,
            transmission: v.transmission,
            color: v.color,
            announced_price: v.announced_price,
            description: v.description,
            optionals: v.optionals,
            plate: v.plate,
            slug: v.slug,
            status: v.status,
            purchase_price: v.purchase_price,
            purchase_date: v.purchase_date,
            purchased_from: v.purchased_from,
          })
          .select('id')
          .single();

        if (!insertedVeh) continue;
        if (i === 0) firstVehicleId = insertedVeh.id;
        if (i === 1) secondVehicleId = insertedVeh.id;

        if (v.photos.length > 0) {
          await admin.from('vehicle_photos').insert(
            v.photos.map((url, idx) => ({
              company_id: companyAId,
              vehicle_id: insertedVeh.id,
              storage_path: url,
              sort_order: idx,
            }))
          );
        }

        if (v.expenses.length > 0) {
          await admin.from('vehicle_expenses').insert(
            v.expenses.map((e) => ({
              company_id: companyAId,
              vehicle_id: insertedVeh.id,
              description: e.description,
              category: e.category,
              amount: e.amount,
              expense_date: e.expense_date,
              supplier: e.supplier,
            }))
          );
        }

        await admin.from('vehicle_daily_stats').insert({
          company_id: companyAId,
          vehicle_id: insertedVeh.id,
          stat_date: new Date().toISOString().slice(0, 10),
          views: v.stats.views,
          whatsapp_clicks: v.stats.whatsapp_clicks,
        });

        if (v.sale) {
          await admin.from('vehicle_sales').insert({
            company_id: companyAId,
            vehicle_id: insertedVeh.id,
            sale_date: v.sale.sale_date,
            sale_price: v.sale.sale_price,
            buyer_name: v.sale.buyer_name,
            buyer_phone: v.sale.buyer_phone,
            payment_method: v.sale.payment_method,
            notes: v.sale.notes,
          });
        }
      }

      const daysFromNow = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
      await admin.from('due_reminders').insert([
        {
          company_id: companyAId,
          vehicle_id: firstVehicleId,
          title: 'IPVA 2026 — Parcela 2',
          category: 'ipva',
          due_date: daysFromNow(3),
          amount: 1420,
          notes: 'Pagar antes de entregar o veículo',
        },
        {
          company_id: companyAId,
          vehicle_id: secondVehicleId,
          title: 'Laudo cautelar e vistoria anual',
          category: 'revisao',
          due_date: daysFromNow(-2),
          amount: 350,
          notes: 'Agendar com Studio Car',
        },
        {
          company_id: companyAId,
          vehicle_id: null,
          title: 'Seguro do pátio CS22',
          category: 'seguro',
          due_date: daysFromNow(10),
          amount: 890,
          notes: 'Débito automático banco',
        },
      ]);
    }

    // Garagem 2: Horizonte Auto (somente semear se ainda não existir)
    const { data: existingB } = await admin
      .from('companies')
      .select('id')
      .eq('slug', 'horizonte-auto')
      .maybeSingle();

    if (!existingB) {
      const userB = await ensureAuthUser('vendas@horizonteauto.com.br', 'Garage@2026', 'Fernanda Lima');
      const { data: compB } = await admin
        .from('companies')
        .insert({
          name: 'Horizonte Auto',
          slug: 'horizonte-auto',
          whatsapp: '31997776655',
          instagram: '@horizonteauto.bh',
          address: 'Av. Raja Gabaglia, 1500 - Belo Horizonte - MG',
          opening_hours: 'Seg a Sáb 8h30 às 18h',
          trial_ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        })
        .select('id')
        .single();

      if (compB) {
        await admin.from('company_members').upsert(
          { company_id: compB.id, user_id: userB.id, role: 'owner' },
          { onConflict: 'company_id,user_id' }
        );
        await admin.from('subscriptions').upsert(
          {
            company_id: compB.id,
            plan_code: 'mensal_5990',
            monthly_price: 49.9,
            status: 'trialing',
            grace_days: 5,
          },
          { onConflict: 'company_id' }
        );

        const { data: vehB } = await admin
          .from('vehicles')
          .insert({
            company_id: compB.id,
            brand: 'Fiat',
            model: 'Pulse',
            version: 'Audace Turbo 200',
            manufacture_year: 2023,
            model_year: 2024,
            mileage: 14000,
            fuel: 'Flex',
            transmission: 'CVT',
            color: 'Vermelho Montecarlo',
            announced_price: 109900,
            description: 'Baixíssima quilometragem, único dono.',
            optionals: 'Multimídia 10", Carregador por indução',
            plate: 'PLS8K44',
            slug: 'fiat-pulse-2024',
            status: 'disponivel',
            purchase_price: 94500,
            purchase_date: new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10),
            purchased_from: 'Concessionária',
          })
          .select('id')
          .single();

        if (vehB) {
          await admin.from('vehicle_photos').insert({
            company_id: compB.id,
            vehicle_id: vehB.id,
            storage_path: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80',
            sort_order: 0,
          });
        }
      }
    }
  })().catch((err) => {
    lastSeedError = err instanceof Error ? err.message : String(err);
    console.error('Supabase seed error:', err);
    seedPromise = null;
  });

  return seedPromise;
}

export async function writeSupabaseAuditLog(
  companyId: string,
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string | null,
  beforeData: unknown,
  afterData: unknown
) {
  const admin = getSupabaseAdmin();
  await admin.from('audit_logs').insert({
    company_id: companyId,
    user_id: userId,
    action,
    table_name: tableName,
    record_id: recordId,
    before_data: beforeData ?? null,
    after_data: afterData ?? null,
  });
}

async function enrichVehicles(companyId: string, financialRows: any[]) {
  if (financialRows.length === 0) return [];
  const admin = getSupabaseAdmin();
  const vehicleIds = financialRows.map((r) => r.id);

  const [vehiclesExtraRes, photosRes, statsRes] = await Promise.all([
    admin
      .from('vehicles')
      .select('id, description, optionals, previous_status')
      .eq('company_id', companyId)
      .in('id', vehicleIds),
    admin
      .from('vehicle_photos')
      .select('vehicle_id, storage_path, sort_order')
      .eq('company_id', companyId)
      .in('vehicle_id', vehicleIds)
      .order('sort_order', { ascending: true }),
    admin
      .from('vehicle_daily_stats')
      .select('vehicle_id, views, whatsapp_clicks')
      .eq('company_id', companyId)
      .in('vehicle_id', vehicleIds),
  ]);

  const extraMap = new Map<string, any>();
  for (const row of vehiclesExtraRes.data || []) extraMap.set(row.id, row);

  const photoMap = new Map<string, string[]>();
  for (const p of photosRes.data || []) {
    const arr = photoMap.get(p.vehicle_id) || [];
    arr.push(p.storage_path);
    photoMap.set(p.vehicle_id, arr);
  }

  const statsMap = new Map<string, { views: number; clicks: number }>();
  for (const s of statsRes.data || []) {
    const prev = statsMap.get(s.vehicle_id) || { views: 0, clicks: 0 };
    prev.views += Number(s.views || 0);
    prev.clicks += Number(s.whatsapp_clicks || 0);
    statsMap.set(s.vehicle_id, prev);
  }

  return financialRows.map((r) => {
    const extra = extraMap.get(r.id) || {};
    const photos = photoMap.get(r.id) || [];
    const st = statsMap.get(r.id) || { views: 0, clicks: 0 };
    return {
      ...r,
      announced_price: Number(r.announced_price ?? 0),
      purchase_price: Number(r.purchase_price ?? 0),
      expenses_total: Number(r.expenses_total ?? 0),
      total_cost: Number(r.total_cost ?? 0),
      sale_price: r.sale_price !== null && r.sale_price !== undefined ? Number(r.sale_price) : null,
      profit: r.profit !== null && r.profit !== undefined ? Number(r.profit) : null,
      margin_ratio: r.margin_ratio !== null && r.margin_ratio !== undefined ? Number(r.margin_ratio) : null,
      days_in_stock: Number(r.days_in_stock ?? 0),
      mileage: Number(r.mileage ?? 0),
      manufacture_year: Number(r.manufacture_year),
      model_year: Number(r.model_year),
      version: r.version ?? '',
      color: r.color ?? '',
      plate: r.plate ?? '',
      purchased_from: r.purchased_from ?? '',
      description: extra.description ?? '',
      optionals: extra.optionals ?? '',
      previous_status: extra.previous_status ?? null,
      cover_photo: photos[0] ?? null,
      photos_count: photos.length,
      views_total: st.views,
      whatsapp_clicks_total: st.clicks,
    };
  });
}

export async function getMembershipAndCompany(userId: string) {
  const admin = getSupabaseAdmin();
  const { data: membership } = await admin
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  const [{ data: company }, { data: sub }] = await Promise.all([
    admin.from('companies').select('*').eq('id', membership.company_id).single(),
    admin.from('subscriptions').select('*').eq('company_id', membership.company_id).maybeSingle(),
  ]);

  if (!company) return null;
  const access = computeSubscriptionState(company, sub);

  return {
    membership,
    company: normalizeCompany(company),
    subscription: sub ? normalizeSubscription(sub, company) : null,
    access,
  };
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
  signSessionToken: (userId: string, email: string) => string
) {
  const admin = getSupabaseAdmin();
  const existing = await findSupabaseUserByEmail(email);
  if (existing) {
    return { status: 409, body: { error: 'Já existe uma conta cadastrada com este e-mail.' } };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (error || !data?.user) {
    return { status: 400, body: { error: error?.message || 'Não foi possível criar sua conta.' } };
  }

  const token = signSessionToken(data.user.id, data.user.email || email);
  return {
    status: 201,
    body: {
      message: 'Conta criada com sucesso.',
      email,
      token,
      user: {
        id: data.user.id,
        email: data.user.email || email,
        name,
        email_verified: true,
      },
    },
  };
}

export async function confirmEmail(
  email: string,
  token: string,
  signSessionToken: (userId: string, email: string) => string
) {
  const admin = getSupabaseAdmin();
  const user = await findSupabaseUserByEmail(email);
  if (!user) {
    return { status: 404, body: { error: 'Conta não encontrada.' } };
  }
  if (user.email_confirmed_at) {
    const jwt = signSessionToken(user.id, user.email || email);
    return {
      status: 200,
      body: {
        ok: true,
        token: jwt,
        message: 'E-mail já confirmado.',
        user: {
          id: user.id,
          email: user.email || email,
          name: user.user_metadata?.name || 'Lojista',
          email_verified: true,
        },
      },
    };
  }
  const expectedToken = user.user_metadata?.verification_token;
  if (!token || !expectedToken || token !== expectedToken) {
    return { status: 400, body: { error: 'Código de confirmação inválido.' } };
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email_confirm: true,
    user_metadata: { ...user.user_metadata, verification_token: null },
  });
  if (error) {
    return { status: 400, body: { error: error.message } };
  }

  const jwt = signSessionToken(user.id, user.email || email);
  return {
    status: 200,
    body: {
      ok: true,
      token: jwt,
      user: {
        id: user.id,
        email: user.email || email,
        name: user.user_metadata?.name || 'Lojista',
        email_verified: true,
      },
    },
  };
}

export async function loginUser(
  email: string,
  password: string,
  signSessionToken: (userId: string, email: string) => string
) {
  const auth = getSupabaseAuth();
  let { data, error } = await auth.auth.signInWithPassword({ email, password });

  if (error && /invalid api key|apikey/i.test(error.message)) {
    const retry = await getSupabaseAdmin().auth.signInWithPassword({ email, password });
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (/email not confirmed/i.test(error.message)) {
      return {
        status: 403,
        body: {
          error: 'Confirme seu e-mail antes de acessar o painel.',
          code: 'EMAIL_NOT_VERIFIED',
        },
      };
    }
    if (/invalid login credentials/i.test(error.message)) {
      return { status: 401, body: { error: 'E-mail ou senha incorretos.' } };
    }
    return { status: 401, body: { error: 'Não foi possível validar suas credenciais.' } };
  }

  if (!data.user) {
    return { status: 401, body: { error: 'E-mail ou senha incorretos.' } };
  }

  const token = signSessionToken(data.user.id, data.user.email || email);
  return {
    status: 200,
    body: {
      token,
      user: {
        id: data.user.id,
        email: data.user.email || email,
        name: data.user.user_metadata?.name || data.user.email || 'Lojista',
        email_verified: Boolean(data.user.email_confirmed_at),
      },
    },
  };
}

export async function requestPasswordReset(email: string, redirectTo?: string) {
  if (!email.includes('@')) {
    return {
      status: 200,
      body: { message: 'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.' },
    };
  }
  try {
    const auth = getSupabaseAuth();
    await auth.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
  } catch (err) {
    console.error('Supabase resetPasswordForEmail error:', err);
  }
  return {
    status: 200,
    body: {
      message: 'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.',
    },
  };
}

export async function resetPassword(email: string, token: string, newPassword: string) {
  if (newPassword.length < 6) {
    return { status: 400, body: { error: 'A nova senha deve ter pelo menos 6 caracteres.' } };
  }
  if (!email.includes('@') || !token) {
    return { status: 400, body: { error: 'Informe o e-mail e o código recebido.' } };
  }
  const auth = getSupabaseAuth();
  const { data, error: verifyErr } = await auth.auth.verifyOtp({
    email,
    token,
    type: 'recovery',
  });
  if (verifyErr || !data?.user) {
    return { status: 400, body: { error: 'Código de recuperação inválido ou expirado.' } };
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(data.user.id, {
    password: newPassword,
  });
  if (error) {
    return { status: 400, body: { error: error.message } };
  }
  return { status: 200, body: { ok: true, message: 'Senha atualizada com sucesso.' } };
}

export async function completeRecovery(accessToken: string, newPassword: string) {
  if (!accessToken) {
    return { status: 400, body: { error: 'Link de recuperação inválido.' } };
  }
  if (newPassword.length < 6) {
    return { status: 400, body: { error: 'A nova senha deve ter pelo menos 6 caracteres.' } };
  }
  const admin = getSupabaseAdmin();
  const { data, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !data?.user) {
    return { status: 401, body: { error: 'Link de recuperação inválido ou expirado. Solicite um novo.' } };
  }
  const { error } = await admin.auth.admin.updateUserById(data.user.id, {
    password: newPassword,
  });
  if (error) {
    return { status: 400, body: { error: error.message } };
  }
  return { status: 200, body: { ok: true, message: 'Senha atualizada com sucesso.' } };
}

export async function checkSlugAvailability(rawSlug: string) {
  const candidate = slugify(rawSlug);
  if (RESERVED_SLUGS.has(candidate)) {
    return { slug: candidate, available: false, reserved: true };
  }
  const admin = getSupabaseAdmin();
  const { data } = await admin.from('companies').select('id').eq('slug', candidate).maybeSingle();
  return { slug: candidate, available: !data, reserved: false };
}

export async function createCompany(userId: string, body: any) {
  const admin = getSupabaseAdmin();
  const { data: existingMembership } = await admin
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMembership) {
    return { status: 409, body: { error: 'Você já possui uma garagem vinculada.' } };
  }

  const name = String(body?.name || '').trim();
  const rawSlug = String(body?.slug || name).trim();
  const slug = slugify(rawSlug);
  const whatsapp = String(body?.whatsapp || '').replace(/\D/g, '');
  const instagram = String(body?.instagram || '').trim();
  const address = String(body?.address || '').trim();
  const openingHours = String(body?.opening_hours || '').trim();
  const logoUrl = String(body?.logo_url || '').trim();
  const coverUrl = String(body?.cover_url || '').trim();

  if (name.length < 2 || whatsapp.length < 10 || slug.length < 2) {
    return { status: 400, body: { error: 'Informe nome da garagem, endereço do link e WhatsApp com DDD.' } };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { status: 400, body: { error: 'Este endereço é reservado pelo sistema. Escolha outro nome para o link.' } };
  }

  const { data: slugTaken } = await admin.from('companies').select('id').eq('slug', slug).maybeSingle();
  if (slugTaken) {
    return { status: 409, body: { error: 'Este endereço de vitrine já está em uso. Escolha outro.' } };
  }

  const trialEndsAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  const { data: company, error: compErr } = await admin
    .from('companies')
    .insert({
      name,
      slug,
      whatsapp,
      instagram: instagram || null,
      address: address || null,
      opening_hours: openingHours,
      logo_url: logoUrl || null,
      cover_url: coverUrl || null,
      trial_ends_at: trialEndsAt,
    })
    .select('*')
    .single();

  if (compErr || !company) {
    return { status: 400, body: { error: compErr?.message || 'Erro ao criar garagem.' } };
  }

  await admin.from('company_members').insert({
    company_id: company.id,
    user_id: userId,
    role: 'owner',
  });

  await admin.from('subscriptions').insert({
    company_id: company.id,
    plan_code: 'mensal_5990',
    monthly_price: 49.9,
    status: 'trialing',
    grace_days: 5,
  });

  await writeSupabaseAuditLog(company.id, userId, 'company_created', 'companies', company.id, null, { name, slug });

  return { status: 201, body: normalizeCompany(company) };
}

export async function updateCurrentCompany(companyId: string, userId: string, body: any) {
  const admin = getSupabaseAdmin();
  const { data: current } = await admin.from('companies').select('*').eq('id', companyId).single();
  if (!current) return { status: 404, body: { error: 'Garagem não encontrada.' } };

  const name = String(body?.name ?? current.name).trim();
  const newSlug = body?.slug !== undefined ? slugify(String(body.slug)) : current.slug;
  const whatsapp = String(body?.whatsapp ?? current.whatsapp).replace(/\D/g, '');
  const instagram = String(body?.instagram ?? current.instagram ?? '').trim();
  const address = String(body?.address ?? current.address ?? '').trim();
  const openingHours = String(body?.opening_hours ?? current.opening_hours ?? '').trim();
  const logoUrl = String(body?.logo_url ?? current.logo_url ?? '').trim();
  const coverUrl = String(body?.cover_url ?? current.cover_url ?? '').trim();
  const showSold = body?.show_sold !== undefined ? Boolean(body.show_sold) : Boolean(current.show_sold);

  if (name.length < 2 || whatsapp.length < 10 || newSlug.length < 2) {
    return { status: 400, body: { error: 'Nome, slug e WhatsApp válidos são obrigatórios.' } };
  }
  if (RESERVED_SLUGS.has(newSlug)) {
    return { status: 400, body: { error: 'Este endereço de vitrine é reservado. Escolha outro.' } };
  }
  if (newSlug !== current.slug) {
    const { data: taken } = await admin
      .from('companies')
      .select('id')
      .eq('slug', newSlug)
      .neq('id', current.id)
      .maybeSingle();
    if (taken) {
      return { status: 409, body: { error: 'Este endereço de vitrine já está sendo usado por outra garagem.' } };
    }
  }

  const { data: updated, error } = await admin
    .from('companies')
    .update({
      name,
      slug: newSlug,
      whatsapp,
      instagram: instagram || null,
      address: address || null,
      opening_hours: openingHours,
      logo_url: logoUrl || null,
      cover_url: coverUrl || null,
      show_sold: showSold,
    })
    .eq('id', companyId)
    .select('*')
    .single();

  if (error || !updated) {
    return { status: 400, body: { error: error?.message || 'Erro ao atualizar configurações.' } };
  }

  await writeSupabaseAuditLog(
    companyId,
    userId,
    'company_updated',
    'companies',
    companyId,
    { name: current.name, slug: current.slug, show_sold: Boolean(current.show_sold) },
    { name, slug: newSlug, show_sold: showSold }
  );

  return { status: 200, body: normalizeCompany(updated) };
}

async function attachReminderVehicleLabels(companyId: string, rows: any[]) {
  const vehicleIds = Array.from(new Set(rows.map((r) => r.vehicle_id).filter(Boolean))) as string[];
  const labelMap = new Map<string, string>();
  if (vehicleIds.length > 0) {
    const admin = getSupabaseAdmin();
    const { data: vehs } = await admin
      .from('vehicles')
      .select('id, brand, model, model_year')
      .eq('company_id', companyId)
      .in('id', vehicleIds);
    for (const v of vehs || []) {
      labelMap.set(v.id, `${v.brand} ${v.model} ${v.model_year}`.trim());
    }
  }
  return rows.map((r) => ({
    ...r,
    amount: r.amount !== null && r.amount !== undefined ? Number(r.amount) : null,
    vehicle_label: r.vehicle_id ? labelMap.get(r.vehicle_id) || null : null,
  }));
}

export async function getDashboard(companyId: string) {
  const admin = getSupabaseAdmin();
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [{ data: finRows }, { data: remindersData }] = await Promise.all([
    admin.from('v_vehicle_financials').select('*').eq('company_id', companyId),
    admin
      .from('due_reminders')
      .select('*')
      .eq('company_id', companyId)
      .is('canceled_at', null)
      .is('completed_at', null)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  const enriched = await enrichVehicles(companyId, finRows || []);

  const totalVehiclesCount = enriched.length;
  const availableCount = enriched.filter((v) => v.status === 'disponivel').length;
  const soldThisMonth = enriched.filter(
    (v) => v.status === 'vendido' && typeof v.sale_date === 'string' && v.sale_date.startsWith(monthPrefix)
  );
  const soldThisMonthCount = soldThisMonth.length;
  const monthProfit = soldThisMonth.reduce((acc, v) => acc + Number(v.profit || 0), 0);
  const activeStock = enriched.filter((v) => ['preparacao', 'disponivel', 'reservado', 'inativo'].includes(v.status));
  const tiedUpCapital = activeStock.reduce((acc, v) => acc + Number(v.total_cost || 0), 0);
  const avgDaysInStock =
    enriched.length > 0
      ? Math.round(enriched.reduce((acc, v) => acc + Number(v.days_in_stock || 0), 0) / enriched.length)
      : 0;

  const stalledVehicles = activeStock
    .filter((v) => v.days_in_stock > 60)
    .sort((a, b) => b.days_in_stock - a.days_in_stock);

  const reminders = await attachReminderVehicleLabels(companyId, remindersData || []);

  const pendingRemindersCount = reminders.length;
  const overdueRemindersCount = reminders.filter((r) => r.due_date < todayIso).length;

  return {
    total_vehicles_count: totalVehiclesCount,
    available_count: availableCount,
    sold_this_month_count: soldThisMonthCount,
    month_profit: Number(monthProfit.toFixed(2)),
    tied_up_capital: Number(tiedUpCapital.toFixed(2)),
    avg_days_in_stock: avgDaysInStock,
    pending_reminders_count: pendingRemindersCount,
    overdue_reminders_count: overdueRemindersCount,
    upcoming_reminders: reminders.slice(0, 3),
    stalled_vehicles: stalledVehicles,
  };
}

export async function listVehicles(companyId: string, statusFilter: string, search: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('v_vehicle_financials')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  let rows = await enrichVehicles(companyId, data || []);

  if (statusFilter && VALID_STATUSES.has(statusFilter)) {
    rows = rows.filter((r) => r.status === statusFilter);
  }
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        `${r.brand} ${r.model} ${r.version}`.toLowerCase().includes(q) ||
        String(r.plate || '').toLowerCase().includes(q)
    );
  }
  return rows;
}

export async function createVehicle(companyId: string, userId: string, body: any) {
  const brand = String(body.brand || '').trim();
  const model = String(body.model || '').trim();
  const version = String(body.version || '').trim();
  const manufactureYear = Number(body.manufacture_year);
  const modelYear = Number(body.model_year);
  const mileage = Number(body.mileage ?? 0);
  const fuel = String(body.fuel || 'Flex').trim();
  const transmission = String(body.transmission || 'Automático').trim();
  const color = String(body.color || '').trim();
  const announcedPrice = Number(body.announced_price);
  const description = String(body.description || '').trim();
  const optionals = String(body.optionals || '').trim();
  const plate = String(body.plate || '').trim().toUpperCase();
  const status = VALID_STATUSES.has(body.status) && body.status !== 'vendido' ? body.status : 'disponivel';
  const purchasePrice = Number(body.purchase_price ?? 0);
  const purchaseDate = String(body.purchase_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const purchasedFrom = String(body.purchased_from || '').trim();
  const photos: string[] = Array.isArray(body.photos) ? body.photos.slice(0, 10) : [];

  if (
    !brand ||
    !model ||
    !Number.isInteger(manufactureYear) ||
    manufactureYear < 1940 ||
    manufactureYear > 2100 ||
    !Number.isInteger(modelYear) ||
    modelYear < 1940 ||
    modelYear > 2100 ||
    !Number.isFinite(announcedPrice) ||
    !Number.isFinite(purchasePrice) ||
    !Number.isFinite(mileage) ||
    announcedPrice < 0 ||
    purchasePrice < 0 ||
    mileage < 0
  ) {
    return { status: 400, body: { error: 'Preencha marca, modelo, anos (1940–2100), valor de compra e preço anunciado válidos.' } };
  }

  const admin = getSupabaseAdmin();
  const baseSlug = slugify(`${brand}-${model}-${modelYear}`);
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const { data: existingSlug } = await admin
      .from('vehicles')
      .select('id')
      .eq('company_id', companyId)
      .eq('slug', slug)
      .maybeSingle();
    if (!existingSlug) break;
    slug = `${baseSlug}-${suffix++}`;
  }

  const { data: createdRow, error } = await admin
    .from('vehicles')
    .insert({
      company_id: companyId,
      brand,
      model,
      version,
      manufacture_year: manufactureYear,
      model_year: modelYear,
      mileage,
      fuel,
      transmission,
      color,
      announced_price: announcedPrice,
      description,
      optionals,
      plate,
      slug,
      status,
      purchase_price: purchasePrice,
      purchase_date: purchaseDate,
      purchased_from: purchasedFrom,
    })
    .select('id')
    .single();

  if (error || !createdRow) {
    return { status: 400, body: { error: error?.message || 'Erro ao cadastrar veículo.' } };
  }

  const validPhotos = photos
    .filter((p) => typeof p === 'string' && p.length > 0)
    .map((storage_path, idx) => ({
      company_id: companyId,
      vehicle_id: createdRow.id,
      storage_path,
      sort_order: idx,
    }));

  if (validPhotos.length > 0) {
    await admin.from('vehicle_photos').insert(validPhotos);
  }

  await writeSupabaseAuditLog(companyId, userId, 'vehicle_created', 'vehicles', createdRow.id, null, {
    brand,
    model,
    announced_price: announcedPrice,
    purchase_price: purchasePrice,
  });

  const { data: fin } = await admin
    .from('v_vehicle_financials')
    .select('*')
    .eq('id', createdRow.id)
    .eq('company_id', companyId)
    .single();

  const [enriched] = await enrichVehicles(companyId, fin ? [fin] : []);
  return { status: 201, body: enriched };
}

export async function getVehicleDetail(companyId: string, vehicleId: string) {
  const admin = getSupabaseAdmin();
  const { data: fin } = await admin
    .from('v_vehicle_financials')
    .select('*')
    .eq('id', vehicleId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!fin) return { status: 404, body: { error: 'Veículo não encontrado.' } };

  const [[vehicle], { data: photos }, { data: expenses }, { data: sales }, { data: dailyStats }] = await Promise.all([
    enrichVehicles(companyId, [fin]),
    admin
      .from('vehicle_photos')
      .select('id, vehicle_id, storage_path, sort_order')
      .eq('vehicle_id', vehicleId)
      .eq('company_id', companyId)
      .order('sort_order', { ascending: true }),
    admin
      .from('vehicle_expenses')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('company_id', companyId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }),
    admin
      .from('vehicle_sales')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false }),
    admin
      .from('vehicle_daily_stats')
      .select('stat_date, views, whatsapp_clicks')
      .eq('vehicle_id', vehicleId)
      .eq('company_id', companyId)
      .order('stat_date', { ascending: false })
      .limit(30),
  ]);

  return {
    status: 200,
    body: {
      vehicle,
      photos: photos || [],
      expenses: (expenses || []).map((e: any) => ({ ...e, amount: Number(e.amount) })),
      sales: (sales || []).map((s: any) => ({ ...s, sale_price: Number(s.sale_price) })),
      daily_stats: dailyStats || [],
    },
  };
}

export async function updateVehicle(companyId: string, vehicleId: string, body: any) {
  const admin = getSupabaseAdmin();
  const { data: current } = await admin
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!current) return { status: 404, body: { error: 'Veículo não encontrado.' } };

  const nextStatus = body?.status !== undefined ? String(body.status) : current.status;
  if (!VALID_STATUSES.has(nextStatus)) {
    return { status: 400, body: { error: 'Status inválido.' } };
  }
  if (nextStatus === 'vendido' && current.status !== 'vendido') {
    return { status: 400, body: { error: 'Para marcar como vendido, registre a venda informando valor e comprador.' } };
  }

  const announcedPrice = body?.announced_price !== undefined ? Number(body.announced_price) : Number(current.announced_price);
  const purchasePrice = body?.purchase_price !== undefined ? Number(body.purchase_price) : Number(current.purchase_price);
  const mileage = body?.mileage !== undefined ? Number(body.mileage) : Number(current.mileage);

  if (announcedPrice < 0 || purchasePrice < 0 || mileage < 0) {
    return { status: 400, body: { error: 'Valores numéricos não podem ser negativos.' } };
  }

  const { error } = await admin
    .from('vehicles')
    .update({
      brand: String(body?.brand ?? current.brand).trim(),
      model: String(body?.model ?? current.model).trim(),
      version: String(body?.version ?? current.version ?? '').trim(),
      manufacture_year: Number(body?.manufacture_year ?? current.manufacture_year),
      model_year: Number(body?.model_year ?? current.model_year),
      mileage,
      fuel: String(body?.fuel ?? current.fuel).trim(),
      transmission: String(body?.transmission ?? current.transmission).trim(),
      color: String(body?.color ?? current.color ?? '').trim(),
      announced_price: announcedPrice,
      description: String(body?.description ?? current.description ?? '').trim(),
      optionals: String(body?.optionals ?? current.optionals ?? '').trim(),
      plate: String(body?.plate ?? current.plate ?? '').trim().toUpperCase(),
      status: nextStatus,
      purchase_price: purchasePrice,
      purchase_date: String(body?.purchase_date ?? current.purchase_date).slice(0, 10),
      purchased_from: String(body?.purchased_from ?? current.purchased_from ?? '').trim(),
    })
    .eq('id', current.id)
    .eq('company_id', companyId);

  if (error) return { status: 400, body: { error: error.message } };

  const { data: fin } = await admin
    .from('v_vehicle_financials')
    .select('*')
    .eq('id', current.id)
    .eq('company_id', companyId)
    .single();
  const [enriched] = await enrichVehicles(companyId, fin ? [fin] : []);
  return { status: 200, body: enriched };
}

export async function softDeleteVehicle(companyId: string, userId: string, vehicleId: string) {
  const admin = getSupabaseAdmin();
  const { data: current } = await admin
    .from('vehicles')
    .select('id, status')
    .eq('id', vehicleId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!current) return { status: 404, body: { error: 'Veículo não encontrado.' } };

  await admin
    .from('vehicles')
    .update({ deleted_at: new Date().toISOString(), status: 'inativo' })
    .eq('id', current.id)
    .eq('company_id', companyId);

  await writeSupabaseAuditLog(companyId, userId, 'vehicle_soft_deleted', 'vehicles', current.id, { status: current.status }, { deleted: true });
  return { status: 200, body: { ok: true } };
}

export async function replaceVehiclePhotos(companyId: string, vehicleId: string, photos: string[]) {
  const admin = getSupabaseAdmin();
  const { data: current } = await admin
    .from('vehicles')
    .select('id')
    .eq('id', vehicleId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!current) return { status: 404, body: { error: 'Veículo não encontrado.' } };

  await admin.from('vehicle_photos').delete().eq('vehicle_id', vehicleId).eq('company_id', companyId);

  const valid = photos
    .slice(0, 10)
    .filter((p) => typeof p === 'string' && p.length > 0)
    .map((storage_path, sort_order) => ({
      company_id: companyId,
      vehicle_id: vehicleId,
      storage_path,
      sort_order,
    }));

  if (valid.length > 0) {
    await admin.from('vehicle_photos').insert(valid);
  }

  const { data: saved } = await admin
    .from('vehicle_photos')
    .select('id, vehicle_id, storage_path, sort_order')
    .eq('vehicle_id', vehicleId)
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true });

  return { status: 200, body: saved || [] };
}

export async function addExpense(companyId: string, vehicleId: string, body: any) {
  const admin = getSupabaseAdmin();
  const { data: vehicle } = await admin
    .from('vehicles')
    .select('id')
    .eq('id', vehicleId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!vehicle) return { status: 404, body: { error: 'Veículo não encontrado.' } };

  const description = String(body?.description || '').trim();
  const category = String(body?.category || '').trim();
  const amount = Number(body?.amount);
  const expenseDate = String(body?.expense_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const supplier = String(body?.supplier || '').trim();

  if (!description || !VALID_CATEGORIES.has(category) || Number.isNaN(amount) || amount <= 0) {
    return { status: 400, body: { error: 'Informe descrição, categoria válida e valor maior que zero.' } };
  }

  const { data: created, error } = await admin
    .from('vehicle_expenses')
    .insert({
      company_id: companyId,
      vehicle_id: vehicleId,
      description,
      category,
      amount,
      expense_date: expenseDate,
      supplier,
    })
    .select('*')
    .single();

  if (error || !created) return { status: 400, body: { error: error?.message || 'Erro ao registrar despesa.' } };
  return { status: 201, body: { ...created, amount: Number(created.amount) } };
}

export async function cancelExpense(companyId: string, userId: string, vehicleId: string, expenseId: string) {
  const admin = getSupabaseAdmin();
  const { data: expense } = await admin
    .from('vehicle_expenses')
    .select('*')
    .eq('id', expenseId)
    .eq('vehicle_id', vehicleId)
    .eq('company_id', companyId)
    .is('canceled_at', null)
    .maybeSingle();

  if (!expense) return { status: 404, body: { error: 'Despesa não encontrada ou já cancelada.' } };

  await admin
    .from('vehicle_expenses')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', expense.id)
    .eq('company_id', companyId);

  await writeSupabaseAuditLog(companyId, userId, 'expense_canceled', 'vehicle_expenses', expense.id, expense, { canceled: true });
  return { status: 200, body: { ok: true } };
}

export async function sellVehicle(companyId: string, userId: string, vehicleId: string, body: any) {
  const admin = getSupabaseAdmin();
  const { data: vehicle } = await admin
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!vehicle) return { status: 404, body: { error: 'Veículo não encontrado.' } };
  if (vehicle.status === 'vendido') return { status: 409, body: { error: 'Este veículo já possui uma venda ativa.' } };

  const saleDate = String(body?.sale_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const salePrice = Number(body?.sale_price);
  const buyerName = String(body?.buyer_name || '').trim();
  const buyerPhone = String(body?.buyer_phone || '').trim();
  const paymentMethod = String(body?.payment_method || '').trim();
  const notes = String(body?.notes || '').trim();

  if (!buyerName || Number.isNaN(salePrice) || salePrice <= 0) {
    return { status: 400, body: { error: 'Informe valor efetivo da venda e nome do comprador.' } };
  }

  const previousStatus = vehicle.status === 'vendido' ? 'disponivel' : vehicle.status;

  const { data: sale, error } = await admin
    .from('vehicle_sales')
    .insert({
      company_id: companyId,
      vehicle_id: vehicle.id,
      sale_date: saleDate,
      sale_price: salePrice,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      payment_method: paymentMethod,
      notes,
    })
    .select('id')
    .single();

  if (error || !sale) {
    return { status: 400, body: { error: error?.message || 'Erro ao registrar venda.' } };
  }

  await writeSupabaseAuditLog(
    companyId,
    userId,
    'vehicle_sold',
    'vehicle_sales',
    sale.id,
    { status: previousStatus },
    { status: 'vendido', sale_price: salePrice, buyer_name: buyerName, sale_date: saleDate }
  );

  const { data: fin } = await admin
    .from('v_vehicle_financials')
    .select('*')
    .eq('id', vehicle.id)
    .eq('company_id', companyId)
    .single();

  const [enriched] = await enrichVehicles(companyId, fin ? [fin] : []);
  return { status: 201, body: enriched };
}

export async function cancelSale(companyId: string, userId: string, vehicleId: string, saleId: string) {
  const admin = getSupabaseAdmin();
  const [{ data: vehicle }, { data: sale }] = await Promise.all([
    admin.from('vehicles').select('*').eq('id', vehicleId).eq('company_id', companyId).is('deleted_at', null).maybeSingle(),
    admin.from('vehicle_sales').select('*').eq('id', saleId).eq('vehicle_id', vehicleId).eq('company_id', companyId).is('canceled_at', null).maybeSingle(),
  ]);

  if (!vehicle || !sale) return { status: 404, body: { error: 'Venda ativa não encontrada.' } };

  const restoreStatus =
    vehicle.previous_status && ['preparacao', 'disponivel', 'reservado', 'inativo'].includes(vehicle.previous_status)
      ? vehicle.previous_status
      : 'disponivel';

  const { error } = await admin
    .from('vehicle_sales')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', sale.id)
    .eq('company_id', companyId);

  if (error) return { status: 400, body: { error: error.message } };

  await writeSupabaseAuditLog(
    companyId,
    userId,
    'sale_canceled',
    'vehicle_sales',
    sale.id,
    { status: 'vendido', sale_price: Number(sale.sale_price) },
    { status: restoreStatus, canceled: true }
  );

  const { data: fin } = await admin
    .from('v_vehicle_financials')
    .select('*')
    .eq('id', vehicle.id)
    .eq('company_id', companyId)
    .single();

  const [enriched] = await enrichVehicles(companyId, fin ? [fin] : []);
  return { status: 200, body: enriched };
}

export async function listReminders(companyId: string) {
  const admin = getSupabaseAdmin();
  const [{ data: company }, { data: sub }, { data: rows }] = await Promise.all([
    admin.from('companies').select('*').eq('id', companyId).single(),
    admin.from('subscriptions').select('*').eq('company_id', companyId).maybeSingle(),
    admin
      .from('due_reminders')
      .select('*')
      .eq('company_id', companyId)
      .is('canceled_at', null)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  const access = computeSubscriptionState(company, sub);

  const labeled = await attachReminderVehicleLabels(companyId, rows || []);
  const formatted = labeled.sort((a: any, b: any) => {
    const aDone = a.completed_at ? 1 : 0;
    const bDone = b.completed_at ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return a.due_date.localeCompare(b.due_date);
  });

  let subscriptionAlert: {
    level: 'info' | 'warning' | 'danger';
    title: string;
    description: string;
    due_date: string | null;
  } | null = null;

  if (sub) {
    if (sub.status === 'suspended' || !access.has_access) {
      subscriptionAlert = {
        level: 'danger',
        title: 'Assinatura vencida — acesso suspenso',
        description: 'Regularize sua assinatura via Pix, boleto ou cartão para reativar a vitrine e os cadastros.',
        due_date: sub.overdue_since || company?.trial_ends_at || null,
      };
    } else if (sub.status === 'overdue') {
      subscriptionAlert = {
        level: 'danger',
        title: 'Pagamento da assinatura em atraso',
        description: `Regularize dentro do período de tolerância (${sub.grace_days} dias) para não tirar sua vitrine do ar.`,
        due_date: sub.overdue_since || null,
      };
    } else if (sub.status === 'trialing') {
      subscriptionAlert = {
        level: access.days_left_in_trial <= 2 ? 'warning' : 'info',
        title:
          access.days_left_in_trial <= 1
            ? 'Último dia do período de teste grátis'
            : `Teste grátis termina em ${access.days_left_in_trial} dias`,
        description: 'Ative seu plano na aba Assinatura para manter a vitrine pública sem interrupção.',
        due_date: company?.trial_ends_at ? String(company.trial_ends_at).slice(0, 10) : null,
      };
    } else if (sub.status === 'active' && sub.current_period_end) {
      const daysToRenew = Math.ceil((new Date(sub.current_period_end).getTime() - Date.now()) / 86400_000);
      if (daysToRenew <= 7) {
        subscriptionAlert = {
          level: 'info',
          title: `Próxima cobrança da assinatura em ${Math.max(0, daysToRenew)} dias`,
          description: 'Acompanhe a renovação automática do plano na página de Assinatura.',
          due_date: String(sub.current_period_end).slice(0, 10),
        };
      }
    }
  }

  return { reminders: formatted, subscription_alert: subscriptionAlert };
}

export async function createReminder(companyId: string, userId: string, body: any) {
  const title = String(body?.title || '').trim();
  const category = String(body?.category || 'outros').trim();
  const dueDate = String(body?.due_date || '').slice(0, 10);
  const rawAmount = body?.amount;
  const amount = rawAmount === '' || rawAmount === null || rawAmount === undefined ? null : Number(rawAmount);
  const vehicleId = body?.vehicle_id ? String(body.vehicle_id).trim() : null;
  const notes = String(body?.notes || '').trim();

  if (!title || !dueDate || !VALID_REMINDER_CATEGORIES.has(category)) {
    return { status: 400, body: { error: 'Informe título, categoria e data de vencimento válidos.' } };
  }
  if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
    return { status: 400, body: { error: 'Valor do vencimento inválido.' } };
  }

  const admin = getSupabaseAdmin();
  if (vehicleId) {
    const { data: owned } = await admin
      .from('vehicles')
      .select('id')
      .eq('id', vehicleId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!owned) {
      return { status: 404, body: { error: 'Veículo vinculado não encontrado na garagem.' } };
    }
  }

  const { data: created, error } = await admin
    .from('due_reminders')
    .insert({
      company_id: companyId,
      vehicle_id: vehicleId,
      title,
      category,
      due_date: dueDate,
      amount,
      notes,
    })
    .select('*')
    .single();

  if (error || !created) return { status: 400, body: { error: error?.message || 'Erro ao criar lembrete.' } };

  await writeSupabaseAuditLog(companyId, userId, 'reminder_created', 'due_reminders', created.id, null, {
    title,
    category,
    due_date: dueDate,
    amount,
  });

  const [withLabel] = await attachReminderVehicleLabels(companyId, [created]);
  return {
    status: 201,
    body: withLabel,
  };
}

export async function toggleReminderComplete(companyId: string, userId: string, reminderId: string) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from('due_reminders')
    .select('*')
    .eq('id', reminderId)
    .eq('company_id', companyId)
    .is('canceled_at', null)
    .maybeSingle();

  if (!existing) return { status: 404, body: { error: 'Lembrete não encontrado.' } };

  const nextCompleted = existing.completed_at ? null : new Date().toISOString();
  const { data: updated, error } = await admin
    .from('due_reminders')
    .update({ completed_at: nextCompleted })
    .eq('id', existing.id)
    .eq('company_id', companyId)
    .select('*')
    .single();

  if (error) return { status: 400, body: { error: error.message } };

  await writeSupabaseAuditLog(
    companyId,
    userId,
    nextCompleted ? 'reminder_completed' : 'reminder_reopened',
    'due_reminders',
    existing.id,
    { completed_at: existing.completed_at },
    { completed_at: nextCompleted }
  );

  return {
    status: 200,
    body: { ...updated, amount: updated.amount !== null && updated.amount !== undefined ? Number(updated.amount) : null },
  };
}

export async function cancelReminder(companyId: string, userId: string, reminderId: string) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from('due_reminders')
    .select('*')
    .eq('id', reminderId)
    .eq('company_id', companyId)
    .is('canceled_at', null)
    .maybeSingle();

  if (!existing) return { status: 404, body: { error: 'Lembrete não encontrado.' } };

  await admin
    .from('due_reminders')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', existing.id)
    .eq('company_id', companyId);

  await writeSupabaseAuditLog(companyId, userId, 'reminder_canceled', 'due_reminders', existing.id, existing, null);
  return { status: 200, body: { ok: true } };
}

export async function getSubscriptionOverview(companyId: string) {
  const admin = getSupabaseAdmin();
  const [{ data: company }, { data: sub }, { data: events }, { data: audits }] = await Promise.all([
    admin.from('companies').select('*').eq('id', companyId).single(),
    admin.from('subscriptions').select('*').eq('company_id', companyId).maybeSingle(),
    admin.from('asaas_events').select('id, event_id, event_type, processed_at, error_message, created_at').order('created_at', { ascending: false }).limit(10),
    admin.from('audit_logs').select('id, action, table_name, record_id, before_data, after_data, created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(15),
  ]);

  return {
    subscription: normalizeSubscription(sub, company),
    events: events || [],
    audit_logs: (audits || []).map((a: any) => ({
      ...a,
      before_data: a.before_data ? JSON.stringify(a.before_data) : null,
      after_data: a.after_data ? JSON.stringify(a.after_data) : null,
    })),
  };
}

export async function getExistingAsaasCustomerId(companyId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from('subscriptions').select('asaas_customer_id').eq('company_id', companyId).maybeSingle();
  const id = data?.asaas_customer_id;
  return id && !id.startsWith('cus_sbx_') ? id : null;
}

export async function saveSubscriptionCheckout(
  companyId: string,
  userId: string,
  data: {
    asaasCustomerId: string;
    asaasSubscriptionId: string;
    planCode: string;
    paymentMethod: string;
    monthlyPrice: number;
    mode: string;
  }
) {
  const admin = getSupabaseAdmin();
  await admin
    .from('subscriptions')
    .upsert(
      {
        company_id: companyId,
        asaas_customer_id: data.asaasCustomerId,
        asaas_subscription_id: data.asaasSubscriptionId,
        plan_code: data.planCode,
        payment_method: data.paymentMethod,
        monthly_price: data.monthlyPrice,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' }
    );

  await writeSupabaseAuditLog(companyId, userId, 'subscription_checkout_created', 'subscriptions', companyId, null, {
    plan_code: data.planCode,
    payment_method: data.paymentMethod,
    asaas_subscription_id: data.asaasSubscriptionId,
    mode: data.mode,
  });
}

export async function getSubscriptionByCompany(companyId: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from('subscriptions').select('*').eq('company_id', companyId).maybeSingle();
  return data;
}

export async function markSubscriptionCanceled(companyId: string, userId: string, sub: any, periodEnd: string) {
  const admin = getSupabaseAdmin();
  await admin
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      current_period_end: periodEnd,
    })
    .eq('company_id', companyId);

  await writeSupabaseAuditLog(
    companyId,
    userId,
    'subscription_canceled',
    'subscriptions',
    sub.id,
    { status: sub.status },
    { status: 'canceled', current_period_end: periodEnd }
  );
}

export async function setSandboxAsaasSubscriptionId(subId: string, asaasSubId: string) {
  const admin = getSupabaseAdmin();
  await admin.from('subscriptions').update({ asaas_subscription_id: asaasSubId }).eq('id', subId);
}

export async function processAsaasWebhook(payload: any, tokenHeader: string | undefined, expectedToken: string) {
  if (!tokenHeader || tokenHeader !== expectedToken) {
    return { status: 401, body: { error: 'Token de webhook inválido.' } };
  }
  const eventId = String(payload?.id || '');
  const eventType = String(payload?.event || '');
  if (!eventId || !eventType) {
    return { status: 400, body: { error: 'Evento inválido.' } };
  }

  const admin = getSupabaseAdmin();
  const { data: existing } = await admin.from('asaas_events').select('id').eq('event_id', eventId).maybeSingle();
  if (existing) {
    return { status: 200, body: { ok: true, idempotent: true } };
  }

  const { data: insertedEvent, error: insertErr } = await admin
    .from('asaas_events')
    .insert({
      event_id: eventId,
      event_type: eventType,
      payload,
    })
    .select('id')
    .single();

  if (insertErr || !insertedEvent) {
    return { status: 500, body: { error: insertErr?.message || 'Erro ao registrar evento Asaas.' } };
  }

  try {
    const asaasSubId = payload.payment?.subscription || payload.subscription?.id;
    const { data: sub } = await admin
      .from('subscriptions')
      .select('*')
      .eq('asaas_subscription_id', asaasSubId)
      .maybeSingle();

    if (!sub) {
      throw new Error(`Assinatura ${asaasSubId} não encontrada.`);
    }

    const prevStatus = sub.status;
    let nextStatus = sub.status;
    let overdueSince = sub.overdue_since;
    let periodEnd = sub.current_period_end;
    let canceledAt = sub.canceled_at;

    if (eventType === 'PAYMENT_CONFIRMED' || eventType === 'PAYMENT_RECEIVED') {
      nextStatus = 'active';
      overdueSince = null;
      canceledAt = null;
      periodEnd = new Date(Date.now() + 30 * 86400_000).toISOString();
    } else if (eventType === 'PAYMENT_OVERDUE') {
      nextStatus = 'overdue';
      overdueSince = sub.overdue_since || new Date().toISOString();
    } else if (eventType === 'PAYMENT_REFUNDED' || eventType === 'GRACE_PERIOD_EXPIRED') {
      nextStatus = 'suspended';
    } else if (eventType === 'SUBSCRIPTION_DELETED') {
      nextStatus = 'canceled';
      canceledAt = new Date().toISOString();
    }

    await admin
      .from('subscriptions')
      .update({
        status: nextStatus,
        overdue_since: overdueSince,
        current_period_end: periodEnd,
        canceled_at: canceledAt,
      })
      .eq('id', sub.id);

    await writeSupabaseAuditLog(
      sub.company_id,
      null,
      `asaas_${eventType.toLowerCase()}`,
      'subscriptions',
      sub.id,
      { status: prevStatus },
      { status: nextStatus }
    );

    await admin.from('asaas_events').update({ processed_at: new Date().toISOString() }).eq('id', insertedEvent.id);
    return { status: 200, body: { ok: true, status: nextStatus } };
  } catch (err) {
    await admin
      .from('asaas_events')
      .update({ error_message: err instanceof Error ? err.message : String(err) })
      .eq('id', insertedEvent.id);
    return { status: 500, body: { error: 'Falha ao processar evento; registrado para reprocessamento.' } };
  }
}

export async function getPublicGarage(slug: string, filters: { q?: string; minYear?: number; maxPrice?: number }) {
  const admin = getSupabaseAdmin();
  const { data: companyRaw } = await admin
    .from('companies')
    .select('id, name, slug, whatsapp, instagram, address, opening_hours, logo_url, cover_url, show_sold, trial_ends_at')
    .eq('slug', slug)
    .maybeSingle();

  if (!companyRaw) return { status: 404, body: { error: 'Garagem não encontrada.' } };

  const { data: sub } = await admin.from('subscriptions').select('*').eq('company_id', companyRaw.id).maybeSingle();
  const access = computeSubscriptionState(companyRaw, sub);
  if (!access.has_access) return { status: 403, body: { error: 'Esta vitrine está temporariamente fora do ar.' } };

  const { data: vehiclesRaw } = await admin
    .from('public_vehicles_view')
    .select('*')
    .eq('company_id', companyRaw.id)
    .order('created_at', { ascending: false });

  let vehicles = (vehiclesRaw || []).map((v: any) => ({
    ...v,
    announced_price: Number(v.announced_price ?? 0),
    mileage: Number(v.mileage ?? 0),
    manufacture_year: Number(v.manufacture_year),
    model_year: Number(v.model_year),
    photos: Array.isArray(v.photos) ? v.photos : [],
  }));

  if (filters.q) {
    const q = filters.q.toLowerCase();
    vehicles = vehicles.filter((v: any) => `${v.brand} ${v.model} ${v.version}`.toLowerCase().includes(q));
  }
  if (filters.minYear && filters.minYear > 0) {
    vehicles = vehicles.filter((v: any) => v.model_year >= filters.minYear!);
  }
  if (filters.maxPrice && filters.maxPrice > 0) {
    vehicles = vehicles.filter((v: any) => v.announced_price <= filters.maxPrice!);
  }

  return {
    status: 200,
    body: {
      company: {
        id: companyRaw.id,
        name: companyRaw.name,
        slug: companyRaw.slug,
        whatsapp: companyRaw.whatsapp,
        instagram: companyRaw.instagram ?? '',
        address: companyRaw.address ?? '',
        opening_hours: companyRaw.opening_hours ?? '',
        logo_url: companyRaw.logo_url ?? '',
        cover_url: companyRaw.cover_url ?? '',
        show_sold: Boolean(companyRaw.show_sold),
      },
      vehicles,
    },
  };
}

export async function getPublicVehicle(slug: string, carSlug: string) {
  const admin = getSupabaseAdmin();
  const { data: companyRaw } = await admin
    .from('companies')
    .select('id, name, slug, whatsapp, instagram, address, opening_hours, logo_url, cover_url, show_sold, trial_ends_at')
    .eq('slug', slug)
    .maybeSingle();

  if (!companyRaw) return { status: 404, body: { error: 'Garagem não encontrada.' } };

  const { data: sub } = await admin.from('subscriptions').select('*').eq('company_id', companyRaw.id).maybeSingle();
  const access = computeSubscriptionState(companyRaw, sub);
  if (!access.has_access) return { status: 403, body: { error: 'Esta vitrine está temporariamente fora do ar.' } };

  const { data: vehicle } = await admin
    .from('public_vehicles_view')
    .select('*')
    .eq('company_id', companyRaw.id)
    .eq('slug', carSlug)
    .maybeSingle();

  if (!vehicle) return { status: 404, body: { error: 'Veículo não disponível.' } };

  return {
    status: 200,
    body: {
      company: {
        id: companyRaw.id,
        name: companyRaw.name,
        slug: companyRaw.slug,
        whatsapp: companyRaw.whatsapp,
        instagram: companyRaw.instagram ?? '',
        address: companyRaw.address ?? '',
        opening_hours: companyRaw.opening_hours ?? '',
        logo_url: companyRaw.logo_url ?? '',
        cover_url: companyRaw.cover_url ?? '',
        show_sold: Boolean(companyRaw.show_sold),
      },
      vehicle: {
        ...vehicle,
        announced_price: Number(vehicle.announced_price ?? 0),
        mileage: Number(vehicle.mileage ?? 0),
        manufacture_year: Number(vehicle.manufacture_year),
        model_year: Number(vehicle.model_year),
        photos: Array.isArray(vehicle.photos) ? vehicle.photos : [],
      },
    },
  };
}

export async function trackPublicEvent(slug: string, carSlug: string, eventType: string) {
  const admin = getSupabaseAdmin();
  await admin.rpc('track_public_vehicle_event', {
    p_company_slug: slug,
    p_vehicle_slug: carSlug,
    p_event_type: eventType,
  });
}

export async function getPublicOgMeta(garageSlug: string, carSlug?: string) {
  const admin = getSupabaseAdmin();
  const { data: company } = await admin
    .from('companies')
    .select('id, name, address, cover_url')
    .eq('slug', garageSlug)
    .maybeSingle();
  if (!company) return null;

  let ogTitle = `${company.name} — Vitrine de Veículos`;
  let ogDesc = company.address || `Confira o estoque disponível na ${company.name}.`;
  let ogImage = company.cover_url || '';

  if (carSlug) {
    const { data: vehicle } = await admin
      .from('public_vehicles_view')
      .select('brand, model, version, model_year, announced_price, mileage, photos')
      .eq('company_id', company.id)
      .eq('slug', carSlug)
      .maybeSingle();
    if (vehicle) {
      const priceStr = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
        Number(vehicle.announced_price)
      );
      ogTitle = `${vehicle.brand} ${vehicle.model} ${vehicle.model_year} — ${priceStr}`;
      ogDesc = `${vehicle.version || ''} · ${new Intl.NumberFormat('pt-BR').format(Number(vehicle.mileage))} km · ${company.name}`.trim();
      const firstPhoto = Array.isArray(vehicle.photos) ? vehicle.photos[0]?.storage_path : '';
      if (firstPhoto && !String(firstPhoto).startsWith('data:')) {
        ogImage = firstPhoto;
      }
    }
  }

  return { ogTitle, ogDesc, ogImage };
}
