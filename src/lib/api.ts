import { ApiError } from './apiError';
import { isSupabaseConfigured } from './supabase';
import { handleSupabaseDirectRequest } from './supabaseDirect';

export { ApiError };

const TOKEN_KEY = 'cs22_garage_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isSupabaseConfigured) {
    return handleSupabaseDirectRequest<T>(path, options);
  }

  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const fallbackMessage =
      res.status === 405
        ? 'Configuração do Supabase ausente no build (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY). Adicione as variáveis no Cloudflare Pages e refaça o deploy.'
        : `Erro na requisição (${res.status})`;
    throw new ApiError(
      json?.error || fallbackMessage,
      res.status,
      json?.code,
      json
    );
  }

  return json as T;
}
