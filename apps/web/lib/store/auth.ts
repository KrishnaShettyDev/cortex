import { create } from 'zustand';
import { apiClient, type User } from '../api/client';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  signIn: (idToken: string) => Promise<void>;
  signOut: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,

  signIn: async (idToken: string) => {
    try {
      set({ isLoading: true, error: null });
      const response = await apiClient.googleSignIn(idToken);
      apiClient.setToken(response.access_token);
      set({ user: response.user, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  signOut: () => {
    apiClient.clearToken();
    set({ user: null });
  },

  checkAuth: async () => {
    try {
      set({ isLoading: true });
      const user = await apiClient.getCurrentUser();
      set({ user, isLoading: false });
    } catch (error) {
      set({ user: null, isLoading: false });
      apiClient.clearToken();
    }
  },
}));
