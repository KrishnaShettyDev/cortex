import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';

// Safe haptics wrapper - silently fails if not available
const triggerHaptic = async (type: 'success' | 'error') => {
  try {
    if (type === 'success') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  } catch {
    // Haptics not available, ignore silently
  }
};
import { Ionicons } from '@expo/vector-icons';
import { GradientIcon } from '../src/components';
import { useAuth } from '../src/context/AuthContext';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../src/lib/analytics';
import { colors, spacing, borderRadius } from '../src/theme';
import { GOOGLE_CLIENT_ID } from '../src/config/env';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../src/legal';

// Error message mapping for user-friendly messages
const getErrorMessage = (error: string): string => {
  const errorLower = error.toLowerCase();

  if (errorLower.includes('network') || errorLower.includes('fetch') || errorLower.includes('connection')) {
    return 'Unable to connect. Please check your internet connection and try again.';
  }
  if (errorLower.includes('timeout')) {
    return 'Request timed out. Please try again.';
  }
  if (errorLower.includes('unauthorized') || errorLower.includes('401')) {
    return 'Authentication failed. Please try signing in again.';
  }
  if (errorLower.includes('invalid') && errorLower.includes('token')) {
    return 'Invalid authentication token. Please try again.';
  }
  if (errorLower.includes('email') && errorLower.includes('required')) {
    return 'Email is required to sign in. Please allow email access.';
  }
  if (errorLower.includes('server') || errorLower.includes('500')) {
    return 'Server error. Please try again later.';
  }
  if (errorLower.includes('canceled') || errorLower.includes('cancelled')) {
    return 'Sign in was cancelled.';
  }

  return error || 'Something went wrong. Please try again.';
};

// Required for Google Sign In on web
WebBrowser.maybeCompleteAuthSession();

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function AuthScreen() {
  const { signInWithApple, signInWithGoogle, isLoading, error, clearError } = useAuth();
  const posthog = usePostHog();
  const [isAppleLoading, setIsAppleLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const errorOpacity = useState(new Animated.Value(0))[0];

  // Combined error from context or local state
  const displayError = error || localError;

  // Animate error banner
  useEffect(() => {
    if (displayError) {
      triggerHaptic('error');
      Animated.timing(errorOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(errorOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [displayError]);

  const dismissError = useCallback(() => {
    clearError();
    setLocalError(null);
  }, [clearError]);

  const showError = useCallback((message: string) => {
    setLocalError(getErrorMessage(message));
  }, []);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_CLIENT_ID.ios,
    androidClientId: GOOGLE_CLIENT_ID.android,
    webClientId: GOOGLE_CLIENT_ID.web,
  });

  // Handle Google Sign In response
  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = (response as any).params?.id_token;
      if (idToken) {
        handleGoogleToken(idToken);
      } else {
        setIsGoogleLoading(false);
        showError('No ID token received from Google');
      }
    } else if (response?.type === 'error') {
      setIsGoogleLoading(false);
      showError(response.error?.message || 'Google Sign In failed');
    } else if (response?.type === 'dismiss') {
      setIsGoogleLoading(false);
    }
  }, [response, showError]);

  const handleGoogleToken = async (idToken: string) => {
    dismissError();
    try {
      await signInWithGoogle(idToken);
      posthog?.capture(ANALYTICS_EVENTS.SIGN_IN, { provider: 'google' });
      triggerHaptic('success');
      router.replace('/(main)/chat');
    } catch (e: any) {
      posthog?.capture(ANALYTICS_EVENTS.SIGN_IN_FAILED, { provider: 'google', error: e.message });
      showError(e.message || 'Google Sign In failed');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    dismissError();
    setIsAppleLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (credential.identityToken && credential.authorizationCode) {
        const fullName = credential.fullName
          ? `${credential.fullName.givenName || ''} ${credential.fullName.familyName || ''}`.trim()
          : undefined;

        await signInWithApple(
          credential.identityToken,
          credential.authorizationCode,
          fullName || undefined,
          credential.email || undefined
        );
        posthog?.capture(ANALYTICS_EVENTS.SIGN_IN, { provider: 'apple' });
        triggerHaptic('success');
        router.replace('/(main)/chat');
      } else {
        showError('Could not get credentials from Apple. Please try again.');
      }
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        posthog?.capture(ANALYTICS_EVENTS.SIGN_IN_FAILED, { provider: 'apple', error: e.message });
        showError(e.message || 'Apple Sign In failed');
      }
    } finally {
      setIsAppleLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    dismissError();
    if (!request) {
      showError('Google Sign In is not ready yet. Please try again.');
      return;
    }
    setIsGoogleLoading(true);
    try {
      await promptAsync();
    } catch (e: any) {
      setIsGoogleLoading(false);
      showError(e.message || 'Failed to start Google Sign In');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {/* Top Section - Logo and Brand */}
        <View style={styles.brandSection}>
          <GradientIcon size={80} variant="solid" />
          <Text style={styles.brandName}>Cortex</Text>
          <Text style={styles.tagline}>Your AI-powered second brain</Text>
        </View>

        {/* Auth Buttons Section */}
        <View style={styles.authSection}>
          {/* Apple Sign In */}
          <TouchableOpacity
            style={[styles.appleButton, isAppleLoading && styles.buttonDisabled]}
            onPress={handleAppleSignIn}
            disabled={isLoading || isAppleLoading}
            activeOpacity={0.8}
          >
            {isAppleLoading ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Ionicons name="logo-apple" size={20} color="#000" />
                <Text style={styles.appleButtonText}>Continue with Apple</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Google Sign In */}
          <TouchableOpacity
            style={[styles.googleButton, (!request || isGoogleLoading) && styles.buttonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={isLoading || isGoogleLoading || !request}
            activeOpacity={0.8}
          >
            {isGoogleLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color="#fff" />
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Error Banner */}
          {displayError && (
            <Animated.View style={[styles.errorBanner, { opacity: errorOpacity }]}>
              <View style={styles.errorContent}>
                <Ionicons name="alert-circle" size={18} color={colors.error} />
                <Text style={styles.errorText}>{getErrorMessage(displayError)}</Text>
                <TouchableOpacity onPress={dismissError} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </Animated.View>
          )}
        </View>

        {/* Footer - Privacy & Terms */}
        <View style={styles.footer}>
          <View style={styles.footerLinks}>
            <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}>
              <Text style={styles.footerLink}>Privacy policy</Text>
            </TouchableOpacity>
            <Text style={styles.footerDot}>·</Text>
            <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(TERMS_OF_SERVICE_URL)}>
              <Text style={styles.footerLink}>Terms of service</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  // Brand Section
  brandSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  brandName: {
    fontSize: 42,
    fontWeight: '300',
    color: '#FFFFFF',
    marginTop: spacing.lg,
    letterSpacing: 1,
    fontFamily: 'System', // Will use system serif on iOS
    fontStyle: 'normal',
  },
  tagline: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    letterSpacing: 0.3,
  },
  // Auth Section
  authSection: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  appleButtonText: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '600',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  googleButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  // Error Banner
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 14,
    lineHeight: 18,
  },
  // Footer
  footer: {
    paddingBottom: spacing.lg,
  },
  footerLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  footerLink: {
    color: colors.textTertiary,
    fontSize: 14,
  },
  footerDot: {
    color: colors.textTertiary,
    fontSize: 14,
  },
});
