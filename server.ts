import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { db, hashPassword, verifyPassword, slugify, initSchemaAndSeed } from './src/server/db.ts';

initSchemaAndSeed();

const PORT = 3000;
const SESSION_SECRET = process.env.AUTH_SESSION_SECRET || 'dev-cs22-garage-session-secret';
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || 'cs22_sandbox_webhook_token';
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ASAAS_BASE_URL =
  process.env.ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';

interface AuthPayload {
  sub: string;
  email: string;
  exp: number;
}

interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
  companyId?: string;
  memberRole?: string;
  hasActiveAccess?: boolean;
}

function signToken(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token: string): AuthPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthPayload;
    if (!decoded.sub || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function computeSubscriptionState(company: any, sub: any) {
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

function writeAuditLog(
  companyId: string,
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string | null,
  beforeData: unknown,
  afterData: unknown
) {
  db.prepare(`
    INSERT INTO audit_logs (id, company_id, user_id, action, table_name, record_id, before_data, after_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    companyId,
    userId,
    action,
    tableName,
    recordId,
    beforeData ? JSON.stringify(beforeData) : null,
    afterData ? JSON.stringify(afterData) : null
  );
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sessão não informada. Faça login novamente.' });
    return;
  }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: 'Sessão expirada ou inválida.' });
    return;
  }
  const user = db.prepare('SELECT id, email, name, email_verified FROM users WHERE id = ?').get(payload.sub) as any;
  if (!user) {
    res.status(401).json({ error: 'Usuário não encontrado.' });
    return;
  }
  req.userId = user.id;
  req.userEmail = user.email;
  next();
}

function requireCompany(allowSuspended = false) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    const membership = db.prepare(`
      SELECT cm.company_id, cm.role
      FROM company_members cm
      WHERE cm.user_id = ?
      ORDER BY cm.created_at ASC
      LIMIT 1
    `).get(req.userId) as any;

    if (!membership) {
      res.status(404).json({ error: 'Garagem não cadastrada.', code: 'NO_COMPANY' });
      return;
    }

    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(membership.company_id) as any;
    const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(membership.company_id) as any;
    const access = computeSubscriptionState(company, sub);

    req.companyId = membership.company_id;
    req.memberRole = membership.role;
    req.hasActiveAccess = access.has_access;

    if (!allowSuspended && !access.has_access) {
      res.status(402).json({
        error: 'Assinatura suspensa ou período de teste encerrado. Regularize o pagamento para liberar o acesso.',
        code: 'SUBSCRIPTION_SUSPENDED',
      });
      return;
    }
    next();
  };
}

// Simple in-memory rate limiter for public showcase routes & click counters
const rateMap = new Map<string, { count: number; resetAt: number }>();
function rateLimitPublic(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const current = rateMap.get(key);
    if (!current || current.resetAt < now) {
      rateMap.set(key, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    if (current.count >= maxPerMinute) {
      res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
      return;
    }
    current.count += 1;
    next();
  };
}

const VALID_STATUSES = new Set(['disponivel', 'reservado', 'vendido', 'inativo']);
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // ===========================================================================
  // AUTH ROUTES
  // ===========================================================================
  app.post('/api/auth/register', (req, res) => {
    const { email, password, name } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();
    const cleanPassword = String(password || '');

    if (!cleanEmail.includes('@') || cleanName.length < 2 || cleanPassword.length < 6) {
      res.status(400).json({ error: 'Informe nome, e-mail válido e senha com ao menos 6 caracteres.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'Já existe uma conta cadastrada com este e-mail.' });
      return;
    }

    const userId = crypto.randomUUID();
    const verificationToken = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified, verification_token)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(userId, cleanEmail, cleanName, hashPassword(cleanPassword), verificationToken);

    res.status(201).json({
      message: 'Conta criada. Confirme seu e-mail para entrar.',
      email: cleanEmail,
      verification_token: verificationToken,
    });
  });

  app.post('/api/auth/confirm-email', (req, res) => {
    const { email, token } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanToken = String(token || '').trim();

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
    if (!user) {
      res.status(404).json({ error: 'Conta não encontrada.' });
      return;
    }
    if (user.email_verified) {
      res.json({ ok: true, message: 'E-mail já confirmado.' });
      return;
    }
    if (!cleanToken || user.verification_token !== cleanToken) {
      res.status(400).json({ error: 'Código de confirmação inválido.' });
      return;
    }

    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);
    const jwt = signToken(user.id, user.email);
    res.json({
      ok: true,
      token: jwt,
      user: { id: user.id, email: user.email, name: user.name, email_verified: true },
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
    if (!user || !verifyPassword(cleanPassword, user.password_hash)) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    if (!user.email_verified) {
      res.status(403).json({
        error: 'Confirme seu e-mail antes de acessar o painel.',
        code: 'EMAIL_NOT_VERIFIED',
        verification_token: user.verification_token,
      });
      return;
    }

    const token = signToken(user.id, user.email);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        email_verified: Boolean(user.email_verified),
      },
    });
  });

  app.post('/api/auth/request-reset', (req, res) => {
    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(cleanEmail) as any;
    if (!user) {
      res.json({ message: 'Se o e-mail existir, enviamos um código de recuperação.' });
      return;
    }
    const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    db.prepare('UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?').run(
      resetToken,
      expiresAt,
      user.id
    );
    res.json({
      message: 'Código de recuperação gerado.',
      reset_token: resetToken,
    });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    const token = String(req.body?.token || '').trim().toUpperCase();
    const newPassword = String(req.body?.new_password || '');

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
    if (!user || !user.reset_token || user.reset_token !== token) {
      res.status(400).json({ error: 'Código de recuperação inválido.' });
      return;
    }
    if (user.reset_expires_at && new Date(user.reset_expires_at).getTime() < Date.now()) {
      res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
      return;
    }

    db.prepare(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL WHERE id = ?'
    ).run(hashPassword(newPassword), user.id);

    res.json({ ok: true, message: 'Senha atualizada com sucesso.' });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const user = db
      .prepare('SELECT id, email, name, email_verified FROM users WHERE id = ?')
      .get(req.userId!) as any;

    const membership = db.prepare(`
      SELECT cm.company_id, cm.role
      FROM company_members cm
      WHERE cm.user_id = ?
      ORDER BY cm.created_at ASC
      LIMIT 1
    `).get(req.userId!) as any;

    if (!membership) {
      res.json({
        user: { ...user, email_verified: Boolean(user.email_verified) },
        company: null,
        subscription: null,
      });
      return;
    }

    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(membership.company_id) as any;
    const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(membership.company_id) as any;
    const access = computeSubscriptionState(company, sub);

    res.json({
      user: { ...user, email_verified: Boolean(user.email_verified) },
      company: {
        ...company,
        show_sold: Boolean(company.show_sold),
      },
      subscription: sub
        ? {
            ...sub,
            has_access: access.has_access,
            days_left_in_trial: access.days_left_in_trial,
          }
        : null,
    });
  });

  // ===========================================================================
  // COMPANY ONBOARDING & SETTINGS
  // ===========================================================================
  app.get('/api/companies/check-slug/:slug', requireAuth, (req, res) => {
    const candidate = slugify(req.params.slug);
    const existing = db.prepare('SELECT id FROM companies WHERE slug = ?').get(candidate);
    res.json({ slug: candidate, available: !existing });
  });

  app.post('/api/companies', requireAuth, (req: AuthedRequest, res) => {
    const existingMembership = db
      .prepare('SELECT company_id FROM company_members WHERE user_id = ?')
      .get(req.userId!);
    if (existingMembership) {
      res.status(409).json({ error: 'Você já possui uma garagem vinculada.' });
      return;
    }

    const name = String(req.body?.name || '').trim();
    const rawSlug = String(req.body?.slug || name).trim();
    const slug = slugify(rawSlug);
    const whatsapp = String(req.body?.whatsapp || '').replace(/\D/g, '');
    const instagram = String(req.body?.instagram || '').trim();
    const address = String(req.body?.address || '').trim();
    const logoUrl = String(req.body?.logo_url || '').trim();

    if (name.length < 2 || whatsapp.length < 10 || slug.length < 2) {
      res.status(400).json({ error: 'Informe nome da garagem, endereço do link e WhatsApp com DDD.' });
      return;
    }

    const slugTaken = db.prepare('SELECT id FROM companies WHERE slug = ?').get(slug);
    if (slugTaken) {
      res.status(409).json({ error: 'Este endereço de vitrine já está em uso. Escolha outro.' });
      return;
    }

    const companyId = crypto.randomUUID();
    const trialEndsAt = new Date(Date.now() + 7 * 86400_000).toISOString();

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO companies (id, name, slug, whatsapp, instagram, address, logo_url, trial_ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(companyId, name, slug, whatsapp, instagram, address, logoUrl, trialEndsAt);

      db.prepare(`
        INSERT INTO company_members (id, company_id, user_id, role)
        VALUES (?, ?, ?, 'owner')
      `).run(crypto.randomUUID(), companyId, req.userId!);

      db.prepare(`
        INSERT INTO subscriptions (id, company_id, plan_code, monthly_price, status, grace_days)
        VALUES (?, ?, 'mensal_5990', 59.90, 'trialing', 5)
      `).run(crypto.randomUUID(), companyId);

      writeAuditLog(companyId, req.userId!, 'company_created', 'companies', companyId, null, { name, slug });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId) as any;
    res.status(201).json({ ...company, show_sold: Boolean(company.show_sold) });
  });

  app.patch('/api/companies/current', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const current = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId!) as any;
    const name = String(req.body?.name ?? current.name).trim();
    const newSlug = req.body?.slug !== undefined ? slugify(String(req.body.slug)) : current.slug;
    const whatsapp = String(req.body?.whatsapp ?? current.whatsapp).replace(/\D/g, '');
    const instagram = String(req.body?.instagram ?? current.instagram).trim();
    const address = String(req.body?.address ?? current.address).trim();
    const logoUrl = String(req.body?.logo_url ?? current.logo_url).trim();
    const coverUrl = String(req.body?.cover_url ?? current.cover_url).trim();
    const showSold = req.body?.show_sold !== undefined ? (req.body.show_sold ? 1 : 0) : current.show_sold;

    if (name.length < 2 || whatsapp.length < 10 || newSlug.length < 2) {
      res.status(400).json({ error: 'Nome, slug e WhatsApp válidos são obrigatórios.' });
      return;
    }
    if (newSlug !== current.slug) {
      const taken = db.prepare('SELECT id FROM companies WHERE slug = ? AND id != ?').get(newSlug, current.id);
      if (taken) {
        res.status(409).json({ error: 'Este endereço de vitrine já está sendo usado por outra garagem.' });
        return;
      }
    }

    db.prepare(`
      UPDATE companies
      SET name = ?, slug = ?, whatsapp = ?, instagram = ?, address = ?, logo_url = ?, cover_url = ?, show_sold = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, newSlug, whatsapp, instagram, address, logoUrl, coverUrl, showSold, req.companyId!);

    writeAuditLog(
      req.companyId!,
      req.userId!,
      'company_updated',
      'companies',
      req.companyId!,
      { name: current.name, slug: current.slug, show_sold: Boolean(current.show_sold) },
      { name, slug: newSlug, show_sold: Boolean(showSold) }
    );

    const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId!) as any;
    res.json({ ...updated, show_sold: Boolean(updated.show_sold) });
  });

  // ===========================================================================
  // DASHBOARD (5 METRICS + STALLED VEHICLES > 60 DAYS) — COMPUTED IN SQL
  // ===========================================================================
  app.get('/api/dashboard', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const monthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM

    const metrics = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'disponivel' THEN 1 ELSE 0 END) AS available_count,
        SUM(CASE WHEN status = 'vendido' AND substr(sale_date, 1, 7) = ? THEN 1 ELSE 0 END) AS sold_this_month_count,
        COALESCE(SUM(CASE WHEN status = 'vendido' AND substr(sale_date, 1, 7) = ? THEN profit ELSE 0 END), 0) AS month_profit,
        COALESCE(SUM(CASE WHEN status IN ('disponivel', 'reservado', 'inativo') THEN total_cost ELSE 0 END), 0) AS tied_up_capital,
        COALESCE(CAST(ROUND(AVG(days_in_stock)) AS INTEGER), 0) AS avg_days_in_stock
      FROM v_vehicle_financials
      WHERE company_id = ?
    `).get(monthPrefix, monthPrefix, req.companyId!) as any;

    const stalledVehicles = db.prepare(`
      SELECT *
      FROM v_vehicle_financials
      WHERE company_id = ?
        AND status IN ('disponivel', 'reservado', 'inativo')
        AND days_in_stock > 60
      ORDER BY days_in_stock DESC
    `).all(req.companyId!);

    res.json({
      available_count: metrics?.available_count ?? 0,
      sold_this_month_count: metrics?.sold_this_month_count ?? 0,
      month_profit: metrics?.month_profit ?? 0,
      tied_up_capital: metrics?.tied_up_capital ?? 0,
      avg_days_in_stock: metrics?.avg_days_in_stock ?? 0,
      stalled_vehicles: stalledVehicles,
    });
  });

  // ===========================================================================
  // VEHICLES, PHOTOS, EXPENSES, SALES (MULTI-TENANT ISOLATED BY company_id)
  // ===========================================================================
  app.get('/api/vehicles', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const statusFilter = String(req.query.status || '').trim();
    const search = String(req.query.q || '').trim().toLowerCase();

    let rows = db.prepare(`
      SELECT *
      FROM v_vehicle_financials
      WHERE company_id = ?
      ORDER BY created_at DESC
    `).all(req.companyId!) as any[];

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

    res.json(rows);
  });

  app.post('/api/vehicles', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const body = req.body || {};
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

    if (!brand || !model || Number.isNaN(manufactureYear) || Number.isNaN(modelYear) || Number.isNaN(announcedPrice) || announcedPrice < 0 || purchasePrice < 0 || mileage < 0) {
      res.status(400).json({ error: 'Preencha marca, modelo, anos, valor de compra e preço anunciado válidos.' });
      return;
    }

    const baseSlug = slugify(`${brand}-${model}-${modelYear}`);
    let slug = baseSlug;
    let suffix = 2;
    while (db.prepare('SELECT id FROM vehicles WHERE company_id = ? AND slug = ?').get(req.companyId!, slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const vehicleId = crypto.randomUUID();

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO vehicles (
          id, company_id, brand, model, version, manufacture_year, model_year,
          mileage, fuel, transmission, color, announced_price, description, optionals,
          plate, slug, status, purchase_price, purchase_date, purchased_from
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        vehicleId, req.companyId!, brand, model, version, manufactureYear, modelYear,
        mileage, fuel, transmission, color, announcedPrice, description, optionals,
        plate, slug, status, purchasePrice, purchaseDate, purchasedFrom
      );

      const insertPhoto = db.prepare(`
        INSERT INTO vehicle_photos (id, company_id, vehicle_id, storage_path, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `);
      photos.forEach((photoPath, idx) => {
        if (typeof photoPath === 'string' && photoPath.length > 0) {
          insertPhoto.run(crypto.randomUUID(), req.companyId!, vehicleId, photoPath, idx);
        }
      });

      writeAuditLog(req.companyId!, req.userId!, 'vehicle_created', 'vehicles', vehicleId, null, {
        brand,
        model,
        announced_price: announcedPrice,
        purchase_price: purchasePrice,
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const created = db
      .prepare('SELECT * FROM v_vehicle_financials WHERE id = ? AND company_id = ?')
      .get(vehicleId, req.companyId!);
    res.status(201).json(created);
  });

  app.get('/api/vehicles/:id', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const vehicle = db
      .prepare('SELECT * FROM v_vehicle_financials WHERE id = ? AND company_id = ?')
      .get(req.params.id, req.companyId!) as any;

    if (!vehicle) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }

    const photos = db
      .prepare('SELECT id, vehicle_id, storage_path, sort_order FROM vehicle_photos WHERE vehicle_id = ? AND company_id = ? ORDER BY sort_order ASC')
      .all(vehicle.id, req.companyId!);

    const expenses = db
      .prepare('SELECT * FROM vehicle_expenses WHERE vehicle_id = ? AND company_id = ? ORDER BY expense_date DESC, created_at DESC')
      .all(vehicle.id, req.companyId!);

    const sales = db
      .prepare('SELECT * FROM vehicle_sales WHERE vehicle_id = ? AND company_id = ? ORDER BY created_at DESC')
      .all(vehicle.id, req.companyId!);

    const dailyStats = db
      .prepare('SELECT stat_date, views, whatsapp_clicks FROM vehicle_daily_stats WHERE vehicle_id = ? AND company_id = ? ORDER BY stat_date DESC LIMIT 30')
      .all(vehicle.id, req.companyId!);

    res.json({ vehicle, photos, expenses, sales, daily_stats: dailyStats });
  });

  app.patch('/api/vehicles/:id', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const current = db
      .prepare('SELECT * FROM vehicles WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
      .get(req.params.id, req.companyId!) as any;

    if (!current) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }

    const body = req.body || {};
    const nextStatus = body.status !== undefined ? String(body.status) : current.status;
    if (!VALID_STATUSES.has(nextStatus)) {
      res.status(400).json({ error: 'Status inválido.' });
      return;
    }
    if (nextStatus === 'vendido' && current.status !== 'vendido') {
      res.status(400).json({ error: 'Para marcar como vendido, registre a venda informando valor e comprador.' });
      return;
    }

    const announcedPrice = body.announced_price !== undefined ? Number(body.announced_price) : current.announced_price;
    const purchasePrice = body.purchase_price !== undefined ? Number(body.purchase_price) : current.purchase_price;
    const mileage = body.mileage !== undefined ? Number(body.mileage) : current.mileage;

    if (announcedPrice < 0 || purchasePrice < 0 || mileage < 0) {
      res.status(400).json({ error: 'Valores numéricos não podem ser negativos.' });
      return;
    }

    db.prepare(`
      UPDATE vehicles
      SET brand = ?, model = ?, version = ?, manufacture_year = ?, model_year = ?,
          mileage = ?, fuel = ?, transmission = ?, color = ?, announced_price = ?,
          description = ?, optionals = ?, plate = ?, status = ?,
          purchase_price = ?, purchase_date = ?, purchased_from = ?, updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `).run(
      String(body.brand ?? current.brand).trim(),
      String(body.model ?? current.model).trim(),
      String(body.version ?? current.version).trim(),
      Number(body.manufacture_year ?? current.manufacture_year),
      Number(body.model_year ?? current.model_year),
      mileage,
      String(body.fuel ?? current.fuel).trim(),
      String(body.transmission ?? current.transmission).trim(),
      String(body.color ?? current.color).trim(),
      announcedPrice,
      String(body.description ?? current.description).trim(),
      String(body.optionals ?? current.optionals).trim(),
      String(body.plate ?? current.plate).trim().toUpperCase(),
      nextStatus,
      purchasePrice,
      String(body.purchase_date ?? current.purchase_date).slice(0, 10),
      String(body.purchased_from ?? current.purchased_from).trim(),
      current.id,
      req.companyId!
    );

    const updated = db
      .prepare('SELECT * FROM v_vehicle_financials WHERE id = ? AND company_id = ?')
      .get(current.id, req.companyId!);
    res.json(updated);
  });

  app.delete('/api/vehicles/:id', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const current = db
      .prepare('SELECT * FROM vehicles WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
      .get(req.params.id, req.companyId!) as any;
    if (!current) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }

    db.prepare("UPDATE vehicles SET deleted_at = datetime('now'), status = 'inativo' WHERE id = ? AND company_id = ?").run(
      current.id,
      req.companyId!
    );
    writeAuditLog(req.companyId!, req.userId!, 'vehicle_soft_deleted', 'vehicles', current.id, { status: current.status }, { deleted: true });
    res.json({ ok: true });
  });

  app.put('/api/vehicles/:id/photos', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const current = db
      .prepare('SELECT id FROM vehicles WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
      .get(req.params.id, req.companyId!) as any;
    if (!current) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }

    const photos: string[] = Array.isArray(req.body?.photos) ? req.body.photos.slice(0, 10) : [];
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM vehicle_photos WHERE vehicle_id = ? AND company_id = ?').run(current.id, req.companyId!);
      const insert = db.prepare(`
        INSERT INTO vehicle_photos (id, company_id, vehicle_id, storage_path, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `);
      photos.forEach((p, idx) => {
        if (typeof p === 'string' && p.length > 0) {
          insert.run(crypto.randomUUID(), req.companyId!, current.id, p, idx);
        }
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const saved = db
      .prepare('SELECT id, vehicle_id, storage_path, sort_order FROM vehicle_photos WHERE vehicle_id = ? AND company_id = ? ORDER BY sort_order ASC')
      .all(current.id, req.companyId!);
    res.json(saved);
  });

  // ===========================================================================
  // EXPENSES (SOFT CANCEL ONLY)
  // ===========================================================================
  app.post('/api/vehicles/:id/expenses', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const vehicle = db
      .prepare('SELECT id FROM vehicles WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
      .get(req.params.id, req.companyId!) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }

    const description = String(req.body?.description || '').trim();
    const category = String(req.body?.category || '').trim();
    const amount = Number(req.body?.amount);
    const expenseDate = String(req.body?.expense_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const supplier = String(req.body?.supplier || '').trim();

    if (!description || !VALID_CATEGORIES.has(category) || Number.isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'Informe descrição, categoria válida e valor maior que zero.' });
      return;
    }

    const expenseId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO vehicle_expenses (id, company_id, vehicle_id, description, category, amount, expense_date, supplier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(expenseId, req.companyId!, vehicle.id, description, category, amount, expenseDate, supplier);

    const created = db.prepare('SELECT * FROM vehicle_expenses WHERE id = ?').get(expenseId);
    res.status(201).json(created);
  });

  app.post('/api/vehicles/:id/expenses/:expenseId/cancel', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const expense = db
      .prepare('SELECT * FROM vehicle_expenses WHERE id = ? AND vehicle_id = ? AND company_id = ? AND canceled_at IS NULL')
      .get(req.params.expenseId, req.params.id, req.companyId!) as any;
    if (!expense) {
      res.status(404).json({ error: 'Despesa não encontrada ou já cancelada.' });
      return;
    }

    db.prepare("UPDATE vehicle_expenses SET canceled_at = datetime('now') WHERE id = ? AND company_id = ?").run(
      expense.id,
      req.companyId!
    );
    writeAuditLog(req.companyId!, req.userId!, 'expense_canceled', 'vehicle_expenses', expense.id, expense, { canceled: true });
    res.json({ ok: true });
  });

  // ===========================================================================
  // SALES (REGISTER & CANCEL WITH PREVIOUS STATUS RESTORE)
  // ===========================================================================
  app.post('/api/vehicles/:id/sell', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const vehicle = db
      .prepare('SELECT * FROM vehicles WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
      .get(req.params.id, req.companyId!) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }
    if (vehicle.status === 'vendido') {
      res.status(409).json({ error: 'Este veículo já possui uma venda ativa.' });
      return;
    }

    const saleDate = String(req.body?.sale_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const salePrice = Number(req.body?.sale_price);
    const buyerName = String(req.body?.buyer_name || '').trim();
    const buyerPhone = String(req.body?.buyer_phone || '').trim();
    const paymentMethod = String(req.body?.payment_method || '').trim();
    const notes = String(req.body?.notes || '').trim();

    if (!buyerName || Number.isNaN(salePrice) || salePrice <= 0) {
      res.status(400).json({ error: 'Informe valor efetivo da venda e nome do comprador.' });
      return;
    }

    const saleId = crypto.randomUUID();
    const previousStatus = vehicle.status === 'vendido' ? 'disponivel' : vehicle.status;

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO vehicle_sales (id, company_id, vehicle_id, sale_date, sale_price, buyer_name, buyer_phone, payment_method, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(saleId, req.companyId!, vehicle.id, saleDate, salePrice, buyerName, buyerPhone, paymentMethod, notes);

      db.prepare(`
        UPDATE vehicles
        SET status = 'vendido', previous_status = ?, updated_at = datetime('now')
        WHERE id = ? AND company_id = ?
      `).run(previousStatus, vehicle.id, req.companyId!);

      writeAuditLog(
        req.companyId!,
        req.userId!,
        'vehicle_sold',
        'vehicle_sales',
        saleId,
        { status: previousStatus },
        { status: 'vendido', sale_price: salePrice, buyer_name: buyerName, sale_date: saleDate }
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const updatedVehicle = db
      .prepare('SELECT * FROM v_vehicle_financials WHERE id = ? AND company_id = ?')
      .get(vehicle.id, req.companyId!);
    res.status(201).json(updatedVehicle);
  });

  app.post('/api/vehicles/:id/sales/:saleId/cancel', requireAuth, requireCompany(), (req: AuthedRequest, res) => {
    const vehicle = db
      .prepare('SELECT * FROM vehicles WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
      .get(req.params.id, req.companyId!) as any;
    const sale = db
      .prepare('SELECT * FROM vehicle_sales WHERE id = ? AND vehicle_id = ? AND company_id = ? AND canceled_at IS NULL')
      .get(req.params.saleId, req.params.id, req.companyId!) as any;

    if (!vehicle || !sale) {
      res.status(404).json({ error: 'Venda ativa não encontrada.' });
      return;
    }

    const restoreStatus =
      vehicle.previous_status && ['disponivel', 'reservado', 'inativo'].includes(vehicle.previous_status)
        ? vehicle.previous_status
        : 'disponivel';

    db.exec('BEGIN');
    try {
      db.prepare("UPDATE vehicle_sales SET canceled_at = datetime('now') WHERE id = ? AND company_id = ?").run(
        sale.id,
        req.companyId!
      );
      db.prepare("UPDATE vehicles SET status = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?").run(
        restoreStatus,
        vehicle.id,
        req.companyId!
      );
      writeAuditLog(
        req.companyId!,
        req.userId!,
        'sale_canceled',
        'vehicle_sales',
        sale.id,
        { status: 'vendido', sale_price: sale.sale_price },
        { status: restoreStatus, canceled: true }
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const updatedVehicle = db
      .prepare('SELECT * FROM v_vehicle_financials WHERE id = ? AND company_id = ?')
      .get(vehicle.id, req.companyId!);
    res.json(updatedVehicle);
  });

  // ===========================================================================
  // SUBSCRIPTION & ASAAS WEBHOOK FLOW
  // ===========================================================================
  app.get('/api/subscription', requireAuth, requireCompany(true), (req: AuthedRequest, res) => {
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId!) as any;
    const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(req.companyId!) as any;
    const access = computeSubscriptionState(company, sub);

    const events = db
      .prepare('SELECT id, event_id, event_type, processed_at, error_message, created_at FROM asaas_events ORDER BY created_at DESC LIMIT 10')
      .all();

    const audits = db
      .prepare('SELECT id, action, table_name, record_id, before_data, after_data, created_at FROM audit_logs WHERE company_id = ? ORDER BY created_at DESC LIMIT 15')
      .all(req.companyId!);

    res.json({
      subscription: {
        ...sub,
        has_access: access.has_access,
        days_left_in_trial: access.days_left_in_trial,
      },
      events,
      audit_logs: audits,
    });
  });

  app.post('/api/subscription/checkout', requireAuth, requireCompany(true), async (req: AuthedRequest, res) => {
    const planCode = String(req.body?.plan_code || 'mensal_5990');
    const paymentMethod = String(req.body?.payment_method || 'PIX');
    const customerName = String(req.body?.customer_name || '').trim();
    const cpfCnpj = String(req.body?.cpf_cnpj || '').replace(/\D/g, '');

    const PLAN_PRICES: Record<string, { value: number; cycle: string; label: string }> = {
      fundador_3990: { value: 39.9, cycle: 'MONTHLY', label: 'CS22 Garage Fundador' },
      mensal_5990: { value: 59.9, cycle: 'MONTHLY', label: 'CS22 Garage Mensal' },
      anual_599: { value: 599.0, cycle: 'YEARLY', label: 'CS22 Garage Anual' },
    };

    const plan = PLAN_PRICES[planCode];
    if (!plan || !['PIX', 'BOLETO', 'CREDIT_CARD'].includes(paymentMethod)) {
      res.status(400).json({ error: 'Plano ou forma de pagamento inválidos.' });
      return;
    }

    let asaasCustomerId = `cus_sbx_${crypto.randomBytes(6).toString('hex')}`;
    let asaasSubscriptionId = `sub_sbx_${crypto.randomBytes(6).toString('hex')}`;
    let invoiceUrl: string | null = null;

    if (ASAAS_API_KEY) {
      try {
        const custRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', access_token: ASAAS_API_KEY },
          body: JSON.stringify({
            name: customerName || 'Garagem CS22',
            email: req.userEmail,
            cpfCnpj: cpfCnpj || undefined,
            externalReference: req.companyId,
          }),
        });
        const custJson = (await custRes.json()) as any;
        if (custRes.ok && custJson.id) {
          asaasCustomerId = custJson.id;
          const subRes = await fetch(`${ASAAS_BASE_URL}/subscriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', access_token: ASAAS_API_KEY },
            body: JSON.stringify({
              customer: asaasCustomerId,
              billingType: paymentMethod,
              value: plan.value,
              nextDueDate: new Date().toISOString().slice(0, 10),
              cycle: plan.cycle,
              description: plan.label,
              externalReference: req.companyId,
            }),
          });
          const subJson = (await subRes.json()) as any;
          if (subRes.ok && subJson.id) {
            asaasSubscriptionId = subJson.id;
            invoiceUrl = subJson.invoiceUrl ?? null;
          }
        }
      } catch (err) {
        console.error('Asaas API fallback to sandbox checkout:', err);
      }
    }

    // Importante (PRD): checkout NUNCA libera assinatura por si só; apenas grava IDs do Asaas e aguarda webhook
    db.prepare(`
      UPDATE subscriptions
      SET asaas_customer_id = ?, asaas_subscription_id = ?, plan_code = ?, payment_method = ?, monthly_price = ?, updated_at = datetime('now')
      WHERE company_id = ?
    `).run(asaasCustomerId, asaasSubscriptionId, planCode, paymentMethod, plan.value, req.companyId!);

    writeAuditLog(req.companyId!, req.userId!, 'subscription_checkout_created', 'subscriptions', req.companyId!, null, {
      plan_code: planCode,
      payment_method: paymentMethod,
      asaas_subscription_id: asaasSubscriptionId,
    });

    res.json({
      asaas_customer_id: asaasCustomerId,
      asaas_subscription_id: asaasSubscriptionId,
      invoice_url: invoiceUrl,
      status: 'pending_webhook_confirmation',
      message: 'Assinatura criada no Asaas. A liberação ocorre automaticamente assim que o webhook confirmar o pagamento.',
    });
  });

  app.post('/api/subscription/cancel', requireAuth, requireCompany(true), async (req: AuthedRequest, res) => {
    const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(req.companyId!) as any;
    if (!sub) {
      res.status(404).json({ error: 'Assinatura não encontrada.' });
      return;
    }

    if (ASAAS_API_KEY && sub.asaas_subscription_id && !sub.asaas_subscription_id.startsWith('sub_sbx_')) {
      try {
        await fetch(`${ASAAS_BASE_URL}/subscriptions/${sub.asaas_subscription_id}`, {
          method: 'DELETE',
          headers: { access_token: ASAAS_API_KEY },
        });
      } catch (err) {
        console.error('Erro ao cancelar assinatura no Asaas:', err);
      }
    }

    const periodEnd = sub.current_period_end || new Date(Date.now() + 7 * 86400_000).toISOString();
    db.prepare(`
      UPDATE subscriptions
      SET status = 'canceled', canceled_at = datetime('now'), current_period_end = ?, updated_at = datetime('now')
      WHERE company_id = ?
    `).run(periodEnd, req.companyId!);

    writeAuditLog(
      req.companyId!,
      req.userId!,
      'subscription_canceled',
      'subscriptions',
      sub.id,
      { status: sub.status },
      { status: 'canceled', current_period_end: periodEnd }
    );

    res.json({ ok: true, message: 'Assinatura cancelada. Acesso mantido até o fim do período vigente.' });
  });

  function processAsaasWebhookPayload(payload: any, tokenHeader: string | undefined) {
    if (!tokenHeader || tokenHeader !== ASAAS_WEBHOOK_TOKEN) {
      return { status: 401, body: { error: 'Token de webhook inválido.' } };
    }
    const eventId = String(payload?.id || '');
    const eventType = String(payload?.event || '');
    if (!eventId || !eventType) {
      return { status: 400, body: { error: 'Evento inválido.' } };
    }

    const existing = db.prepare('SELECT id FROM asaas_events WHERE event_id = ?').get(eventId);
    if (existing) {
      return { status: 200, body: { ok: true, idempotent: true } };
    }

    const rowId = crypto.randomUUID();
    db.prepare('INSERT INTO asaas_events (id, event_id, event_type, payload) VALUES (?, ?, ?, ?)').run(
      rowId,
      eventId,
      eventType,
      JSON.stringify(payload)
    );

    try {
      const asaasSubId = payload.payment?.subscription || payload.subscription?.id;
      const sub = db
        .prepare('SELECT * FROM subscriptions WHERE asaas_subscription_id = ?')
        .get(asaasSubId) as any;

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
      } else if (eventType === 'PAYMENT_REFUNDED') {
        nextStatus = 'suspended';
      } else if (eventType === 'SUBSCRIPTION_DELETED') {
        nextStatus = 'canceled';
        canceledAt = new Date().toISOString();
      } else if (eventType === 'GRACE_PERIOD_EXPIRED') {
        nextStatus = 'suspended';
      }

      db.prepare(`
        UPDATE subscriptions
        SET status = ?, overdue_since = ?, current_period_end = ?, canceled_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(nextStatus, overdueSince, periodEnd, canceledAt, sub.id);

      writeAuditLog(
        sub.company_id,
        null,
        `asaas_${eventType.toLowerCase()}`,
        'subscriptions',
        sub.id,
        { status: prevStatus },
        { status: nextStatus }
      );

      db.prepare("UPDATE asaas_events SET processed_at = datetime('now') WHERE id = ?").run(rowId);
      return { status: 200, body: { ok: true, status: nextStatus } };
    } catch (err) {
      db.prepare('UPDATE asaas_events SET error_message = ? WHERE id = ?').run(
        err instanceof Error ? err.message : String(err),
        rowId
      );
      return { status: 500, body: { error: 'Falha ao processar evento; registrado para reprocessamento.' } };
    }
  }

  app.post('/api/webhooks/asaas', (req, res) => {
    const token = req.header('asaas-access-token');
    const result = processAsaasWebhookPayload(req.body, token);
    res.status(result.status).json(result.body);
  });

  app.post('/api/subscription/sandbox-simulate', requireAuth, requireCompany(true), (req: AuthedRequest, res) => {
    const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(req.companyId!) as any;
    if (!sub) {
      res.status(404).json({ error: 'Assinatura não encontrada.' });
      return;
    }

    let asaasSubId = sub.asaas_subscription_id;
    if (!asaasSubId) {
      asaasSubId = `sub_sbx_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare('UPDATE subscriptions SET asaas_subscription_id = ? WHERE id = ?').run(asaasSubId, sub.id);
    }

    const eventType = String(req.body?.event || 'PAYMENT_CONFIRMED');
    const eventId = String(req.body?.event_id || `evt_${crypto.randomBytes(6).toString('hex')}`);

    const result = processAsaasWebhookPayload(
      {
        id: eventId,
        event: eventType,
        payment: { subscription: asaasSubId },
      },
      ASAAS_WEBHOOK_TOKEN
    );
    res.status(result.status).json({ ...result.body, event_id: eventId });
  });

  // ===========================================================================
  // PUBLIC VITRINE ROUTES (STRICTLY READ-ONLY FROM public_vehicles_view)
  // ===========================================================================
  app.get('/api/public/garages/:slug', rateLimitPublic(120), (req, res) => {
    const company = db
      .prepare('SELECT id, name, slug, whatsapp, instagram, address, logo_url, cover_url, show_sold, trial_ends_at FROM companies WHERE slug = ?')
      .get(req.params.slug) as any;

    if (!company) {
      res.status(404).json({ error: 'Garagem não encontrada.' });
      return;
    }

    const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(company.id) as any;
    const access = computeSubscriptionState(company, sub);
    if (!access.has_access) {
      res.status(403).json({ error: 'Esta vitrine está temporariamente fora do ar.' });
      return;
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    const minYear = Number(req.query.minYear || 0);
    const maxPrice = Number(req.query.maxPrice || 0);

    let vehicles = db
      .prepare('SELECT * FROM public_vehicles_view WHERE company_id = ? ORDER BY created_at DESC')
      .all(company.id) as any[];

    if (q) {
      vehicles = vehicles.filter((v) => `${v.brand} ${v.model} ${v.version}`.toLowerCase().includes(q));
    }
    if (minYear > 0) {
      vehicles = vehicles.filter((v) => v.model_year >= minYear);
    }
    if (maxPrice > 0) {
      vehicles = vehicles.filter((v) => v.announced_price <= maxPrice);
    }

    const enriched = vehicles.map((v) => ({
      ...v,
      photos: db
        .prepare('SELECT storage_path, sort_order FROM vehicle_photos WHERE vehicle_id = ? ORDER BY sort_order ASC')
        .all(v.id),
    }));

    res.json({
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        whatsapp: company.whatsapp,
        instagram: company.instagram,
        address: company.address,
        logo_url: company.logo_url,
        cover_url: company.cover_url,
        show_sold: Boolean(company.show_sold),
      },
      vehicles: enriched,
    });
  });

  app.get('/api/public/garages/:slug/vehicles/:carSlug', rateLimitPublic(120), (req, res) => {
    const company = db
      .prepare('SELECT id, name, slug, whatsapp, instagram, address, logo_url, cover_url, show_sold, trial_ends_at FROM companies WHERE slug = ?')
      .get(req.params.slug) as any;
    if (!company) {
      res.status(404).json({ error: 'Garagem não encontrada.' });
      return;
    }

    const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(company.id) as any;
    const access = computeSubscriptionState(company, sub);
    if (!access.has_access) {
      res.status(403).json({ error: 'Esta vitrine está temporariamente fora do ar.' });
      return;
    }

    const vehicle = db
      .prepare('SELECT * FROM public_vehicles_view WHERE company_id = ? AND slug = ?')
      .get(company.id, req.params.carSlug) as any;

    if (!vehicle) {
      res.status(404).json({ error: 'Veículo não disponível.' });
      return;
    }

    const photos = db
      .prepare('SELECT storage_path, sort_order FROM vehicle_photos WHERE vehicle_id = ? ORDER BY sort_order ASC')
      .all(vehicle.id);

    res.json({
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        whatsapp: company.whatsapp,
        instagram: company.instagram,
        address: company.address,
        logo_url: company.logo_url,
        cover_url: company.cover_url,
        show_sold: Boolean(company.show_sold),
      },
      vehicle: { ...vehicle, photos },
    });
  });

  app.post('/api/public/garages/:slug/vehicles/:carSlug/track', rateLimitPublic(60), (req, res) => {
    const type = String(req.body?.type || '');
    if (!['view', 'whatsapp_click'].includes(type)) {
      res.status(400).json({ error: 'Tipo de evento inválido.' });
      return;
    }

    const vehicle = db.prepare(`
      SELECT v.id, v.company_id
      FROM vehicles v
      JOIN companies c ON c.id = v.company_id
      WHERE c.slug = ? AND v.slug = ? AND v.deleted_at IS NULL AND v.status = 'disponivel'
    `).get(req.params.slug, req.params.carSlug) as any;

    if (!vehicle) {
      res.json({ ok: false });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const viewInc = type === 'view' ? 1 : 0;
    const clickInc = type === 'whatsapp_click' ? 1 : 0;

    db.prepare(`
      INSERT INTO vehicle_daily_stats (id, company_id, vehicle_id, stat_date, views, whatsapp_clicks)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (vehicle_id, stat_date) DO UPDATE SET
        views = vehicle_daily_stats.views + excluded.views,
        whatsapp_clicks = vehicle_daily_stats.whatsapp_clicks + excluded.whatsapp_clicks
    `).run(crypto.randomUUID(), vehicle.company_id, vehicle.id, today, viewInc, clickInc);

    res.json({ ok: true });
  });

  // ===========================================================================
  // VITE / STATIC SERVING + DYNAMIC OPENGRAPH PREVIEW FOR WHATSAPP & INSTAGRAM
  // ===========================================================================
  const isProd = process.env.NODE_ENV === 'production';
  let vite: Awaited<ReturnType<typeof createViteServer>> | null = null;
  if (!isProd) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
  }

  const renderSpaHtml = async (req: Request, res: Response) => {
    try {
      const templatePath = isProd
        ? path.resolve(process.cwd(), 'dist/index.html')
        : path.resolve(process.cwd(), 'index.html');
      let html = fs.readFileSync(templatePath, 'utf-8');

      // Inject dynamic OG tags when crawler opens /g/:slug or /g/:slug/:carSlug
      const vitrineMatch = req.path.match(/^\/g\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\/?$/);
      if (vitrineMatch) {
        const [, garageSlug, carSlug] = vitrineMatch;
        const company = db
          .prepare('SELECT id, name, address, cover_url FROM companies WHERE slug = ?')
          .get(garageSlug) as any;

        if (company) {
          let ogTitle = `${company.name} — Vitrine de Veículos`;
          let ogDesc = company.address || `Confira o estoque disponível na ${company.name}.`;
          let ogImage = company.cover_url || '';

          if (carSlug) {
            const vehicle = db
              .prepare('SELECT id, brand, model, version, model_year, announced_price, mileage FROM public_vehicles_view WHERE company_id = ? AND slug = ?')
              .get(company.id, carSlug) as any;
            if (vehicle) {
              const priceStr = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                vehicle.announced_price
              );
              ogTitle = `${vehicle.brand} ${vehicle.model} ${vehicle.model_year} — ${priceStr}`;
              ogDesc = `${vehicle.version || ''} · ${new Intl.NumberFormat('pt-BR').format(vehicle.mileage)} km · ${company.name}`.trim();
              const photo = db
                .prepare('SELECT storage_path FROM vehicle_photos WHERE vehicle_id = ? ORDER BY sort_order ASC LIMIT 1')
                .get(vehicle.id) as any;
              if (photo?.storage_path && !photo.storage_path.startsWith('data:')) {
                ogImage = photo.storage_path;
              }
            }
          }

          const safe = (s: string) => s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
          html = html
            .replace(/<title>.*?<\/title>/, `<title>${safe(ogTitle)}</title>`)
            .replace(/<meta property="og:title" content=".*?" \/>/, `<meta property="og:title" content="${safe(ogTitle)}" />`)
            .replace(/<meta property="og:description" content=".*?" \/>/, `<meta property="og:description" content="${safe(ogDesc)}" />`);
          if (ogImage) {
            html = html.replace('</head>', `  <meta property="og:image" content="${safe(ogImage)}" />\n  </head>`);
          }
        }
      }

      if (!isProd && vite) {
        html = await vite.transformIndexHtml(req.originalUrl, html);
      }
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (err) {
      console.error(err);
      res.status(500).end('Erro interno ao carregar página.');
    }
  };

  app.get(['/g/:slug', '/g/:slug/:carSlug'], renderSpaHtml);

  if (!isProd && vite) {
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
  }

  app.get('*', renderSpaHtml);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CS22 Garage running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
