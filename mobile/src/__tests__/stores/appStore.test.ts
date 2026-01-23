/**
 * Tests for App Store
 * Tests state management, selectors, and notification settings
 */

import { useAppStore, selectIsOnline, selectIsUnlocked, selectChatDraft, selectNotificationSettings, selectThemeMode, ThemeMode } from '../../stores/appStore';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

describe('appStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAppStore.getState().reset();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useAppStore.getState();

      expect(state.isOnline).toBe(true);
      expect(state.lastOnlineAt).toBeNull();
      expect(state.isBiometricEnabled).toBe(false);
      expect(state.isBiometricAvailable).toBe(false);
      expect(state.isUnlocked).toBe(false);
      expect(state.lastScreen).toBe('/(main)/chat');
      expect(state.chatDraft).toBe('');
      expect(state.lastConversationId).toBeNull();
      expect(state.hasSeenOnboarding).toBe(false);
      expect(state.themeMode).toBe('dark');
      expect(state.isApiHealthy).toBe(true);
      expect(state.lastHealthCheckAt).toBeNull();
      expect(state.notificationSettings).toEqual({
        morningBriefing: true,
        eveningBriefing: true,
        smartReminders: true,
        memoryInsights: true,
      });
      expect(state.integrationStatus).toBeNull();
      expect(state.integrationStatusLoadedAt).toBeNull();
    });
  });

  describe('Network State', () => {
    it('should set online state and update lastOnlineAt when going online', () => {
      const { setOnline } = useAppStore.getState();
      const before = Date.now();

      setOnline(true);

      const state = useAppStore.getState();
      expect(state.isOnline).toBe(true);
      expect(state.lastOnlineAt).toBeGreaterThanOrEqual(before);
    });

    it('should set online state and clear lastOnlineAt when going offline', () => {
      const { setOnline } = useAppStore.getState();

      // Go online first
      setOnline(true);
      expect(useAppStore.getState().lastOnlineAt).not.toBeNull();

      // Go offline
      setOnline(false);

      const state = useAppStore.getState();
      expect(state.isOnline).toBe(false);
      expect(state.lastOnlineAt).toBeNull();
    });
  });

  describe('Biometric State', () => {
    it('should set biometric enabled', () => {
      const { setBiometricEnabled } = useAppStore.getState();

      setBiometricEnabled(true);

      expect(useAppStore.getState().isBiometricEnabled).toBe(true);
    });

    it('should set biometric available', () => {
      const { setBiometricAvailable } = useAppStore.getState();

      setBiometricAvailable(true);

      expect(useAppStore.getState().isBiometricAvailable).toBe(true);
    });

    it('should set unlocked state', () => {
      const { setUnlocked } = useAppStore.getState();

      setUnlocked(true);

      expect(useAppStore.getState().isUnlocked).toBe(true);
    });

    it('should toggle unlocked state', () => {
      const { setUnlocked } = useAppStore.getState();

      setUnlocked(true);
      expect(useAppStore.getState().isUnlocked).toBe(true);

      setUnlocked(false);
      expect(useAppStore.getState().isUnlocked).toBe(false);
    });
  });

  describe('App State Persistence', () => {
    it('should set last screen', () => {
      const { setLastScreen } = useAppStore.getState();

      setLastScreen('/(main)/settings');

      expect(useAppStore.getState().lastScreen).toBe('/(main)/settings');
    });

    it('should set chat draft', () => {
      const { setChatDraft } = useAppStore.getState();

      setChatDraft('Hello, this is a test message');

      expect(useAppStore.getState().chatDraft).toBe('Hello, this is a test message');
    });

    it('should set last conversation ID', () => {
      const { setLastConversationId } = useAppStore.getState();

      setLastConversationId('conv-123');

      expect(useAppStore.getState().lastConversationId).toBe('conv-123');
    });

    it('should clear last conversation ID', () => {
      const { setLastConversationId } = useAppStore.getState();

      setLastConversationId('conv-123');
      setLastConversationId(null);

      expect(useAppStore.getState().lastConversationId).toBeNull();
    });
  });

  describe('UI State', () => {
    it('should set has seen onboarding', () => {
      const { setHasSeenOnboarding } = useAppStore.getState();

      setHasSeenOnboarding(true);

      expect(useAppStore.getState().hasSeenOnboarding).toBe(true);
    });

    it('should set theme mode to light', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('light');

      expect(useAppStore.getState().themeMode).toBe('light');
    });

    it('should set theme mode to system', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('system');

      expect(useAppStore.getState().themeMode).toBe('system');
    });

    it('should set theme mode to dark', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('light');
      setThemeMode('dark');

      expect(useAppStore.getState().themeMode).toBe('dark');
    });
  });

  describe('Health Check', () => {
    it('should set API healthy and update lastHealthCheckAt', () => {
      const { setApiHealthy } = useAppStore.getState();
      const before = Date.now();

      setApiHealthy(true);

      const state = useAppStore.getState();
      expect(state.isApiHealthy).toBe(true);
      expect(state.lastHealthCheckAt).toBeGreaterThanOrEqual(before);
    });

    it('should set API unhealthy', () => {
      const { setApiHealthy } = useAppStore.getState();

      setApiHealthy(false);

      expect(useAppStore.getState().isApiHealthy).toBe(false);
    });
  });

  describe('Notification Settings', () => {
    it('should update single notification setting', () => {
      const { setNotificationSettings } = useAppStore.getState();

      setNotificationSettings({ morningBriefing: false });

      const { notificationSettings } = useAppStore.getState();
      expect(notificationSettings.morningBriefing).toBe(false);
      // Other settings should be preserved
      expect(notificationSettings.eveningBriefing).toBe(true);
      expect(notificationSettings.smartReminders).toBe(true);
      expect(notificationSettings.memoryInsights).toBe(true);
    });

    it('should update multiple notification settings', () => {
      const { setNotificationSettings } = useAppStore.getState();

      setNotificationSettings({
        morningBriefing: false,
        smartReminders: false,
      });

      const { notificationSettings } = useAppStore.getState();
      expect(notificationSettings.morningBriefing).toBe(false);
      expect(notificationSettings.eveningBriefing).toBe(true);
      expect(notificationSettings.smartReminders).toBe(false);
      expect(notificationSettings.memoryInsights).toBe(true);
    });

    it('should update all notification settings', () => {
      const { setNotificationSettings } = useAppStore.getState();

      setNotificationSettings({
        morningBriefing: false,
        eveningBriefing: false,
        smartReminders: false,
        memoryInsights: false,
      });

      const { notificationSettings } = useAppStore.getState();
      expect(notificationSettings.morningBriefing).toBe(false);
      expect(notificationSettings.eveningBriefing).toBe(false);
      expect(notificationSettings.smartReminders).toBe(false);
      expect(notificationSettings.memoryInsights).toBe(false);
    });
  });

  describe('Integration Status', () => {
    it('should set integration status', () => {
      const { setIntegrationStatus } = useAppStore.getState();
      const mockStatus = {
        google: {
          connected: true,
          email: 'test@gmail.com',
          last_sync: null,
          status: 'active' as const,
          gmail_connected: true,
          calendar_connected: true,
        },
        microsoft: {
          connected: false,
          email: null,
          last_sync: null,
          status: 'not_connected' as const,
          gmail_connected: false,
          calendar_connected: false,
        },
      };
      const before = Date.now();

      setIntegrationStatus(mockStatus);

      const state = useAppStore.getState();
      expect(state.integrationStatus).toEqual(mockStatus);
      expect(state.integrationStatusLoadedAt).toBeGreaterThanOrEqual(before);
    });

    it('should clear integration status', () => {
      const { setIntegrationStatus } = useAppStore.getState();
      const mockStatus = {
        google: {
          connected: true,
          email: 'test@gmail.com',
          last_sync: null,
          status: 'active' as const,
          gmail_connected: true,
          calendar_connected: true,
        },
        microsoft: {
          connected: false,
          email: null,
          last_sync: null,
          status: 'not_connected' as const,
          gmail_connected: false,
          calendar_connected: false,
        },
      };

      setIntegrationStatus(mockStatus);
      setIntegrationStatus(null);

      expect(useAppStore.getState().integrationStatus).toBeNull();
    });
  });

  describe('Reset', () => {
    it('should reset all state to initial values', () => {
      const {
        setOnline,
        setBiometricEnabled,
        setUnlocked,
        setLastScreen,
        setChatDraft,
        setHasSeenOnboarding,
        setThemeMode,
        setNotificationSettings,
        reset,
      } = useAppStore.getState();

      // Modify all state
      setOnline(false);
      setBiometricEnabled(true);
      setUnlocked(true);
      setLastScreen('/settings');
      setChatDraft('Test draft');
      setHasSeenOnboarding(true);
      setThemeMode('light');
      setNotificationSettings({ morningBriefing: false });

      // Reset
      reset();

      const state = useAppStore.getState();
      expect(state.isOnline).toBe(true);
      expect(state.isBiometricEnabled).toBe(false);
      expect(state.isUnlocked).toBe(false);
      expect(state.lastScreen).toBe('/(main)/chat');
      expect(state.chatDraft).toBe('');
      expect(state.hasSeenOnboarding).toBe(false);
      expect(state.themeMode).toBe('dark');
      expect(state.notificationSettings.morningBriefing).toBe(true);
    });
  });

  describe('Selectors', () => {
    it('selectIsOnline should return online state', () => {
      useAppStore.getState().setOnline(false);

      const isOnline = selectIsOnline(useAppStore.getState());
      expect(isOnline).toBe(false);
    });

    it('selectIsUnlocked should return unlocked state', () => {
      useAppStore.getState().setUnlocked(true);

      const isUnlocked = selectIsUnlocked(useAppStore.getState());
      expect(isUnlocked).toBe(true);
    });

    it('selectChatDraft should return chat draft', () => {
      useAppStore.getState().setChatDraft('My draft message');

      const draft = selectChatDraft(useAppStore.getState());
      expect(draft).toBe('My draft message');
    });

    it('selectNotificationSettings should return notification settings', () => {
      useAppStore.getState().setNotificationSettings({ morningBriefing: false });

      const settings = selectNotificationSettings(useAppStore.getState());
      expect(settings.morningBriefing).toBe(false);
      expect(settings.eveningBriefing).toBe(true);
    });

    it('selectThemeMode should return theme mode', () => {
      useAppStore.getState().setThemeMode('system');

      const themeMode = selectThemeMode(useAppStore.getState());
      expect(themeMode).toBe('system');
    });
  });

  describe('State Preservation', () => {
    it('should preserve unrelated state when updating', () => {
      const { setOnline, setBiometricEnabled, setChatDraft, setThemeMode } = useAppStore.getState();

      // Set initial values
      setOnline(true);
      setBiometricEnabled(true);
      setChatDraft('Original draft');
      setThemeMode('light');

      // Update only one property
      setOnline(false);

      // Other properties should be preserved
      const state = useAppStore.getState();
      expect(state.isOnline).toBe(false);
      expect(state.isBiometricEnabled).toBe(true);
      expect(state.chatDraft).toBe('Original draft');
      expect(state.themeMode).toBe('light');
    });
  });
});
