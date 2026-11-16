import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { db, hashPassword, verifyPassword, slugify, initSchemaAndSeed } from './src/server/db.ts';
import * as supa from './src/server/supabaseStore.ts';

initSchemaAndSeed();

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET =
  (process.env.AUTH_SESSION_SECRET || '').trim() ||
  (process.env.SUPABASE_SERVICE_ROLE_KEY
    ? crypto
        .createHmac('sha256', 'cs22-garage-session-key-v1')
        .update(process.env.SUPABASE_SERVICE_ROLE_KEY.trim())
        .digest('hex')
    : crypto.randomBytes(32).toString('hex'));
const rawWebhookToken = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
const ASAAS_WEBHOOK_TOKEN =
  rawWebhookToken || (process.env.NODE_ENV === 'production' ? '' : 'cs22_sandbox_webhook_token');
const ASAAS_API_KEY = (process.env.ASAAS_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
const ASAAS_ENV: 'sandbox' | 'production' = ASAAS_API_KEY.startsWith('$aact_prod_')
  ? 'production'
  : ASAAS_API_KEY.startsWith('$aact_hmlg_')
    ? 'sandbox'
    : process.env.ASAAS_ENV === 'production'
      ? 'production'
      : 'sandbox';
const ASAAS_BASE_URL =
  ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';

const REQUIRED_SUPABASE_TABLES = [
  'companies',
  'company_members',
  'vehicles',
  'vehicle_photos',
  'vehicle_expenses',
  'vehicle_sales',
  'vehicle_daily_stats',
  'subscriptions',
  'asaas_events',
  'audit_logs',
  'due_reminders',
] as const;

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

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sessão não informada. Faça login novamente.' });
    return;
  }
  const bearer = authHeader.slice(7);
  const payload = verifyToken(bearer);

  if (supa.isSupabaseBackendEnabled) {
    try {
      if (payload) {
        const user = await supa.getSupabaseUserById(payload.sub);
        if (user) {
          req.userId = user.id;
          req.userEmail = user.email || payload.email;
          next();
          return;
        }
      }
      const { data } = await supa.getSupabaseAdmin().auth.getUser(bearer);
      if (data?.user) {
        req.userId = data.user.id;
        req.userEmail = data.user.email || '';
        next();
        return;
      }
      res.status(401).json({ error: 'Sessão expirada ou inválida.' });
      return;
    } catch {
      res.status(401).json({ error: 'Sessão expirada ou inválida.' });
      return;
    }
  }

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
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }

    if (supa.isSupabaseBackendEnabled) {
      const ctx = await supa.getMembershipAndCompany(req.userId);
      if (!ctx) {
        res.status(404).json({ error: 'Garagem não cadastrada.', code: 'NO_COMPANY' });
        return;
      }
      req.companyId = ctx.membership.company_id;
      req.memberRole = ctx.membership.role;
      req.hasActiveAccess = ctx.access.has_access;
      if (!allowSuspended && !ctx.access.has_access) {
        res.status(402).json({
          error: 'Assinatura suspensa ou período de teste encerrado. Regularize o pagamento para liberar o acesso.',
          code: 'SUBSCRIPTION_SUSPENDED',
        });
        return;
      }
      next();
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

const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'g',
  'login',
  'entrar',
  'planos',
  'cadastro',
  'onboarding',
  'recuperar-senha',
  'manifest',
  'sw',
  'offline',
  'favicon',
  'icon',
  'robots',
  'sitemap',
  'health',
  'webhooks',
  'suporte',
  'termos',
  'privacidade',
]);
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

async function startServer() {
  if (supa.isSupabaseEnvConfigured) {
    const ready = await supa.refreshSupabaseReadiness();
    if (!ready) {
      console.warn('Supabase conectado, mas tabelas ainda não criadas. Execute supabase/migrations/001_cs22_garage_mvp.sql no SQL Editor.');
    }
  }

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      status: 'healthy',
      database: supa.isSupabaseBackendEnabled ? 'supabase' : 'sqlite',
      env: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    });
  });

  // ===========================================================================
  // AUTH ROUTES
  // ===========================================================================
  app.post('/api/auth/register', rateLimitPublic(20), async (req, res) => {
    const { email, password, name } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();
    const cleanPassword = String(password || '');

    if (!cleanEmail.includes('@') || cleanName.length < 2 || cleanPassword.length < 6) {
      res.status(400).json({ error: 'Informe nome, e-mail válido e senha com ao menos 6 caracteres.' });
      return;
    }

    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.registerUser(cleanEmail, cleanPassword, cleanName, signToken);
      res.status(result.status).json(result.body);
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'Já existe uma conta cadastrada com este e-mail.' });
      return;
    }

    const userId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified, verification_token)
      VALUES (?, ?, ?, ?, 1, NULL)
    `).run(userId, cleanEmail, cleanName, hashPassword(cleanPassword));

    const jwt = signToken(userId, cleanEmail);
    res.status(201).json({
      message: 'Conta criada com sucesso.',
      email: cleanEmail,
      token: jwt,
      user: { id: userId, email: cleanEmail, name: cleanName, email_verified: true },
    });
  });

  app.post('/api/auth/confirm-email', rateLimitPublic(20), async (req, res) => {
    const { email, token } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanToken = String(token || '').trim();

    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.confirmEmail(cleanEmail, cleanToken, signToken);
      res.status(result.status).json(result.body);
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
    if (!user) {
      res.status(404).json({ error: 'Conta não encontrada.' });
      return;
    }
    if (user.email_verified) {
      const jwt = signToken(user.id, user.email);
      res.json({
        ok: true,
        token: jwt,
        message: 'E-mail já confirmado.',
        user: { id: user.id, email: user.email, name: user.name, email_verified: true },
      });
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

  app.post('/api/auth/login', rateLimitPublic(25), async (req, res) => {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');

    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.loginUser(cleanEmail, cleanPassword, signToken);
      res.status(result.status).json(result.body);
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
    if (!user || !verifyPassword(cleanPassword, user.password_hash)) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    if (!user.email_verified) {
      res.status(403).json({
        error: 'Confirme seu e-mail antes de acessar o painel.',
        code: 'EMAIL_NOT_VERIFIED',
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

  app.post('/api/auth/request-reset', rateLimitPublic(10), async (req, res) => {
    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host') || 'localhost:3000'}`).replace(/\/$/, '');
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.requestPasswordReset(cleanEmail, `${appUrl}/recuperar-senha`);
      res.status(result.status).json(result.body);
      return;
    }
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(cleanEmail) as any;
    if (user) {
      const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase();
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      db.prepare('UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?').run(
        resetToken,
        expiresAt,
        user.id
      );
    }
    res.json({
      message: 'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.',
    });
  });

  app.post('/api/auth/reset-password', rateLimitPublic(15), async (req, res) => {
    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.new_password || '');

    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.resetPassword(cleanEmail, token, newPassword);
      res.status(result.status).json(result.body);
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
    if (!user || !user.reset_token || user.reset_token !== token.toUpperCase()) {
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

  app.post('/api/auth/complete-recovery', rateLimitPublic(15), async (req, res) => {
    const accessToken = String(req.body?.access_token || '').trim();
    const newPassword = String(req.body?.new_password || '');

    if (!supa.isSupabaseBackendEnabled) {
      res.status(400).json({ error: 'Recuperação por link requer autenticação Supabase ativa.' });
      return;
    }

    const result = await supa.completeRecovery(accessToken, newPassword);
    res.status(result.status).json(result.body);
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const sbUser = await supa.getSupabaseUserById(req.userId!);
      if (!sbUser) {
        res.status(401).json({ error: 'Usuário não encontrado.' });
        return;
      }
      const ctx = await supa.getMembershipAndCompany(req.userId!);
      res.json({
        user: {
          id: sbUser.id,
          email: sbUser.email || req.userEmail,
          name: sbUser.user_metadata?.name || sbUser.email || 'Lojista',
          email_verified: Boolean(sbUser.email_confirmed_at),
        },
        company: ctx?.company ?? null,
        subscription: ctx?.subscription ?? null,
      });
      return;
    }

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
  app.get('/api/companies/check-slug/:slug', requireAuth, async (req, res) => {
    if (supa.isSupabaseBackendEnabled) {
      res.json(await supa.checkSlugAvailability(req.params.slug));
      return;
    }
    const candidate = slugify(req.params.slug);
    if (RESERVED_SLUGS.has(candidate)) {
      res.json({ slug: candidate, available: false, reserved: true });
      return;
    }
    const existing = db.prepare('SELECT id FROM companies WHERE slug = ?').get(candidate);
    res.json({ slug: candidate, available: !existing, reserved: false });
  });

  app.post('/api/companies', requireAuth, async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.createCompany(req.userId!, req.body);
      res.status(result.status).json(result.body);
      return;
    }

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
    const openingHours = String(req.body?.opening_hours || '').trim();
    const logoUrl = String(req.body?.logo_url || '').trim();
    const coverUrl = String(req.body?.cover_url || '').trim();

    if (name.length < 2 || whatsapp.length < 10 || slug.length < 2) {
      res.status(400).json({ error: 'Informe nome da garagem, endereço do link e WhatsApp com DDD.' });
      return;
    }
    if (RESERVED_SLUGS.has(slug)) {
      res.status(400).json({ error: 'Este endereço é reservado pelo sistema. Escolha outro nome para o link.' });
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
        INSERT INTO companies (id, name, slug, whatsapp, instagram, address, opening_hours, logo_url, cover_url, trial_ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(companyId, name, slug, whatsapp, instagram, address, openingHours, logoUrl, coverUrl, trialEndsAt);

      db.prepare(`
        INSERT INTO company_members (id, company_id, user_id, role)
        VALUES (?, ?, ?, 'owner')
      `).run(crypto.randomUUID(), companyId, req.userId!);

      db.prepare(`
        INSERT INTO subscriptions (id, company_id, plan_code, monthly_price, status, grace_days)
        VALUES (?, ?, 'mensal_5990', 49.90, 'trialing', 5)
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

  app.patch('/api/companies/current', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.updateCurrentCompany(req.companyId!, req.userId!, req.body);
      res.status(result.status).json(result.body);
      return;
    }

    const current = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId!) as any;
    const name = String(req.body?.name ?? current.name).trim();
    const newSlug = req.body?.slug !== undefined ? slugify(String(req.body.slug)) : current.slug;
    const whatsapp = String(req.body?.whatsapp ?? current.whatsapp).replace(/\D/g, '');
    const instagram = String(req.body?.instagram ?? current.instagram).trim();
    const address = String(req.body?.address ?? current.address).trim();
    const openingHours = String(req.body?.opening_hours ?? current.opening_hours ?? '').trim();
    const logoUrl = String(req.body?.logo_url ?? current.logo_url).trim();
    const coverUrl = String(req.body?.cover_url ?? current.cover_url).trim();
    const showSold = req.body?.show_sold !== undefined ? (req.body.show_sold ? 1 : 0) : current.show_sold;

    if (name.length < 2 || whatsapp.length < 10 || newSlug.length < 2) {
      res.status(400).json({ error: 'Nome, slug e WhatsApp válidos são obrigatórios.' });
      return;
    }
    if (RESERVED_SLUGS.has(newSlug)) {
      res.status(400).json({ error: 'Este endereço de vitrine é reservado. Escolha outro.' });
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
      SET name = ?, slug = ?, whatsapp = ?, instagram = ?, address = ?, opening_hours = ?, logo_url = ?, cover_url = ?, show_sold = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, newSlug, whatsapp, instagram, address, openingHours, logoUrl, coverUrl, showSold, req.companyId!);

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
  app.get('/api/dashboard', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      res.json(await supa.getDashboard(req.companyId!));
      return;
    }
    const monthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM

    const metrics = db.prepare(`
      SELECT
        COUNT(*) AS total_vehicles_count,
        SUM(CASE WHEN status = 'disponivel' THEN 1 ELSE 0 END) AS available_count,
        SUM(CASE WHEN status = 'vendido' AND substr(sale_date, 1, 7) = ? THEN 1 ELSE 0 END) AS sold_this_month_count,
        COALESCE(SUM(CASE WHEN status = 'vendido' AND substr(sale_date, 1, 7) = ? THEN profit ELSE 0 END), 0) AS month_profit,
        COALESCE(SUM(CASE WHEN status IN ('preparacao', 'disponivel', 'reservado', 'inativo') THEN total_cost ELSE 0 END), 0) AS tied_up_capital,
        COALESCE(CAST(ROUND(AVG(days_in_stock)) AS INTEGER), 0) AS avg_days_in_stock
      FROM v_vehicle_financials
      WHERE company_id = ?
    `).get(monthPrefix, monthPrefix, req.companyId!) as any;

    const stalledVehicles = db.prepare(`
      SELECT *
      FROM v_vehicle_financials
      WHERE company_id = ?
        AND status IN ('preparacao', 'disponivel', 'reservado', 'inativo')
        AND days_in_stock > 60
      ORDER BY days_in_stock DESC
    `).all(req.companyId!);

    const todayIso = new Date().toISOString().slice(0, 10);
    const reminderStats = db.prepare(`
      SELECT
        COUNT(*) AS pending_reminders_count,
        SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue_reminders_count
      FROM due_reminders
      WHERE company_id = ?
        AND canceled_at IS NULL
        AND completed_at IS NULL
    `).get(todayIso, req.companyId!) as any;

    const upcomingReminders = db.prepare(`
      SELECT
        r.*,
        CASE
          WHEN v.id IS NOT NULL THEN trim(v.brand || ' ' || v.model || ' ' || v.model_year)
          ELSE NULL
        END AS vehicle_label
      FROM due_reminders r
      LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.company_id = r.company_id
      WHERE r.company_id = ?
        AND r.canceled_at IS NULL
        AND r.completed_at IS NULL
      ORDER BY r.due_date ASC, r.created_at DESC
      LIMIT 3
    `).all(req.companyId!);

    res.json({
      total_vehicles_count: metrics?.total_vehicles_count ?? 0,
      available_count: metrics?.available_count ?? 0,
      sold_this_month_count: metrics?.sold_this_month_count ?? 0,
      month_profit: metrics?.month_profit ?? 0,
      tied_up_capital: metrics?.tied_up_capital ?? 0,
      avg_days_in_stock: metrics?.avg_days_in_stock ?? 0,
      pending_reminders_count: reminderStats?.pending_reminders_count ?? 0,
      overdue_reminders_count: reminderStats?.overdue_reminders_count ?? 0,
      upcoming_reminders: upcomingReminders,
      stalled_vehicles: stalledVehicles,
    });
  });

  // ===========================================================================
  // VEHICLES, PHOTOS, EXPENSES, SALES (MULTI-TENANT ISOLATED BY company_id)
  // ===========================================================================
  app.get('/api/vehicles', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    const statusFilter = String(req.query.status || '').trim();
    const search = String(req.query.q || '').trim().toLowerCase();

    if (supa.isSupabaseBackendEnabled) {
      res.json(await supa.listVehicles(req.companyId!, statusFilter, search));
      return;
    }

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

  app.post('/api/vehicles', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.createVehicle(req.companyId!, req.userId!, req.body || {});
      res.status(result.status).json(result.body);
      return;
    }
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

  app.get('/api/vehicles/:id', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.getVehicleDetail(req.companyId!, req.params.id);
      res.status(result.status).json(result.body);
      return;
    }

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

  app.patch('/api/vehicles/:id', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.updateVehicle(req.companyId!, req.params.id, req.body);
      res.status(result.status).json(result.body);
      return;
    }
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

  app.delete('/api/vehicles/:id', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.softDeleteVehicle(req.companyId!, req.userId!, req.params.id);
      res.status(result.status).json(result.body);
      return;
    }

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

  app.put('/api/vehicles/:id/photos', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const photos: string[] = Array.isArray(req.body?.photos) ? req.body.photos : [];
      const result = await supa.replaceVehiclePhotos(req.companyId!, req.params.id, photos);
      res.status(result.status).json(result.body);
      return;
    }
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
  app.post('/api/vehicles/:id/expenses', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.addExpense(req.companyId!, req.params.id, req.body);
      res.status(result.status).json(result.body);
      return;
    }

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

  app.post('/api/vehicles/:id/expenses/:expenseId/cancel', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.cancelExpense(req.companyId!, req.userId!, req.params.id, req.params.expenseId);
      res.status(result.status).json(result.body);
      return;
    }

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
  app.post('/api/vehicles/:id/sell', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.sellVehicle(req.companyId!, req.userId!, req.params.id, req.body);
      res.status(result.status).json(result.body);
      return;
    }
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

  app.post('/api/vehicles/:id/sales/:saleId/cancel', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.cancelSale(req.companyId!, req.userId!, req.params.id, req.params.saleId);
      res.status(result.status).json(result.body);
      return;
    }
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
  // DUE REMINDERS (LEMBRETES DE VENCIMENTO)
  // ===========================================================================
  const VALID_REMINDER_CATEGORIES = new Set([
    'ipva',
    'licenciamento',
    'seguro',
    'revisao',
    'financiamento',
    'assinatura',
    'outros',
  ]);

  app.get('/api/reminders', requireAuth, requireCompany(true), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      res.json(await supa.listReminders(req.companyId!));
      return;
    }

    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.companyId!) as any;
    const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(req.companyId!) as any;
    const access = computeSubscriptionState(company, sub);

    const rows = db.prepare(`
      SELECT
        r.*,
        CASE
          WHEN v.id IS NOT NULL THEN trim(v.brand || ' ' || v.model || ' ' || v.model_year)
          ELSE NULL
        END AS vehicle_label
      FROM due_reminders r
      LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.company_id = r.company_id
      WHERE r.company_id = ?
        AND r.canceled_at IS NULL
      ORDER BY
        CASE WHEN r.completed_at IS NULL THEN 0 ELSE 1 END ASC,
        r.due_date ASC,
        r.created_at DESC
    `).all(req.companyId!);

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

    res.json({
      reminders: rows,
      subscription_alert: subscriptionAlert,
    });
  });

  app.post('/api/reminders', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.createReminder(req.companyId!, req.userId!, req.body);
      res.status(result.status).json(result.body);
      return;
    }

    const title = String(req.body?.title || '').trim();
    const category = String(req.body?.category || 'outros').trim();
    const dueDate = String(req.body?.due_date || '').slice(0, 10);
    const rawAmount = req.body?.amount;
    const amount = rawAmount === '' || rawAmount === null || rawAmount === undefined ? null : Number(rawAmount);
    const vehicleId = req.body?.vehicle_id ? String(req.body.vehicle_id).trim() : null;
    const notes = String(req.body?.notes || '').trim();

    if (!title || !dueDate || !VALID_REMINDER_CATEGORIES.has(category)) {
      res.status(400).json({ error: 'Informe título, categoria e data de vencimento válidos.' });
      return;
    }
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      res.status(400).json({ error: 'Valor do vencimento inválido.' });
      return;
    }

    if (vehicleId) {
      const ownedVehicle = db
        .prepare('SELECT id FROM vehicles WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
        .get(vehicleId, req.companyId!);
      if (!ownedVehicle) {
        res.status(404).json({ error: 'Veículo vinculado não encontrado na garagem.' });
        return;
      }
    }

    const reminderId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO due_reminders (id, company_id, vehicle_id, title, category, due_date, amount, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reminderId, req.companyId!, vehicleId, title, category, dueDate, amount, notes);

    writeAuditLog(req.companyId!, req.userId!, 'reminder_created', 'due_reminders', reminderId, null, {
      title,
      category,
      due_date: dueDate,
      amount,
    });

    const created = db.prepare(`
      SELECT
        r.*,
        CASE
          WHEN v.id IS NOT NULL THEN trim(v.brand || ' ' || v.model || ' ' || v.model_year)
          ELSE NULL
        END AS vehicle_label
      FROM due_reminders r
      LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.company_id = r.company_id
      WHERE r.id = ? AND r.company_id = ?
    `).get(reminderId, req.companyId!);

    res.status(201).json(created);
  });

  app.post('/api/reminders/:id/complete', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.toggleReminderComplete(req.companyId!, req.userId!, req.params.id);
      res.status(result.status).json(result.body);
      return;
    }

    const existing = db
      .prepare('SELECT * FROM due_reminders WHERE id = ? AND company_id = ? AND canceled_at IS NULL')
      .get(req.params.id, req.companyId!) as any;

    if (!existing) {
      res.status(404).json({ error: 'Lembrete não encontrado.' });
      return;
    }

    const nextCompleted = existing.completed_at ? null : new Date().toISOString();
    db.prepare(`
      UPDATE due_reminders
      SET completed_at = ?, updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `).run(nextCompleted, existing.id, req.companyId!);

    writeAuditLog(
      req.companyId!,
      req.userId!,
      nextCompleted ? 'reminder_completed' : 'reminder_reopened',
      'due_reminders',
      existing.id,
      { completed_at: existing.completed_at },
      { completed_at: nextCompleted }
    );

    const updated = db.prepare('SELECT * FROM due_reminders WHERE id = ? AND company_id = ?').get(
      existing.id,
      req.companyId!
    );
    res.json(updated);
  });

  app.post('/api/reminders/:id/cancel', requireAuth, requireCompany(), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.cancelReminder(req.companyId!, req.userId!, req.params.id);
      res.status(result.status).json(result.body);
      return;
    }

    const existing = db
      .prepare('SELECT * FROM due_reminders WHERE id = ? AND company_id = ? AND canceled_at IS NULL')
      .get(req.params.id, req.companyId!) as any;

    if (!existing) {
      res.status(404).json({ error: 'Lembrete não encontrado.' });
      return;
    }

    db.prepare(`
      UPDATE due_reminders
      SET canceled_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `).run(existing.id, req.companyId!);

    writeAuditLog(req.companyId!, req.userId!, 'reminder_canceled', 'due_reminders', existing.id, existing, null);
    res.json({ ok: true });
  });

  // ===========================================================================
  // SUBSCRIPTION & ASAAS WEBHOOK FLOW
  // ===========================================================================
  app.get('/api/subscription', requireAuth, requireCompany(true), async (req: AuthedRequest, res) => {
    if (supa.isSupabaseBackendEnabled) {
      res.json(await supa.getSubscriptionOverview(req.companyId!));
      return;
    }
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

  app.get('/api/integrations/status', requireAuth, async (req, res) => {
    const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host') || 'localhost:3000'}`).replace(/\/$/, '');
    const supabaseUrl = supa.normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL);
    const supabaseAnonConfigured = Boolean((process.env.VITE_SUPABASE_ANON_KEY || '').trim());
    const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^['"]|['"]$/g, '');

    const asaasStatus: {
      configured: boolean;
      env: 'sandbox' | 'production';
      webhook_token_configured: boolean;
      webhook_url: string;
      reachable: boolean | null;
      account_name: string | null;
      error: string | null;
    } = {
      configured: Boolean(ASAAS_API_KEY),
      env: ASAAS_ENV,
      webhook_token_configured: Boolean(process.env.ASAAS_WEBHOOK_TOKEN),
      webhook_url: `${appUrl}/api/webhooks/asaas`,
      reachable: null,
      account_name: null,
      error: null,
    };

    if (ASAAS_API_KEY) {
      try {
        const accountRes = await fetch(`${ASAAS_BASE_URL}/myAccount`, {
          headers: { access_token: ASAAS_API_KEY },
          signal: AbortSignal.timeout(4000),
        });
        const accountJson = (await accountRes.json().catch(() => ({}))) as any;
        if (accountRes.ok) {
          asaasStatus.reachable = true;
          asaasStatus.account_name = accountJson?.name || accountJson?.tradingName || null;
        } else {
          asaasStatus.reachable = false;
          asaasStatus.error =
            accountJson?.errors?.[0]?.description || `Erro HTTP ${accountRes.status} ao validar chave Asaas.`;
        }
      } catch (err) {
        asaasStatus.reachable = false;
        asaasStatus.error = err instanceof Error ? err.message : 'Falha de conexão com a API do Asaas.';
      }
    }

    const supabaseStatus: {
      url_configured: boolean;
      anon_key_configured: boolean;
      service_role_configured: boolean;
      configured: boolean;
      reachable: boolean | null;
      tables_ready: boolean | null;
      missing_tables: string[];
      error: string | null;
      seed_error: string | null;
    } = {
      url_configured: Boolean(supabaseUrl),
      anon_key_configured: supabaseAnonConfigured,
      service_role_configured: Boolean(supabaseServiceKey),
      configured: Boolean(supabaseUrl && supabaseServiceKey),
      reachable: null,
      tables_ready: null,
      missing_tables: [],
      error: null,
      seed_error: supa.getLastSeedError(),
    };

    if (supabaseUrl && supabaseServiceKey) {
      try {
        const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const checks = await Promise.all(
          REQUIRED_SUPABASE_TABLES.map(async (tableName) => {
            const { error } = await adminClient.from(tableName).select('*').limit(1);
            return { tableName, error };
          })
        );
        const missing: string[] = [];
        let connError: string | null = null;
        for (const c of checks) {
          if (c.error) {
            if (
              c.error.code === '42P01' ||
              c.error.code === 'PGRST205' ||
              /does not exist|schema cache|could not find the table/i.test(c.error.message || '')
            ) {
              missing.push(c.tableName);
            } else if (!connError) {
              connError = c.error.message || `Erro código ${c.error.code || 'desconhecido'}`;
            }
          }
        }
        supabaseStatus.reachable = connError === null;
        supabaseStatus.missing_tables = missing;
        supabaseStatus.tables_ready = connError === null && missing.length === 0;
        supabaseStatus.error = connError;
        if (supabaseStatus.tables_ready && !supa.isSupabaseBackendEnabled) {
          await supa.refreshSupabaseReadiness();
        }
        supabaseStatus.seed_error = supa.getLastSeedError();
      } catch (err) {
        supabaseStatus.reachable = false;
        supabaseStatus.tables_ready = false;
        supabaseStatus.error = err instanceof Error ? err.message : 'Falha ao conectar no Supabase.';
      }
    }

    res.json({
      active_database: supa.isSupabaseBackendEnabled ? 'supabase' : 'sqlite',
      asaas: asaasStatus,
      supabase: supabaseStatus,
    });
  });

  app.post('/api/subscription/checkout', requireAuth, requireCompany(true), async (req: AuthedRequest, res) => {
    const planCode = 'mensal_5990';
    const paymentMethod = String(req.body?.payment_method || 'PIX');
    const customerName = String(req.body?.customer_name || '').trim();
    const cpfCnpj = String(req.body?.cpf_cnpj || '').replace(/\D/g, '');

    const plan = { value: 49.9, cycle: 'MONTHLY', label: 'CS22 Garage Plano Padrão' };

    if (!['PIX', 'BOLETO', 'CREDIT_CARD'].includes(paymentMethod)) {
      res.status(400).json({ error: 'Forma de pagamento inválida.' });
      return;
    }

    const reusableCustomerId = supa.isSupabaseBackendEnabled
      ? await supa.getExistingAsaasCustomerId(req.companyId!)
      : (() => {
          const row = db
            .prepare('SELECT asaas_customer_id FROM subscriptions WHERE company_id = ?')
            .get(req.companyId!) as { asaas_customer_id?: string | null } | undefined;
          return row?.asaas_customer_id && !row.asaas_customer_id.startsWith('cus_sbx_')
            ? row.asaas_customer_id
            : null;
        })();

    let asaasCustomerId = `cus_sbx_${crypto.randomBytes(6).toString('hex')}`;
    let asaasSubscriptionId = `sub_sbx_${crypto.randomBytes(6).toString('hex')}`;
    let invoiceUrl: string | null = null;
    let checkoutMode: 'asaas_api' | 'sandbox_simulated' = 'sandbox_simulated';

    if (ASAAS_API_KEY) {
      if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
        res.status(400).json({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido para cobrança no Asaas.' });
        return;
      }

      try {
        if (reusableCustomerId) {
          asaasCustomerId = reusableCustomerId;
        } else {
          const custRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', access_token: ASAAS_API_KEY },
            body: JSON.stringify({
              name: customerName || 'Garagem CS22',
              email: req.userEmail,
              cpfCnpj,
              externalReference: req.companyId,
            }),
          });
          const custJson = (await custRes.json()) as any;
          if (!custRes.ok || !custJson.id) {
            const asaasErr = custJson?.errors?.[0]?.description || 'Não foi possível cadastrar o cliente no Asaas.';
            res.status(custRes.status >= 400 && custRes.status < 500 ? 400 : 502).json({ error: asaasErr });
            return;
          }
          asaasCustomerId = custJson.id;
        }

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
        if (!subRes.ok || !subJson.id) {
          const asaasErr = subJson?.errors?.[0]?.description || 'Não foi possível gerar a assinatura no Asaas.';
          res.status(subRes.status >= 400 && subRes.status < 500 ? 400 : 502).json({ error: asaasErr });
          return;
        }

        asaasSubscriptionId = subJson.id;
        invoiceUrl = subJson.invoiceUrl ?? null;
        checkoutMode = 'asaas_api';

        if (!invoiceUrl) {
          try {
            const payRes = await fetch(`${ASAAS_BASE_URL}/subscriptions/${asaasSubscriptionId}/payments?limit=1`, {
              headers: { access_token: ASAAS_API_KEY },
            });
            if (payRes.ok) {
              const payJson = (await payRes.json()) as any;
              invoiceUrl = payJson?.data?.[0]?.invoiceUrl ?? payJson?.data?.[0]?.bankSlipUrl ?? null;
            }
          } catch {
            // Optional lookup for invoice link
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha de comunicação com o Asaas.';
        res.status(502).json({ error: `Erro ao conectar com o Asaas: ${message}` });
        return;
      }
    }

    // Importante (PRD): checkout NUNCA libera assinatura por si só; apenas grava IDs do Asaas e aguarda webhook
    if (supa.isSupabaseBackendEnabled) {
      await supa.saveSubscriptionCheckout(req.companyId!, req.userId!, {
        asaasCustomerId,
        asaasSubscriptionId,
        planCode,
        paymentMethod,
        monthlyPrice: plan.value,
        mode: checkoutMode,
      });
    } else {
      db.prepare(`
        UPDATE subscriptions
        SET asaas_customer_id = ?, asaas_subscription_id = ?, plan_code = ?, payment_method = ?, monthly_price = ?, updated_at = datetime('now')
        WHERE company_id = ?
      `).run(asaasCustomerId, asaasSubscriptionId, planCode, paymentMethod, plan.value, req.companyId!);

      writeAuditLog(req.companyId!, req.userId!, 'subscription_checkout_created', 'subscriptions', req.companyId!, null, {
        plan_code: planCode,
        payment_method: paymentMethod,
        asaas_subscription_id: asaasSubscriptionId,
        mode: checkoutMode,
      });
    }

    res.json({
      asaas_customer_id: asaasCustomerId,
      asaas_subscription_id: asaasSubscriptionId,
      invoice_url: invoiceUrl,
      mode: checkoutMode,
      status: 'pending_webhook_confirmation',
      message:
        checkoutMode === 'asaas_api'
          ? 'Assinatura criada no Asaas. Conclua o pagamento no link gerado para liberar o acesso via webhook.'
          : 'Assinatura gerada em modo Sandbox Simulado. Use o simulador de webhook abaixo para testar a confirmação.',
    });
  });

  app.post('/api/subscription/cancel', requireAuth, requireCompany(true), async (req: AuthedRequest, res) => {
    const sub = supa.isSupabaseBackendEnabled
      ? await supa.getSubscriptionByCompany(req.companyId!)
      : (db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(req.companyId!) as any);

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
    if (supa.isSupabaseBackendEnabled) {
      await supa.markSubscriptionCanceled(req.companyId!, req.userId!, sub, periodEnd);
    } else {
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
    }

    res.json({ ok: true, message: 'Assinatura cancelada. Acesso mantido até o fim do período vigente.' });
  });

  function processAsaasWebhookPayload(payload: any, tokenHeader: string | undefined) {
    if (!ASAAS_WEBHOOK_TOKEN || !tokenHeader || tokenHeader !== ASAAS_WEBHOOK_TOKEN) {
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

  app.post('/api/webhooks/asaas', async (req, res) => {
    const token = req.header('asaas-access-token');
    if (!ASAAS_WEBHOOK_TOKEN) {
      res.status(401).json({ error: 'Token de webhook não configurado.' });
      return;
    }
    const result = supa.isSupabaseBackendEnabled
      ? await supa.processAsaasWebhook(req.body, token, ASAAS_WEBHOOK_TOKEN)
      : processAsaasWebhookPayload(req.body, token);
    res.status(result.status).json(result.body);
  });

  app.post('/api/subscription/sandbox-simulate', requireAuth, requireCompany(true), async (req: AuthedRequest, res) => {
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ error: 'Simulador desabilitado em produção.' });
      return;
    }
    if (supa.isSupabaseBackendEnabled) {
      const sub = await supa.getSubscriptionByCompany(req.companyId!);
      if (!sub) {
        res.status(404).json({ error: 'Assinatura não encontrada.' });
        return;
      }
      let asaasSubId = sub.asaas_subscription_id;
      if (!asaasSubId) {
        asaasSubId = `sub_sbx_${crypto.randomBytes(6).toString('hex')}`;
        await supa.setSandboxAsaasSubscriptionId(sub.id, asaasSubId);
      }
      const eventType = String(req.body?.event || 'PAYMENT_CONFIRMED');
      const eventId = String(req.body?.event_id || `evt_${crypto.randomBytes(6).toString('hex')}`);
      const result = await supa.processAsaasWebhook(
        {
          id: eventId,
          event: eventType,
          payment: { subscription: asaasSubId },
        },
        ASAAS_WEBHOOK_TOKEN,
        ASAAS_WEBHOOK_TOKEN
      );
      res.status(result.status).json({ ...result.body, event_id: eventId });
      return;
    }

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
  app.get('/api/public/garages/:slug', rateLimitPublic(120), async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const minYear = Number(req.query.minYear || 0);
    const maxPrice = Number(req.query.maxPrice || 0);

    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.getPublicGarage(req.params.slug, { q, minYear, maxPrice });
      res.status(result.status).json(result.body);
      return;
    }

    const company = db
      .prepare('SELECT id, name, slug, whatsapp, instagram, address, opening_hours, logo_url, cover_url, show_sold, trial_ends_at FROM companies WHERE slug = ?')
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
        opening_hours: company.opening_hours || '',
        logo_url: company.logo_url,
        cover_url: company.cover_url,
        show_sold: Boolean(company.show_sold),
      },
      vehicles: enriched,
    });
  });

  app.get('/api/public/garages/:slug/vehicles/:carSlug', rateLimitPublic(120), async (req, res) => {
    if (supa.isSupabaseBackendEnabled) {
      const result = await supa.getPublicVehicle(req.params.slug, req.params.carSlug);
      res.status(result.status).json(result.body);
      return;
    }

    const company = db
      .prepare('SELECT id, name, slug, whatsapp, instagram, address, opening_hours, logo_url, cover_url, show_sold, trial_ends_at FROM companies WHERE slug = ?')
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
        opening_hours: company.opening_hours || '',
        logo_url: company.logo_url,
        cover_url: company.cover_url,
        show_sold: Boolean(company.show_sold),
      },
      vehicle: { ...vehicle, photos },
    });
  });

  app.post('/api/public/garages/:slug/vehicles/:carSlug/track', rateLimitPublic(60), async (req, res) => {
    const type = String(req.body?.type || '');
    if (!['view', 'whatsapp_click'].includes(type)) {
      res.status(400).json({ error: 'Tipo de evento inválido.' });
      return;
    }

    if (supa.isSupabaseBackendEnabled) {
      await supa.trackPublicEvent(req.params.slug, req.params.carSlug, type);
      res.json({ ok: true });
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
  let vite: any = null;
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
  }

  const renderSpaHtml = async (req: Request, res: Response) => {
    try {
      const templatePath = isProd
        ? path.resolve(process.cwd(), 'dist/index.html')
        : path.resolve(process.cwd(), 'index.html');
      let html = fs.readFileSync(templatePath, 'utf-8');

      // Inject dynamic OG tags when crawler opens /:slug or /:slug/:carSlug
      const segments = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      const isRootVitrine =
        (segments.length === 1 || segments.length === 2) &&
        !RESERVED_SLUGS.has(segments[0]) &&
        /^[a-z0-9-]+$/.test(segments[0]) &&
        (segments.length === 1 || /^[a-z0-9-]+$/.test(segments[1]));
      if (isRootVitrine) {
        const [garageSlug, carSlug] = segments;
        let ogTitle = '';
        let ogDesc = '';
        let ogImage = '';

        if (supa.isSupabaseBackendEnabled) {
          const meta = await supa.getPublicOgMeta(garageSlug, carSlug);
          if (meta) {
            ogTitle = meta.ogTitle;
            ogDesc = meta.ogDesc;
            ogImage = meta.ogImage;
          }
        } else {
          const company = db
            .prepare('SELECT id, name, address, cover_url FROM companies WHERE slug = ?')
            .get(garageSlug) as any;

          if (company) {
            ogTitle = `${company.name} — Vitrine de Veículos`;
            ogDesc = company.address || `Confira o estoque disponível na ${company.name}.`;
            ogImage = company.cover_url || '';

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
          }
        }

        if (ogTitle) {
          const safe = (s: string) => s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
          html = html
            .replace(/<title>.*?<\/title>/, `<title>${safe(ogTitle)}</title>`)
            .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${safe(ogTitle)}" />`)
            .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${safe(ogDesc)}" />`);
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

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint não encontrado.' });
  });

  app.get('/g/:slug', (req, res) => {
    res.redirect(301, `/${encodeURIComponent(req.params.slug)}`);
  });

  app.get('/g/:slug/:carSlug', (req, res) => {
    res.redirect(301, `/${encodeURIComponent(req.params.slug)}/${encodeURIComponent(req.params.carSlug)}`);
  });

  app.get('/:slug', (req, res, next) => {
    if (RESERVED_SLUGS.has(req.params.slug) || !/^[a-z0-9-]+$/.test(req.params.slug)) {
      next();
      return;
    }
    void renderSpaHtml(req, res);
  });

  app.get('/:slug/:carSlug', (req, res, next) => {
    if (
      RESERVED_SLUGS.has(req.params.slug) ||
      !/^[a-z0-9-]+$/.test(req.params.slug) ||
      !/^[a-z0-9-]+$/.test(req.params.carSlug)
    ) {
      next();
      return;
    }
    void renderSpaHtml(req, res);
  });

  if (!isProd && vite) {
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.use('/src/assets/images', express.static(path.resolve(process.cwd(), 'src/assets/images')));
  }

  app.get('*', renderSpaHtml);

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled server error:', err);
    if (req.path.startsWith('/api')) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
      return;
    }
    res.status(500).end('Erro interno ao carregar página.');
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CS22 Garage running on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

startServer();
