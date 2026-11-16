import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Ban,
  Plus,
  CreditCard,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  formatBRL,
  formatDateBR,
  REMINDER_CATEGORY_LABELS,
  type DueReminder,
  type ReminderCategory,
  type RemindersResponse,
  type SubscriptionDueAlert,
  type VehicleFinancial,
} from '../types/garage';

interface RemindersPageProps {
  navigate: (to: string) => void;
}

type ReminderFilter = 'pendentes' | 'concluidos' | 'todos';

function getDaysDiffFromToday(isoDate: string): number {
  const today = new Date();
  const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const [y, m, d] = isoDate.split('T')[0].split('-').map(Number);
  const dueMidnight = Date.UTC(y, m - 1, d);
  return Math.round((dueMidnight - todayMidnight) / 86400000);
}

export function RemindersPage({ navigate }: RemindersPageProps) {
  const [reminders, setReminders] = useState<DueReminder[]>([]);
  const [subAlert, setSubAlert] = useState<SubscriptionDueAlert | null>(null);
  const [vehicles, setVehicles] = useState<VehicleFinancial[]>([]);
  const [filter, setFilter] = useState<ReminderFilter>('pendentes');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ReminderCategory>('ipva');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [remRes, vehRes] = await Promise.all([
        apiRequest<RemindersResponse>('/api/reminders'),
        apiRequest<VehicleFinancial[]>('/api/vehicles'),
      ]);
      setReminders(remRes.reminders);
      setSubAlert(remRes.subscription_alert);
      setVehicles(vehRes.filter((v) => v.status !== 'inativo'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar lembretes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      await apiRequest('/api/reminders', {
        method: 'POST',
        body: JSON.stringify({
          title,
          category,
          due_date: dueDate,
          amount: amount ? Number(amount) : null,
          vehicle_id: vehicleId || null,
          notes,
        }),
      });
      setTitle('');
      setAmount('');
      setVehicleId('');
      setNotes('');
      setSuccess('Lembrete de vencimento salvo.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar lembrete.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async (id: string) => {
    setError('');
    setSuccess('');
    try {
      await apiRequest(`/api/reminders/${id}/complete`, { method: 'POST' });
      setSuccess('Lembrete marcado como concluído.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao concluir lembrete.');
    }
  };

  const handleCancel = async (id: string) => {
    setError('');
    setSuccess('');
    try {
      await apiRequest(`/api/reminders/${id}/cancel`, { method: 'POST' });
      setSuccess('Lembrete cancelado (histórico preservado).');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar lembrete.');
    }
  };

  const filteredReminders = reminders.filter((item) => {
    if (filter === 'pendentes') return !item.completed_at && !item.canceled_at;
    if (filter === 'concluidos') return Boolean(item.completed_at) && !item.canceled_at;
    return !item.canceled_at;
  });

  const pendingCount = reminders.filter((r) => !r.completed_at && !r.canceled_at).length;
  const overdueCount = reminders.filter(
    (r) => !r.completed_at && !r.canceled_at && getDaysDiffFromToday(r.due_date) < 0
  ).length;

  return (
    <div className="space-y-6">
      {/* Alerta automático de assinatura / teste grátis */}
      {subAlert && (
        <div
          className={`rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            subAlert.level === 'danger'
              ? 'bg-red-50 border-red-200 text-red-950'
              : subAlert.level === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-950'
              : 'bg-white border-slate-200 text-slate-900'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                subAlert.level === 'danger'
                  ? 'bg-red-100 text-red-700'
                  : subAlert.level === 'warning'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-brand-dark text-white'
              }`}
            >
              {subAlert.level === 'danger' ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <CreditCard className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-bold">{subAlert.title}</p>
              <p className="text-xs sm:text-sm opacity-85 mt-0.5">{subAlert.description}</p>
              {subAlert.due_date && (
                <p className="text-xs font-mono mt-1 opacity-75">
                  Vencimento: {formatDateBR(subAlert.due_date)}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/app/assinatura')}
            className="min-h-[44px] px-4 py-2 bg-brand-blue hover:bg-brand-blue-hover text-white text-xs sm:text-sm font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            Ir para pagamento / assinatura
          </button>
        </div>
      )}

      {/* Resumo rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Pendentes</p>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-slate-900">{pendingCount}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Vencidos</p>
          <p
            className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${
              overdueCount > 0 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {overdueCount}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500">Atalho</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Veículos da garagem</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/app/veiculos')}
            className="min-h-[40px] px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            Ver estoque
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs sm:text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs sm:text-sm text-emerald-900">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Formulário curto de novo lembrete */}
        <form
          onSubmit={handleCreate}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-brand-blue shrink-0" />
            <h2 className="font-display text-base font-bold text-slate-900">Novo lembrete de vencimento</h2>
          </div>
          <p className="text-xs text-slate-500">
            Controle vencimentos de IPVA, licenciamento, seguro, parcelas ou renovações da loja.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Título do vencimento</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: IPVA 2026 - Cota única"
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Categoria</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ReminderCategory)}
                className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              >
                {Object.entries(REMINDER_CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Data de vencimento</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Valor previsto (R$, opcional)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Veículo (opcional)</label>
              <select
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              >
                <option value="">Geral da garagem</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} ({v.plate || v.model_year})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Observações (opcional)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Pagar no aplicativo do banco antes das 16h"
              className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[46px] py-2.5 bg-brand-blue hover:bg-brand-blue-hover disabled:opacity-60 text-white text-sm font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{submitting ? 'Salvando...' : 'Criar lembrete'}</span>
          </button>
        </form>

        {/* Lista de lembretes */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-display text-base font-bold text-slate-900">Agenda de vencimentos</h2>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {(
                [
                  { id: 'pendentes', label: 'Pendentes' },
                  { id: 'concluidos', label: 'Concluídos' },
                  { id: 'todos', label: 'Todos' },
                ] as Array<{ id: ReminderFilter; label: string }>
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    filter === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filteredReminders.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-display text-sm font-bold text-slate-900">Nenhum lembrete nesta visualização</p>
              <p className="mt-1 text-xs text-slate-500">
                Cadastre um vencimento de IPVA, seguro, revisão ou parcela ao lado.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredReminders.map((rem) => {
                const diffDays = getDaysDiffFromToday(rem.due_date);
                const isDone = Boolean(rem.completed_at);
                const isOverdue = !isDone && diffDays < 0;
                const isToday = !isDone && diffDays === 0;
                const isSoon = !isDone && diffDays > 0 && diffDays <= 7;

                return (
                  <div
                    key={rem.id}
                    className={`p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isDone ? 'bg-slate-50/70' : ''
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-sm font-bold ${
                            isDone ? 'line-through text-slate-500' : 'text-slate-900'
                          }`}
                        >
                          {rem.title}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {REMINDER_CATEGORY_LABELS[rem.category]}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span
                          className={`inline-flex items-center gap-1 font-mono font-semibold tabular-nums ${
                            isOverdue
                              ? 'text-red-700'
                              : isToday
                              ? 'text-amber-700'
                              : isSoon
                              ? 'text-brand-blue'
                              : 'text-slate-600'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {formatDateBR(rem.due_date)}
                            {isDone
                              ? ` · Concluído em ${formatDateBR(rem.completed_at)}`
                              : isOverdue
                              ? ` · Vencido há ${Math.abs(diffDays)}d`
                              : isToday
                              ? ' · Vence hoje'
                              : ` · Em ${diffDays}d`}
                          </span>
                        </span>

                        {rem.amount !== null && rem.amount > 0 && (
                          <span className="font-mono font-semibold text-slate-800 tabular-nums">
                            {formatBRL(rem.amount)}
                          </span>
                        )}

                        {rem.vehicle_id && rem.vehicle_label && (
                          <button
                            type="button"
                            onClick={() => navigate(`/app/veiculos/${rem.vehicle_id}`)}
                            className="font-medium text-brand-blue hover:underline text-left"
                          >
                            {rem.vehicle_label}
                          </button>
                        )}
                      </div>

                      {rem.notes && <p className="text-xs text-slate-500">{rem.notes}</p>}
                    </div>

                    {!isDone && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleComplete(rem.id)}
                          className="min-h-[40px] px-3 py-1.5 bg-brand-green hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Marcar pago</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancel(rem.id)}
                          title="Cancelar lembrete"
                          className="min-h-[40px] min-w-[40px] px-2.5 py-1.5 border border-slate-200 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-xl inline-flex items-center justify-center transition-colors"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
