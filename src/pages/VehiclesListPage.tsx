import { useEffect, useState } from 'react';
import { Search, Plus, ChevronRight } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  formatBRL,
  formatKm,
  formatPercent,
  VEHICLE_STATUS_LABELS,
  type VehicleFinancial,
  type VehicleStatus,
} from '../types/garage';
import { VehicleImage } from '../components/VehicleImage';

interface VehiclesListPageProps {
  navigate: (to: string) => void;
}

const FILTER_OPTIONS: Array<{ value: '' | VehicleStatus; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'disponivel', label: 'Disponíveis' },
  { value: 'reservado', label: 'Reservados' },
  { value: 'vendido', label: 'Vendidos' },
  { value: 'inativo', label: 'Inativos' },
];

export function VehiclesListPage({ navigate }: VehiclesListPageProps) {
  const [vehicles, setVehicles] = useState<VehicleFinancial[]>([]);
  const [status, setStatus] = useState<'' | VehicleStatus>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search.trim()) params.set('q', search.trim());

    apiRequest<VehicleFinancial[]>(`/api/vehicles?${params.toString()}`)
      .then((res) => {
        if (active) setVehicles(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Erro ao listar veículos.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, search]);

  return (
    <div className="space-y-5">
      {/* Search & Status Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar marca, modelo ou placa..."
            className="w-full h-11 pl-10 pr-4 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl overflow-x-auto">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setStatus(opt.value)}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                status === opt.value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : vehicles.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <p className="font-display text-base font-bold text-slate-900">Nenhum veículo encontrado</p>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre o primeiro carro para publicar na vitrine e controlar despesas e lucro.
          </p>
          <button
            type="button"
            onClick={() => navigate('/app/veiculos/novo')}
            className="mt-5 min-h-[44px] px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Cadastrar primeiro veículo</span>
          </button>
        </div>
      ) : (
        <>
          {/* Mobile List Cards */}
          <div className="lg:hidden space-y-3">
            {vehicles.map((car) => (
              <button
                key={car.id}
                type="button"
                onClick={() => navigate(`/app/veiculos/${car.id}`)}
                className="w-full bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3.5 text-left active:bg-slate-50 transition-colors"
              >
                <VehicleImage
                  src={car.cover_photo}
                  alt={`${car.brand} ${car.model}`}
                  className="w-20 h-16 rounded-lg object-cover shrink-0 border border-slate-200"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {car.brand} {car.model}
                    </p>
                    <span
                      className={`text-[11px] font-semibold shrink-0 ${
                        car.status === 'disponivel'
                          ? 'text-emerald-700'
                          : car.status === 'reservado'
                          ? 'text-amber-700'
                          : car.status === 'vendido'
                          ? 'text-blue-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {VEHICLE_STATUS_LABELS[car.status]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {car.manufacture_year}/{car.model_year} · {formatKm(car.mileage)} · {car.plate || 'Sem placa'}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {formatBRL(car.status === 'vendido' && car.sale_price ? car.sale_price : car.announced_price)}
                    </span>
                    {car.status === 'vendido' && car.profit !== null ? (
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          car.profit >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        Lucro {formatBRL(car.profit)}
                      </span>
                    ) : (
                      <span className="font-mono text-slate-500 tabular-nums">
                        CMV {formatBRL(car.total_cost)} · {car.days_in_stock}d
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            ))}
          </div>

          {/* Desktop High-Density Data Table */}
          <div className="hidden lg:block bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-4">Veículo</th>
                  <th className="py-3 px-4">Placa</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">CMV (Compra + Desp.)</th>
                  <th className="py-3 px-4 text-right">Anunciado / Venda</th>
                  <th className="py-3 px-4 text-right">Lucro / Margem</th>
                  <th className="py-3 px-4 text-right">Estoque</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {vehicles.map((car) => (
                  <tr
                    key={car.id}
                    onClick={() => navigate(`/app/veiculos/${car.id}`)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <VehicleImage
                          src={car.cover_photo}
                          alt={`${car.brand} ${car.model}`}
                          className="w-14 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {car.brand} {car.model} {car.version}
                          </p>
                          <p className="text-xs text-slate-500">
                            {car.manufacture_year}/{car.model_year} · {formatKm(car.mileage)} · {car.color || '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{car.plate || '—'}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold ${
                          car.status === 'disponivel'
                            ? 'text-emerald-700'
                            : car.status === 'reservado'
                            ? 'text-amber-700'
                            : car.status === 'vendido'
                            ? 'text-blue-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {VEHICLE_STATUS_LABELS[car.status]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {formatBRL(car.total_cost)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatBRL(car.status === 'vendido' && car.sale_price ? car.sale_price : car.announced_price)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                      {car.status === 'vendido' && car.profit !== null ? (
                        <span className={car.profit >= 0 ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>
                          {formatBRL(car.profit)} ({formatPercent(car.margin_ratio)})
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {car.days_in_stock}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
