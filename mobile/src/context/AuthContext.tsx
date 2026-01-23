import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService } from '../services/auth';
import { storage } from '../services/storage';
import { User } from '../types';
import { logger } from '../utils/logger';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  error: string | null;
  signInWithApple: (identityToken: string, authorizationCode: string, name?: string, email?: string) => Promise<void>;
  signInWithGoogle: (idToken: string, name?: string, email?: string) => Promise<void>;
  devSignIn: (email: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    logger.debug('AuthContext: checkAuth started');
    try {
      const token = await storage.getAccessToken();
      logger.debug('AuthContext: token exists:', !!token);
      if (token) {
        logger.debug('AuthContext: fetching current user...');
        const currentUser = await authService.getCurrentUser();
        logger.debug('AuthContext: got user:', currentUser?.email);
        setUser(currentUser);
        setIsAuthenticated(true);
      } else {
        logger.debug('AuthContext: no token, skipping user fetch');
      }
    } catch (err) {
      logger.error('AuthContext: error during checkAuth:', err);
      await storage.clearAll();
    } finally {
      logger.debug('AuthContext: checkAuth complete, setting isLoading=false');
      setIsLoading(false);
    }
  };

  const signInWithApple = async (
    identityToken: string,
    authorizationCode: string,
    name?: string,
    email?: string
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      await authService.signInWithApple(identityToken, authorizationCode, name, email);
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async (idToken: string, name?: string, email?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await authService.signInWithGoogle(idToken, name, email);
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const devSignIn = async (email: string, name?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await authService.devSignIn(email, name);
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    await authService.signOut();
    setUser(null);
    setIsAuthenticated(false);
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        error,
        signInWithApple,
        signInWithGoogle,
        devSignIn,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
