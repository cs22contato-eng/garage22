import React, { useEffect, useState, useCallback } from 'react';
import { CreditCard, CalendarClock, ExternalLink } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  DEFAULT_PLAN_CODE,
  formatBRL,
  formatDateBR,
  SUBSCRIPTION_STATUS_LABELS,
  type PaymentMethod,
  type Subscription,
} from '../types/garage';

interface SubscriptionPageProps {
  navigate: (to: string) => void;
}

export function SubscriptionPage({ navigate }: SubscriptionPageProps) {
  const { company, refreshSession } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');
  const [customerName, setCustomerName] = useState(() => company?.name || '');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadSubscription = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ subscription: Subscription }>('/api/subscription');
      setSub(res.subscription);
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
    setInvoiceUrl(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{
        message: string;
        asaas_subscription_id: string;
        invoice_url: string | null;
      }>('/api/subscription/checkout', {
        method: 'POST',
        body: JSON.stringify({
          plan_code: DEFAULT_PLAN_CODE,
          payment_method: paymentMethod,
          customer_name: customerName,
          cpf_cnpj: cpfCnpj,
        }),
      });
      setInvoiceUrl(res.invoice_url);
      setMessage(res.message);
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
      setConfirmCancel(false);
      setMessage(res.message);
      await loadSubscription();
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar assinatura.');
    } finally {
      setSubmitting(false);
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
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-bold text-slate-900">
                {SUBSCRIPTION_STATUS_LABELS[sub.status]}
              </h2>
              <span
                className={`text-xs font-semibold ${
                  sub.has_access ? 'text-brand-green' : 'text-red-700'
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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/app/lembretes')}
              className="min-h-[40px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <CalendarClock className="w-4 h-4 text-brand-blue" />
              <span>Lembretes de vencimento</span>
            </button>

            {sub.status === 'active' &&
              (confirmCancel ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleCancel}
                    className="min-h-[40px] px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                  >
                    Confirmar cancelamento
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setConfirmCancel(false)}
                    className="min-h-[40px] px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                  >
                    Manter plano
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setConfirmCancel(true)}
                  className="min-h-[40px] px-4 py-2 border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                >
                  Cancelar assinatura
                </button>
              ))}
          </div>
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs sm:text-sm text-red-800">{error}</div>
      )}
      {message && (
        <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs sm:text-sm text-blue-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span>{message}</span>
          {invoiceUrl && (
            <a
              href={invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[38px] px-3.5 py-2 bg-brand-blue hover:bg-brand-blue-hover text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <span>Abrir fatura Asaas</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {/* Checkout Asaas */}
      <form onSubmit={handleCheckout} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <CreditCard className="w-5 h-5 text-brand-blue shrink-0 mt-0.5" />
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Ativar assinatura</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pagamento recorrente seguro via Pix, boleto ou cartão. A liberação ocorre automaticamente após a confirmação.
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-xl border-2 border-brand-blue bg-blue-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-brand-blue">Plano único</p>
            <p className="mt-0.5 font-display text-base font-bold text-slate-900">Plano Padrão</p>
            <p className="mt-0.5 text-xs text-slate-600">
              Acesso completo · Cobrança mensal recorrente no Asaas · Cancele quando quiser
            </p>
          </div>
          <p className="font-mono text-xl font-bold text-brand-blue tabular-nums shrink-0">
            R$ 49,90<span className="text-xs font-sans font-normal text-slate-600">/mês</span>
          </p>
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
                    ? 'border-brand-dark bg-brand-dark text-white'
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
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
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
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="min-h-[46px] px-6 py-2.5 bg-brand-blue hover:bg-brand-blue-hover disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {submitting ? 'Gerando cobrança...' : 'Assinar Plano Padrão (R$ 49,90/mês)'}
        </button>
      </form>
    </div>
  );
}
