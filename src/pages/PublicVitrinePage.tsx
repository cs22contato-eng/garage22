import { useEffect, useState } from 'react';
import { Search, Share2, MessageCircle, MapPin, Instagram, Check } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatBRL, formatKm, type PublicCompany, type PublicVehicle } from '../types/garage';
import { VehicleImage } from '../components/VehicleImage';

interface PublicVitrinePageProps {
  garageSlug: string;
  navigate: (to: string) => void;
}

export function PublicVitrinePage({ garageSlug, navigate }: PublicVitrinePageProps) {
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [vehicles, setVehicles] = useState<PublicVehicle[]>([]);
  const [q, setQ] = useState('');
  const [minYear, setMinYear] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (minYear) params.set('minYear', minYear);
    if (maxPrice) params.set('maxPrice', maxPrice);

    apiRequest<{ company: PublicCompany; vehicles: PublicVehicle[] }>(
      `/api/public/garages/${encodeURIComponent(garageSlug)}?${params.toString()}`
    )
      .then((res) => {
        if (!active) return;
        setCompany(res.company);
        setVehicles(res.vehicles);
        document.title = `${res.company.name} — Vitrine de Veículos`;
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Vitrine indisponível.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [garageSlug, q, minYear, maxPrice]);

  const handleShareGarage = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: company?.name || 'Vitrine de Veículos',
          text: `Confira o estoque disponível da ${company?.name || 'garagem'}:`,
          url,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <h1 className="font-display text-xl font-bold text-slate-900">Vitrine indisponível</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-6 min-h-[44px] px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl"
          >
            Ir para CS22 Garage
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Garage Header */}
      <header className="bg-white border-b border-slate-200">
        {company?.cover_url && (
          <div className="h-36 sm:h-52 w-full overflow-hidden bg-slate-900 relative">
            <img
              src={company.cover_url}
              alt={company.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover opacity-85"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            {company?.logo_url ? (
              <img
                src={company.logo_url}
                alt={company.name}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0 bg-white"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center font-display font-bold text-lg shrink-0">
                {company?.name?.slice(0, 2).toUpperCase() || 'CG'}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-display text-lg sm:text-2xl font-bold text-slate-900 truncate">
                {company?.name || 'Carregando garagem...'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                {company?.address && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{company.address}</span>
                  </span>
                )}
                {company?.instagram && (
                  <span className="inline-flex items-center gap-1">
                    <Instagram className="w-3.5 h-3.5 shrink-0" />
                    <span>{company.instagram}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleShareGarage}
              className="min-h-[42px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Share2 className="w-4 h-4" />}
              <span>{copied ? 'Link copiado' : 'Compartilhar'}</span>
            </button>

            {company?.whatsapp && (
              <a
                href={`https://wa.me/${company.whatsapp}?text=${encodeURIComponent(
                  `Olá! Vi o estoque da ${company.name} e gostaria de atendimento.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[42px] px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <MessageCircle className="w-4 h-4" />
                <span>WhatsApp</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Search & Filter Controls */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar marca ou modelo (ex: Corolla, Q3...)"
              className="w-full h-11 pl-10 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:bg-white"
            />
          </div>
          <div className="sm:col-span-3">
            <select
              value={minYear}
              onChange={(e) => setMinYear(e.target.value)}
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              <option value="">Ano mínimo: Todos</option>
              {[2025, 2024, 2023, 2022, 2020, 2018, 2015].map((y) => (
                <option key={y} value={y}>
                  A partir de {y}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <select
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              <option value="">Preço máximo: Todos</option>
              <option value="80000">Até R$ 80.000</option>
              <option value="120000">Até R$ 120.000</option>
              <option value="180000">Até R$ 180.000</option>
              <option value="250000">Até R$ 250.000</option>
            </select>
          </div>
        </div>

        {/* Vehicles Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-80 bg-white border border-slate-200 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <p className="font-display text-base font-bold text-slate-900">Nenhum veículo encontrado</p>
            <p className="mt-1 text-sm text-slate-500">Tente limpar os filtros de busca ou fale conosco pelo WhatsApp.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {vehicles.map((car) => {
              const cover = car.photos?.[0]?.storage_path || null;
              const isSold = car.status === 'vendido';
              return (
                <button
                  key={car.id}
                  type="button"
                  onClick={() => navigate(`/g/${garageSlug}/${car.slug}`)}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden text-left hover:-translate-y-0.5 hover:shadow-md transition-all flex flex-col"
                >
                  <div className="aspect-[4/3] w-full bg-slate-100 relative overflow-hidden">
                    <VehicleImage
                      src={cover}
                      alt={`${car.brand} ${car.model}`}
                      className="w-full h-full object-cover"
                    />
                    {isSold && (
                      <div className="absolute inset-0 bg-slate-900/55 flex items-center justify-center">
                        <span className="px-3 py-1 bg-white text-slate-900 text-xs font-bold rounded-lg">
                          Vendido
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        {car.brand} · {car.manufacture_year}/{car.model_year}
                      </p>
                      <h2 className="mt-0.5 font-display text-base font-bold text-slate-900 truncate">
                        {car.model} {car.version}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500 truncate">
                        {formatKm(car.mileage)} · {car.transmission} · {car.fuel}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="font-mono text-lg font-bold tabular-nums text-slate-900">
                        {isSold ? 'Vendido' : formatBRL(car.announced_price)}
                      </span>
                      <span className="text-xs font-semibold text-blue-700">Ver detalhes</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-5 px-4 text-center text-xs text-slate-500">
        Vitrine publicada com{' '}
        <button type="button" onClick={() => navigate('/')} className="font-semibold text-slate-700 hover:underline">
          CS22 Garage
        </button>
      </footer>
    </div>
  );
}
