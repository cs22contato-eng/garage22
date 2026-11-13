export type VehicleStatus = 'disponivel' | 'reservado' | 'vendido' | 'inativo';

export type ExpenseCategory =
  | 'documentacao'
  | 'mecanica'
  | 'funilaria_pintura'
  | 'estetica'
  | 'pneus'
  | 'transporte'
  | 'comissao'
  | 'outros';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'overdue'
  | 'suspended'
  | 'canceled';

export type PlanCode = 'fundador_3990' | 'mensal_5990' | 'anual_599';
export type PaymentMethod = 'PIX' | 'BOLETO' | 'CREDIT_CARD';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  instagram: string;
  address: string;
  logo_url: string;
  cover_url: string;
  show_sold: boolean;
  trial_ends_at: string;
  created_at: string;
}

export interface Subscription {
  id: string;
  company_id: string;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  plan_code: PlanCode;
  payment_method: PaymentMethod | null;
  monthly_price: number;
  status: SubscriptionStatus;
  current_period_end: string | null;
  grace_days: number;
  overdue_since: string | null;
  canceled_at: string | null;
  has_access: boolean;
  days_left_in_trial: number;
  updated_at: string;
}

export interface VehiclePhoto {
  id: string;
  vehicle_id: string;
  storage_path: string;
  sort_order: number;
}

export interface VehicleExpense {
  id: string;
  vehicle_id: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  expense_date: string;
  supplier: string;
  canceled_at: string | null;
  created_at: string;
}

export interface VehicleSale {
  id: string;
  vehicle_id: string;
  sale_date: string;
  sale_price: number;
  buyer_name: string;
  buyer_phone: string;
  payment_method: string;
  notes: string;
  canceled_at: string | null;
  created_at: string;
}

export interface VehicleFinancial {
  id: string;
  company_id: string;
  brand: string;
  model: string;
  version: string;
  manufacture_year: number;
  model_year: number;
  mileage: number;
  fuel: string;
  transmission: string;
  color: string;
  announced_price: number;
  description: string;
  optionals: string;
  plate: string;
  slug: string;
  status: VehicleStatus;
  previous_status: VehicleStatus | null;
  purchase_price: number;
  purchase_date: string;
  purchased_from: string;
  expenses_total: number;
  total_cost: number;
  sale_id: string | null;
  sale_date: string | null;
  sale_price: number | null;
  buyer_name: string | null;
  payment_method: string | null;
  profit: number | null;
  margin_ratio: number | null;
  days_in_stock: number;
  cover_photo: string | null;
  photos_count: number;
  views_total: number;
  whatsapp_clicks_total: number;
  created_at: string;
}

export interface VehicleDetailResponse {
  vehicle: VehicleFinancial;
  photos: VehiclePhoto[];
  expenses: VehicleExpense[];
  sales: VehicleSale[];
  daily_stats: Array<{
    stat_date: string;
    views: number;
    whatsapp_clicks: number;
  }>;
}

export interface DashboardMetrics {
  available_count: number;
  sold_this_month_count: number;
  month_profit: number;
  tied_up_capital: number;
  avg_days_in_stock: number;
  stalled_vehicles: VehicleFinancial[];
}

export interface PublicCompany {
  id: string;
  name: string;
  slug: string;
  whatsapp: string;
  instagram: string;
  address: string;
  logo_url: string;
  cover_url: string;
  show_sold: boolean;
}

export interface PublicVehicle {
  id: string;
  company_id: string;
  company_slug: string;
  brand: string;
  model: string;
  version: string;
  manufacture_year: number;
  model_year: number;
  mileage: number;
  fuel: string;
  transmission: string;
  color: string;
  announced_price: number;
  description: string;
  optionals: string;
  slug: string;
  status: 'disponivel' | 'vendido';
  photos: Array<{ storage_path: string; sort_order: number }>;
  created_at: string;
}

export interface AsaasEventRecord {
  id: string;
  event_id: string;
  event_type: string;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  before_data: string | null;
  after_data: string | null;
  created_at: string;
}

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  documentacao: 'Documentação',
  mecanica: 'Mecânica',
  funilaria_pintura: 'Funilaria e pintura',
  estetica: 'Estética',
  pneus: 'Pneus',
  transporte: 'Transporte',
  comissao: 'Comissão',
  outros: 'Outros',
};

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  disponivel: 'Disponível',
  reservado: 'Reservado',
  vendido: 'Vendido',
  inativo: 'Inativo',
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Em teste (7 dias)',
  active: 'Ativa',
  overdue: 'Em atraso',
  suspended: 'Suspensa',
  canceled: 'Cancelada',
};

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(1).replace('.', ',')}%`;
}

export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return '—';
  return `${new Intl.NumberFormat('pt-BR').format(km)} km`;
}

export function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const [datePart] = isoDate.split('T');
  const parts = datePart.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
