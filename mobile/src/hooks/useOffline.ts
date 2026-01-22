import { useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useQueryClient } from '@tanstack/react-query';
import { addBreadcrumb } from '../lib/sentry';

// Check if NetInfo native module is available
const checkNativeModuleAvailable = (): boolean => {
  try {
    const { NativeModules } = require('react-native');
    return NativeModules?.RNCNetInfo != null;
  } catch {
    return false;
  }
};

const isModuleAvailable = checkNativeModuleAvailable();

// Lazy load NetInfo only if available
let NetInfo: typeof import('@react-native-community/netinfo').default | null = null;

const loadNetInfo = async () => {
  if (!isModuleAvailable) return false;
  if (NetInfo !== null) return true;

  try {
    const module = await import('@react-native-community/netinfo');
    NetInfo = module.default;
    return true;
  } catch {
    return false;
  }
};

export const useOffline = () => {
  const { isOnline, setOnline, setApiHealthy } = useAppStore();
  const queryClient = useQueryClient();
  const [moduleLoaded, setModuleLoaded] = useState(false);

  // Load module on mount
  useEffect(() => {
    if (!isModuleAvailable) {
      setModuleLoaded(true);
      setOnline(true); // Assume online if we can't check
      return;
    }

    loadNetInfo().then((loaded) => {
      setModuleLoaded(true);
      if (!loaded) {
        setOnline(true);
      }
    });
  }, [setOnline]);

  // Check API health
  const checkApiHealth = useCallback(async () => {
    try {
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000'}/health`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const healthy = response.ok;
      setApiHealthy(healthy);
      return healthy;
    } catch {
      setApiHealthy(false);
      return false;
    }
  }, [setApiHealthy]);

  // Handle coming back online
  const handleOnline = useCallback(async () => {
    addBreadcrumb('network', 'Device came online');

    const apiHealthy = await checkApiHealth();

    if (apiHealthy) {
      queryClient.refetchQueries({
        stale: true,
        type: 'active',
      });
    }
  }, [queryClient, checkApiHealth]);

  // Handle going offline
  const handleOffline = useCallback(() => {
    addBreadcrumb('network', 'Device went offline');
    setApiHealthy(false);
  }, [setApiHealthy]);

  useEffect(() => {
    if (!moduleLoaded || !NetInfo || !isModuleAvailable) return;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const wasOnline = isOnline;
      const nowOnline = state.isConnected ?? false;

      setOnline(nowOnline);

      if (!wasOnline && nowOnline) {
        handleOnline();
      } else if (wasOnline && !nowOnline) {
        handleOffline();
      }
    });

    NetInfo.fetch().then((state) => {
      setOnline(state.isConnected ?? false);
      if (state.isConnected) {
        checkApiHealth();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [moduleLoaded, isOnline, setOnline, handleOnline, handleOffline, checkApiHealth]);

  // Manual refresh
  const refresh = useCallback(async () => {
    if (!NetInfo || !isModuleAvailable) {
      await checkApiHealth();
      return;
    }

    const state = await NetInfo.fetch();
    setOnline(state.isConnected ?? false);
    if (state.isConnected) {
      await handleOnline();
    }
  }, [setOnline, handleOnline, checkApiHealth]);

  return {
    isOnline,
    isOffline: !isOnline,
    refresh,
    checkApiHealth,
  };
};

// Hook to pause/resume queries based on network state
export const useNetworkAwareQuery = () => {
  const { isOnline } = useAppStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isOnline) {
      queryClient.setDefaultOptions({
        queries: {
          enabled: false,
        },
      });
    } else {
      queryClient.setDefaultOptions({
        queries: {
          enabled: true,
        },
      });
    }
  }, [isOnline, queryClient]);
};
