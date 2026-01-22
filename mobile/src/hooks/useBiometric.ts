import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { addBreadcrumb, captureException } from '../lib/sentry';

// Check if native module is available
const checkNativeModuleAvailable = (): boolean => {
  try {
    const { NativeModulesProxy } = require('expo-modules-core');
    return NativeModulesProxy?.ExpoLocalAuthentication != null;
  } catch {
    return false;
  }
};

const isModuleAvailable = checkNativeModuleAvailable();

// Lazy load LocalAuthentication only if available
let LocalAuthentication: typeof import('expo-local-authentication') | null = null;

const loadLocalAuthentication = async () => {
  if (!isModuleAvailable) return false;
  if (LocalAuthentication !== null) return true;

  try {
    LocalAuthentication = await import('expo-local-authentication');
    return true;
  } catch {
    return false;
  }
};

export const useBiometric = () => {
  const {
    isBiometricEnabled,
    isBiometricAvailable,
    isUnlocked,
    setBiometricEnabled,
    setBiometricAvailable,
    setUnlocked,
  } = useAppStore();

  const [moduleLoaded, setModuleLoaded] = useState(false);

  // Load module on mount
  useEffect(() => {
    if (!isModuleAvailable) {
      setModuleLoaded(true);
      setBiometricAvailable(false);
      setUnlocked(true);
      return;
    }

    loadLocalAuthentication().then((loaded) => {
      setModuleLoaded(true);
      if (!loaded) {
        setBiometricAvailable(false);
        setUnlocked(true);
      }
    });
  }, [setBiometricAvailable, setUnlocked]);

  // Check if device supports biometric auth
  const checkAvailability = useCallback(async () => {
    if (!LocalAuthentication || !isModuleAvailable) {
      setBiometricAvailable(false);
      return false;
    }

    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const available = compatible && enrolled;
      setBiometricAvailable(available);
      return available;
    } catch (error) {
      captureException(error as Error, { context: 'biometric_availability_check' });
      setBiometricAvailable(false);
      return false;
    }
  }, [setBiometricAvailable]);

  // Get supported authentication types
  const getSupportedTypes = useCallback(async () => {
    if (!LocalAuthentication || !isModuleAvailable) return [];

    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      return types.map((type) => {
        switch (type) {
          case LocalAuthentication.AuthenticationType.FINGERPRINT:
            return 'fingerprint';
          case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION:
            return 'face';
          case LocalAuthentication.AuthenticationType.IRIS:
            return 'iris';
          default:
            return 'unknown';
        }
      });
    } catch {
      return [];
    }
  }, []);

  // Authenticate user
  const authenticate = useCallback(
    async (reason = 'Authenticate to access Cortex') => {
      if (!LocalAuthentication || !isModuleAvailable) {
        setUnlocked(true);
        return { success: true };
      }

      try {
        addBreadcrumb('auth', 'Biometric authentication started');

        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: reason,
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
          fallbackLabel: 'Use Passcode',
        });

        if (result.success) {
          addBreadcrumb('auth', 'Biometric authentication succeeded');
          setUnlocked(true);
          return { success: true };
        } else {
          addBreadcrumb('auth', 'Biometric authentication failed', {
            error: result.error,
          });
          return {
            success: false,
            error: result.error,
            warning: result.warning,
          };
        }
      } catch (error) {
        captureException(error as Error, { context: 'biometric_auth' });
        return {
          success: false,
          error: 'authentication_error',
        };
      }
    },
    [setUnlocked]
  );

  // Enable biometric auth
  const enable = useCallback(async () => {
    if (!LocalAuthentication || !isModuleAvailable) {
      return {
        success: false,
        error: 'Biometric authentication is not available in this environment',
      };
    }

    const available = await checkAvailability();
    if (!available) {
      return {
        success: false,
        error: 'Biometric authentication is not available on this device',
      };
    }

    const result = await authenticate('Enable biometric authentication');
    if (result.success) {
      setBiometricEnabled(true);
      addBreadcrumb('settings', 'Biometric authentication enabled');
      return { success: true };
    }

    return result;
  }, [checkAvailability, authenticate, setBiometricEnabled]);

  // Disable biometric auth
  const disable = useCallback(async () => {
    if (!LocalAuthentication || !isModuleAvailable) {
      setBiometricEnabled(false);
      return { success: true };
    }

    const result = await authenticate('Disable biometric authentication');
    if (result.success) {
      setBiometricEnabled(false);
      addBreadcrumb('settings', 'Biometric authentication disabled');
      return { success: true };
    }
    return result;
  }, [authenticate, setBiometricEnabled]);

  // Lock the app
  const lock = useCallback(() => {
    if (!LocalAuthentication || !isModuleAvailable) {
      return;
    }
    setUnlocked(false);
    addBreadcrumb('auth', 'App locked');
  }, [setUnlocked]);

  // Check availability on mount
  useEffect(() => {
    if (moduleLoaded && isModuleAvailable && LocalAuthentication) {
      checkAvailability();
    }
  }, [moduleLoaded, checkAvailability]);

  // Auto-unlock if biometric is not enabled or not available
  useEffect(() => {
    if (!isBiometricEnabled || !isModuleAvailable) {
      setUnlocked(true);
    }
  }, [isBiometricEnabled, setUnlocked]);

  return {
    isEnabled: isBiometricEnabled,
    isAvailable: isBiometricAvailable && isModuleAvailable,
    isUnlocked,
    isModuleLoaded: moduleLoaded,
    authenticate,
    enable,
    disable,
    lock,
    checkAvailability,
    getSupportedTypes,
  };
};
