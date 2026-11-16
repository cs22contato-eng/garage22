import React, { useEffect, useState } from 'react';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';

type AuthMode = 'login' | 'register' | 'confirm' | 'forgot';

interface AuthPagesProps {
  initialMode: AuthMode;
  navigate: (to: string) => void;
}

export function AuthPages({ initialMode, navigate }: AuthPagesProps) {
  const { setSessionToken } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmToken, setConfirmToken] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [recoveryAccessToken, setRecoveryAccessToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetRequested, setResetRequested] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    setMode(initialMode);
    setError('');
    setInfo('');

    // Suporte ao link de recuperação enviado por e-mail pelo Supabase (#access_token=...&type=recovery)
    if (initialMode === 'forgot' && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hashParams.get('access_token');
      const type = hashParams.get('type');
      if (accessToken && type === 'recovery') {
        setRecoveryAccessToken(accessToken);
        setInfo('Link validado. Defina sua nova senha abaixo.');
      }
    }
  }, [initialMode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await setSessionToken(res.token);
      navigate('/app/painel');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setMode('confirm');
        setInfo('Confirme seu e-mail com o código recebido para entrar.');
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao entrar.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; token?: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      if (res.token) {
        await setSessionToken(res.token);
        navigate('/onboarding');
        return;
      }
      setInfo('Conta criada. Confirme seu e-mail para iniciar seu teste grátis de 7 dias.');
      setMode('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token?: string }>('/api/auth/confirm-email', {
        method: 'POST',
        body: JSON.stringify({ email, token: confirmToken }),
      });
      if (res.token) {
        await setSessionToken(res.token);
        navigate('/onboarding');
      } else {
        setInfo('E-mail confirmado. Faça login para continuar.');
        setMode('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/request-reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResetRequested(true);
      setInfo(
        res.message ||
          'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação para sua caixa de entrada.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao solicitar recuperação.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (recoveryAccessToken) {
        await apiRequest('/api/auth/complete-recovery', {
          method: 'POST',
          body: JSON.stringify({ access_token: recoveryAccessToken, new_password: newPassword }),
        });
        window.history.replaceState({}, '', '/login');
        setRecoveryAccessToken('');
      } else {
        await apiRequest('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email, token: resetToken, new_password: newPassword }),
        });
      }
      setInfo('Senha atualizada com sucesso. Entre com sua nova senha.');
      setResetRequested(false);
      setNewPassword('');
      setResetToken('');
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao redefinir senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="min-h-[40px] px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>Voltar para início</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {/* Dark Carbon Brand Showcase Header */}
          <div className="bg-brand-dark relative overflow-hidden px-6 py-5 flex items-center justify-center border-b border-slate-800">
            <img
              src="/assets/aistudio/Logo_futurista_CS22_Garage_14b7e400.png"
              alt="CS22 Garage"
              className="h-20 w-auto object-contain"
            />
          </div>

          <div className="p-6 sm:p-8">
            {(mode === 'login' || mode === 'register') && (
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl mb-5">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className={`min-h-[38px] text-xs sm:text-sm font-semibold rounded-lg transition-colors ${
                    mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/cadastro')}
                  className={`min-h-[38px] text-xs sm:text-sm font-semibold rounded-lg transition-colors ${
                    mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Criar conta
                </button>
              </div>
            )}

            <div className="mb-5">
              <h1 className="font-display text-2xl font-bold text-slate-900">
                {mode === 'login' && 'Entrar na garagem'}
                {mode === 'register' && 'Criar conta grátis'}
                {mode === 'confirm' && 'Confirmar seu e-mail'}
                {mode === 'forgot' && 'Recuperar senha'}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {mode === 'login' && 'Acesse o painel de veículos, lembretes, despesas e lucros.'}
                {mode === 'register' && '7 dias grátis sem cartão. Comece pelo celular.'}
                {mode === 'confirm' && 'Valide seu e-mail para liberar o cadastro da garagem.'}
                {mode === 'forgot' && 'Redefina sua senha com segurança.'}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-800">
                {error}
              </div>
            )}
            {info && (
              <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs sm:text-sm text-blue-900">
                {info}
              </div>
            )}

            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">E-mail</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com.br"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-slate-700">Senha</label>
                    <button
                      type="button"
                      onClick={() => navigate('/recuperar-senha')}
                      className="text-xs font-semibold text-brand-blue hover:underline"
                    >
                      Esqueci a senha
                    </button>
                  </div>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] py-2.5 bg-brand-blue hover:bg-brand-blue-hover disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>
              </form>
            )}

            {mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Seu nome</label>
                  <input
                    type="text"
                    required
                    autoComplete="name"
                    minLength={2}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Carlos Eduardo"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">E-mail</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com.br"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Senha (mín. 6 caracteres)</label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Crie uma senha forte"
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] py-2.5 bg-brand-blue hover:bg-brand-blue-hover disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {loading ? 'Criando conta...' : 'Criar conta grátis'}
                </button>
              </form>
            )}

            {mode === 'confirm' && (
              <form onSubmit={handleConfirmEmail} className="space-y-4">
                <div className="flex items-center gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                  <MailCheck className="w-4 h-4 text-brand-blue shrink-0" />
                  <span>Confirme o e-mail <strong>{email}</strong> para liberar seu acesso.</span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Código de confirmação</label>
                  <input
                    type="text"
                    required
                    value={confirmToken}
                    onChange={(e) => setConfirmToken(e.target.value)}
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] py-2.5 bg-brand-blue hover:bg-brand-blue-hover disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {loading ? 'Confirmando...' : 'Confirmar e continuar'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="w-full min-h-[40px] py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
                >
                  Voltar para o login
                </button>
              </form>
            )}

            {mode === 'forgot' && (
              <form
                onSubmit={recoveryAccessToken || resetRequested ? handleResetPassword : handleRequestReset}
                className="space-y-4"
              >
                {!recoveryAccessToken && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">E-mail cadastrado</label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com.br"
                      className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    />
                  </div>
                )}

                {resetRequested && !recoveryAccessToken && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Código recebido por e-mail
                    </label>
                    <input
                      type="text"
                      required
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder="Digite o código recebido"
                      className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    />
                  </div>
                )}

                {(recoveryAccessToken || resetRequested) && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Nova senha (mín. 6 caracteres)
                    </label>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] py-2.5 bg-brand-blue hover:bg-brand-blue-hover disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {loading
                    ? 'Processando...'
                    : recoveryAccessToken || resetRequested
                    ? 'Salvar nova senha'
                    : 'Enviar instruções'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="w-full min-h-[40px] py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
                >
                  Voltar para o login
                </button>
              </form>
            )}

            <div className="mt-6 pt-5 border-t border-slate-200 text-center text-xs text-slate-600">
              {mode === 'login' ? (
                <>
                  Ainda não tem conta?{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/cadastro')}
                    className="font-semibold text-brand-blue hover:underline"
                  >
                    Criar conta grátis
                  </button>
                </>
              ) : (
                <>
                  Já possui conta?{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="font-semibold text-brand-blue hover:underline"
                  >
                    Entrar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
