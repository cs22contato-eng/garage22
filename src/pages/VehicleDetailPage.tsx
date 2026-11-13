import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Camera,
  Trash2,
  ArrowUp,
  Plus,
  Ban,
  BadgeCheck,
  Eye,
  MessageCircle,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { compressVehicleImage } from '../lib/imageCompression';
import {
  EXPENSE_CATEGORY_LABELS,
  VEHICLE_STATUS_LABELS,
  formatBRL,
  formatDateBR,
  formatPercent,
  type ExpenseCategory,
  type VehicleDetailResponse,
  type VehicleStatus,
} from '../types/garage';
import { VehicleImage } from '../components/VehicleImage';

interface VehicleDetailPageProps {
  vehicleId?: string; // undefined => creating new vehicle
  navigate: (to: string) => void;
}

type DetailTab = 'dados' | 'fotos' | 'despesas' | 'venda';

export function VehicleDetailPage({ vehicleId, navigate }: VehicleDetailPageProps) {
  const isNew = !vehicleId;
  const [tab, setTab] = useState<DetailTab>('dados');
  const [detail, setDetail] = useState<VehicleDetailResponse | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form fields for vehicle + purchase
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [version, setVersion] = useState('');
  const [manufactureYear, setManufactureYear] = useState(new Date().getFullYear());
  const [modelYear, setModelYear] = useState(new Date().getFullYear());
  const [mileage, setMileage] = useState(0);
  const [fuel, setFuel] = useState('Flex');
  const [transmission, setTransmission] = useState('Automático');
  const [color, setColor] = useState('');
  const [announcedPrice, setAnnouncedPrice] = useState('');
  const [plate, setPlate] = useState('');
  const [status, setStatus] = useState<VehicleStatus>('disponivel');
  const [description, setDescription] = useState('');
  const [optionals, setOptionals] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchasedFrom, setPurchasedFrom] = useState('');

  // Photos (max 10)
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // New Expense Form
  const [expDesc, setExpDesc] = useState('');
  const [expCat, setExpCat] = useState<ExpenseCategory>('mecanica');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [expSupplier, setExpSupplier] = useState('');
  const [addingExpense, setAddingExpense] = useState(false);

  // Register Sale Form
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [salePrice, setSalePrice] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [saleNotes, setSaleNotes] = useState('');
  const [submittingSale, setSubmittingSale] = useState(false);

  const loadVehicle = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<VehicleDetailResponse>(`/api/vehicles/${vehicleId}`);
      setDetail(res);
      const v = res.vehicle;
      setBrand(v.brand);
      setModel(v.model);
      setVersion(v.version);
      setManufactureYear(v.manufacture_year);
      setModelYear(v.model_year);
      setMileage(v.mileage);
      setFuel(v.fuel);
      setTransmission(v.transmission);
      setColor(v.color);
      setAnnouncedPrice(String(v.announced_price));
      setPlate(v.plate);
      setStatus(v.status);
      setDescription(v.description);
      setOptionals(v.optionals);
      setPurchasePrice(String(v.purchase_price));
      setPurchaseDate(v.purchase_date);
      setPurchasedFrom(v.purchased_from);
      setPhotos(res.photos.map((p) => p.storage_path));
      if (!salePrice) {
        setSalePrice(String(v.announced_price));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar veículo.');
    } finally {
      setLoading(false);
    }
  }, [vehicleId, salePrice]);

  useEffect(() => {
    if (!isNew) {
      loadVehicle();
    }
  }, [isNew, loadVehicle]);

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const payload = {
        brand,
        model,
        version,
        manufacture_year: Number(manufactureYear),
        model_year: Number(modelYear),
        mileage: Number(mileage),
        fuel,
        transmission,
        color,
        announced_price: Number(announcedPrice),
        plate,
        status: isNew ? status : detail?.vehicle.status === 'vendido' ? 'vendido' : status,
        description,
        optionals,
        purchase_price: Number(purchasePrice || 0),
        purchase_date: purchaseDate,
        purchased_from: purchasedFrom,
        photos: isNew ? photos : undefined,
      };

      if (isNew) {
        const created = await apiRequest<{ id: string }>('/api/vehicles', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        navigate(`/app/veiculos/${created.id}`);
      } else {
        await apiRequest(`/api/vehicles/${vehicleId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        await loadVehicle();
        setSuccess('Dados do veículo atualizados.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar veículo.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setError('');
    setUploadingPhoto(true);
    try {
      const remaining = 10 - photos.length;
      const toProcess = files.slice(0, remaining);
      const compressedList: string[] = [];
      for (const file of toProcess) {
        const compressed = await compressVehicleImage(file);
        compressedList.push(compressed);
      }
      const nextPhotos = [...photos, ...compressedList].slice(0, 10);
      setPhotos(nextPhotos);

      if (!isNew && vehicleId) {
        await apiRequest(`/api/vehicles/${vehicleId}/photos`, {
          method: 'PUT',
          body: JSON.stringify({ photos: nextPhotos }),
        });
        await loadVehicle();
        setSuccess('Fotos atualizadas.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar foto.');
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleUpdatePhotoOrder = async (nextPhotos: string[]) => {
    setPhotos(nextPhotos);
    if (!isNew && vehicleId) {
      try {
        await apiRequest(`/api/vehicles/${vehicleId}/photos`, {
          method: 'PUT',
          body: JSON.stringify({ photos: nextPhotos }),
        });
        await loadVehicle();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao reordenar fotos.');
      }
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) return;
    setError('');
    setAddingExpense(true);
    try {
      await apiRequest(`/api/vehicles/${vehicleId}/expenses`, {
        method: 'POST',
        body: JSON.stringify({
          description: expDesc,
          category: expCat,
          amount: Number(expAmount),
          expense_date: expDate,
          supplier: expSupplier,
        }),
      });
      setExpDesc('');
      setExpAmount('');
      setExpSupplier('');
      await loadVehicle();
      setSuccess('Despesa lançada no custo do veículo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao lançar despesa.');
    } finally {
      setAddingExpense(false);
    }
  };

  const handleCancelExpense = async (expenseId: string) => {
    if (!vehicleId) return;
    setError('');
    try {
      await apiRequest(`/api/vehicles/${vehicleId}/expenses/${expenseId}/cancel`, {
        method: 'POST',
      });
      await loadVehicle();
      setSuccess('Despesa cancelada (histórico preservado).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar despesa.');
    }
  };

  const handleSellVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) return;
    setError('');
    setSubmittingSale(true);
    try {
      await apiRequest(`/api/vehicles/${vehicleId}/sell`, {
        method: 'POST',
        body: JSON.stringify({
          sale_date: saleDate,
          sale_price: Number(salePrice),
          buyer_name: buyerName,
          buyer_phone: buyerPhone,
          payment_method: paymentMethod,
          notes: saleNotes,
        }),
      });
      await loadVehicle();
      setSuccess('Venda registrada! O veículo foi removido da vitrine pública.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar venda.');
    } finally {
      setSubmittingSale(false);
    }
  };

  const handleCancelSale = async (saleId: string) => {
    if (!vehicleId) return;
    setError('');
    try {
      await apiRequest(`/api/vehicles/${vehicleId}/sales/${saleId}/cancel`, {
        method: 'POST',
      });
      await loadVehicle();
      setSuccess('Venda cancelada e status do veículo restaurado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar venda.');
    }
  };

  const handleDeleteVehicle = async () => {
    if (!vehicleId) return;
    setError('');
    try {
      await apiRequest(`/api/vehicles/${vehicleId}`, { method: 'DELETE' });
      navigate('/app/veiculos');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir veículo.');
    }
  };

  if (loading) {
    return <div className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse" />;
  }

  const v = detail?.vehicle;
  const activeSale = detail?.sales.find((s) => !s.canceled_at);
  const previewSaleNum = Number(salePrice || 0);
  const currentCMV = v?.total_cost ?? Number(purchasePrice || 0);
  const previewProfit = previewSaleNum - currentCMV;
  const previewMargin = previewSaleNum > 0 ? previewProfit / previewSaleNum : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/app/veiculos')}
          className="min-h-[40px] inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para veículos</span>
        </button>

        {!isNew && v && v.status !== 'vendido' && (
          <button
            type="button"
            onClick={() => setTab('venda')}
            className="min-h-[40px] px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold rounded-xl transition-colors"
          >
            Registrar venda
          </button>
        )}
      </div>

      {/* Summary strip for existing vehicle */}
      {!isNew && v && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="col-span-2 lg:col-span-1">
            <p className="text-xs text-slate-500">Status</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{VEHICLE_STATUS_LABELS[v.status]}</p>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{v.days_in_stock} dias em estoque</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Compra</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">
              {formatBRL(v.purchase_price)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Despesas</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">
              {formatBRL(v.expenses_total)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Custo total (CMV)</p>
            <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900">
              {formatBRL(v.total_cost)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{v.status === 'vendido' ? 'Lucro real' : 'Vitrine (hoje)'}</p>
            {v.status === 'vendido' ? (
              <p
                className={`mt-1 font-mono text-sm font-bold tabular-nums ${
                  (v.profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatBRL(v.profit)} ({formatPercent(v.margin_ratio)})
              </p>
            ) : (
              <div className="mt-1 flex items-center gap-3 text-xs font-mono text-slate-700 tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                  {v.views_total}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                  {v.whatsapp_clicks_total}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl overflow-x-auto">
        {(
          [
            { id: 'dados', label: 'Dados e Compra' },
            { id: 'fotos', label: `Fotos (${photos.length}/10)` },
            ...(!isNew ? [{ id: 'despesas', label: `Despesas (${detail?.expenses.filter((e) => !e.canceled_at).length || 0})` }] : []),
            ...(!isNew ? [{ id: 'venda', label: v?.status === 'vendido' ? 'Venda e Lucro' : 'Registrar Venda' }] : []),
          ] as Array<{ id: DetailTab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs sm:text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs sm:text-sm text-emerald-900">
          {success}
        </div>
      )}

      {/* TAB 1: DADOS E COMPRA */}
      {tab === 'dados' && (
        <form onSubmit={handleSaveVehicle} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-6">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">Informações do veículo</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Estes dados aparecem na vitrine pública (exceto placa e dados de compra).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Marca</label>
              <input
                type="text"
                required
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Ex: Toyota"
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Modelo</label>
              <input
                type="text"
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Ex: Corolla"
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Versão</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="Ex: Altis Hybrid 1.8"
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Ano fabricação</label>
              <input
                type="number"
                required
                value={manufactureYear}
                onChange={(e) => setManufactureYear(Number(e.target.value))}
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Ano modelo</label>
              <input
                type="number"
                required
                value={modelYear}
                onChange={(e) => setModelYear(Number(e.target.value))}
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Quilometragem</label>
              <input
                type="number"
                min={0}
                required
                value={mileage}
                onChange={(e) => setMileage(Number(e.target.value))}
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cor</label>
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Ex: Prata"
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Combustível</label>
              <select
                value={fuel}
                onChange={(e) => setFuel(e.target.value)}
                className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                <option value="Flex">Flex</option>
                <option value="Gasolina">Gasolina</option>
                <option value="Diesel">Diesel</option>
                <option value="Híbrido">Híbrido</option>
                <option value="Elétrico">Elétrico</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Câmbio</label>
              <select
                value={transmission}
                onChange={(e) => setTransmission(e.target.value)}
                className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                <option value="Automático">Automático</option>
                <option value="Manual">Manual</option>
                <option value="CVT">CVT</option>
                <option value="Automatizado">Automatizado</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Preço anunciado (R$)</label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                value={announcedPrice}
                onChange={(e) => setAnnouncedPrice(e.target.value)}
                placeholder="89900"
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select
                value={status}
                disabled={v?.status === 'vendido'}
                onChange={(e) => setStatus(e.target.value as VehicleStatus)}
                className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-sm disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                <option value="disponivel">Disponível (na vitrine)</option>
                <option value="reservado">Reservado</option>
                <option value="inativo">Inativo</option>
                {v?.status === 'vendido' && <option value="vendido">Vendido</option>}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Descrição para o comprador</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Histórico de revisões, estado dos pneus, laudo cautelar..."
                className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Opcionais (texto livre)</label>
              <textarea
                rows={3}
                value={optionals}
                onChange={(e) => setOptionals(e.target.value)}
                placeholder="Ar digital, multimídia, bancos em couro, câmera de ré..."
                className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
          </div>

          <div className="pt-5 border-t border-slate-200">
            <h3 className="font-display text-sm font-bold text-slate-900">Dados internos de compra (privado)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Placa, valor pago e origem nunca são enviados para a vitrine pública. A data da compra define os dias em estoque.
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Placa (privada)</label>
                <input
                  type="text"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                  placeholder="ABC1D23"
                  className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Valor da compra (R$)</label>
                <input
                  type="number"
                  required
                  min={0}
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="76000"
                  className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Data da compra</label>
                <input
                  type="date"
                  required
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">De quem comprou</label>
                <input
                  type="text"
                  value={purchasedFrom}
                  onChange={(e) => setPurchasedFrom(e.target.value)}
                  placeholder="Particular / Repasse / Leilão"
                  className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {!isNew ? (
              <button
                type="button"
                onClick={handleDeleteVehicle}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Arquivar veículo</span>
              </button>
            ) : (
              <div />
            )}

            <button
              type="submit"
              disabled={saving}
              className="min-h-[46px] px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {saving ? 'Salvando...' : isNew ? 'Cadastrar veículo' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: FOTOS (ATÉ 10 COM COMPRESSÃO) */}
      {tab === 'fotos' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Fotos do veículo ({photos.length}/10)</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Compressão automática antes do envio. A primeira foto é a capa na vitrine.
              </p>
            </div>
            {photos.length < 10 && (
              <label className="min-h-[44px] px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold rounded-xl cursor-pointer inline-flex items-center justify-center gap-2 transition-colors">
                <Camera className="w-4 h-4" />
                <span>{uploadingPhoto ? 'Comprimindo...' : 'Adicionar fotos'}</span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAddPhotos}
                  disabled={uploadingPhoto}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {photos.length === 0 ? (
            <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-500">
              Nenhuma foto adicionada. Envie até 10 imagens do carro pelo celular ou computador.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {photos.map((photo, idx) => (
                <div key={`${idx}-${photo.slice(0, 24)}`} className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                  <div className="aspect-[4/3] relative">
                    <VehicleImage src={photo} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                  </div>
                  <div className="p-2 flex items-center justify-between gap-2 bg-white border-t border-slate-200">
                    <span className="text-[11px] font-semibold text-slate-600">
                      {idx === 0 ? 'Capa' : `Foto ${idx + 1}`}
                    </span>
                    <div className="flex items-center gap-1">
                      {idx > 0 && (
                        <button
                          type="button"
                          title="Definir como capa"
                          onClick={() => {
                            const copy = [...photos];
                            const [picked] = copy.splice(idx, 1);
                            copy.unshift(picked);
                            handleUpdatePhotoOrder(copy);
                          }}
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Remover foto"
                        onClick={() => {
                          const next = photos.filter((_, i) => i !== idx);
                          handleUpdatePhotoOrder(next);
                        }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DESPESAS */}
      {tab === 'despesas' && !isNew && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleAddExpense} className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-4 h-fit">
            <h2 className="font-display text-base font-bold text-slate-900">Lançar despesa paga</h2>
            <p className="text-xs text-slate-500">
              Comissão, frete, mecânica e estética entram aqui para compor o CMV real sem duplicidade.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Descrição</label>
              <input
                type="text"
                required
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="Ex: Troca de óleo e filtros"
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Categoria</label>
                <select
                  value={expCat}
                  onChange={(e) => setExpCat(e.target.value as ExpenseCategory)}
                  className="w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                >
                  {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Valor (R$)</label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  placeholder="450,00"
                  className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Data</label>
                <input
                  type="date"
                  required
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                  className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Fornecedor</label>
                <input
                  type="text"
                  value={expSupplier}
                  onChange={(e) => setExpSupplier(e.target.value)}
                  placeholder="Oficina / Despachante"
                  className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={addingExpense}
              className="w-full min-h-[44px] py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{addingExpense ? 'Lançando...' : 'Adicionar despesa'}</span>
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">Histórico de despesas</h3>
              <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                Total: {formatBRL(v?.expenses_total)}
              </span>
            </div>
            {detail?.expenses.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">Nenhuma despesa lançada neste veículo.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {detail?.expenses.map((exp) => {
                  const canceled = Boolean(exp.canceled_at);
                  return (
                    <div
                      key={exp.id}
                      className={`px-5 py-3.5 flex items-center justify-between gap-4 ${
                        canceled ? 'opacity-50 bg-slate-50' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold text-slate-900 ${canceled ? 'line-through' : ''}`}>
                          {exp.description}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {EXPENSE_CATEGORY_LABELS[exp.category]} · {formatDateBR(exp.expense_date)}
                          {exp.supplier ? ` · ${exp.supplier}` : ''}
                          {canceled ? ' · Cancelada' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`font-mono text-sm font-semibold tabular-nums ${canceled ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                          {formatBRL(exp.amount)}
                        </span>
                        {!canceled && (
                          <button
                            type="button"
                            onClick={() => handleCancelExpense(exp.id)}
                            title="Cancelar despesa"
                            className="p-2 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: REGISTRAR VENDA / VENDA ATIVA */}
      {tab === 'venda' && !isNew && v && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
          {activeSale ? (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <BadgeCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">Veículo vendido</h2>
                    <p className="text-xs text-slate-500">
                      Vendido em {formatDateBR(activeSale.sale_date)} para {activeSale.buyer_name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCancelSale(activeSale.id)}
                  className="min-h-[40px] px-4 py-2 border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold rounded-xl transition-colors"
                >
                  Cancelar venda (devolver ao estoque)
                </button>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-500">Valor efetivo da venda</p>
                  <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
                    {formatBRL(activeSale.sale_price)}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-500">Custo total (CMV)</p>
                  <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
                    {formatBRL(v.total_cost)}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-500">Lucro líquido</p>
                  <p
                    className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                      (v.profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {formatBRL(v.profit)}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-500">Margem / Dias</p>
                  <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
                    {formatPercent(v.margin_ratio)} · {v.days_in_stock}d
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Comprador</p>
                  <p className="font-medium text-slate-900 mt-0.5">{activeSale.buyer_name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Telefone</p>
                  <p className="font-mono text-slate-900 mt-0.5">{activeSale.buyer_phone || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Forma de pagamento</p>
                  <p className="font-medium text-slate-900 mt-0.5">{activeSale.payment_method || '—'}</p>
                </div>
              </div>
              {activeSale.notes && (
                <div className="text-sm">
                  <p className="text-xs text-slate-500">Observação</p>
                  <p className="text-slate-700 mt-0.5">{activeSale.notes}</p>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSellVehicle} className="space-y-5 max-w-2xl">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">Registrar venda do veículo</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ao confirmar, o status muda para vendido e o carro sai da vitrine pública na hora.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Data da venda</label>
                  <input
                    type="date"
                    required
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Valor efetivo da venda (R$)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nome do comprador</label>
                  <input
                    type="text"
                    required
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="Nome completo"
                    className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Telefone (opcional)</label>
                  <input
                    type="tel"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    placeholder="11999990000"
                    className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Forma de pagamento</label>
                <input
                  type="text"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  placeholder="Ex: Pix + Financiamento BV / Troca + TED"
                  className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Observação (opcional)</label>
                <textarea
                  rows={2}
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              {/* Prévia do resultado */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-slate-500">CMV atual</p>
                  <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900">
                    {formatBRL(currentCMV)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Lucro previsto</p>
                  <p
                    className={`mt-1 font-mono text-sm font-bold tabular-nums ${
                      previewProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {formatBRL(previewProfit)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Margem</p>
                  <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900">
                    {formatPercent(previewMargin)}
                  </p>
                </div>
              </div>

              <button
                type="submit"
                disabled={submittingSale}
                className="min-h-[48px] px-6 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {submittingSale ? 'Registrando venda...' : 'Confirmar venda e tirar da vitrine'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
