import React, { useEffect, useState, useCallback } from 'react';
import { CreditCard, ShieldCheck, AlertTriangle, ChevronDown } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  formatBRL,
  formatDateBR,
  SUBSCRIPTION_STATUS_LABELS,
  type AsaasEventRecord,
  type AuditLogEntry,
  type PaymentMethod,
  type PlanCode,
  type Subscription,
} from '../types/garage';

export function SubscriptionPage() {
  const { refreshSession } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [events, setEvents] = useState<AsaasEventRecord[]>([]);
  const [audits, setAudits] = useState<AuditLogEntry[]>([]);
  const [planCode, setPlanCode] = useState<PlanCode>('mensal_5990');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');
  const [customerName, setCustomerName] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showSandbox, setShowSandbox] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadSubscription = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        subscription: Subscription;
        events: AsaasEventRecord[];
        audit_logs: AuditLogEntry[];
      }>('/api/subscription');
      setSub(res.subscription);
      setEvents(res.events);
      setAudits(res.audit_logs);
      if (res.subscription?.plan_code) {
        setPlanCode(res.subscription.plan_code);
      }
      if (res.subscription?.payment_method) {
        setPaymentMethod(res.subscription.payment_method);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar assinatura.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string; asaas_subscription_id: string }>('/api/subscription/checkout', {
        method: 'POST',
        body: JSON.stringify({
          plan_code: planCode,
          payment_method: paymentMethod,
          customer_name: customerName,
          cpf_cnpj: cpfCnpj,
        }),
      });
      setMessage(`${res.message} (ID Asaas: ${res.asaas_subscription_id})`);
      await loadSubscription();
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar cobrança.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/subscription/cancel', { method: 'POST' });
      setMessage(res.message);
      await loadSubscription();
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar assinatura.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimulateWebhook = async (event: string, fixedEventId?: string) => {
    setError('');
    setMessage('');
    try {
      const res = await apiRequest<{ ok?: boolean; idempotent?: boolean; status?: string; event_id?: string }>(
        '/api/subscription/sandbox-simulate',
        {
          method: 'POST',
          body: JSON.stringify({ event, event_id: fixedEventId }),
        }
      );
      if (res.idempotent) {
        setMessage(`Evento duplicado (${fixedEventId}) ignorado com segurança (idempotência).`);
      } else {
        setMessage(`Webhook ${event} processado. Nova situação: ${res.status}.`);
      }
      await loadSubscription();
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar webhook.');
    }
  };

  if (loading) {
    return <div className="h-56 bg-white border border-slate-200 rounded-2xl animate-pulse" />;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Status Summary */}
      {sub && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">Situação atual da assinatura</p>
            <div className="mt-1 flex items-center gap-3">
              <h2 className="font-display text-xl font-bold text-slate-900">
                {SUBSCRIPTION_STATUS_LABELS[sub.status]}
              </h2>
              <span
                className={`text-xs font-semibold ${
                  sub.has_access ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {sub.has_access ? 'Acesso e vitrine ativos' : 'Acesso bloqueado e vitrine fora do ar'}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {sub.status === 'trialing' && `Restam ${sub.days_left_in_trial} dias no teste gratuito de 7 dias.`}
              {sub.status === 'active' &&
                `Renovação prevista para ${formatDateBR(sub.current_period_end)}. Valor: ${formatBRL(sub.monthly_price)}.`}
              {sub.status === 'overdue' &&
                `Cobrança vencida em ${formatDateBR(sub.overdue_since)}. Tolerância de ${sub.grace_days} dias.`}
              {sub.status === 'suspended' && 'Tolerância esgotada. Confirme um pagamento para reativar imediatamente.'}
              {sub.status === 'canceled' &&
                `Cancelada em ${formatDateBR(sub.canceled_at)}. Acesso mantido até ${formatDateBR(sub.current_period_end)}.`}
            </p>
          </div>

          {sub.status === 'active' && (
            <button
              type="button"
              disabled={submitting}
              onClick={handleCancel}
              className="min-h-[40px] px-4 py-2 border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Cancelar assinatura
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs sm:text-sm text-red-800">{error}</div>
      )}
      {message && (
        <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs sm:text-sm text-blue-900">{message}</div>
      )}

      {/* Checkout Asaas */}
      <form onSubmit={handleCheckout} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <CreditCard className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Ativar ou alterar plano no Asaas</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              O acesso é liberado exclusivamente quando o Asaas confirma o pagamento via webhook.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { code: 'fundador_3990' as PlanCode, title: 'Fundador', price: 'R$ 39,90/mês', desc: '20 primeiras garagens' },
            { code: 'mensal_5990' as PlanCode, title: 'Mensal', price: 'R$ 59,90/mês', desc: 'Sem fidelidade' },
            { code: 'anual_599' as PlanCode, title: 'Anual', price: 'R$ 599,00/ano', desc: 'Economize 2 meses' },
          ].map((p) => (
            <button
              key={p.code}
              type="button"
              onClick={() => setPlanCode(p.code)}
              className={`p-4 rounded-xl border text-left transition-colors ${
                planCode === p.code ? 'border-blue-700 bg-blue-50/50' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <p className="text-xs font-semibold text-slate-500">{p.desc}</p>
              <p className="mt-1 font-display text-base font-bold text-slate-900">{p.title}</p>
              <p className="mt-1 font-mono text-sm font-bold text-blue-700 tabular-nums">{p.price}</p>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-2">Forma de pagamento</label>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { id: 'PIX', label: 'Pix' },
                { id: 'BOLETO', label: 'Boleto' },
                { id: 'CREDIT_CARD', label: 'Cartão' },
              ] as Array<{ id: PaymentMethod; label: string }>
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setPaymentMethod(m.id)}
                className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-semibold transition-colors ${
                  paymentMethod === m.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nome ou Razão Social</label>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nome para cobrança"
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">CPF ou CNPJ</label>
            <input
              type="text"
              required
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(e.target.value)}
              placeholder="Somente números"
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="min-h-[46px] px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {submitting ? 'Gerando assinatura...' : 'Gerar assinatura no Asaas'}
        </button>
      </form>

      {/* Sandbox Asaas Webhook Verification Drawer */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowSandbox(!showSandbox)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-slate-600" />
            <span className="text-sm font-semibold text-slate-900">
              Simulador de Webhook Asaas (Sandbox e Idempotência)
            </span>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showSandbox ? 'rotate-180' : ''}`} />
        </button>

        {showSandbox && (
          <div className="px-5 pb-5 pt-2 border-t border-slate-200 space-y-4">
            <p className="text-xs text-slate-600">
              Teste os cenários de webhook exigidos no PRD: confirmação de pagamento, atraso, suspensão após tolerância,
              estorno e envio duplicado com o mesmo ID de evento.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleSimulateWebhook('PAYMENT_CONFIRMED')}
                className="min-h-[38px] px-3 py-1.5 bg-emerald-700 text-white text-xs font-semibold rounded-lg hover:bg-emerald-800"
              >
                PAYMENT_CONFIRMED (Ativar)
              </button>
              <button
                type="button"
                onClick={() => handleSimulateWebhook('PAYMENT_OVERDUE')}
                className="min-h-[38px] px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700"
              >
                PAYMENT_OVERDUE (Em atraso)
              </button>
              <button
                type="button"
                onClick={() => handleSimulateWebhook('GRACE_PERIOD_EXPIRED')}
                className="min-h-[38px] px-3 py-1.5 bg-red-700 text-white text-xs font-semibold rounded-lg hover:bg-red-800"
              >
                Suspender (Tolerância esgotada)
              </button>
              <button
                type="button"
                onClick={() => handleSimulateWebhook('PAYMENT_REFUNDED')}
                className="min-h-[38px] px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-900"
              >
                PAYMENT_REFUNDED (Estorno)
              </button>
              <button
                type="button"
                onClick={() => handleSimulateWebhook('PAYMENT_CONFIRMED', 'evt_idempotency_test_001')}
                className="min-h-[38px] px-3 py-1.5 bg-slate-100 border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg hover:bg-slate-200"
              >
                Testar Idempotência (ID fixo)
              </button>
            </div>

            {events.length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-700 mb-2">Últimos eventos em asaas_events</p>
                <div className="space-y-1.5">
                  {events.slice(0, 5).map((ev) => (
                    <div key={ev.id} className="text-xs font-mono text-slate-600 flex items-center justify-between">
                      <span className="truncate">
                        {ev.event_type} · {ev.event_id}
                      </span>
                      <span className={ev.error_message ? 'text-red-700' : 'text-emerald-700'}>
                        {ev.error_message ? 'Erro' : 'Processado'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {audits.length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-700 mb-2">Últimos registros de auditoria</p>
                <div className="space-y-1.5">
                  {audits.slice(0, 5).map((a) => (
                    <div key={a.id} className="text-xs text-slate-600 flex items-center justify-between gap-4">
                      <span className="font-mono truncate">{a.action}</span>
                      <span className="text-slate-400 shrink-0">{formatDateBR(a.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
