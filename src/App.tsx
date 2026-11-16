import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { LandingPage } from './pages/LandingPage';
import { AuthPages } from './pages/AuthPages';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { VehiclesListPage } from './pages/VehiclesListPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { RemindersPage } from './pages/RemindersPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { SettingsPage } from './pages/SettingsPage';
import { PublicVitrinePage } from './pages/PublicVitrinePage';
import { PublicVehiclePage } from './pages/PublicVehiclePage';
import { PWAStatusBanner } from './components/PWAStatusBanner';

function AppRouter() {
  const [rawPath, setRawPath] = useState(() => window.location.pathname || '/');
  const { user, company, loading } = useAuth();
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;

  const navigate = useCallback((to: string) => {
    const cleanTo = to.length > 1 ? to.replace(/\/+$/, '') : to;
    if (cleanTo === window.location.pathname) return;
    window.history.pushState({}, '', cleanTo);
    setRawPath(cleanTo);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPopState = () => setRawPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Public Vitrine Routes: /g/:garageSlug and /g/:garageSlug/:carSlug
  const publicCarMatch = path.match(/^\/g\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
  if (publicCarMatch) {
    return (
      <PublicVehiclePage
        garageSlug={publicCarMatch[1]}
        carSlug={publicCarMatch[2]}
        navigate={navigate}
      />
    );
  }

  const publicGarageMatch = path.match(/^\/g\/([a-z0-9-]+)$/);
  if (publicGarageMatch) {
    return <PublicVitrinePage garageSlug={publicGarageMatch[1]} navigate={navigate} />;
  }

  // Commercial Landing Page
  if (path === '/') {
    return <LandingPage navigate={navigate} />;
  }

  // Auth Routes
  if (path === '/login' || path === '/cadastro' || path === '/recuperar-senha') {
    if (!loading && user && path !== '/recuperar-senha') {
      if (company) {
        return (
          <AppShell
            currentPath="/app/painel"
            navigate={navigate}
            title="Painel"
            primaryAction={{ label: 'Novo veículo', onClick: () => navigate('/app/veiculos/novo') }}
          >
            <DashboardPage navigate={navigate} />
          </AppShell>
        );
      }
      return <OnboardingPage navigate={navigate} />;
    }
    const mode = path === '/login' ? 'login' : path === '/cadastro' ? 'register' : 'forgot';
    return <AuthPages initialMode={mode} navigate={navigate} />;
  }

  // Protected App Routes
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <div className="px-4 py-2 rounded-xl bg-brand-dark">
          <img
            src="/assets/aistudio/Logo_automotivo_CS22_Garage_deb1d1bd.png"
            alt="CS22 Garage"
            className="h-9 w-auto object-contain"
          />
        </div>
        <div className="text-sm font-medium text-slate-500">Carregando CS22 Garage...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPages initialMode="login" navigate={navigate} />;
  }

  if (path === '/onboarding' || !company) {
    return <OnboardingPage navigate={navigate} />;
  }

  if (path === '/app' || path === '/app/painel') {
    return (
      <AppShell
        currentPath="/app/painel"
        navigate={navigate}
        title="Painel"
        primaryAction={{ label: 'Novo veículo', onClick: () => navigate('/app/veiculos/novo') }}
      >
        <DashboardPage navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/app/veiculos') {
    return (
      <AppShell
        currentPath="/app/veiculos"
        navigate={navigate}
        title="Veículos"
        backTo="/app/painel"
        backLabel="Voltar ao painel"
        primaryAction={{ label: 'Novo veículo', onClick: () => navigate('/app/veiculos/novo') }}
      >
        <VehiclesListPage navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/app/veiculos/novo') {
    return (
      <AppShell
        currentPath="/app/veiculos"
        navigate={navigate}
        title="Novo veículo"
        backTo="/app/veiculos"
        backLabel="Voltar para veículos"
      >
        <VehicleDetailPage navigate={navigate} />
      </AppShell>
    );
  }

  const vehicleDetailMatch = path.match(/^\/app\/veiculos\/([^/]+)$/);
  if (vehicleDetailMatch) {
    return (
      <AppShell
        currentPath="/app/veiculos"
        navigate={navigate}
        title="Detalhes do veículo"
        backTo="/app/veiculos"
        backLabel="Voltar para veículos"
      >
        <VehicleDetailPage vehicleId={vehicleDetailMatch[1]} navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/app/lembretes') {
    return (
      <AppShell
        currentPath="/app/lembretes"
        navigate={navigate}
        title="Lembretes de vencimento"
        backTo="/app/painel"
        backLabel="Voltar ao painel"
      >
        <RemindersPage navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/app/assinatura') {
    return (
      <AppShell
        currentPath="/app/assinatura"
        navigate={navigate}
        title="Assinatura e pagamentos"
        backTo="/app/painel"
        backLabel="Voltar ao painel"
      >
        <SubscriptionPage navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/app/configuracoes') {
    return (
      <AppShell
        currentPath="/app/configuracoes"
        navigate={navigate}
        title="Configurações da garagem"
        backTo="/app/painel"
        backLabel="Voltar ao painel"
      >
        <SettingsPage navigate={navigate} />
      </AppShell>
    );
  }

  if (path.startsWith('/app/')) {
    return (
      <AppShell
        currentPath="/app/painel"
        navigate={navigate}
        title="Painel"
        primaryAction={{ label: 'Novo veículo', onClick: () => navigate('/app/veiculos/novo') }}
      >
        <DashboardPage navigate={navigate} />
      </AppShell>
    );
  }

  // Fallback to Landing
  return <LandingPage navigate={navigate} />;
}

export default function App() {
  return (
    <AuthProvider>
      <PWAStatusBanner />
      <AppRouter />
    </AuthProvider>
  );
}
