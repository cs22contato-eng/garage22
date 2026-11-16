import { useEffect, useState } from 'react';
import {
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  ChevronRight,
  CalendarClock,
  Clock,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  buildVitrinePath,
  buildVitrinePublicUrl,
  formatBRL,
  formatDateBR,
  formatVitrineDisplayUrl,
  REMINDER_CATEGORY_LABELS,
  type DashboardMetrics,
} from '../types/garage';
import { VehicleImage } from '../components/VehicleImage';
import { PWAInstallPrompt } from '../components/PWAInstallPrompt';

interface DashboardPageProps {
  navigate: (to: string) => void;
}

export function DashboardPage({ navigate }: DashboardPageProps) {
  const { company } = useAuth();
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<DashboardMetrics>('/api/dashboard')
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Erro ao carregar painel.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const vitrineUrl = company ? buildVitrinePublicUrl(company.slug) : '';
  const vitrineDisplayUrl = company ? formatVitrineDisplayUrl(company.slug) : '';

  const copyVitrineLink = async () => {
    if (!vitrineUrl) return;
    try {
      await navigator.clipboard.writeText(vitrineUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors in restricted iframes
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Link da bio / Vitrine Pública */}
      {company && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">Link da sua vitrine para Instagram e WhatsApp</p>
            <p className="mt-1 font-mono text-sm font-medium text-slate-900 truncate">{vitrineDisplayUrl}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyVitrineLink}
              className="min-h-[40px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              {copied ? <Check className="w-4 h-4 text-brand-green" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copiado' : 'Copiar link'}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(buildVitrinePath(company.slug))}
              className="min-h-[40px] px-3.5 py-2 bg-brand-dark hover:bg-brand-navy text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>Abrir vitrine</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <PWAInstallPrompt hasRegisteredVehicle={data.total_vehicles_count > 0} />

      {/* Os 5 números do Painel (PRD Fase 1) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Carros disponíveis</p>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {data.available_count}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Vendidos no mês</p>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {data.sold_this_month_count}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 col-span-2 lg:col-span-1">
          <p className="text-xs font-medium text-slate-500">Lucro do mês</p>
          <p
            className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
              data.month_profit >= 0 ? 'text-brand-green' : 'text-red-700'
            }`}
          >
            {formatBRL(data.month_profit)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Dinheiro parado em estoque</p>
          <p className="mt-2 font-mono text-xl sm:text-2xl font-bold tabular-nums text-slate-900">
            {formatBRL(data.tied_up_capital)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Dias médios em estoque</p>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {data.avg_days_in_stock} <span className="text-xs font-sans font-normal text-slate-500">dias</span>
          </p>
        </div>
      </div>

      {/* Lembretes de vencimento + Carros parados */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarClock className="w-4 h-4 text-brand-blue shrink-0" />
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 truncate">
                Lembretes de vencimento
              </h2>
            </div>
            <span
              className={`font-mono text-xs font-semibold tabular-nums shrink-0 ${
                data.overdue_reminders_count > 0 ? 'text-red-700' : 'text-slate-600'
              }`}
            >
              {data.overdue_reminders_count > 0
                ? `${data.overdue_reminders_count} vencido(s)`
                : `${data.pending_reminders_count} pendente(s)`}
            </span>
          </div>

          <div className="flex-1 divide-y divide-slate-100">
            {data.upcoming_reminders.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-slate-700">Nenhum vencimento pendente.</p>
                <p className="mt-1 text-xs text-slate-500">
                  Adicione alertas de IPVA, seguro, revisão ou parcelas.
                </p>
              </div>
            ) : (
              data.upcoming_reminders.map((rem) => (
                <button
                  key={rem.id}
                  type="button"
                  onClick={() => navigate('/app/lembretes')}
                  className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{rem.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {REMINDER_CATEGORY_LABELS[rem.category]}
                      {rem.vehicle_label ? ` · ${rem.vehicle_label}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-brand-blue tabular-nums">
                      <Clock className="w-3 h-3 shrink-0" />
                      {formatDateBR(rem.due_date)}
                    </p>
                    {rem.amount !== null && rem.amount > 0 && (
                      <p className="font-mono text-xs text-slate-700 tabular-nums mt-0.5">
                        {formatBRL(rem.amount)}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="px-4 sm:px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => navigate('/app/lembretes')}
              className="min-h-[38px] px-3 py-1.5 bg-brand-blue hover:bg-brand-blue-hover text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Gerenciar lembretes
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/assinatura')}
              className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              Ver assinatura
            </button>
          </div>
        </section>

        {/* Lista de carros parados há mais de 60 dias */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
                Carros parados há mais de 60 dias
              </h2>
            </div>
            <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
              {data.stalled_vehicles.length} {data.stalled_vehicles.length === 1 ? 'veículo' : 'veículos'}
            </span>
          </div>

          {data.stalled_vehicles.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-700">Nenhum carro parado acima de 60 dias.</p>
              <p className="mt-1 text-xs text-slate-500">
                Quando algum veículo em estoque ultrapassar 60 dias desde a compra, ele aparece aqui.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.stalled_vehicles.map((car) => (
                <button
                  key={car.id}
                  type="button"
                  onClick={() => navigate(`/app/veiculos/${car.id}`)}
                  className="w-full px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <VehicleImage
                      src={car.cover_photo}
                      alt={`${car.brand} ${car.model}`}
                      className="w-14 h-11 rounded-lg object-cover shrink-0 border border-slate-200"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {car.brand} {car.model} {car.version}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {car.manufacture_year}/{car.model_year} · CMV {formatBRL(car.total_cost)} · Anunciado{' '}
                        {formatBRL(car.announced_price)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-xs sm:text-sm font-bold text-amber-700 tabular-nums">
                      {car.days_in_stock} dias
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
