import React, { useState, useEffect } from 'react';
import { Upload, ExternalLink, Copy, Check, Share2, CheckCircle2, XCircle } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { compressVehicleImage } from '../lib/imageCompression';
import { useAuth } from '../context/AuthContext';
import { RESERVED_GARAGE_SLUGS } from '../types/garage';
import { PWAInstallPrompt } from '../components/PWAInstallPrompt';

interface SettingsPageProps {
  navigate: (to: string) => void;
}

export function SettingsPage({ navigate }: SettingsPageProps) {
  const { company, subscription, refreshSession } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugReserved, setSlugReserved] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const [instagram, setInstagram] = useState('');
  const [address, setAddress] = useState('');
  const [openingHours, setOpeningHours] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [showSold, setShowSold] = useState(false);

  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (company) {
      setName(company.name);
      setSlug(company.slug);
      setWhatsapp(company.whatsapp);
      setInstagram(company.instagram);
      setAddress(company.address);
      setOpeningHours(company.opening_hours || '');
      setLogoUrl(company.logo_url);
      setCoverUrl(company.cover_url);
      setShowSold(company.show_sold);
    }
  }, [company]);

  useEffect(() => {
    if (!company || slug === company.slug) {
      setSlugAvailable(null);
      setSlugReserved(false);
      return;
    }
    if (slug.length < 2) {
      setSlugAvailable(false);
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
        const res = await apiRequest<{ available: boolean; reserved?: boolean }>(
          `/api/companies/check-slug/${encodeURIComponent(slug)}`
        );
        setSlugAvailable(res.available);
        setSlugReserved(Boolean(res.reserved));
      } catch {
        setSlugAvailable(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [slug, company]);

  const vitrineUrl = company ? `${window.location.origin}/g/${company.slug}` : '';

  const handleCopyVitrine = async () => {
    if (!vitrineUrl) return;
    try {
      await navigator.clipboard.writeText(vitrineUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleShareVitrine = async () => {
    if (!vitrineUrl || !company) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: company.name,
          text: `Confira os carros disponíveis da ${company.name}:`,
          url: vitrineUrl,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    await handleCopyVitrine();
  };

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await apiRequest('/api/companies/current', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          slug,
          whatsapp,
          instagram,
          address,
          opening_hours: openingHours,
          logo_url: logoUrl,
          cover_url: coverUrl,
          show_sold: showSold,
        }),
      });
      await refreshSession();
      setSuccess('Configurações da garagem salvas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      {company && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Endereço da sua vitrine pública</p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-900 truncate">{vitrineUrl}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyVitrine}
                className="min-h-[40px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copiado' : 'Copiar link'}</span>
              </button>
              <button
                type="button"
                onClick={handleShareVitrine}
                className="min-h-[40px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors"
              >
                <Share2 className="w-4 h-4" />
                <span>Compartilhar</span>
              </button>
              <button
                type="button"
                onClick={() => navigate(`/g/${company.slug}`)}
                className="min-h-[40px] px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors"
              >
                <span>Abrir</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {subscription && (
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              {subscription.status === 'trialing' ? (
                <span className="text-slate-700">
                  Período de teste grátis:{' '}
                  <strong className="font-mono tabular-nums text-slate-900">
                    {subscription.days_left_in_trial} {subscription.days_left_in_trial === 1 ? 'dia restante' : 'dias restantes'}
                  </strong>
                </span>
              ) : (
                <span className="text-slate-700">
                  Situação da assinatura:{' '}
                  <strong className="text-slate-900">
                    {subscription.status === 'active'
                      ? 'Ativa'
                      : subscription.status === 'overdue'
                      ? 'Em atraso'
                      : subscription.status === 'canceled'
                      ? 'Cancelada'
                      : 'Suspensa'}
                  </strong>
                </span>
              )}
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => navigate('/app/lembretes')}
                  className="font-semibold text-slate-700 hover:text-slate-900 hover:underline"
                >
                  Lembretes de vencimento
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/app/assinatura')}
                  className="font-semibold text-brand-blue hover:underline text-left sm:text-right"
                >
                  Gerenciar assinatura
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <PWAInstallPrompt hasRegisteredVehicle alwaysVisibleInSettings />

      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">Dados da garagem e vitrine</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Personalize o link público, horário, contato do WhatsApp e exibição de carros vendidos.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs sm:text-sm text-red-800">{error}</div>
        )}
        {success && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs sm:text-sm text-emerald-900">
            {success}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nome da garagem</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Slug da vitrine (/g/...)</label>
            <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-brand-blue">
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="flex-1 h-11 px-3 text-sm font-mono focus:outline-none"
              />
              {slugAvailable === true && (
                <span className="pr-3 text-emerald-700 flex items-center gap-1 text-xs font-medium shrink-0">
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
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">WhatsApp (55 + DDD + número)</label>
            <input
              type="tel"
              required
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Instagram</label>
            <input
              type="text"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@garagem"
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Endereço completo</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Av. Brasil, 1400 — Campinas/SP"
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Horário de funcionamento</label>
            <input
              type="text"
              value={openingHours}
              onChange={(e) => setOpeningHours(e.target.value)}
              placeholder="Seg a Sex 8h–18h · Sáb 8h–13h"
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Logo da garagem</label>
            <div className="flex items-center gap-3">
              {logoUrl && (
                <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-xl object-cover border border-slate-200" />
              )}
              <label className="min-h-[42px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl cursor-pointer inline-flex items-center gap-2">
                <Upload className="w-4 h-4" />
                <span>{logoUrl ? 'Alterar logo' : 'Enviar logo'}</span>
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
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Imagem de capa</label>
            <div className="flex items-center gap-3">
              {coverUrl && (
                <img src={coverUrl} alt="Capa" className="w-16 h-12 rounded-xl object-cover border border-slate-200" />
              )}
              <label className="min-h-[42px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl cursor-pointer inline-flex items-center gap-2">
                <Upload className="w-4 h-4" />
                <span>{coverUrl ? 'Alterar capa' : 'Enviar capa'}</span>
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

        <label className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            checked={showSold}
            onChange={(e) => setShowSold(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-brand-blue focus:ring-brand-blue"
          />
          <div>
            <span className="text-sm font-semibold text-slate-900 block">Mostrar carros vendidos na vitrine</span>
            <span className="text-xs text-slate-500">
              Exibe veículos vendidos como referência de portfólio (sem exibir valores internos ou comprador).
            </span>
          </div>
        </label>

        <button
          type="submit"
          disabled={saving || slugAvailable === false}
          className="min-h-[46px] px-6 py-2.5 bg-brand-blue hover:bg-brand-blue-hover disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {saving ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </form>
    </div>
  );
}
