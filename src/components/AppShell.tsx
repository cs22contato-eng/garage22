import React from 'react';
import {
  LayoutDashboard,
  CarFront,
  CalendarClock,
  Store,
  CreditCard,
  Settings,
  LogOut,
  Plus,
  AlertTriangle,
  ArrowLeft,
  Home,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AppShellProps {
  currentPath: string;
  navigate: (to: string) => void;
  title: string;
  backTo?: string;
  backLabel?: string;
  primaryAction?: { label: string; onClick: () => void };
  children: React.ReactNode;
}

export function AppShell({
  currentPath,
  navigate,
  title,
  backTo,
  backLabel = 'Voltar',
  primaryAction,
  children,
}: AppShellProps) {
  const { user, company, subscription, logout } = useAuth();

  const isSuspended = subscription && !subscription.has_access;
  const isAssinaturaRoute = currentPath.startsWith('/app/assinatura');

  const navItems = [
    { label: 'Painel', path: '/app/painel', icon: LayoutDashboard },
    { label: 'Veículos', path: '/app/veiculos', icon: CarFront },
    { label: 'Lembretes', path: '/app/lembretes', icon: CalendarClock },
    { label: 'Assinatura', path: '/app/assinatura', icon: CreditCard },
    { label: 'Ajustes', path: '/app/configuracoes', icon: Settings },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="px-5 h-16 flex items-center justify-between bg-brand-dark border-b border-slate-800">
          <button
            type="button"
            onClick={() => navigate('/app/painel')}
            aria-label="CS22 Garage - Ir para o Painel"
            className="flex items-center gap-2 focus:outline-none"
          >
            <img
              src="/assets/aistudio/Logo_automotivo_CS22_Garage_deb1d1bd.png"
              alt="CS22 Garage"
              className="h-9 w-auto object-contain"
            />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900 truncate">{company?.name || 'Minha Garagem'}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{user?.email}</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPath.startsWith(item.path);
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-brand-blue font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          {company?.slug && (
            <button
              type="button"
              onClick={() => navigate(`/g/${company.slug}`)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap"
            >
              <Store className="w-4 h-4 shrink-0" />
              <span>Abrir Vitrine</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap"
          >
            <Home className="w-4 h-4 shrink-0" />
            <span>Página inicial</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-200">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen pb-20 lg:pb-8">
        {/* Top Bar (compact on mobile <= 56px) */}
        <header className="sticky top-0 z-20 h-14 lg:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-4 lg:px-8 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            {backTo ? (
              <button
                type="button"
                onClick={() => navigate(backTo)}
                aria-label={backLabel}
                className="min-h-[40px] px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors shrink-0"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{backLabel}</span>
                <span className="sm:hidden">Voltar</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/')}
                aria-label="Ir para página inicial"
                className="lg:hidden w-9 h-9 rounded-lg overflow-hidden bg-brand-dark flex items-center justify-center shrink-0"
              >
                <img
                  src="/favicon.png"
                  alt="CS22"
                  className="w-8 h-8 object-contain"
                />
              </button>
            )}
            <h1 className="font-display text-base lg:text-lg font-bold text-slate-900 truncate">
              {title}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {company?.slug && (
              <button
                type="button"
                onClick={() => navigate(`/g/${company.slug}`)}
                className="lg:hidden min-h-[40px] px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap"
              >
                Vitrine
              </button>
            )}
            {!backTo && (
              <button
                type="button"
                onClick={handleLogout}
                title="Sair"
                aria-label="Sair da conta"
                className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
            {primaryAction && !isSuspended && (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className="min-h-[40px] px-3 sm:px-3.5 py-2 text-xs lg:text-sm font-semibold text-white bg-brand-blue hover:bg-brand-blue-hover rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>{primaryAction.label}</span>
              </button>
            )}
          </div>
        </header>

        {/* Trial / Overdue Notice */}
        {subscription && subscription.status === 'trialing' && subscription.has_access && (
          <div className="bg-slate-100 border-b border-slate-200 px-4 lg:px-8 py-2 flex items-center justify-between gap-4 text-xs text-slate-700">
            <span>
              Teste grátis ativo: faltam <strong className="tabular-nums">{subscription.days_left_in_trial}</strong> dias para ativar a assinatura.
            </span>
            <button
              type="button"
              onClick={() => navigate('/app/assinatura')}
              className="font-semibold text-brand-blue hover:underline whitespace-nowrap shrink-0"
            >
              Ver plano
            </button>
          </div>
        )}

        {subscription && subscription.status === 'overdue' && subscription.has_access && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 lg:px-8 py-2.5 flex items-center justify-between gap-4 text-xs text-amber-900">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Pagamento em atraso. Regularize dentro da tolerância para manter o painel e a vitrine ativos.</span>
            </span>
            <button
              type="button"
              onClick={() => navigate('/app/assinatura')}
              className="font-semibold text-amber-900 underline whitespace-nowrap shrink-0"
            >
              Regularizar
            </button>
          </div>
        )}

        <main className="flex-1 px-4 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          {isSuspended && !isAssinaturaRoute ? (
            <div className="max-w-lg mx-auto mt-8 bg-white border border-slate-200 rounded-2xl p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-700 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900">
                Assinatura suspensa
              </h2>
              <p className="text-sm text-slate-600 mt-2">
                Seu período de teste ou tolerância encerrou. Seus carros, despesas e históricos estão preservados.
                Ative a assinatura via Pix, boleto ou cartão para liberar o painel e republicar sua vitrine.
              </p>
              <button
                type="button"
                onClick={() => navigate('/app/assinatura')}
                className="mt-5 w-full min-h-[44px] px-5 py-2.5 bg-brand-blue hover:bg-brand-blue-hover text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Ir para Assinatura
              </button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Mobile Bottom Thumb Navigation Bar (5 evenly spaced items) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe">
        <div className="grid grid-cols-5 h-16 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPath.startsWith(item.path);
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
                  active ? 'text-brand-blue font-semibold' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={active ? 2.25 : 1.75} />
                <span className="text-[10px] font-medium tracking-tight truncate max-w-full px-0.5">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
