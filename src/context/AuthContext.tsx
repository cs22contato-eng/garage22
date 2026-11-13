import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest, getAuthToken, setAuthToken } from '../lib/api';
import type { Company, Subscription, UserProfile } from '../types/garage';

interface AuthState {
  user: UserProfile | null;
  company: Company | null;
  subscription: Subscription | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
  setSessionToken: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setCompany(null);
      setSubscription(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiRequest<{
        user: UserProfile;
        company: Company | null;
        subscription: Subscription | null;
      }>('/api/auth/me');
      setUser(data.user);
      setCompany(data.company);
      setSubscription(data.subscription);
    } catch {
      setAuthToken(null);
      setUser(null);
      setCompany(null);
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const setSessionToken = useCallback(
    async (token: string) => {
      setAuthToken(token);
      setLoading(true);
      await refreshSession();
    },
    [refreshSession]
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setCompany(null);
    setSubscription(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, company, subscription, loading, refreshSession, setSessionToken, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
