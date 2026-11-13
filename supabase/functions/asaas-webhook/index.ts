// Supabase Edge Function: asaas-webhook
// Deploy: supabase functions deploy asaas-webhook --no-verify-jwt
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASAAS_WEBHOOK_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN")!;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const token = req.headers.get("asaas-access-token");
  if (!token || token !== ASAAS_WEBHOOK_TOKEN) {
    return new Response(JSON.stringify({ error: "Invalid webhook token" }), { status: 401 });
  }

  const payload = await req.json();
  const eventId = payload.id as string;
  const eventType = payload.event as string;
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Idempotência: ignora evento já registrado
  const { data: existing } = await adminClient
    .from("asaas_events")
    .select("id, processed_at")
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ ok: true, idempotent: true }), { status: 200 });
  }

  const { error: insertErr } = await adminClient.from("asaas_events").insert({
    event_id: eventId,
    event_type: eventType,
    payload,
  });

  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), { status: 500 });
  }

  try {
    const asaasSubId = payload.payment?.subscription || payload.subscription?.id;
    if (!asaasSubId) {
      throw new Error("subscription id missing in webhook payload");
    }

    const { data: sub } = await adminClient
      .from("subscriptions")
      .select("*")
      .eq("asaas_subscription_id", asaasSubId)
      .single();

    if (!sub) {
      throw new Error(`subscription ${asaasSubId} not found`);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (eventType === "PAYMENT_CONFIRMED" || eventType === "PAYMENT_RECEIVED") {
      updates.status = "active";
      updates.overdue_since = null;
      const nextPeriod = new Date();
      nextPeriod.setDate(nextPeriod.getDate() + 30);
      updates.current_period_end = nextPeriod.toISOString();
    } else if (eventType === "PAYMENT_OVERDUE") {
      updates.status = "overdue";
      updates.overdue_since = sub.overdue_since || new Date().toISOString();
    } else if (eventType === "PAYMENT_REFUNDED") {
      updates.status = "suspended";
    } else if (eventType === "SUBSCRIPTION_DELETED") {
      updates.status = "canceled";
      updates.canceled_at = new Date().toISOString();
    }

    await adminClient.from("subscriptions").update(updates).eq("id", sub.id);
    await adminClient.from("audit_logs").insert({
      company_id: sub.company_id,
      action: `webhook_${eventType.toLowerCase()}`,
      table_name: "subscriptions",
      record_id: sub.id,
      before_data: { status: sub.status },
      after_data: updates,
    });
    await adminClient
      .from("asaas_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("event_id", eventId);

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    await adminClient
      .from("asaas_events")
      .update({ error_message: err instanceof Error ? err.message : String(err) })
      .eq("event_id", eventId);
    return new Response(JSON.stringify({ error: "Processing failed, logged for retry" }), { status: 500 });
  }
});
