import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

const DISMISS_KEY = 'cs22_pwa_install_dismissed';

interface PWAInstallPromptProps {
  hasRegisteredVehicle: boolean;
  alwaysVisibleInSettings?: boolean;
}

export function PWAInstallPrompt({
  hasRegisteredVehicle,
  alwaysVisibleInSettings = false,
}: PWAInstallPromptProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  if (isInstalled) return null;
  if (!alwaysVisibleInSettings && (!hasRegisteredVehicle || dismissed)) return null;
  if (!isInstallable && !isIOS) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900">Instalar CS22 Garage no celular</p>
        {isInstallable ? (
          <p className="text-xs text-slate-600 mt-0.5">
            Acesse sua garagem direto da tela inicial como aplicativo.
          </p>
        ) : (
          <p className="text-xs text-slate-600 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <Share className="w-3.5 h-3.5 text-brand-blue shrink-0" />
            <span>Toque em Compartilhar e depois em Adicionar à Tela de Início.</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isInstallable && (
          <button
            type="button"
            onClick={install}
            className="min-h-[40px] px-3.5 py-2 bg-brand-blue hover:bg-brand-blue-hover text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Instalar app</span>
          </button>
        )}
        {!alwaysVisibleInSettings && (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dispensar convite de instalação"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
