import React, { useState, useEffect } from 'react';
import { Upload, ExternalLink } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { compressVehicleImage } from '../lib/imageCompression';
import { useAuth } from '../context/AuthContext';

interface SettingsPageProps {
  navigate: (to: string) => void;
}

export function SettingsPage({ navigate }: SettingsPageProps) {
  const { company, refreshSession } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [instagram, setInstagram] = useState('');
  const [address, setAddress] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [showSold, setShowSold] = useState(false);

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
      setLogoUrl(company.logo_url);
      setCoverUrl(company.cover_url);
      setShowSold(company.show_sold);
    }
  }, [company]);

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
      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">Dados da garagem e vitrine</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Personalize o link público, contato do WhatsApp e exibição de carros vendidos.
            </p>
          </div>
          {company?.slug && (
            <button
              type="button"
              onClick={() => navigate(`/g/${company.slug}`)}
              className="min-h-[38px] px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 shrink-0"
            >
              <span>Ver vitrine</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
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
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Slug da vitrine (/g/...)</label>
            <input
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
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
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Instagram</label>
            <input
              type="text"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@garagem"
              className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Endereço completo</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
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
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
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
          disabled={saving}
          className="min-h-[46px] px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {saving ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </form>
    </div>
  );
}
