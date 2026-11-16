import { WifiOff, RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export function PWAStatusBanner() {
  const isOnline = useOnlineStatus();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        registration.update().catch(() => {});
      }
    },
  });

  if (!isOnline) {
    return (
      <div className="bg-brand-dark text-white px-4 py-2.5 text-xs font-medium flex items-center justify-center gap-2">
        <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
        <span>Sem internet. Conecte-se para continuar.</span>
      </div>
    );
  }

  if (needRefresh) {
    return (
      <div className="bg-brand-blue text-white px-4 py-2 text-xs font-medium flex items-center justify-center gap-3">
        <span>Nova versão disponível</span>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="px-3 py-1 bg-white text-brand-blue font-semibold rounded-lg inline-flex items-center gap-1 hover:bg-blue-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Atualizar</span>
        </button>
      </div>
    );
  }

  return null;
}
