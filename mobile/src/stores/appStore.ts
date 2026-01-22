import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IntegrationsStatus } from '../services';

export type ThemeMode = 'dark' | 'light' | 'system';

interface NotificationSettings {
  morningBriefing: boolean;
  eveningBriefing: boolean;
  smartReminders: boolean;
  memoryInsights: boolean;
}

interface AppState {
  // Network State
  isOnline: boolean;
  lastOnlineAt: number | null;

  // Biometric Auth
  isBiometricEnabled: boolean;
  isBiometricAvailable: boolean;
  isUnlocked: boolean;

  // App State Persistence
  lastScreen: string;
  chatDraft: string;
  lastConversationId: string | null;

  // UI State
  hasSeenOnboarding: boolean;
  themeMode: ThemeMode;

  // Health Check
  isApiHealthy: boolean;
  lastHealthCheckAt: number | null;

  // Notification Settings
  notificationSettings: NotificationSettings;

  // Integration Status (cached)
  integrationStatus: IntegrationsStatus | null;
  integrationStatusLoadedAt: number | null;

  // Actions
  setOnline: (online: boolean) => void;
  setBiometricEnabled: (enabled: boolean) => void;
  setBiometricAvailable: (available: boolean) => void;
  setUnlocked: (unlocked: boolean) => void;
  setLastScreen: (screen: string) => void;
  setChatDraft: (draft: string) => void;
  setLastConversationId: (id: string | null) => void;
  setHasSeenOnboarding: (seen: boolean) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setApiHealthy: (healthy: boolean) => void;
  setNotificationSettings: (settings: Partial<NotificationSettings>) => void;
  setIntegrationStatus: (status: IntegrationsStatus | null) => void;
  reset: () => void;
}

const initialState = {
  isOnline: true,
  lastOnlineAt: null,
  isBiometricEnabled: false,
  isBiometricAvailable: false,
  isUnlocked: false,
  lastScreen: '/(main)/chat',
  chatDraft: '',
  lastConversationId: null,
  hasSeenOnboarding: false,
  themeMode: 'dark' as ThemeMode,
  isApiHealthy: true,
  lastHealthCheckAt: null,
  notificationSettings: {
    morningBriefing: true,
    eveningBriefing: true,
    smartReminders: true,
    memoryInsights: true,
  },
  integrationStatus: null,
  integrationStatusLoadedAt: null,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialState,

      setOnline: (online) =>
        set({
          isOnline: online,
          lastOnlineAt: online ? Date.now() : null,
        }),

      setBiometricEnabled: (enabled) =>
        set({ isBiometricEnabled: enabled }),

      setBiometricAvailable: (available) =>
        set({ isBiometricAvailable: available }),

      setUnlocked: (unlocked) =>
        set({ isUnlocked: unlocked }),

      setLastScreen: (screen) =>
        set({ lastScreen: screen }),

      setChatDraft: (draft) =>
        set({ chatDraft: draft }),

      setLastConversationId: (id) =>
        set({ lastConversationId: id }),

      setHasSeenOnboarding: (seen) =>
        set({ hasSeenOnboarding: seen }),

      setThemeMode: (mode) =>
        set({ themeMode: mode }),

      setApiHealthy: (healthy) =>
        set({
          isApiHealthy: healthy,
          lastHealthCheckAt: Date.now(),
        }),

      setNotificationSettings: (settings) =>
        set((state) => ({
          notificationSettings: { ...state.notificationSettings, ...settings },
        })),

      setIntegrationStatus: (status) =>
        set({
          integrationStatus: status,
          integrationStatusLoadedAt: Date.now(),
        }),

      reset: () => set(initialState),
    }),
    {
      name: 'cortex-app-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist these fields
      partialize: (state) => ({
        isBiometricEnabled: state.isBiometricEnabled,
        lastScreen: state.lastScreen,
        chatDraft: state.chatDraft,
        lastConversationId: state.lastConversationId,
        hasSeenOnboarding: state.hasSeenOnboarding,
        themeMode: state.themeMode,
        notificationSettings: state.notificationSettings,
      }),
    }
  )
);

// Selectors for common state access patterns
export const selectIsOnline = (state: AppState) => state.isOnline;
export const selectIsUnlocked = (state: AppState) => state.isUnlocked;
export const selectChatDraft = (state: AppState) => state.chatDraft;
export const selectNotificationSettings = (state: AppState) => state.notificationSettings;
export const selectThemeMode = (state: AppState) => state.themeMode;

// Export types
export type { NotificationSettings };
