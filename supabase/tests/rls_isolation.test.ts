/**
 * Teste automatizado de isolamento multi-tenant (PRD Fase 1 - Segurança)
 * Verifica que a Garagem A nunca lê, altera ou apaga dados da Garagem B,
 * e que a vitrine pública nunca expõe placa, compra, despesas ou vendas.
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

async function runIsolationTests() {
  const tokenGarageA = await login("contato@premiummotors.com.br", "Garage@2026");
  const tokenGarageB = await login("vendas@horizonteauto.com.br", "Garage@2026");

  // 1. Listar veículos da Garagem A
  const listARes = await fetch(`${BASE_URL}/api/vehicles`, {
    headers: { Authorization: `Bearer ${tokenGarageA}` },
  });
  const vehiclesA = await listARes.json();
  assert.ok(vehiclesA.length > 0, "Garagem A precisa ter veículos");
  const targetVehicleId = vehiclesA[0].id;

  // 2. Garagem B tentando ler veículo da Garagem A
  const readBRes = await fetch(`${BASE_URL}/api/vehicles/${targetVehicleId}`, {
    headers: { Authorization: `Bearer ${tokenGarageB}` },
  });
  assert.ok([403, 404].includes(readBRes.status), "Garagem B não pode ler veículo da Garagem A");

  // 3. Garagem B tentando alterar veículo da Garagem A
  const patchBRes = await fetch(`${BASE_URL}/api/vehicles/${targetVehicleId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenGarageB}`,
    },
    body: JSON.stringify({ announced_price: 1 }),
  });
  assert.ok([403, 404].includes(patchBRes.status), "Garagem B não pode alterar veículo da Garagem A");

  // 4. Garagem B tentando apagar veículo da Garagem A
  const delBRes = await fetch(`${BASE_URL}/api/vehicles/${targetVehicleId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${tokenGarageB}` },
  });
  assert.ok([403, 404].includes(delBRes.status), "Garagem B não pode excluir veículo da Garagem A");

  // 5. Vitrine pública nunca expõe placa, valor de compra, despesas ou vendas
  const publicRes = await fetch(`${BASE_URL}/api/public/garages/premium-motors`);
  assert.equal(publicRes.status, 200);
  const publicData = await publicRes.json();
  for (const car of publicData.vehicles) {
    assert.equal("plate" in car, false, "Placa vazou na vitrine!");
    assert.equal("purchase_price" in car, false, "Valor de compra vazou na vitrine!");
    assert.equal("expenses_total" in car, false, "Despesas vazaram na vitrine!");
    assert.equal("profit" in car, false, "Lucro vazou na vitrine!");
  }

  console.log("Todos os testes de isolamento multi-tenant e privacidade passaram.");
}

runIsolationTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
