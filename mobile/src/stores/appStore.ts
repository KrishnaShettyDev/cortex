import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IntegrationsStatus } from '../services';
import { ChatMessage } from '../types';

export type ThemeMode = 'dark' | 'light' | 'system';

interface NotificationSettings {
  // Briefings
  morningBriefing: boolean;
  eveningBriefing: boolean;

  // Smart features
  smartReminders: boolean;
  memoryInsights: boolean;
  meetingPrep: boolean;
  emailAlerts: boolean;
  commitmentReminders: boolean;
  patternWarnings: boolean;
  reconnectionNudges: boolean;
  importantDates: boolean;

  // Budget and quiet hours
  maxNotificationsPerDay: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // HH:MM format
  quietHoursEnd: string; // HH:MM format

  // Timing
  morningBriefingTime: string; // HH:MM format
  eveningBriefingTime: string; // HH:MM format
  meetingPrepMinutesBefore: number;
  timezone: string;
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

  // Chat History (persisted)
  chatMessages: ChatMessage[];

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
  setChatMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  addChatMessage: (message: ChatMessage) => void;
  clearChatMessages: () => void;
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
  chatMessages: [] as ChatMessage[],
  hasSeenOnboarding: false,
  themeMode: 'system' as ThemeMode,
  isApiHealthy: true,
  lastHealthCheckAt: null,
  notificationSettings: {
    morningBriefing: true,
    eveningBriefing: true,
    smartReminders: true,
    memoryInsights: true,
    meetingPrep: true,
    emailAlerts: true,
    commitmentReminders: true,
    patternWarnings: true,
    reconnectionNudges: true,
    importantDates: true,
    maxNotificationsPerDay: 8,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    morningBriefingTime: '08:00',
    eveningBriefingTime: '18:00',
    meetingPrepMinutesBefore: 30,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
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

      setChatMessages: (messagesOrUpdater) => {
        // Support both direct array and functional updates
        if (typeof messagesOrUpdater === 'function') {
          set((state) => {
            const currentMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
            const newMessages = messagesOrUpdater(currentMessages);
            return { chatMessages: Array.isArray(newMessages) ? newMessages.filter(Boolean) : [] };
          });
        } else {
          const validMessages = Array.isArray(messagesOrUpdater) ? messagesOrUpdater.filter(Boolean) : [];
          set({ chatMessages: validMessages });
        }
      },

      addChatMessage: (message) =>
        set((state) => {
          const existingMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
          if (!message) return { chatMessages: existingMessages.filter(Boolean) };
          return { chatMessages: [...existingMessages.filter(Boolean), message] };
        }),

      clearChatMessages: () =>
        set({ chatMessages: [], lastConversationId: null }),

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
        chatMessages: Array.isArray(state.chatMessages) ? state.chatMessages.filter(Boolean) : [],
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
