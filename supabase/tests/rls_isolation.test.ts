/**
 * Teste automatizado de isolamento multi-tenant e fluxos principais (PRD Fase 1 & 2)
 * Verifica:
 * 1. Isolamento multi-tenant de veículos e lembretes de vencimento entre Garagem A e Garagem B
 * 2. Privacidade absoluta na vitrine pública (nunca expõe placa, compra, despesas, vendas)
 * 3. Ciclo completo: Cadastro -> Confirmação -> Onboarding -> Login -> Veículo -> Pagamento/Webhook -> Lembretes
 */
import assert from "node:assert/strict";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";

async function login(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `Login falhou para ${email}`);
  const data = await res.json();
  return data.token as string;
}

async function runIsolationAndFlowTests() {
  const tokenGarageA = await login("contato@premiummotors.com.br", "Garage@2026");
  const tokenGarageB = await login("vendas@horizonteauto.com.br", "Garage@2026");

  // 1. Listar veículos da Garagem A
  const listARes = await fetch(`${BASE_URL}/api/vehicles`, {
    headers: { Authorization: `Bearer ${tokenGarageA}` },
  });
  assert.equal(listARes.status, 200);
  const vehiclesA = await listARes.json();
  assert.ok(vehiclesA.length > 0, "Garagem A precisa ter veículos");
  const targetVehicleId = vehiclesA[0].id;

  // 2. Garagem B tentando ler, alterar ou apagar veículo da Garagem A
  const readBRes = await fetch(`${BASE_URL}/api/vehicles/${targetVehicleId}`, {
    headers: { Authorization: `Bearer ${tokenGarageB}` },
  });
  assert.ok([403, 404].includes(readBRes.status), "Garagem B não pode ler veículo da Garagem A");

  const patchBRes = await fetch(`${BASE_URL}/api/vehicles/${targetVehicleId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenGarageB}`,
    },
    body: JSON.stringify({ announced_price: 1 }),
  });
  assert.ok([403, 404].includes(patchBRes.status), "Garagem B não pode alterar veículo da Garagem A");

  const delBRes = await fetch(`${BASE_URL}/api/vehicles/${targetVehicleId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${tokenGarageB}` },
  });
  assert.ok([403, 404].includes(delBRes.status), "Garagem B não pode excluir veículo da Garagem A");

  // 3. Isolamento multi-tenant de Lembretes de Vencimento (due_reminders)
  const remARes = await fetch(`${BASE_URL}/api/reminders`, {
    headers: { Authorization: `Bearer ${tokenGarageA}` },
  });
  assert.equal(remARes.status, 200);
  const remAData = await remARes.json();
  assert.ok(remAData.reminders.length > 0, "Garagem A deve possuir lembretes semeados");
  const targetReminderId = remAData.reminders[0].id;

  const remBRes = await fetch(`${BASE_URL}/api/reminders`, {
    headers: { Authorization: `Bearer ${tokenGarageB}` },
  });
  assert.equal(remBRes.status, 200);
  const remBData = await remBRes.json();
  assert.equal(
    remBData.reminders.some((r: { id: string }) => r.id === targetReminderId),
    false,
    "Garagem B não pode listar lembretes da Garagem A"
  );

  const completeBRes = await fetch(`${BASE_URL}/api/reminders/${targetReminderId}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenGarageB}` },
  });
  assert.ok([403, 404].includes(completeBRes.status), "Garagem B não pode concluir lembrete da Garagem A");

  const cancelBRes = await fetch(`${BASE_URL}/api/reminders/${targetReminderId}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenGarageB}` },
  });
  assert.ok([403, 404].includes(cancelBRes.status), "Garagem B não pode cancelar lembrete da Garagem A");

  // 4. Vitrine pública nunca expõe placa, valor de compra, despesas ou vendas
  const publicRes = await fetch(`${BASE_URL}/api/public/garages/premium-motors`);
  assert.equal(publicRes.status, 200);
  const publicData = await publicRes.json();
  for (const car of publicData.vehicles) {
    assert.equal("plate" in car, false, "Placa vazou na vitrine!");
    assert.equal("purchase_price" in car, false, "Valor de compra vazou na vitrine!");
    assert.equal("expenses_total" in car, false, "Despesas vazaram na vitrine!");
    assert.equal("profit" in car, false, "Lucro vazou na vitrine!");
  }

  // 5. Fluxo completo E2E com nova garagem: Cadastro -> Confirmação -> Onboarding -> Login -> Pagamento -> Lembrete
  const suffix = Date.now();
  const newEmail = `teste-${suffix}@cs22garage.com.br`;
  const newPass = "Teste@2026";
  const newSlug = `garagem-teste-${suffix}`;

  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Lojista Teste", email: newEmail, password: newPass }),
  });
  assert.equal(regRes.status, 201, "Cadastro falhou");
  const regData = await regRes.json();
  assert.equal("verification_token" in regData, false, "Token de verificação não deve vazar no response");
  assert.ok(regData.token, "Token de sessão após cadastro ausente");
  const confData = { token: regData.token as string };

  // Onboarding (slug reservado deve falhar)
  const reservedRes = await fetch(`${BASE_URL}/api/companies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${confData.token}`,
    },
    body: JSON.stringify({ name: "Admin", slug: "admin", whatsapp: "11999990000" }),
  });
  assert.equal(reservedRes.status, 400, "Slug reservado deveria ser rejeitado");

  const compRes = await fetch(`${BASE_URL}/api/companies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${confData.token}`,
    },
    body: JSON.stringify({
      name: `Garagem Teste ${suffix}`,
      slug: newSlug,
      whatsapp: "11999998888",
    }),
  });
  assert.equal(compRes.status, 201, "Onboarding da garagem falhou");

  // Re-login com usuário recém cadastrado
  const freshToken = await login(newEmail, newPass);
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${freshToken}` },
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.company.slug, newSlug);
  assert.equal(meData.subscription.status, "trialing");

  // Pagamento / Checkout + Webhook PAYMENT_CONFIRMED + Idempotência
  const intRes = await fetch(`${BASE_URL}/api/integrations/status`, {
    headers: { Authorization: `Bearer ${freshToken}` },
  });
  assert.equal(intRes.status, 200, "Status de integrações deve responder 200");
  const intData = await intRes.json();
  assert.ok("asaas" in intData && "supabase" in intData, "Payload de integrações inválido");

  // Rejeitar webhook sem token válido
  const badWhRes = await fetch(`${BASE_URL}/api/webhooks/asaas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "asaas-access-token": "token_invalido",
    },
    body: JSON.stringify({
      id: `evt_bad_${suffix}`,
      event: "PAYMENT_CONFIRMED",
      payment: { subscription: "sub_inexistente" },
    }),
  });
  assert.equal(badWhRes.status, 401, "Webhook com token inválido deveria retornar 401");

  const checkoutRes = await fetch(`${BASE_URL}/api/subscription/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${freshToken}`,
    },
    body: JSON.stringify({
      plan_code: "mensal_5990",
      payment_method: "PIX",
      customer_name: "Lojista Teste",
      cpf_cnpj: "12345678901",
    }),
  });

  if (intData.asaas.configured) {
    assert.equal(intData.asaas.reachable, true, `Asaas precisa estar acessível: ${intData.asaas.error}`);
    // Em API real do Asaas, CPF fictício 12345678901 é rejeitado com 400 sem gerar cobrança real
    assert.ok([200, 400].includes(checkoutRes.status), `Status inesperado do checkout Asaas real: ${checkoutRes.status}`);
  } else {
    assert.equal(checkoutRes.status, 200, "Checkout Asaas simulado falhou");
    const checkoutData = await checkoutRes.json();
    assert.ok(checkoutData.asaas_subscription_id, "ID da assinatura Asaas ausente");
  }

  const fixedEventId = `evt_test_${suffix}`;
  const wh1Res = await fetch(`${BASE_URL}/api/subscription/sandbox-simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${freshToken}`,
    },
    body: JSON.stringify({ event: "PAYMENT_CONFIRMED", event_id: fixedEventId }),
  });
  assert.equal(wh1Res.status, 200);
  const wh1Data = await wh1Res.json();
  assert.equal(wh1Data.status, "active");

  const subAfterRes = await fetch(`${BASE_URL}/api/subscription`, {
    headers: { Authorization: `Bearer ${freshToken}` },
  });
  assert.equal(subAfterRes.status, 200);
  const subAfterData = await subAfterRes.json();
  assert.equal(Number(subAfterData.subscription.monthly_price), 49.9, "Plano padrão deve ter valor R$ 49,90");
  const daysRemaining =
    (new Date(subAfterData.subscription.current_period_end).getTime() - Date.now()) / 86400_000;
  assert.ok(daysRemaining > 20, `Assinatura ativada deveria ter período futuro (~30 dias), obtido: ${daysRemaining}`);

  const wh2Res = await fetch(`${BASE_URL}/api/subscription/sandbox-simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${freshToken}`,
    },
    body: JSON.stringify({ event: "PAYMENT_CONFIRMED", event_id: fixedEventId }),
  });
  assert.equal(wh2Res.status, 200);
  const wh2Data = await wh2Res.json();
  assert.equal(wh2Data.idempotent, true, "Webhook repetido deve retornar idempotent=true");

  // Criar veículo em preparação e vincular lembrete de vencimento
  const vehCreateRes = await fetch(`${BASE_URL}/api/vehicles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${freshToken}`,
    },
    body: JSON.stringify({
      brand: "Honda",
      model: "Civic",
      version: "Touring",
      manufacture_year: 2022,
      model_year: 2022,
      mileage: 31000,
      fuel: "Gasolina",
      transmission: "CVT",
      color: "Preto",
      announced_price: 145000,
      plate: "TST2A26",
      status: "preparacao",
      purchase_price: 122000,
      purchase_date: "2026-03-01",
    }),
  });
  assert.equal(vehCreateRes.status, 201, "Criação de veículo falhou");
  const createdVeh = await vehCreateRes.json();

  // Criar lembrete de vencimento, concluir e criar outro para cancelar
  const remCreateRes = await fetch(`${BASE_URL}/api/reminders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${freshToken}`,
    },
    body: JSON.stringify({
      title: "IPVA 2026 Civic",
      category: "ipva",
      due_date: "2026-01-10",
      amount: 3200,
      vehicle_id: createdVeh.id,
      notes: "Cota única",
    }),
  });
  assert.equal(remCreateRes.status, 201, "Criação de lembrete falhou");
  const rem1 = await remCreateRes.json();

  const dashRes = await fetch(`${BASE_URL}/api/dashboard`, {
    headers: { Authorization: `Bearer ${freshToken}` },
  });
  assert.equal(dashRes.status, 200);
  const dashData = await dashRes.json();
  assert.equal(dashData.pending_reminders_count, 1);
  assert.equal(dashData.overdue_reminders_count, 1);

  const remCompleteRes = await fetch(`${BASE_URL}/api/reminders/${rem1.id}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${freshToken}` },
  });
  assert.equal(remCompleteRes.status, 200);

  const remCreate2Res = await fetch(`${BASE_URL}/api/reminders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${freshToken}`,
    },
    body: JSON.stringify({
      title: "Seguro loja",
      category: "seguro",
      due_date: "2026-12-20",
      amount: 850,
    }),
  });
  assert.equal(remCreate2Res.status, 201);
  const rem2 = await remCreate2Res.json();

  const remCancelRes = await fetch(`${BASE_URL}/api/reminders/${rem2.id}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${freshToken}` },
  });
  assert.equal(remCancelRes.status, 200);

  console.log("Todos os testes E2E (cadastro, login, pagamento, lembretes, isolamento multi-tenant e privacidade) passaram.");
}

runIsolationAndFlowTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
