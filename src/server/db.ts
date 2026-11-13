import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'cs22_garage.sqlite');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'item';
}

export function initSchemaAndSeed() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token TEXT,
      reset_token TEXT,
      reset_expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      whatsapp TEXT NOT NULL,
      instagram TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      show_sold INTEGER NOT NULL DEFAULT 0,
      trial_ends_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_members (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'seller')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (company_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      manufacture_year INTEGER NOT NULL CHECK (manufacture_year BETWEEN 1940 AND 2100),
      model_year INTEGER NOT NULL CHECK (model_year BETWEEN 1940 AND 2100),
      mileage INTEGER NOT NULL DEFAULT 0 CHECK (mileage >= 0),
      fuel TEXT NOT NULL DEFAULT 'Flex',
      transmission TEXT NOT NULL DEFAULT 'Automático',
      color TEXT NOT NULL DEFAULT '',
      announced_price REAL NOT NULL CHECK (announced_price >= 0),
      description TEXT NOT NULL DEFAULT '',
      optionals TEXT NOT NULL DEFAULT '',
      plate TEXT NOT NULL DEFAULT '',
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'reservado', 'vendido', 'inativo')),
      previous_status TEXT CHECK (previous_status IN ('disponivel', 'reservado', 'inativo')),
      purchase_price REAL NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
      purchase_date TEXT NOT NULL,
      purchased_from TEXT NOT NULL DEFAULT '',
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (id, company_id),
      UNIQUE (company_id, slug)
    );

    CREATE INDEX IF NOT EXISTS idx_vehicles_company_status ON vehicles(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_vehicles_company_created ON vehicles(company_id, created_at);

    CREATE TABLE IF NOT EXISTS vehicle_photos (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vehicle_id, company_id) REFERENCES vehicles(id, company_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS vehicle_expenses (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN (
        'documentacao', 'mecanica', 'funilaria_pintura', 'estetica',
        'pneus', 'transporte', 'comissao', 'outros'
      )),
      amount REAL NOT NULL CHECK (amount > 0),
      expense_date TEXT NOT NULL,
      supplier TEXT NOT NULL DEFAULT '',
      canceled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vehicle_id, company_id) REFERENCES vehicles(id, company_id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_company_created ON vehicle_expenses(company_id, created_at);

    CREATE TABLE IF NOT EXISTS vehicle_sales (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      sale_price REAL NOT NULL CHECK (sale_price > 0),
      buyer_name TEXT NOT NULL,
      buyer_phone TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      canceled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vehicle_id, company_id) REFERENCES vehicles(id, company_id) ON DELETE RESTRICT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_sale_per_vehicle
      ON vehicle_sales(vehicle_id) WHERE canceled_at IS NULL;

    CREATE TABLE IF NOT EXISTS vehicle_daily_stats (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      stat_date TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
      whatsapp_clicks INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_clicks >= 0),
      UNIQUE (vehicle_id, stat_date),
      FOREIGN KEY (vehicle_id, company_id) REFERENCES vehicles(id, company_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE RESTRICT,
      asaas_customer_id TEXT,
      asaas_subscription_id TEXT,
      plan_code TEXT NOT NULL DEFAULT 'mensal_5990' CHECK (plan_code IN ('fundador_3990', 'mensal_5990', 'anual_599')),
      payment_method TEXT CHECK (payment_method IN ('PIX', 'BOLETO', 'CREDIT_CARD')),
      monthly_price REAL NOT NULL DEFAULT 59.90,
      status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'overdue', 'suspended', 'canceled')),
      current_period_end TEXT,
      grace_days INTEGER NOT NULL DEFAULT 5,
      overdue_since TEXT,
      canceled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS asaas_events (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      processed_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      user_id TEXT,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT,
      before_data TEXT,
      after_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    DROP VIEW IF EXISTS v_vehicle_financials;
    CREATE VIEW v_vehicle_financials AS
    SELECT
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
      v.description,
      v.optionals,
      v.plate,
      v.slug,
      v.status,
      v.previous_status,
      v.purchase_price,
      v.purchase_date,
      v.purchased_from,
      v.created_at,
      ROUND(COALESCE(exp.expenses_total, 0), 2) AS expenses_total,
      ROUND(v.purchase_price + COALESCE(exp.expenses_total, 0), 2) AS total_cost,
      s.id AS sale_id,
      s.sale_date,
      s.sale_price,
      s.buyer_name,
      s.payment_method,
      CASE
        WHEN s.id IS NOT NULL THEN (s.sale_price - (v.purchase_price + COALESCE(exp.expenses_total, 0)))
        ELSE NULL
      END AS profit,
      CASE
        WHEN s.id IS NOT NULL AND s.sale_price > 0
          THEN ((s.sale_price - (v.purchase_price + COALESCE(exp.expenses_total, 0))) / s.sale_price)
        ELSE NULL
      END AS margin_ratio,
      MAX(0, CAST(julianday(COALESCE(s.sale_date, date('now'))) - julianday(v.purchase_date) AS INTEGER)) AS days_in_stock,
      (SELECT vp.storage_path FROM vehicle_photos vp WHERE vp.vehicle_id = v.id ORDER BY vp.sort_order ASC LIMIT 1) AS cover_photo,
      (SELECT COUNT(*) FROM vehicle_photos vp WHERE vp.vehicle_id = v.id) AS photos_count,
      COALESCE((SELECT SUM(st.views) FROM vehicle_daily_stats st WHERE st.vehicle_id = v.id), 0) AS views_total,
      COALESCE((SELECT SUM(st.whatsapp_clicks) FROM vehicle_daily_stats st WHERE st.vehicle_id = v.id), 0) AS whatsapp_clicks_total
    FROM vehicles v
    LEFT JOIN (
      SELECT vehicle_id, SUM(amount) AS expenses_total
      FROM vehicle_expenses
      WHERE canceled_at IS NULL
      GROUP BY vehicle_id
    ) exp ON exp.vehicle_id = v.id
    LEFT JOIN vehicle_sales s ON s.vehicle_id = v.id AND s.canceled_at IS NULL
    WHERE v.deleted_at IS NULL;

    DROP VIEW IF EXISTS public_vehicles_view;
    CREATE VIEW public_vehicles_view AS
    SELECT
      v.id,
      v.company_id,
      c.slug AS company_slug,
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
      v.created_at
    FROM vehicles v
    JOIN companies c ON c.id = v.company_id
    WHERE v.deleted_at IS NULL
      AND (v.status = 'disponivel' OR (v.status = 'vendido' AND c.show_sold = 1));
  `);

  // Seed data only when database is empty
  const existingUser = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (existingUser) return;

  const now = new Date();
  const isoDay = (offsetDays: number) => {
    const d = new Date(now.getTime() + offsetDays * 86400_000);
    return d.toISOString().slice(0, 10);
  };
  const isoTimestamp = (offsetDays: number) => {
    const d = new Date(now.getTime() + offsetDays * 86400_000);
    return d.toISOString();
  };

  const user1Id = crypto.randomUUID();
  const user2Id = crypto.randomUUID();
  const comp1Id = crypto.randomUUID();
  const comp2Id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, email_verified)
    VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 1)
  `).run(
    user1Id,
    'contato@premiummotors.com.br',
    'Rafael Almeida',
    hashPassword('Garage@2026'),
    user2Id,
    'vendas@horizonteauto.com.br',
    'Marcos Oliveira',
    hashPassword('Garage@2026')
  );

  db.prepare(`
    INSERT INTO companies (id, name, slug, whatsapp, instagram, address, logo_url, cover_url, show_sold, trial_ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?), (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    comp1Id,
    'Premium Motors Multimarcas',
    'premium-motors',
    '5511998765432',
    '@premiummotors.sp',
    'Av. Europa, 840 — Jardins, São Paulo/SP',
    '',
    '/src/assets/images/hero_garage_showroom_1794570998522.jpg',
    isoTimestamp(5),
    comp2Id,
    'Horizonte Auto Center',
    'horizonte-auto',
    '5531991234567',
    '@horizonteauto.bh',
    'Av. Raja Gabaglia, 1200 — Belo Horizonte/MG',
    '',
    '',
    isoTimestamp(6)
  );

  db.prepare(`
    INSERT INTO company_members (id, company_id, user_id, role)
    VALUES (?, ?, ?, 'owner'), (?, ?, ?, 'owner')
  `).run(crypto.randomUUID(), comp1Id, user1Id, crypto.randomUUID(), comp2Id, user2Id);

  db.prepare(`
    INSERT INTO subscriptions (id, company_id, plan_code, monthly_price, status, grace_days)
    VALUES (?, ?, 'fundador_3990', 39.90, 'trialing', 5),
           (?, ?, 'mensal_5990', 59.90, 'trialing', 5)
  `).run(crypto.randomUUID(), comp1Id, crypto.randomUUID(), comp2Id);

  // Seed 4 vehicles for Garage 1 (Premium Motors)
  const v1Id = crypto.randomUUID();
  const v2Id = crypto.randomUUID();
  const v3Id = crypto.randomUUID();
  const v4Id = crypto.randomUUID();

  const insertVehicle = db.prepare(`
    INSERT INTO vehicles (
      id, company_id, brand, model, version, manufacture_year, model_year,
      mileage, fuel, transmission, color, announced_price, description, optionals,
      plate, slug, status, purchase_price, purchase_date, purchased_from
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. Disponível (72 dias em estoque -> aparece na lista de parados > 60 dias)
  insertVehicle.run(
    v1Id, comp1Id, 'Honda', 'Accord', 'EX 2.0 Turbo', 2021, 2022,
    38400, 'Gasolina', 'Automático', 'Prata Lunar', 164900,
    'Único dono, todas as revisões na concessionária, laudo cautelar 100% aprovado.',
    'Teto solar, bancos em couro, Honda Sensing, multimídia Apple CarPlay, câmera de ré',
    'FGH4J21', 'honda-accord-ex-2022', 'disponivel',
    144000, isoDay(-72), 'Particular (João Carlos)'
  );

  // 2. Disponível recente (18 dias em estoque)
  insertVehicle.run(
    v2Id, comp1Id, 'Audi', 'Q3', 'Prestige Plus 1.4 TFSI', 2022, 2023,
    24100, 'Gasolina', 'Automático', 'Cinza Daytona', 239900,
    'SUV impecável com histórico completo, pneus novos Michelin e vitrificação recente.',
    'Painel Virtual Cockpit, faróis Full LED, abertura elétrica do porta-malas, ar dual zone',
    'KLM9P88', 'audi-q3-prestige-2023', 'disponivel',
    212500, isoDay(-18), 'Leilão Santander Financeira'
  );

  // 3. Reservado (29 dias em estoque)
  insertVehicle.run(
    v3Id, comp1Id, 'Volkswagen', 'Golf', 'GTI / R-Line 2.0 TSI', 2022, 2022,
    31800, 'Gasolina', 'Automático DSG', 'Azul Biscay', 218000,
    'Hatch esportivo com pacote completo, sem retoques de pintura, chave reserva e manual.',
    'Rodas aro 18, modos de condução, controle de cruzeiro adaptativo, sensor dianteiro e traseiro',
    'RST2B44', 'vw-golf-rline-2022', 'reservado',
    191000, isoDay(-29), 'Repasse Concessionária Sul'
  );

  // 4. Vendido neste mês (22 dias em estoque -> gera lucro e margem do mês)
  insertVehicle.run(
    v4Id, comp1Id, 'Audi', 'A5', 'Sportback S-Line 2.0', 2021, 2022,
    29500, 'Gasolina', 'Automático S-Tronic', 'Branco Geleira', 254900,
    'Coupé 4 portas com interior em Alcântara, impecável.',
    'Teto panorâmico, som Bang & Olufsen, bancos elétricos com memória',
    'XYZ7A10', 'audi-a5-sportback-2022', 'vendido',
    219000, isoDay(-24), 'Particular (Patrícia M.)'
  );

  // Photos
  const insertPhoto = db.prepare(`
    INSERT INTO vehicle_photos (id, company_id, vehicle_id, storage_path, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertPhoto.run(crypto.randomUUID(), comp1Id, v1Id, '/src/assets/images/car_corolla_altis_1794570998697.jpg', 0);
  insertPhoto.run(crypto.randomUUID(), comp1Id, v2Id, '/src/assets/images/car_compass_limited_1794570999960.jpg', 0);
  insertPhoto.run(crypto.randomUUID(), comp1Id, v3Id, '/src/assets/images/car_onix_premier_1794570999847.jpg', 0);
  insertPhoto.run(crypto.randomUUID(), comp1Id, v4Id, '/src/assets/images/car_civic_touring_1794571000152.jpg', 0);

  // Expenses
  const insertExp = db.prepare(`
    INSERT INTO vehicle_expenses (id, company_id, vehicle_id, description, category, amount, expense_date, supplier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertExp.run(crypto.randomUUID(), comp1Id, v1Id, 'Revisão 40 mil km + pastilhas', 'mecanica', 2150, isoDay(-65), 'Oficina Precision');
  insertExp.run(crypto.randomUUID(), comp1Id, v1Id, 'Polimento técnico e higienização', 'estetica', 850, isoDay(-62), 'Studio Detail SP');
  insertExp.run(crypto.randomUUID(), comp1Id, v2Id, 'Jogo de 4 pneus Michelin Primacy', 'pneus', 4200, isoDay(-14), 'PneuCenter Paulista');
  insertExp.run(crypto.randomUUID(), comp1Id, v2Id, 'Transferência e vistoria cautelar', 'documentacao', 980, isoDay(-12), 'Despachante Central');
  insertExp.run(crypto.randomUUID(), comp1Id, v3Id, 'Martelinho de ouro para-lama', 'funilaria_pintura', 650, isoDay(-20), 'Funilaria Express');
  insertExp.run(crypto.randomUUID(), comp1Id, v4Id, 'Frete cegonha Curitiba -> SP', 'transporte', 1450, isoDay(-22), 'TransAuto Sul');
  insertExp.run(crypto.randomUUID(), comp1Id, v4Id, 'Comissão consultor de venda', 'comissao', 2500, isoDay(-2), 'Lucas Ferreira');
  insertExp.run(crypto.randomUUID(), comp1Id, v4Id, 'Vitrificação cerâmica 3 anos', 'estetica', 1200, isoDay(-18), 'Studio Detail SP');

  // Sale for v4 in current month
  db.prepare(`
    INSERT INTO vehicle_sales (id, company_id, vehicle_id, sale_date, sale_price, buyer_name, buyer_phone, payment_method, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), comp1Id, v4Id, isoDay(-2), 249500,
    'Eduardo Mendes', '11982341122', 'TED + Financiamento Itaú',
    'Entrega realizada com tanque cheio e laudo aprovado.'
  );

  // Daily stats for public vehicles
  db.prepare(`
    INSERT INTO vehicle_daily_stats (id, company_id, vehicle_id, stat_date, views, whatsapp_clicks)
    VALUES (?, ?, ?, ?, 48, 6), (?, ?, ?, ?, 74, 11)
  `).run(
    crypto.randomUUID(), comp1Id, v1Id, isoDay(0),
    crypto.randomUUID(), comp1Id, v2Id, isoDay(0)
  );

  // Seed 1 isolated vehicle for Garage 2 (Horizonte Auto)
  const v5Id = crypto.randomUUID();
  insertVehicle.run(
    v5Id, comp2Id, 'Toyota', 'Corolla', 'Altis Hybrid 1.8', 2023, 2023,
    19200, 'Híbrido', 'Automático CVT', 'Prata', 158900,
    'Veículo exclusivo da Horizonte Auto para validação de isolamento multi-tenant.',
    'Pacote Safety Sense, couro bege, carregador por indução',
    'BHZ1C99', 'toyota-corolla-altis-2023', 'disponivel',
    139000, isoDay(-15), 'Particular'
  );
  insertPhoto.run(crypto.randomUUID(), comp2Id, v5Id, '/src/assets/images/car_corolla_altis_1794570998697.jpg', 0);
}
