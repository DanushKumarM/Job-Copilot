import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setOnAuthExpired, shouldClearStoredSession } from '../api/client';
import { UserOut } from '../types/api';
import { getSessionToken, removeSessionToken, setSessionToken } from '../utils/secureStore';

interface AuthContextType {
  user: UserOut | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserOut | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const restoreSession = async () => {
    try {
      const token = await getSessionToken();
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const data = await api.auth.me();
      setUser(data.user);
    } catch (error) {
      if (shouldClearStoredSession(error)) {
        await removeSessionToken();
      }
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    restoreSession();
    setOnAuthExpired(() => {
      setUser(null);
    });
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.auth.login({ email, password });
    if (res.session_token) {
      await setSessionToken(res.session_token);
    }
    setUser(res.user);
  };

  const register = async (email: string, password: string) => {
    const res = await api.auth.register({ email, password });
    if (res.session_token) {
      await setSessionToken(res.session_token);
    }
    setUser(res.user);
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // Continue cleanup on mobile even if server request fails
    } finally {
      await removeSessionToken();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
};
