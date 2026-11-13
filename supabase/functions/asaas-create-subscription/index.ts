// Supabase Edge Function: asaas-create-subscription
// Deploy: supabase functions deploy asaas-create-subscription
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY")!;
const ASAAS_BASE_URL =
  Deno.env.get("ASAAS_ENV") === "production"
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/api/v3";

const PLAN_PRICES: Record<string, { value: number; cycle: string; label: string }> = {
  fundador_3990: { value: 39.9, cycle: "MONTHLY", label: "CS22 Garage Fundador" },
  mensal_5990: { value: 59.9, cycle: "MONTHLY", label: "CS22 Garage Mensal" },
  anual_599: { value: 599.0, cycle: "YEARLY", label: "CS22 Garage Anual" },
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 });
  }

  const { company_id, plan_code, payment_method, customer_name, customer_cpf_cnpj } = await req.json();
  const plan = PLAN_PRICES[plan_code];
  if (!plan || !["PIX", "BOLETO", "CREDIT_CARD"].includes(payment_method)) {
    return new Response(JSON.stringify({ error: "Plano ou forma de pagamento inválidos" }), { status: 400 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verificar vínculo com company_members
  const { data: member } = await adminClient
    .from("company_members")
    .select("role")
    .eq("company_id", company_id)
    .eq("user_id", userData.user.id)
    .single();

  if (!member) {
    return new Response(JSON.stringify({ error: "Acesso negado à garagem" }), { status: 403 });
  }

  // Criar cliente no Asaas
  const customerRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: ASAAS_API_KEY },
    body: JSON.stringify({
      name: customer_name,
      email: userData.user.email,
      cpfCnpj: customer_cpf_cnpj,
      externalReference: company_id,
    }),
  });
  const customer = await customerRes.json();
  if (!customerRes.ok) {
    return new Response(JSON.stringify({ error: "Erro ao criar cliente no Asaas", details: customer }), { status: 502 });
  }

  // Criar assinatura mensal/anual no Asaas (liberação apenas via webhook confirmado)
  const nextDueDate = new Date().toISOString().slice(0, 10);
  const subRes = await fetch(`${ASAAS_BASE_URL}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: ASAAS_API_KEY },
    body: JSON.stringify({
      customer: customer.id,
      billingType: payment_method,
      value: plan.value,
      nextDueDate,
      cycle: plan.cycle,
      description: plan.label,
      externalReference: company_id,
    }),
  });
  const asaasSub = await subRes.json();
  if (!subRes.ok) {
    return new Response(JSON.stringify({ error: "Erro ao criar assinatura no Asaas", details: asaasSub }), { status: 502 });
  }

  await adminClient
    .from("subscriptions")
    .upsert({
      company_id,
      asaas_customer_id: customer.id,
      asaas_subscription_id: asaasSub.id,
      plan_code,
      payment_method,
      monthly_price: plan.value,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id" });

  await adminClient.from("audit_logs").insert({
    company_id,
    user_id: userData.user.id,
    action: "subscription_checkout_created",
    table_name: "subscriptions",
    after_data: { plan_code, payment_method, asaas_subscription_id: asaasSub.id },
  });

  return new Response(JSON.stringify({
    asaas_subscription_id: asaasSub.id,
    asaas_customer_id: customer.id,
    invoice_url: asaasSub.invoiceUrl ?? null,
    status: "pending_webhook_confirmation",
  }), { headers: { "Content-Type": "application/json" } });
});
