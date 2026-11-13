import React, { useState } from 'react';
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
  const [newPassword, setNewPassword] = useState('');
  const [resetRequested, setResetRequested] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

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
        if (err.data?.verification_token) {
          setConfirmToken(err.data.verification_token);
        }
        setMode('confirm');
        setInfo('Confirme seu e-mail com o código de verificação para entrar.');
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao entrar.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (demoEmail: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: demoEmail, password: 'Garage@2026' }),
      });
      await setSessionToken(res.token);
      navigate('/app/painel');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar na conta demo.');
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
      const res = await apiRequest<{ message: string; verification_token?: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      if (res.verification_token) {
        setConfirmToken(res.verification_token);
      }
      setInfo('Conta criada. Confirme seu e-mail abaixo para iniciar seu teste grátis de 7 dias.');
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
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; reset_token?: string }>('/api/auth/request-reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (res.reset_token) {
        setResetToken(res.reset_token);
      }
      setResetRequested(true);
      setInfo('Código de recuperação gerado. Informe o código e sua nova senha.');
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
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, token: resetToken, new_password: newPassword }),
      });
      setInfo('Senha atualizada com sucesso. Entre com sua nova senha.');
      setResetRequested(false);
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao redefinir senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-10">
      <div className="max-w-md w-full mx-auto">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para início</span>
        </button>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
          <div className="mb-6">
            <span className="font-display text-lg font-bold text-slate-900">CS22 Garage</span>
            <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">
              {mode === 'login' && 'Entrar na garagem'}
              {mode === 'register' && 'Criar conta grátis'}
              {mode === 'confirm' && 'Confirmar seu e-mail'}
              {mode === 'forgot' && 'Recuperar senha'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'login' && 'Acesse o painel de veículos, despesas e lucros.'}
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dono@garagem.com.br"
                  className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-700">Senha</label>
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setInfo('');
                      setMode('forgot');
                    }}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Esqueci a senha
                  </button>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </button>

              <div className="pt-4 border-t border-slate-100 space-y-2">
                <p className="text-xs text-slate-500 text-center">Acesso rápido para validação:</p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoLogin('contato@premiummotors.com.br')}
                  className="w-full min-h-[42px] px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl transition-colors"
                >
                  Entrar como Premium Motors (Garagem 1)
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoLogin('vendas@horizonteauto.com.br')}
                  className="w-full min-h-[40px] px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl transition-colors"
                >
                  Entrar como Horizonte Auto (Garagem 2 — isolamento)
                </button>
              </div>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Seu nome</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Carlos Eduardo"
                  className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dono@garagem.com.br"
                  className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Senha (mín. 6 caracteres)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Crie uma senha forte"
                  className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {loading ? 'Criando conta...' : 'Criar conta grátis'}
              </button>
            </form>
          )}

          {mode === 'confirm' && (
            <form onSubmit={handleConfirmEmail} className="space-y-4">
              <div className="flex items-center gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                <MailCheck className="w-4 h-4 text-blue-700 shrink-0" />
                <span>Confirme o e-mail <strong>{email}</strong> para liberar seu acesso.</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Código de confirmação</label>
                <input
                  type="text"
                  required
                  value={confirmToken}
                  onChange={(e) => setConfirmToken(e.target.value)}
                  className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {loading ? 'Confirmando...' : 'Confirmar e continuar'}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={resetRequested ? handleResetPassword : handleRequestReset} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">E-mail cadastrado</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              {resetRequested && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Código de recuperação</label>
                    <input
                      type="text"
                      required
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Nova senha</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                    />
                  </div>
                </>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {loading ? 'Processando...' : resetRequested ? 'Salvar nova senha' : 'Enviar código'}
              </button>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-slate-200 text-center text-xs text-slate-600">
            {mode === 'login' ? (
              <>
                Ainda não tem conta?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setInfo('');
                    setMode('register');
                  }}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  Criar conta grátis
                </button>
              </>
            ) : (
              <>
                Já possui conta?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setInfo('');
                    setMode('login');
                  }}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  Entrar
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
