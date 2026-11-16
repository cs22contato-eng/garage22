/**
 * Script de diagnóstico das integrações externas: Asaas e Supabase.
 * Uso: npx tsx supabase/scripts/verify-integrations.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_TABLES = [
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

async function main() {
  const asaasKey = process.env.ASAAS_API_KEY || '';
  const asaasEnv = process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox';
  const asaasWebhookToken = process.env.ASAAS_WEBHOOK_TOKEN || '';
  const asaasBaseUrl = asaasEnv === 'production' ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/api/v3';

  console.log('=== Diagnóstico Asaas ===');
  console.log(`Ambiente: ${asaasEnv}`);
  console.log(`ASAAS_API_KEY configurada: ${Boolean(asaasKey)}`);
  console.log(`ASAAS_WEBHOOK_TOKEN configurado: ${Boolean(asaasWebhookToken)}`);

  if (asaasKey) {
    try {
      const res = await fetch(`${asaasBaseUrl}/myAccount`, {
        headers: { access_token: asaasKey },
        signal: AbortSignal.timeout(5000),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (res.ok) {
        console.log(`Conexão Asaas OK (${json.name || json.tradingName || 'conta autenticada'})`);
      } else {
        console.log(`Falha Asaas (${res.status}): ${json?.errors?.[0]?.description || 'Erro desconhecido'}`);
      }
    } catch (err) {
      console.log(`Erro de rede Asaas: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log('Modo atual: Sandbox Simulado (defina ASAAS_API_KEY nos Segredos para ativar API real).');
  }

  console.log('\n=== Diagnóstico Supabase ===');
  const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY || '';
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  console.log(`VITE_SUPABASE_URL configurada: ${Boolean(supabaseUrl)}`);
  console.log(`VITE_SUPABASE_ANON_KEY configurada: ${Boolean(supabaseAnon)}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY configurada: ${Boolean(supabaseService)}`);

  if (supabaseUrl && supabaseService) {
    const client = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const missing: string[] = [];
    for (const table of REQUIRED_TABLES) {
      const { error } = await client.from(table).select('*').limit(1);
      if (error) {
        missing.push(`${table} (${error.message})`);
      }
    }
    if (missing.length === 0) {
      console.log(`Conexão Supabase OK — todas as ${REQUIRED_TABLES.length} tabelas existem.`);
    } else {
      console.log(`Tabelas ausentes ou inacessíveis no Supabase:\n- ${missing.join('\n- ')}`);
      console.log('Execute o arquivo supabase/migrations/001_cs22_garage_mvp.sql no SQL Editor do Supabase.');
    }
  } else {
    console.log('Defina VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY nos Segredos.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
