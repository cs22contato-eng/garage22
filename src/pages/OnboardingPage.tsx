import React, { useState, useEffect } from 'react';
import { Upload, CheckCircle2, XCircle, ArrowLeft, LogOut } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { compressVehicleImage } from '../lib/imageCompression';
import { useAuth } from '../context/AuthContext';
import { RESERVED_GARAGE_SLUGS } from '../types/garage';

interface OnboardingPageProps {
  navigate: (to: string) => void;
}

function toSlug(val: string) {
  return val
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function OnboardingPage({ navigate }: OnboardingPageProps) {
  const { refreshSession, company, logout, user } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugReserved, setSlugReserved] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const [instagram, setInstagram] = useState('');
  const [address, setAddress] = useState('');
  const [openingHours, setOpeningHours] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (company) {
      navigate('/app/painel');
    }
  }, [company, navigate]);

  useEffect(() => {
    if (!slugTouched) {
      setSlug(toSlug(name));
    }
  }, [name, slugTouched]);

  useEffect(() => {
    if (slug.length < 2) {
      setSlugAvailable(null);
      setSlugReserved(false);
      return;
    }
    if (RESERVED_GARAGE_SLUGS.includes(slug)) {
      setSlugAvailable(false);
      setSlugReserved(true);
      return;
    }
    setSlugReserved(false);
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest<{ slug: string; available: boolean; reserved?: boolean }>(
          `/api/companies/check-slug/${encodeURIComponent(slug)}`
        );
        setSlugAvailable(res.available);
        setSlugReserved(Boolean(res.reserved));
      } catch {
        setSlugAvailable(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [slug]);

  const handleImagePick = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const compressed = await compressVehicleImage(file);
      setter(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar imagem.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('/api/companies', {
        method: 'POST',
        body: JSON.stringify({
          name,
          slug,
          whatsapp,
          instagram,
          address,
          opening_hours: openingHours,
          logo_url: logoUrl,
          cover_url: coverUrl,
        }),
      });
      await refreshSession();
      navigate('/app/painel');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar garagem.');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchAccount = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="min-h-[40px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>Voltar para início</span>
          </button>

          <button
            type="button"
            onClick={handleSwitchAccount}
            className="min-h-[40px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-700 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sair / Trocar conta</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-brand-dark px-6 py-4 flex items-center justify-between gap-4 border-b border-slate-800">
            <img
              src="/assets/aistudio/Logo_automotivo_CS22_Garage_deb1d1bd.png"
              alt="CS22 Garage"
              className="h-8 w-auto object-contain"
            />
            {user?.email && <span className="text-xs text-slate-300 truncate">{user.email}</span>}
          </div>

          <div className="p-6 sm:p-8">
            <span className="text-xs font-semibold text-brand-blue">Passo único · 7 dias grátis sem cartão</span>
            <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
              Configure sua garagem
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Esses dados montam o endereço da sua vitrine no link da bio e o botão de WhatsApp dos carros.
            </p>

            {error && (
              <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-800">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Nome da garagem</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Silva Multimarcas"
                  className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Endereço do link (vitrine pública)</label>
                <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-brand-blue">
                  <span className="px-3 h-11 flex items-center bg-slate-100 text-xs font-mono text-slate-600 border-r border-slate-300 shrink-0">
                    garage.cs22.com.br/
                  </span>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(toSlug(e.target.value));
                    }}
                    placeholder="silva-multimarcas"
                    className="flex-1 h-11 px-3 text-sm font-mono text-slate-900 focus:outline-none"
                  />
                  {slugAvailable === true && (
                    <span className="pr-3 text-brand-green flex items-center gap-1 text-xs font-medium shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                      Livre
                    </span>
                  )}
                  {slugAvailable === false && (
                    <span className="pr-3 text-red-700 flex items-center gap-1 text-xs font-medium shrink-0">
                      <XCircle className="w-4 h-4" />
                      {slugReserved ? 'Reservado' : 'Em uso'}
                    </span>
                  )}
                </div>
                {slugReserved && (
                  <p className="mt-1 text-xs text-red-700">
                    Este endereço é reservado pelo sistema. Escolha outro nome para o link.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">WhatsApp (com DDD)</label>
                  <input
                    type="tel"
                    required
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="11999998888"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Instagram (opcional)</label>
                  <input
                    type="text"
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="@silvamultimarcas"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Endereço da loja (opcional)</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Av. Brasil, 1400 — Campinas/SP"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Horário de funcionamento (opcional)</label>
                  <input
                    type="text"
                    value={openingHours}
                    onChange={(e) => setOpeningHours(e.target.value)}
                    placeholder="Seg a Sex 8h–18h · Sáb 8h–13h"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Logo da garagem (opcional)</label>
                  <div className="flex items-center gap-3">
                    {logoUrl && (
                      <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-xl object-cover border border-slate-200" />
                    )}
                    <label className="min-h-[44px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl cursor-pointer inline-flex items-center gap-2 transition-colors">
                      <Upload className="w-4 h-4" />
                      <span>{logoUrl ? 'Trocar logo' : 'Enviar logo'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => handleImagePick(e, setLogoUrl)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Imagem de capa (opcional)</label>
                  <div className="flex items-center gap-3">
                    {coverUrl && (
                      <img src={coverUrl} alt="Capa" className="w-16 h-12 rounded-xl object-cover border border-slate-200" />
                    )}
                    <label className="min-h-[44px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl cursor-pointer inline-flex items-center gap-2 transition-colors">
                      <Upload className="w-4 h-4" />
                      <span>{coverUrl ? 'Trocar capa' : 'Enviar capa'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => handleImagePick(e, setCoverUrl)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || slugAvailable === false}
                className="w-full min-h-[48px] py-3 bg-brand-blue hover:bg-brand-blue-hover disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {loading ? 'Salvando garagem...' : 'Criar garagem e iniciar 7 dias grátis'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
