import type { User } from '@supabase/supabase-js';
import { ApiError } from './apiError';
import { supabase } from './supabase';
import { RESERVED_GARAGE_SLUGS } from '../types/garage';

const RESERVED_SLUG_SET = new Set(RESERVED_GARAGE_SLUGS);
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

function slugifyText(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'veiculo'
  );
}

function parseJsonBody(body: BodyInit | null | undefined): any {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function isPreviewBackendAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app');
}

function computeSubscriptionState(company: any, sub: any) {
  const now = Date.now();
  const trialEndsMs = company?.trial_ends_at ? new Date(company.trial_ends_at).getTime() : 0;
  const daysLeftInTrial = Math.max(0, Math.ceil((trialEndsMs - now) / 86400_000));

  let hasAccess = false;
  const status = sub?.status || 'trialing';
  if (status === 'trialing') {
    hasAccess = trialEndsMs >= now;
  } else if (status === 'active') {
    hasAccess = true;
  } else if (status === 'overdue') {
    const overdueMs = sub?.overdue_since ? new Date(sub.overdue_since).getTime() : now;
    const graceMs = Number(sub?.grace_days ?? 5) * 86400_000;
    hasAccess = overdueMs + graceMs >= now;
  } else if (status === 'canceled') {
    const periodEndMs = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : 0;
    hasAccess = periodEndMs >= now;
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

function toUserProfile(u: User) {
  return {
    id: u.id,
    email: u.email || '',
    name: String((u.user_metadata as any)?.name || u.email?.split('@')[0] || 'Lojista'),
    email_verified: Boolean(u.email_confirmed_at || u.confirmed_at),
  };
}

async function getSupabaseAccessToken(): Promise<string> {
  if (!supabase) return '';
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

async function requireAuthedUser(): Promise<User> {
  if (!supabase) throw new ApiError('Supabase não configurado.', 500);
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) {
    return sessionData.session.user;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    throw new ApiError('Sessão expirada ou inválida.', 401);
  }
  return data.user;
}

async function getMemberContext(userId: string) {
  if (!supabase) throw new ApiError('Supabase não configurado.', 500);
  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  const [{ data: companyRaw }, { data: subRaw }] = await Promise.all([
    supabase.from('companies').select('*').eq('id', membership.company_id).maybeSingle(),
    supabase.from('subscriptions').select('*').eq('company_id', membership.company_id).maybeSingle(),
  ]);

  if (!companyRaw) return null;
  const company = normalizeCompany(companyRaw);
  const subscription = normalizeSubscription(subRaw, companyRaw);
  const access = computeSubscriptionState(companyRaw, subRaw);

  return { membership, company, subscription, access };
}

async function requireCompanyContext(allowSuspended = false) {
  const user = await requireAuthedUser();
  const ctx = await getMemberContext(user.id);
  if (!ctx) {
    throw new ApiError('Garagem não cadastrada.', 404, 'NO_COMPANY');
  }
  if (!allowSuspended && !ctx.access.has_access) {
    throw new ApiError(
      'Assinatura suspensa ou período de teste encerrado. Regularize o pagamento para liberar o acesso.',
      402,
      'SUBSCRIPTION_SUSPENDED'
    );
  }
  return { user, ...ctx };
}

async function enrichVehicles(companyId: string, financialRows: any[]) {
  if (!supabase || financialRows.length === 0) return [];
  const vehicleIds = financialRows.map((r) => r.id);

  const [vehiclesExtraRes, photosRes, statsRes] = await Promise.all([
    supabase
      .from('vehicles')
      .select('id, description, optionals, previous_status')
      .eq('company_id', companyId)
      .in('id', vehicleIds),
    supabase
      .from('vehicle_photos')
      .select('vehicle_id, storage_path, sort_order')
      .eq('company_id', companyId)
      .in('vehicle_id', vehicleIds)
      .order('sort_order', { ascending: true }),
    supabase
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

async function attachReminderVehicleLabels(companyId: string, rows: any[]) {
  if (!supabase) return rows;
  const vehicleIds = Array.from(new Set(rows.map((r) => r.vehicle_id).filter(Boolean))) as string[];
  const labelMap = new Map<string, string>();
  if (vehicleIds.length > 0) {
    const { data: vehs } = await supabase
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

async function invokeEdgeFunctionOrLocalFallback<T>(
  edgeBody: Record<string, unknown>,
  localPath: string,
  localBody?: Record<string, unknown>
): Promise<T> {
  if (!supabase) throw new ApiError('Supabase não configurado.', 500);
  const { data, error } = await supabase.functions.invoke('asaas-create-subscription', {
    body: edgeBody,
  });

  if (!error && data && !(data as any).error) {
    return data as T;
  }

  // Extrai mensagem real quando a Edge Function retornou JSON de erro (ex.: 400 CPF inválido)
  const errCtx = (error as any)?.context;
  if (errCtx && typeof errCtx.json === 'function') {
    try {
      const parsed = await errCtx.json();
      if (parsed?.error) {
        throw new ApiError(parsed.error, errCtx.status || 400, parsed.code, parsed);
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
    }
  }

  if (data && (data as any).error) {
    throw new ApiError(String((data as any).error), 400);
  }

  // Fallback opcional apenas quando rodando em preview local/AI Studio antes do deploy das Edge Functions
  if (isPreviewBackendAvailable()) {
    const token = await getSupabaseAccessToken();
    const res = await fetch(localPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(localBody ?? {}),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok && json) {
      return json as T;
    }
    if (json?.error) {
      throw new ApiError(json.error, res.status, json.code, json);
    }
  }

  throw new ApiError(
    error?.message ||
      'Serviço de assinatura Asaas indisponível. Verifique se a Edge Function asaas-create-subscription está implantada no Supabase.',
    502
  );
}

export async function handleSupabaseDirectRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!supabase) {
    throw new ApiError('Supabase não configurado.', 500);
  }

  const url = new URL(path, 'https://garage.cs22.com.br');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = (options.method || 'GET').toUpperCase();
  const body = parseJsonBody(options.body);

  // =========================================================================
  // AUTH
  // =========================================================================
  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = await requireAuthedUser();
    const ctx = await getMemberContext(user.id);
    return {
      user: toUserProfile(user),
      company: ctx?.company ?? null,
      subscription: ctx?.subscription ?? null,
    } as T;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const cleanPassword = String(body.password || '');
    if (!cleanEmail || !cleanPassword) {
      throw new ApiError('Informe e-mail e senha.', 400);
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword,
    });

    if (error || !data.user || !data.session) {
      const msg = (error?.message || '').toLowerCase();
      if (msg.includes('not confirmed')) {
        throw new ApiError('Confirme seu e-mail antes de acessar o painel.', 403, 'EMAIL_NOT_VERIFIED');
      }
      throw new ApiError('E-mail ou senha incorretos.', 401);
    }

    return {
      token: data.session.access_token,
      user: toUserProfile(data.user),
    } as T;
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const cleanName = String(body.name || '').trim();
    const cleanPassword = String(body.password || '');
    if (!cleanEmail.includes('@') || cleanName.length < 2 || cleanPassword.length < 6) {
      throw new ApiError('Informe nome, e-mail válido e senha com ao menos 6 caracteres.', 400);
    }

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password: cleanPassword,
      options: {
        data: { name: cleanName },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already') || msg.includes('registered')) {
        throw new ApiError('Este e-mail já está cadastrado.', 409);
      }
      throw new ApiError(error.message || 'Erro ao criar conta.', 400);
    }

    // Quando confirmação por e-mail estiver desativada no Supabase, session já vem ativa
    if (data.session && data.user) {
      return {
        message: 'Conta criada com sucesso!',
        token: data.session.access_token,
        user: toUserProfile(data.user),
      } as T;
    }

    return {
      message: 'Conta criada! Verifique sua caixa de entrada para confirmar o e-mail antes de entrar.',
    } as T;
  }

  if (pathname === '/api/auth/confirm-email' && method === 'POST') {
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const token = String(body.token || '').trim();
    if (!cleanEmail || !token) {
      throw new ApiError('Informe o e-mail e o código de confirmação.', 400);
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token,
      type: 'signup',
    });

    if (error || !data.user) {
      throw new ApiError('Código de confirmação inválido ou expirado.', 400);
    }

    return {
      ok: true,
      token: data.session?.access_token,
      user: toUserProfile(data.user),
    } as T;
  }

  if (pathname === '/api/auth/request-reset' && method === 'POST') {
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      throw new ApiError('Informe um e-mail válido.', 400);
    }
    await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/recuperar-senha`,
    });
    return {
      message: 'Se o e-mail estiver cadastrado, enviamos as instruções de redefinição para sua caixa de entrada.',
    } as T;
  }

  if (pathname === '/api/auth/complete-recovery' && method === 'POST') {
    const accessToken = String(body.access_token || '').trim();
    const newPassword = String(body.new_password || '');
    if (newPassword.length < 6) {
      throw new ApiError('A nova senha deve ter ao menos 6 caracteres.', 400);
    }

    if (accessToken) {
      const { error: userErr } = await supabase.auth.getUser(accessToken);
      if (userErr) {
        throw new ApiError('Link de recuperação inválido ou expirado. Solicite um novo.', 400);
      }
      await supabase.auth.setSession({ access_token: accessToken, refresh_token: accessToken });
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      throw new ApiError(error.message || 'Não foi possível redefinir a senha. Solicite um novo link.', 400);
    }
    return { message: 'Senha redefinida com sucesso.' } as T;
  }

  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const token = String(body.token || '').trim();
    const newPassword = String(body.new_password || '');
    if (!cleanEmail || !token || newPassword.length < 6) {
      throw new ApiError('Informe e-mail, código recebido e nova senha (mínimo 6 caracteres).', 400);
    }
    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token,
      type: 'recovery',
    });
    if (error || !data.user) {
      throw new ApiError('Código de recuperação inválido ou expirado.', 400);
    }
    const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updErr) {
      throw new ApiError(updErr.message || 'Erro ao atualizar senha.', 400);
    }
    return { message: 'Senha redefinida com sucesso.' } as T;
  }

  // =========================================================================
  // COMPANIES (ONBOARDING & SETTINGS)
  // =========================================================================
  const checkSlugMatch = pathname.match(/^\/api\/companies\/check-slug\/([^/]+)$/);
  if (checkSlugMatch && method === 'GET') {
    const user = await requireAuthedUser();
    const candidate = decodeURIComponent(checkSlugMatch[1]).trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) {
      return { slug: candidate, available: false, reserved: false } as T;
    }
    if (RESERVED_SLUG_SET.has(candidate)) {
      return { slug: candidate, available: false, reserved: true } as T;
    }

    const ctx = await getMemberContext(user.id);
    const { data: rpcData, error: rpcErr } = await supabase.rpc('check_company_slug_available', {
      p_slug: candidate,
      p_exclude_company_id: ctx?.company?.id ?? null,
    });

    if (!rpcErr && Array.isArray(rpcData) && rpcData[0]) {
      return {
        slug: candidate,
        available: Boolean(rpcData[0].available),
        reserved: Boolean(rpcData[0].reserved),
      } as T;
    }

    // Fallback se a migração 002 ainda não tiver sido aplicada
    const { data: pubMatch } = await supabase
      .from('public_companies_view')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();

    const available = !pubMatch || pubMatch.id === ctx?.company?.id;
    return { slug: candidate, available, reserved: false } as T;
  }

  if (pathname === '/api/companies' && method === 'POST') {
    await requireAuthedUser();
    const name = String(body.name || '').trim();
    const rawSlug = String(body.slug || '').trim().toLowerCase();
    const whatsapp = String(body.whatsapp || '').replace(/\D/g, '');
    if (name.length < 2 || rawSlug.length < 2 || whatsapp.length < 10) {
      throw new ApiError('Preencha nome da garagem, endereço do link e WhatsApp com DDD.', 400);
    }
    if (RESERVED_SLUG_SET.has(rawSlug)) {
      throw new ApiError('Este endereço de vitrine é reservado. Escolha outro.', 400);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawSlug)) {
      throw new ApiError('Use apenas letras minúsculas, números e hífens no link.', 400);
    }

    const { data, error } = await supabase.rpc('create_company', {
      p_name: name,
      p_slug: rawSlug,
      p_whatsapp: whatsapp,
      p_instagram: String(body.instagram || '').trim(),
      p_address: String(body.address || '').trim(),
      p_opening_hours: String(body.opening_hours || '').trim(),
      p_logo_url: String(body.logo_url || '').trim(),
      p_cover_url: String(body.cover_url || '').trim(),
    });

    if (error || !data) {
      const msg = (error?.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique') || error?.code === '23505') {
        throw new ApiError('Este endereço de vitrine já está em uso. Escolha outro.', 409);
      }
      if (msg.includes('reservado')) {
        throw new ApiError('Este endereço de vitrine é reservado. Escolha outro.', 400);
      }
      throw new ApiError(error?.message || 'Erro ao cadastrar garagem.', 400);
    }

    return { company: normalizeCompany(data) } as T;
  }

  if (pathname === '/api/companies/current' && method === 'PATCH') {
    const { company } = await requireCompanyContext(true);
    const name = String(body.name ?? company.name).trim();
    const newSlug = String(body.slug ?? company.slug).trim().toLowerCase();
    const whatsapp = String(body.whatsapp ?? company.whatsapp).replace(/\D/g, '');

    if (name.length < 2 || whatsapp.length < 10 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newSlug)) {
      throw new ApiError('Dados inválidos. Verifique nome, link e WhatsApp.', 400);
    }
    if (RESERVED_SLUG_SET.has(newSlug)) {
      throw new ApiError('Este endereço de vitrine é reservado. Escolha outro.', 400);
    }

    const { data: updated, error } = await supabase
      .from('companies')
      .update({
        name,
        slug: newSlug,
        whatsapp,
        instagram: body.instagram !== undefined ? String(body.instagram || '').trim() || null : company.instagram || null,
        address: body.address !== undefined ? String(body.address || '').trim() || null : company.address || null,
        opening_hours: body.opening_hours !== undefined ? String(body.opening_hours || '').trim() : company.opening_hours,
        logo_url: body.logo_url !== undefined ? String(body.logo_url || '').trim() || null : company.logo_url || null,
        cover_url: body.cover_url !== undefined ? String(body.cover_url || '').trim() || null : company.cover_url || null,
        show_sold: body.show_sold !== undefined ? Boolean(body.show_sold) : Boolean(company.show_sold),
      })
      .eq('id', company.id)
      .select('*')
      .single();

    if (error || !updated) {
      if (error?.code === '23505' || (error?.message || '').toLowerCase().includes('unique')) {
        throw new ApiError('Este endereço de vitrine já está sendo usado por outra garagem.', 409);
      }
      throw new ApiError(error?.message || 'Erro ao atualizar garagem.', 400);
    }

    return normalizeCompany(updated) as T;
  }

  // =========================================================================
  // DASHBOARD
  // =========================================================================
  if (pathname === '/api/dashboard' && method === 'GET') {
    const { company } = await requireCompanyContext(true);
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const todayIso = new Date().toISOString().slice(0, 10);

    const [{ data: finRows, error: finErr }, { data: remindersData }] = await Promise.all([
      supabase.from('v_vehicle_financials').select('*').eq('company_id', company.id),
      supabase
        .from('due_reminders')
        .select('*')
        .eq('company_id', company.id)
        .is('canceled_at', null)
        .is('completed_at', null)
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: false }),
    ]);

    if (finErr) throw new ApiError(finErr.message, 400);
    const enriched = await enrichVehicles(company.id, finRows || []);

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

    const reminders = await attachReminderVehicleLabels(company.id, remindersData || []);
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
    } as T;
  }

  // =========================================================================
  // VEHICLES
  // =========================================================================
  if (pathname === '/api/vehicles' && method === 'GET') {
    const { company } = await requireCompanyContext(true);
    const statusFilter = (url.searchParams.get('status') || '').trim();
    const search = (url.searchParams.get('q') || '').trim().toLowerCase();

    const { data, error } = await supabase
      .from('v_vehicle_financials')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message, 400);
    let rows = await enrichVehicles(company.id, data || []);

    if (statusFilter && VALID_STATUSES.has(statusFilter)) {
      rows = rows.filter((r) => r.status === statusFilter);
    }
    if (search) {
      rows = rows.filter(
        (r) =>
          `${r.brand} ${r.model} ${r.version}`.toLowerCase().includes(search) ||
          String(r.plate || '').toLowerCase().includes(search)
      );
    }
    return rows as T;
  }

  if (pathname === '/api/vehicles' && method === 'POST') {
    const { company } = await requireCompanyContext(false);
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
      throw new ApiError('Preencha marca, modelo, anos (1940–2100), valor de compra e preço anunciado válidos.', 400);
    }

    const baseSlug = slugifyText(`${brand}-${model}-${modelYear}`);
    let slug = baseSlug;
    let suffix = 2;
    while (true) {
      const { data: existingSlug } = await supabase
        .from('vehicles')
        .select('id')
        .eq('company_id', company.id)
        .eq('slug', slug)
        .maybeSingle();
      if (!existingSlug) break;
      slug = `${baseSlug}-${suffix++}`;
    }

    const { data: createdRow, error } = await supabase
      .from('vehicles')
      .insert({
        company_id: company.id,
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
      throw new ApiError(error?.message || 'Erro ao cadastrar veículo.', 400);
    }

    const validPhotos = photos
      .filter((p) => typeof p === 'string' && p.length > 0)
      .map((storage_path, idx) => ({
        company_id: company.id,
        vehicle_id: createdRow.id,
        storage_path,
        sort_order: idx,
      }));

    if (validPhotos.length > 0) {
      const { error: photoErr } = await supabase.from('vehicle_photos').insert(validPhotos);
      if (photoErr) throw new ApiError(photoErr.message, 400);
    }

    const { data: fin } = await supabase
      .from('v_vehicle_financials')
      .select('*')
      .eq('id', createdRow.id)
      .eq('company_id', company.id)
      .single();

    const [enriched] = await enrichVehicles(company.id, fin ? [fin] : []);
    return enriched as T;
  }

  const vehPhotosMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/photos$/);
  if (vehPhotosMatch && method === 'PUT') {
    const { company } = await requireCompanyContext(false);
    const vehicleId = decodeURIComponent(vehPhotosMatch[1]);
    const photos: string[] = Array.isArray(body.photos) ? body.photos.slice(0, 10) : [];
    const valid = photos.filter((p) => typeof p === 'string' && p.length > 0);

    const { data: current } = await supabase
      .from('vehicles')
      .select('id')
      .eq('id', vehicleId)
      .eq('company_id', company.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!current) throw new ApiError('Veículo não encontrado.', 404);

    // Tenta limpar via DELETE (habilitado pela migration 002); se política DELETE ainda não existir, sincroniza in-place
    await supabase.from('vehicle_photos').delete().eq('vehicle_id', vehicleId).eq('company_id', company.id);

    const { data: remaining } = await supabase
      .from('vehicle_photos')
      .select('id, sort_order')
      .eq('vehicle_id', vehicleId)
      .eq('company_id', company.id)
      .order('sort_order', { ascending: true });

    const existing = remaining || [];
    if (existing.length === 0) {
      if (valid.length > 0) {
        const { error: insErr } = await supabase.from('vehicle_photos').insert(
          valid.map((storage_path, sort_order) => ({
            company_id: company.id,
            vehicle_id: vehicleId,
            storage_path,
            sort_order,
          }))
        );
        if (insErr) throw new ApiError(insErr.message, 400);
      }
    } else {
      if (valid.length < existing.length) {
        throw new ApiError(
          'Para remover fotos já salvas, execute o arquivo supabase/migrations/002_direct_client_support.sql no SQL Editor do Supabase.',
          403
        );
      }
      for (let i = 0; i < existing.length; i++) {
        await supabase
          .from('vehicle_photos')
          .update({ storage_path: valid[i], sort_order: i })
          .eq('id', existing[i].id)
          .eq('company_id', company.id);
      }
      const extra = valid.slice(existing.length);
      if (extra.length > 0) {
        const { error: insErr } = await supabase.from('vehicle_photos').insert(
          extra.map((storage_path, offset) => ({
            company_id: company.id,
            vehicle_id: vehicleId,
            storage_path,
            sort_order: existing.length + offset,
          }))
        );
        if (insErr) throw new ApiError(insErr.message, 400);
      }
    }

    const { data: saved } = await supabase
      .from('vehicle_photos')
      .select('id, vehicle_id, storage_path, sort_order')
      .eq('vehicle_id', vehicleId)
      .eq('company_id', company.id)
      .order('sort_order', { ascending: true });

    return (saved || []) as T;
  }

  const vehExpensesMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/expenses$/);
  if (vehExpensesMatch && method === 'POST') {
    const { company } = await requireCompanyContext(false);
    const vehicleId = decodeURIComponent(vehExpensesMatch[1]);
    const description = String(body.description || '').trim();
    const category = String(body.category || '').trim();
    const amount = Number(body.amount);
    const expenseDate = String(body.expense_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const supplier = String(body.supplier || '').trim();

    if (!description || !VALID_CATEGORIES.has(category) || Number.isNaN(amount) || amount <= 0) {
      throw new ApiError('Informe descrição, categoria válida e valor maior que zero.', 400);
    }

    const { data: created, error } = await supabase
      .from('vehicle_expenses')
      .insert({
        company_id: company.id,
        vehicle_id: vehicleId,
        description,
        category,
        amount,
        expense_date: expenseDate,
        supplier,
      })
      .select('*')
      .single();

    if (error || !created) throw new ApiError(error?.message || 'Erro ao registrar despesa.', 400);
    return { ...created, amount: Number(created.amount) } as T;
  }

  const vehExpenseCancelMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/expenses\/([^/]+)\/cancel$/);
  if (vehExpenseCancelMatch && method === 'POST') {
    const { company } = await requireCompanyContext(false);
    const vehicleId = decodeURIComponent(vehExpenseCancelMatch[1]);
    const expenseId = decodeURIComponent(vehExpenseCancelMatch[2]);

    const { error } = await supabase
      .from('vehicle_expenses')
      .update({ canceled_at: new Date().toISOString() })
      .eq('id', expenseId)
      .eq('vehicle_id', vehicleId)
      .eq('company_id', company.id)
      .is('canceled_at', null);

    if (error) throw new ApiError(error.message, 400);
    return { ok: true } as T;
  }

  const vehSellMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/sell$/);
  if (vehSellMatch && method === 'POST') {
    const { company } = await requireCompanyContext(false);
    const vehicleId = decodeURIComponent(vehSellMatch[1]);

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, status')
      .eq('id', vehicleId)
      .eq('company_id', company.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!vehicle) throw new ApiError('Veículo não encontrado.', 404);
    if (vehicle.status === 'vendido') throw new ApiError('Este veículo já possui uma venda ativa.', 409);

    const saleDate = String(body.sale_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const salePrice = Number(body.sale_price);
    const buyerName = String(body.buyer_name || '').trim();
    const buyerPhone = String(body.buyer_phone || '').trim();
    const paymentMethod = String(body.payment_method || '').trim();
    const notes = String(body.notes || '').trim();

    if (!buyerName || Number.isNaN(salePrice) || salePrice <= 0) {
      throw new ApiError('Informe valor efetivo da venda e nome do comprador.', 400);
    }

    const { error } = await supabase.from('vehicle_sales').insert({
      company_id: company.id,
      vehicle_id: vehicle.id,
      sale_date: saleDate,
      sale_price: salePrice,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      payment_method: paymentMethod,
      notes,
    });

    if (error) throw new ApiError(error.message, 400);

    const { data: fin } = await supabase
      .from('v_vehicle_financials')
      .select('*')
      .eq('id', vehicle.id)
      .eq('company_id', company.id)
      .single();

    const [enriched] = await enrichVehicles(company.id, fin ? [fin] : []);
    return enriched as T;
  }

  const vehSaleCancelMatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/sales\/([^/]+)\/cancel$/);
  if (vehSaleCancelMatch && method === 'POST') {
    const { company } = await requireCompanyContext(false);
    const vehicleId = decodeURIComponent(vehSaleCancelMatch[1]);
    const saleId = decodeURIComponent(vehSaleCancelMatch[2]);

    const { error } = await supabase
      .from('vehicle_sales')
      .update({ canceled_at: new Date().toISOString() })
      .eq('id', saleId)
      .eq('vehicle_id', vehicleId)
      .eq('company_id', company.id)
      .is('canceled_at', null);

    if (error) throw new ApiError(error.message, 400);

    const { data: fin } = await supabase
      .from('v_vehicle_financials')
      .select('*')
      .eq('id', vehicleId)
      .eq('company_id', company.id)
      .single();

    const [enriched] = await enrichVehicles(company.id, fin ? [fin] : []);
    return enriched as T;
  }

  const vehDetailMatch = pathname.match(/^\/api\/vehicles\/([^/]+)$/);
  if (vehDetailMatch) {
    const vehicleId = decodeURIComponent(vehDetailMatch[1]);

    if (method === 'GET') {
      const { company } = await requireCompanyContext(true);
      const { data: fin } = await supabase
        .from('v_vehicle_financials')
        .select('*')
        .eq('id', vehicleId)
        .eq('company_id', company.id)
        .maybeSingle();

      if (!fin) throw new ApiError('Veículo não encontrado.', 404);

      const [[vehicle], { data: photos }, { data: expenses }, { data: sales }, { data: dailyStats }] = await Promise.all([
        enrichVehicles(company.id, [fin]),
        supabase
          .from('vehicle_photos')
          .select('id, vehicle_id, storage_path, sort_order')
          .eq('vehicle_id', vehicleId)
          .eq('company_id', company.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('vehicle_expenses')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('company_id', company.id)
          .order('expense_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('vehicle_sales')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('company_id', company.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('vehicle_daily_stats')
          .select('stat_date, views, whatsapp_clicks')
          .eq('vehicle_id', vehicleId)
          .eq('company_id', company.id)
          .order('stat_date', { ascending: false })
          .limit(30),
      ]);

      return {
        vehicle,
        photos: photos || [],
        expenses: (expenses || []).map((e: any) => ({ ...e, amount: Number(e.amount) })),
        sales: (sales || []).map((s: any) => ({ ...s, sale_price: Number(s.sale_price) })),
        daily_stats: dailyStats || [],
      } as T;
    }

    if (method === 'PATCH') {
      const { company } = await requireCompanyContext(false);
      const { data: current } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .eq('company_id', company.id)
        .is('deleted_at', null)
        .maybeSingle();

      if (!current) throw new ApiError('Veículo não encontrado.', 404);

      const nextStatus = body.status !== undefined ? String(body.status) : current.status;
      if (!VALID_STATUSES.has(nextStatus)) throw new ApiError('Status inválido.', 400);
      if (nextStatus === 'vendido' && current.status !== 'vendido') {
        throw new ApiError('Para marcar como vendido, registre a venda informando valor e comprador.', 400);
      }

      const announcedPrice =
        body.announced_price !== undefined ? Number(body.announced_price) : Number(current.announced_price);
      const purchasePrice =
        body.purchase_price !== undefined ? Number(body.purchase_price) : Number(current.purchase_price);
      const mileage = body.mileage !== undefined ? Number(body.mileage) : Number(current.mileage);

      if (announcedPrice < 0 || purchasePrice < 0 || mileage < 0) {
        throw new ApiError('Valores numéricos não podem ser negativos.', 400);
      }

      const { error } = await supabase
        .from('vehicles')
        .update({
          brand: String(body.brand ?? current.brand).trim(),
          model: String(body.model ?? current.model).trim(),
          version: String(body.version ?? current.version ?? '').trim(),
          manufacture_year: Number(body.manufacture_year ?? current.manufacture_year),
          model_year: Number(body.model_year ?? current.model_year),
          mileage,
          fuel: String(body.fuel ?? current.fuel).trim(),
          transmission: String(body.transmission ?? current.transmission).trim(),
          color: String(body.color ?? current.color ?? '').trim(),
          announced_price: announcedPrice,
          description: String(body.description ?? current.description ?? '').trim(),
          optionals: String(body.optionals ?? current.optionals ?? '').trim(),
          plate: String(body.plate ?? current.plate ?? '').trim().toUpperCase(),
          status: nextStatus,
          purchase_price: purchasePrice,
          purchase_date: String(body.purchase_date ?? current.purchase_date).slice(0, 10),
          purchased_from: String(body.purchased_from ?? current.purchased_from ?? '').trim(),
        })
        .eq('id', current.id)
        .eq('company_id', company.id);

      if (error) throw new ApiError(error.message, 400);

      const { data: fin } = await supabase
        .from('v_vehicle_financials')
        .select('*')
        .eq('id', current.id)
        .eq('company_id', company.id)
        .single();

      const [enriched] = await enrichVehicles(company.id, fin ? [fin] : []);
      return enriched as T;
    }

    if (method === 'DELETE') {
      const { company } = await requireCompanyContext(false);
      const { error } = await supabase
        .from('vehicles')
        .update({ deleted_at: new Date().toISOString(), status: 'inativo' })
        .eq('id', vehicleId)
        .eq('company_id', company.id)
        .is('deleted_at', null);

      if (error) throw new ApiError(error.message, 400);
      return { ok: true } as T;
    }
  }

  // =========================================================================
  // REMINDERS
  // =========================================================================
  if (pathname === '/api/reminders' && method === 'GET') {
    const { company, subscription, access } = await requireCompanyContext(true);
    const { data: rows, error } = await supabase
      .from('due_reminders')
      .select('*')
      .eq('company_id', company.id)
      .is('canceled_at', null)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message, 400);
    const labeled = await attachReminderVehicleLabels(company.id, rows || []);
    const formatted = labeled.sort((a: any, b: any) => {
      const aDone = a.completed_at ? 1 : 0;
      const bDone = b.completed_at ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return String(a.due_date).localeCompare(String(b.due_date));
    });

    let subscriptionAlert: {
      level: 'info' | 'warning' | 'danger';
      title: string;
      description: string;
      due_date: string | null;
    } | null = null;

    if (subscription) {
      if (subscription.status === 'suspended' || !access.has_access) {
        subscriptionAlert = {
          level: 'danger',
          title: 'Assinatura vencida — acesso suspenso',
          description: 'Regularize sua assinatura via Pix, boleto ou cartão para reativar a vitrine e os cadastros.',
          due_date: subscription.overdue_since || company?.trial_ends_at || null,
        };
      } else if (subscription.status === 'overdue') {
        subscriptionAlert = {
          level: 'danger',
          title: 'Pagamento da assinatura em atraso',
          description: `Regularize dentro do período de tolerância (${subscription.grace_days} dias) para não tirar sua vitrine do ar.`,
          due_date: subscription.overdue_since || null,
        };
      } else if (subscription.status === 'trialing') {
        subscriptionAlert = {
          level: access.days_left_in_trial <= 2 ? 'warning' : 'info',
          title:
            access.days_left_in_trial <= 1
              ? 'Último dia do período de teste grátis'
              : `Teste grátis termina em ${access.days_left_in_trial} dias`,
          description: 'Ative seu plano na aba Assinatura para manter a vitrine pública sem interrupção.',
          due_date: company?.trial_ends_at ? String(company.trial_ends_at).slice(0, 10) : null,
        };
      } else if (subscription.status === 'active' && subscription.current_period_end) {
        const daysToRenew = Math.ceil((new Date(subscription.current_period_end).getTime() - Date.now()) / 86400_000);
        if (daysToRenew <= 7) {
          subscriptionAlert = {
            level: 'info',
            title: `Próxima cobrança da assinatura em ${Math.max(0, daysToRenew)} dias`,
            description: 'Acompanhe a renovação automática do plano na página de Assinatura.',
            due_date: String(subscription.current_period_end).slice(0, 10),
          };
        }
      }
    }

    return { reminders: formatted, subscription_alert: subscriptionAlert } as T;
  }

  if (pathname === '/api/reminders' && method === 'POST') {
    const { company } = await requireCompanyContext(false);
    const title = String(body.title || '').trim();
    const category = String(body.category || 'outros').trim();
    const dueDate = String(body.due_date || '').slice(0, 10);
    const rawAmount = body.amount;
    const amount = rawAmount === '' || rawAmount === null || rawAmount === undefined ? null : Number(rawAmount);
    const vehicleId = body.vehicle_id ? String(body.vehicle_id).trim() : null;
    const notes = String(body.notes || '').trim();

    if (!title || !dueDate || !VALID_REMINDER_CATEGORIES.has(category)) {
      throw new ApiError('Informe título, categoria válida e data de vencimento.', 400);
    }
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      throw new ApiError('O valor informado não pode ser negativo.', 400);
    }

    const { data: created, error } = await supabase
      .from('due_reminders')
      .insert({
        company_id: company.id,
        vehicle_id: vehicleId,
        title,
        category,
        due_date: dueDate,
        amount,
        notes,
      })
      .select('*')
      .single();

    if (error || !created) throw new ApiError(error?.message || 'Erro ao criar lembrete.', 400);
    const [labeled] = await attachReminderVehicleLabels(company.id, [created]);
    return labeled as T;
  }

  const reminderActionMatch = pathname.match(/^\/api\/reminders\/([^/]+)\/(complete|cancel)$/);
  if (reminderActionMatch && method === 'POST') {
    const { company } = await requireCompanyContext(false);
    const reminderId = decodeURIComponent(reminderActionMatch[1]);
    const action = reminderActionMatch[2];
    const now = new Date().toISOString();

    const updatePayload = action === 'complete' ? { completed_at: now } : { canceled_at: now };
    const { error } = await supabase
      .from('due_reminders')
      .update(updatePayload)
      .eq('id', reminderId)
      .eq('company_id', company.id)
      .is('canceled_at', null);

    if (error) throw new ApiError(error.message, 400);
    return { ok: true } as T;
  }

  // =========================================================================
  // SUBSCRIPTION & ASAAS
  // =========================================================================
  if (pathname === '/api/subscription' && method === 'GET') {
    const { subscription } = await requireCompanyContext(true);
    return { subscription } as T;
  }

  if (pathname === '/api/subscription/checkout' && method === 'POST') {
    const { company } = await requireCompanyContext(true);
    return invokeEdgeFunctionOrLocalFallback<T>(
      {
        action: 'create',
        company_id: company.id,
        payment_method: body.payment_method || 'PIX',
        customer_name: body.customer_name || company.name,
        customer_cpf_cnpj: body.cpf_cnpj,
      },
      '/api/subscription/checkout',
      body
    );
  }

  if (pathname === '/api/subscription/cancel' && method === 'POST') {
    const { company } = await requireCompanyContext(true);
    return invokeEdgeFunctionOrLocalFallback<T>(
      {
        action: 'cancel',
        company_id: company.id,
      },
      '/api/subscription/cancel',
      {}
    );
  }

  // =========================================================================
  // PUBLIC VITRINE (ANONYMOUS VIEWS & RPC)
  // =========================================================================
  const publicTrackMatch = pathname.match(/^\/api\/public\/garages\/([^/]+)\/vehicles\/([^/]+)\/track$/);
  if (publicTrackMatch && method === 'POST') {
    const garageSlug = decodeURIComponent(publicTrackMatch[1]);
    const carSlug = decodeURIComponent(publicTrackMatch[2]);
    const eventType = String(body.type || '');
    if (eventType === 'view' || eventType === 'whatsapp_click') {
      await supabase.rpc('track_public_vehicle_event', {
        p_company_slug: garageSlug,
        p_vehicle_slug: carSlug,
        p_event_type: eventType,
      });
    }
    return { ok: true } as T;
  }

  const publicVehicleMatch = pathname.match(/^\/api\/public\/garages\/([^/]+)\/vehicles\/([^/]+)$/);
  if (publicVehicleMatch && method === 'GET') {
    const garageSlug = decodeURIComponent(publicVehicleMatch[1]);
    const carSlug = decodeURIComponent(publicVehicleMatch[2]);

    const [{ data: companyRaw }, { data: vehicleRaw }] = await Promise.all([
      supabase.from('public_companies_view').select('*').eq('slug', garageSlug).maybeSingle(),
      supabase
        .from('public_vehicles_view')
        .select('*')
        .eq('company_slug', garageSlug)
        .eq('slug', carSlug)
        .maybeSingle(),
    ]);

    if (!companyRaw) {
      throw new ApiError('Vitrine não encontrada ou temporariamente fora do ar.', 404);
    }
    if (!vehicleRaw) {
      throw new ApiError('Veículo não disponível.', 404);
    }

    return {
      company: normalizeCompany(companyRaw),
      vehicle: {
        ...vehicleRaw,
        announced_price: Number(vehicleRaw.announced_price ?? 0),
        mileage: Number(vehicleRaw.mileage ?? 0),
        manufacture_year: Number(vehicleRaw.manufacture_year),
        model_year: Number(vehicleRaw.model_year),
        photos: Array.isArray(vehicleRaw.photos) ? vehicleRaw.photos : [],
      },
    } as T;
  }

  const publicGarageMatch = pathname.match(/^\/api\/public\/garages\/([^/]+)$/);
  if (publicGarageMatch && method === 'GET') {
    const garageSlug = decodeURIComponent(publicGarageMatch[1]);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const minYear = Number(url.searchParams.get('minYear') || 0);
    const maxPrice = Number(url.searchParams.get('maxPrice') || 0);

    const { data: companyRaw } = await supabase
      .from('public_companies_view')
      .select('*')
      .eq('slug', garageSlug)
      .maybeSingle();

    if (!companyRaw) {
      throw new ApiError('Vitrine não encontrada ou temporariamente fora do ar.', 404);
    }

    const { data: vehiclesRaw } = await supabase
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

    if (q) {
      vehicles = vehicles.filter((v: any) => `${v.brand} ${v.model} ${v.version}`.toLowerCase().includes(q));
    }
    if (minYear > 0) {
      vehicles = vehicles.filter((v: any) => v.model_year >= minYear);
    }
    if (maxPrice > 0) {
      vehicles = vehicles.filter((v: any) => v.announced_price <= maxPrice);
    }

    return {
      company: normalizeCompany(companyRaw),
      vehicles,
    } as T;
  }

  throw new ApiError(`Endpoint não suportado no cliente: ${method} ${pathname}`, 404);
}
