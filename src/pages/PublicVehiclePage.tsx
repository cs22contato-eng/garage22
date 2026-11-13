import { useEffect, useState } from 'react';
import { ArrowLeft, Share2, MessageCircle, Check, MapPin } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatBRL, formatKm, type PublicCompany, type PublicVehicle } from '../types/garage';
import { VehicleImage } from '../components/VehicleImage';

interface PublicVehiclePageProps {
  garageSlug: string;
  carSlug: string;
  navigate: (to: string) => void;
}

export function PublicVehiclePage({ garageSlug, carSlug, navigate }: PublicVehiclePageProps) {
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [vehicle, setVehicle] = useState<PublicVehicle | null>(null);
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSelectedPhotoIdx(0);

    apiRequest<{ company: PublicCompany; vehicle: PublicVehicle }>(
      `/api/public/garages/${encodeURIComponent(garageSlug)}/vehicles/${encodeURIComponent(carSlug)}`
    )
      .then((res) => {
        if (!active) return;
        setCompany(res.company);
        setVehicle(res.vehicle);

        const title = `${res.vehicle.brand} ${res.vehicle.model} ${res.vehicle.model_year} — ${formatBRL(
          res.vehicle.announced_price
        )}`;
        document.title = title;

        // Registrar visualização diária do veículo
        fetch(
          `/api/public/garages/${encodeURIComponent(garageSlug)}/vehicles/${encodeURIComponent(carSlug)}/track`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'view' }),
          }
        ).catch(() => {});
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Veículo não disponível.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [garageSlug, carSlug]);

  const handleWhatsAppClick = () => {
    if (!company || !vehicle) return;
    fetch(
      `/api/public/garages/${encodeURIComponent(garageSlug)}/vehicles/${encodeURIComponent(carSlug)}/track`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'whatsapp_click' }),
      }
    ).catch(() => {});

    const link = window.location.href;
    const msg = `Olá, ${company.name}! Tenho interesse no ${vehicle.brand} ${vehicle.model} ${vehicle.version} (${vehicle.manufacture_year}/${vehicle.model_year}) anunciado por ${formatBRL(
      vehicle.announced_price
    )}. Link: ${link}`;
    window.location.href = `https://wa.me/${company.whatsapp}?text=${encodeURIComponent(msg)}`;
  };

  const handleShare = async () => {
    if (!vehicle) return;
    const url = window.location.href;
    const title = `${vehicle.brand} ${vehicle.model} ${vehicle.model_year}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: `${title} por ${formatBRL(vehicle.announced_price)}`,
          url,
        });
        return;
      } catch {
        // fallback
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-8 max-w-6xl mx-auto">
        <div className="h-96 bg-white border border-slate-200 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !vehicle || !company) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <h1 className="font-display text-xl font-bold text-slate-900">Veículo indisponível</h1>
          <p className="mt-2 text-sm text-slate-600">
            {error || 'Este veículo já foi vendido ou removido da vitrine.'}
          </p>
          <button
            type="button"
            onClick={() => navigate(`/g/${garageSlug}`)}
            className="mt-6 min-h-[44px] px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl"
          >
            Ver outros veículos da garagem
          </button>
        </div>
      </div>
    );
  }

  const photos = vehicle.photos || [];
  const mainPhoto = photos[selectedPhotoIdx]?.storage_path || null;
  const isSold = vehicle.status === 'vendido';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24 lg:pb-12">
      {/* Compact Sticky Top Bar */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 h-14 px-4 sm:px-6 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate(`/g/${garageSlug}`)}
          className="min-h-[40px] inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-700 hover:text-slate-900 truncate"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span className="truncate">{company.name}</span>
        </button>

        <button
          type="button"
          onClick={handleShare}
          className="min-h-[38px] px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 shrink-0"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Share2 className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copiado' : 'Compartilhar'}</span>
        </button>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Gallery */}
          <div className="lg:col-span-7 space-y-3">
            <div className="aspect-[4/3] w-full bg-white border border-slate-200 rounded-2xl overflow-hidden relative">
              <VehicleImage
                src={mainPhoto}
                alt={`${vehicle.brand} ${vehicle.model}`}
                className="w-full h-full object-cover"
              />
              {isSold && (
                <div className="absolute inset-0 bg-slate-900/55 flex items-center justify-center">
                  <span className="px-4 py-1.5 bg-white text-slate-900 text-sm font-bold rounded-xl">
                    Vendido
                  </span>
                </div>
              )}
            </div>

            {photos.length > 1 && (
              <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                {photos.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedPhotoIdx(idx)}
                    className={`w-20 h-16 rounded-xl overflow-hidden border-2 shrink-0 transition-colors ${
                      selectedPhotoIdx === idx ? 'border-blue-700' : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                  >
                    <VehicleImage src={p.storage_path} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Contiguous Purchase / Inquiry Module */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
              <p className="text-xs font-medium text-slate-500">
                {vehicle.brand} · {vehicle.manufacture_year}/{vehicle.model_year}
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
                {vehicle.model} {vehicle.version}
              </h1>

              <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-slate-900">
                {isSold ? 'Veículo vendido' : formatBRL(vehicle.announced_price)}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 pt-5 border-t border-slate-100 text-xs">
                <div>
                  <span className="text-slate-500 block">Quilometragem</span>
                  <span className="font-mono font-semibold text-slate-900 text-sm mt-0.5 block">
                    {formatKm(vehicle.mileage)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Câmbio</span>
                  <span className="font-semibold text-slate-900 text-sm mt-0.5 block">{vehicle.transmission}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Combustível</span>
                  <span className="font-semibold text-slate-900 text-sm mt-0.5 block">{vehicle.fuel}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Cor</span>
                  <span className="font-semibold text-slate-900 text-sm mt-0.5 block">{vehicle.color || '—'}</span>
                </div>
              </div>

              {!isSold && (
                <div className="hidden lg:block mt-6">
                  <button
                    type="button"
                    onClick={handleWhatsAppClick}
                    className="w-full min-h-[48px] px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span>Falar no WhatsApp sobre este carro</span>
                  </button>
                </div>
              )}

              {company.address && (
                <p className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>{company.address}</span>
                </p>
              )}
            </div>

            {(vehicle.description || vehicle.optionals) && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
                {vehicle.description && (
                  <div>
                    <h2 className="font-display text-sm font-bold text-slate-900">Sobre o veículo</h2>
                    <p className="mt-1.5 text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                      {vehicle.description}
                    </p>
                  </div>
                )}
                {vehicle.optionals && (
                  <div className={vehicle.description ? 'pt-4 border-t border-slate-100' : ''}>
                    <h2 className="font-display text-sm font-bold text-slate-900">Opcionais e destaques</h2>
                    <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{vehicle.optionals}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Mobile Sticky Bottom WhatsApp Bar */}
      {!isSold && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 p-3 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe">
          <button
            type="button"
            onClick={handleWhatsAppClick}
            className="w-full min-h-[48px] px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <MessageCircle className="w-5 h-5" />
            <span>Chamar no WhatsApp · {formatBRL(vehicle.announced_price)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
