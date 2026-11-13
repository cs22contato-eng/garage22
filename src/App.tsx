import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { LandingPage } from './pages/LandingPage';
import { AuthPages } from './pages/AuthPages';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { VehiclesListPage } from './pages/VehiclesListPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { SettingsPage } from './pages/SettingsPage';
import { PublicVitrinePage } from './pages/PublicVitrinePage';
import { PublicVehiclePage } from './pages/PublicVehiclePage';

function AppRouter() {
  const [path, setPath] = useState(() => window.location.pathname || '/');
  const { user, company, loading } = useAuth();

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Public Vitrine Routes: /g/:garageSlug and /g/:garageSlug/:carSlug
  const publicCarMatch = path.match(/^\/g\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/);
  if (publicCarMatch) {
    return (
      <PublicVehiclePage
        garageSlug={publicCarMatch[1]}
        carSlug={publicCarMatch[2]}
        navigate={navigate}
      />
    );
  }

  const publicGarageMatch = path.match(/^\/g\/([a-z0-9-]+)\/?$/);
  if (publicGarageMatch) {
    return <PublicVitrinePage garageSlug={publicGarageMatch[1]} navigate={navigate} />;
  }

  // Commercial Landing Page
  if (path === '/') {
    return <LandingPage navigate={navigate} />;
  }

  // Auth Routes
  if (path === '/login') {
    return <AuthPages initialMode="login" navigate={navigate} />;
  }
  if (path === '/cadastro') {
    return <AuthPages initialMode="register" navigate={navigate} />;
  }
  if (path === '/recuperar-senha') {
    return <AuthPages initialMode="forgot" navigate={navigate} />;
  }

  // Protected App Routes
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
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
        primaryAction={{ label: 'Novo veículo', onClick: () => navigate('/app/veiculos/novo') }}
      >
        <VehiclesListPage navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/app/veiculos/novo') {
    return (
      <AppShell currentPath="/app/veiculos" navigate={navigate} title="Novo veículo">
        <VehicleDetailPage navigate={navigate} />
      </AppShell>
    );
  }

  const vehicleDetailMatch = path.match(/^\/app\/veiculos\/([^/]+)\/?$/);
  if (vehicleDetailMatch) {
    return (
      <AppShell currentPath="/app/veiculos" navigate={navigate} title="Detalhes do veículo">
        <VehicleDetailPage vehicleId={vehicleDetailMatch[1]} navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/app/assinatura') {
    return (
      <AppShell currentPath="/app/assinatura" navigate={navigate} title="Assinatura">
        <SubscriptionPage />
      </AppShell>
    );
  }

  if (path === '/app/configuracoes') {
    return (
      <AppShell currentPath="/app/configuracoes" navigate={navigate} title="Configurações da garagem">
        <SettingsPage navigate={navigate} />
      </AppShell>
    );
  }

  // Fallback to Landing or Dashboard
  return <LandingPage navigate={navigate} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
