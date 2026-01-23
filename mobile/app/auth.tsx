import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Animated,
  ActivityIndicator,
} from 'react-native';
import Constants from 'expo-constants';
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
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { GradientIcon } from '../src/components';
import { useAuth } from '../src/context/AuthContext';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../src/lib/analytics';
import { colors, gradients, spacing, borderRadius, typography, shadows } from '../src/theme';
import { GOOGLE_CLIENT_ID, ENABLE_DEV_LOGIN } from '../src/config/env';
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

// Check if running in Expo Go
const isExpoGo = Constants.appOwnership === 'expo';

export default function AuthScreen() {
  const { signInWithApple, signInWithGoogle, devSignIn, isLoading, error, clearError } = useAuth();
  const posthog = usePostHog();
  const [showDevLogin, setShowDevLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
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

  // For Expo Go: We need to add the exp:// redirect URI to the iOS OAuth client
  // in Google Cloud Console since Expo Go doesn't support custom schemes
  // For production builds: Use the appropriate native client IDs
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_CLIENT_ID.ios,
    androidClientId: GOOGLE_CLIENT_ID.android,
    webClientId: GOOGLE_CLIENT_ID.web,
  });

  // Debug: Log the request details
  useEffect(() => {
    if (request) {
      console.log('=== Google OAuth Debug ===');
      console.log('Is Expo Go:', isExpoGo);
      console.log('Request URL:', request.url);
      console.log('Redirect URI from request:', request.redirectUri);
      console.log('Client ID:', request.clientId);
      console.log('========================');
    }
  }, [request]);

  // Handle Google Sign In response
  useEffect(() => {
    console.log('=== Google Auth Response ===');
    console.log('Response type:', response?.type);
    console.log('Response params:', (response as any)?.params);
    console.log('============================');

    if (response?.type === 'success') {
      // Get id_token from authentication response
      const idToken = (response as any).params?.id_token;
      console.log('Got ID token:', idToken ? 'yes' : 'no');
      if (idToken) {
        handleGoogleToken(idToken);
      } else {
        setIsGoogleLoading(false);
        showError('No ID token received from Google');
      }
    } else if (response?.type === 'error') {
      setIsGoogleLoading(false);
      console.log('Google Auth Error:', response.error);
      showError(response.error?.message || 'Google Sign In failed');
    } else if (response?.type === 'dismiss') {
      setIsGoogleLoading(false);
      // Don't show error for user-initiated dismissal
      console.log('User dismissed the auth flow');
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

  const handleDevSignIn = async () => {
    dismissError();
    if (!email) {
      showError('Please enter an email');
      return;
    }
    try {
      await devSignIn(email, name || undefined);
      posthog?.capture(ANALYTICS_EVENTS.SIGN_IN, { provider: 'dev' });
      triggerHaptic('success');
      router.replace('/(main)/chat');
    } catch (e: any) {
      posthog?.capture(ANALYTICS_EVENTS.SIGN_IN_FAILED, { provider: 'dev', error: e.message });
      showError(e.message || 'Dev sign in failed');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <GradientIcon size={100} />
          </View>
          <Text style={styles.title}>Meet Cortex</Text>
          <Text style={styles.subtitle}>Your AI-powered second brain</Text>
        </View>

        {/* Auth Buttons */}
        <View style={styles.authContainer}>
          {!showDevLogin ? (
            <>
              {/* Apple Sign In */}
              <TouchableOpacity
                style={[styles.appleButton, isAppleLoading && styles.buttonLoading]}
                onPress={handleAppleSignIn}
                disabled={isLoading || isAppleLoading}
                activeOpacity={0.8}
              >
                {isAppleLoading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <>
                    <Ionicons name="logo-apple" size={20} color="#000" />
                    <Text style={styles.appleButtonText}>Sign in with Apple</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Google Sign In */}
              <TouchableOpacity
                style={[
                  styles.googleButton,
                  (!request || isGoogleLoading) && styles.googleButtonDisabled
                ]}
                onPress={handleGoogleSignIn}
                disabled={isLoading || isGoogleLoading || !request}
                activeOpacity={0.8}
              >
                {isGoogleLoading ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <>
                    <Ionicons name="logo-google" size={18} color={colors.google} />
                    <Text style={styles.googleButtonText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Dev Login Toggle - Only shown in development */}
              {ENABLE_DEV_LOGIN && (
                <TouchableOpacity
                  style={styles.devButton}
                  onPress={() => setShowDevLogin(true)}
                >
                  <Text style={styles.devButtonText}>Dev Login</Text>
                </TouchableOpacity>
              )}
            </>
          ) : ENABLE_DEV_LOGIN ? (
            <View style={styles.devLoginCard}>
              <BlurView intensity={20} style={StyleSheet.absoluteFill} tint="dark" />
              <View style={styles.devLoginContent}>
                <Text style={styles.devLoginTitle}>Development Login</Text>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor={colors.textTertiary}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.input}
                    placeholder="Name (optional)"
                    placeholderTextColor={colors.textTertiary}
                    value={name}
                    onChangeText={setName}
                  />
                </View>
                <TouchableOpacity
                  style={styles.signInButton}
                  onPress={handleDevSignIn}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={gradients.accent}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.gradientButton}
                  >
                    <Text style={styles.signInButtonText}>
                      {isLoading ? 'Signing in...' : 'Sign In'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => setShowDevLogin(false)}
                >
                  <Text style={styles.backButtonText}>Back</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>

        {/* Error Banner */}
        {displayError && (
          <Animated.View style={[styles.errorBanner, { opacity: errorOpacity }]}>
            <View style={styles.errorContent}>
              <Ionicons name="alert-circle" size={20} color={colors.error} style={styles.errorIcon} />
              <Text style={styles.errorText}>{getErrorMessage(displayError)}</Text>
              <TouchableOpacity onPress={dismissError} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            By continuing, you agree to our{' '}
            <Text
              style={styles.linkText}
              onPress={() => WebBrowser.openBrowserAsync(TERMS_OF_SERVICE_URL)}
            >
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text
              style={styles.linkText}
              onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoContainer: {
    ...shadows.glow,
  },
  title: {
    ...typography.h1,
    marginTop: spacing.xl,
  },
  subtitle: {
    ...typography.bodySmall,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  authContainer: {
    gap: spacing.md,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: spacing.md + 2,
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
    backgroundColor: colors.glassBackground,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  googleButtonText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
  googleButtonDisabled: {
    opacity: 0.5,
  },
  devButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  devButtonText: {
    color: colors.textTertiary,
    fontSize: 14,
  },
  devLoginCard: {
    backgroundColor: colors.glassBackground,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  devLoginContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  devLoginTitle: {
    ...typography.h3,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  inputContainer: {
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
  },
  signInButton: {
    marginTop: spacing.sm,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  gradientButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  signInButtonText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  backButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  buttonLoading: {
    opacity: 0.7,
  },
  errorBanner: {
    marginTop: spacing.lg,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorIcon: {
    marginRight: spacing.sm,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: spacing.xl,
    left: spacing.lg,
    right: spacing.lg,
  },
  footerText: {
    ...typography.caption,
    textAlign: 'center',
  },
  linkText: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
});
