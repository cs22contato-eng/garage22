// Supabase Edge Function: asaas-create-subscription
// Deploy: supabase functions deploy asaas-create-subscription
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASAAS_API_KEY = (Deno.env.get("ASAAS_API_KEY") || "").trim();
const IS_PROD_ASAAS =
  ASAAS_API_KEY.startsWith("$aact_prod_") ||
  (!ASAAS_API_KEY.startsWith("$aact_hmlg_") && Deno.env.get("ASAAS_ENV") === "production");
const ASAAS_BASE_URL = IS_PROD_ASAAS
  ? "https://api.asaas.com/v3"
  : "https://sandbox.asaas.com/api/v3";

const SINGLE_PLAN = {
  code: "mensal_5990",
  value: 49.9,
  cycle: "MONTHLY",
  label: "CS22 Garage Plano Padrão",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }

  const body = await req.json();
  const action = String(body?.action || "create");
  const company_id = String(body?.company_id || "");
  if (!company_id) {
    return jsonResponse({ error: "Garagem não informada" }, 400);
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
    return jsonResponse({ error: "Acesso negado à garagem" }, 403);
  }

  if (action === "cancel") {
    const { data: sub } = await adminClient
      .from("subscriptions")
      .select("*")
      .eq("company_id", company_id)
      .maybeSingle();

    if (!sub) {
      return jsonResponse({ error: "Assinatura não encontrada" }, 404);
    }

    if (
      ASAAS_API_KEY &&
      sub.asaas_subscription_id &&
      !String(sub.asaas_subscription_id).startsWith("sub_sbx_")
    ) {
      try {
        await fetch(`${ASAAS_BASE_URL}/subscriptions/${sub.asaas_subscription_id}`, {
          method: "DELETE",
          headers: { access_token: ASAAS_API_KEY },
        });
      } catch {
        // segue cancelamento local
      }
    }

    const periodEnd = sub.current_period_end || new Date().toISOString();
    await adminClient
      .from("subscriptions")
      .update({
        status: "canceled",
        canceled_at: new Date().toISOString(),
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", company_id);

    await adminClient.from("audit_logs").insert({
      company_id,
      user_id: userData.user.id,
      action: "subscription_canceled",
      table_name: "subscriptions",
      record_id: sub.id,
      before_data: { status: sub.status },
      after_data: { status: "canceled", current_period_end: periodEnd },
    });

    return jsonResponse({
      ok: true,
      message: "Assinatura cancelada. Seu acesso permanece ativo até o fim do período já pago.",
    });
  }

  const { payment_method, customer_name, customer_cpf_cnpj } = body;
  const plan_code = SINGLE_PLAN.code;
  const plan = SINGLE_PLAN;
  const cleanCpfCnpj = String(customer_cpf_cnpj || "").replace(/\D/g, "");
  if (!["PIX", "BOLETO", "CREDIT_CARD"].includes(payment_method)) {
    return jsonResponse({ error: "Forma de pagamento inválida" }, 400);
  }
  if (cleanCpfCnpj.length !== 11 && cleanCpfCnpj.length !== 14) {
    return jsonResponse({ error: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido." }, 400);
  }
  if (!ASAAS_API_KEY) {
    return jsonResponse({ error: "Chave ASAAS_API_KEY não configurada na Edge Function." }, 500);
  }

  const { data: existingSub } = await adminClient
    .from("subscriptions")
    .select("asaas_customer_id")
    .eq("company_id", company_id)
    .maybeSingle();

  let asaasCustomerId =
    existingSub?.asaas_customer_id && !existingSub.asaas_customer_id.startsWith("cus_sbx_")
      ? existingSub.asaas_customer_id
      : null;

  if (!asaasCustomerId) {
    const customerRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", access_token: ASAAS_API_KEY },
      body: JSON.stringify({
        name: customer_name || "Garagem CS22",
        email: userData.user.email,
        cpfCnpj: cleanCpfCnpj,
        externalReference: company_id,
      }),
    });
    const customer = await customerRes.json();
    if (!customerRes.ok || !customer.id) {
      return jsonResponse({ error: customer?.errors?.[0]?.description || "Erro ao criar cliente no Asaas", details: customer }, 502);
    }
    asaasCustomerId = customer.id;
  }

  // Criar assinatura mensal no Asaas (liberação apenas via webhook confirmado)
  const nextDueDate = new Date().toISOString().slice(0, 10);
  const subRes = await fetch(`${ASAAS_BASE_URL}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: ASAAS_API_KEY },
    body: JSON.stringify({
      customer: asaasCustomerId,
      billingType: payment_method,
      value: plan.value,
      nextDueDate,
      cycle: plan.cycle,
      description: plan.label,
      externalReference: company_id,
    }),
  });
  const asaasSub = await subRes.json();
  if (!subRes.ok || !asaasSub.id) {
    return jsonResponse({ error: asaasSub?.errors?.[0]?.description || "Erro ao criar assinatura no Asaas", details: asaasSub }, 502);
  }

  let invoiceUrl: string | null = asaasSub.invoiceUrl ?? null;
  if (!invoiceUrl) {
    try {
      const payRes = await fetch(`${ASAAS_BASE_URL}/subscriptions/${asaasSub.id}/payments?limit=1`, {
        headers: { access_token: ASAAS_API_KEY },
      });
      if (payRes.ok) {
        const payJson = await payRes.json();
        invoiceUrl = payJson?.data?.[0]?.invoiceUrl ?? payJson?.data?.[0]?.bankSlipUrl ?? null;
      }
    } catch {
      // Optional payment link lookup
    }
  }

  await adminClient
    .from("subscriptions")
    .upsert({
      company_id,
      asaas_customer_id: asaasCustomerId,
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

  return jsonResponse({
    asaas_subscription_id: asaasSub.id,
    asaas_customer_id: asaasCustomerId,
    invoice_url: invoiceUrl,
    message: "Cobrança criada no Asaas. A assinatura será ativada assim que o pagamento for confirmado pelo webhook.",
    status: "pending_webhook_confirmation",
  });
});
