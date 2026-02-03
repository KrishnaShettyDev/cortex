import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

import { useAuth } from '../../src/context/AuthContext';
import { integrationsService, IntegrationsStatus, authService } from '../../src/services';
import { colors, spacing, borderRadius, sheetHandle, useTheme, ThemeMode } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';
import { useAppStore } from '../../src/stores/appStore';
import { GOOGLE_CLIENT_ID } from '../../src/config/env';

// Required for Google Sign In
WebBrowser.maybeCompleteAuthSession();

const goBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)/chat');
  }
};

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const posthog = usePostHog();
  const { colors, mode: themeMode, setMode: setThemeMode } = useTheme();

  // Use cached integration status from store
  const cachedIntegrationStatus = useAppStore((state) => state.integrationStatus);
  const setIntegrationStatus = useAppStore((state) => state.setIntegrationStatus);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isAccountsExpanded, setIsAccountsExpanded] = useState(true);

  // Only show loading if we have no cached data
  const [isLoadingStatus, setIsLoadingStatus] = useState(!cachedIntegrationStatus);

  // Google OAuth for connecting services (Gmail/Calendar)
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_CLIENT_ID.ios,
    androidClientId: GOOGLE_CLIENT_ID.android,
    webClientId: GOOGLE_CLIENT_ID.web,
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  });

  // Debug: Log the redirect URI being used
  useEffect(() => {
    if (request) {
      console.log('🔐 OAuth Request redirect URI:', request.redirectUri);
      console.log('🔐 OAuth Request URL:', request.url);
    }
  }, [request]);

  // Handle Google OAuth response
  useEffect(() => {
    if (response?.type === 'success') {
      const { authentication } = response;
      if (authentication?.accessToken) {
        handleGoogleConnected(authentication.accessToken);
      }
    } else if (response?.type === 'error') {
      setIsConnecting(false);
      Alert.alert('Error', response.error?.message || 'Failed to connect Google');
    } else if (response?.type === 'dismiss') {
      setIsConnecting(false);
    }
  }, [response]);

  const handleGoogleConnected = async (accessToken: string) => {
    try {
      // TODO: Send access token to backend to store for syncing
      // For now, just refresh the status
      await loadIntegrationStatus();
      posthog?.capture('google_connected', { source: 'settings' });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to complete Google connection');
    } finally {
      setIsConnecting(false);
    }
  };

  // Track settings screen viewed
  useEffect(() => {
    posthog?.capture(ANALYTICS_EVENTS.SETTINGS_OPENED);
  }, []);

  const loadIntegrationStatus = useCallback(async () => {
    try {
      const status = await integrationsService.getStatus();
      setIntegrationStatus(status);
    } catch (error) {
      logger.error('Failed to load integration status:', error);
    } finally {
      setIsLoadingStatus(false);
    }
  }, [setIntegrationStatus]);

  // Load in background (won't show loading if we have cached data)
  useEffect(() => {
    loadIntegrationStatus();
  }, [loadIntegrationStatus]);

  const handleConnectGoogle = async () => {
    if (!request) {
      Alert.alert('Error', 'Google Sign In is not ready yet. Please try again.');
      return;
    }
    setIsConnecting(true);
    try {
      await promptAsync();
    } catch (error: any) {
      setIsConnecting(false);
      Alert.alert('Error', error.message || 'Failed to connect Google');
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          posthog?.capture(ANALYTICS_EVENTS.SIGN_OUT_CONFIRMED);
          await signOut();
          router.replace('/auth');
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This will permanently delete all your data including memories, conversations, and connected accounts. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await authService.deleteAccount();
              router.replace('/auth');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete account');
            }
          },
        },
      ]
    );
  };

  const handleContactUs = () => {
    posthog?.capture(ANALYTICS_EVENTS.CONTACT_US_TAPPED);
    Linking.openURL('https://wa.me/917780185418');
  };

  // Use name if available, otherwise use email prefix as fallback
  const emailPrefix = user?.email?.split('@')[0] || '';
  const displayName = user?.name?.toUpperCase() || emailPrefix.toUpperCase() || 'USER';
  const displayEmail = user?.email || '';
  const isGoogleConnected = cachedIntegrationStatus?.google?.connected || false;
  const connectedEmail = cachedIntegrationStatus?.google?.email || displayEmail;

  // For avatar, use name or email prefix
  const avatarName = user?.name || emailPrefix || 'User';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={['top']}>
      {/* Sheet Handle */}
      <View style={styles.handleContainer}>
        <View style={[styles.handle, { backgroundColor: colors.textTertiary }]} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Section */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            <Image
              source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarName)}&background=random&size=128` }}
              style={styles.avatarImage}
            />
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.textPrimary }]}>{displayName}</Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{displayEmail}</Text>
          </View>
        </View>

        {/* Menu Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Menu</Text>

          {/* Insights Row */}
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/(main)/insights')} activeOpacity={0.7}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="bulb-outline" size={20} color={colors.textSecondary} />
            </View>
            <Text style={[styles.menuText, { color: colors.textPrimary }]}>Insights</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Relationships Row */}
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/(main)/relationships')} activeOpacity={0.7}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
            </View>
            <Text style={[styles.menuText, { color: colors.textPrimary }]}>Relationships</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Calendar Row */}
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/(main)/calendar')} activeOpacity={0.7}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            </View>
            <Text style={[styles.menuText, { color: colors.textPrimary }]}>Calendar</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Contact Us Row */}
          <TouchableOpacity style={styles.menuRow} onPress={handleContactUs} activeOpacity={0.7}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
            </View>
            <Text style={[styles.menuText, { color: colors.textPrimary }]}>Contact Us</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Appearance Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Appearance</Text>

          {/* System Option */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setThemeMode('system')}
            activeOpacity={0.7}
          >
            <View style={styles.menuIconContainer}>
              <Ionicons name="phone-portrait-outline" size={20} color={colors.textSecondary} />
            </View>
            <Text style={[styles.menuText, { color: colors.textPrimary }]}>System</Text>
            <View style={{ flex: 1 }} />
            {themeMode === 'system' && (
              <Ionicons name="checkmark" size={20} color={colors.accent} />
            )}
          </TouchableOpacity>

          {/* Light Option */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setThemeMode('light')}
            activeOpacity={0.7}
          >
            <View style={styles.menuIconContainer}>
              <Ionicons name="sunny-outline" size={20} color={colors.textSecondary} />
            </View>
            <Text style={[styles.menuText, { color: colors.textPrimary }]}>Light</Text>
            <View style={{ flex: 1 }} />
            {themeMode === 'light' && (
              <Ionicons name="checkmark" size={20} color={colors.accent} />
            )}
          </TouchableOpacity>

          {/* Dark Option */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setThemeMode('dark')}
            activeOpacity={0.7}
          >
            <View style={styles.menuIconContainer}>
              <Ionicons name="moon-outline" size={20} color={colors.textSecondary} />
            </View>
            <Text style={[styles.menuText, { color: colors.textPrimary }]}>Dark</Text>
            <View style={{ flex: 1 }} />
            {themeMode === 'dark' && (
              <Ionicons name="checkmark" size={20} color={colors.accent} />
            )}
          </TouchableOpacity>
        </View>

        {/* Connected Accounts Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Connected Accounts</Text>

          {/* Manage Accounts Expandable */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setIsAccountsExpanded(!isAccountsExpanded)}
            activeOpacity={0.7}
          >
            <Image
              source={{ uri: 'https://www.google.com/favicon.ico' }}
              style={styles.googleLogo}
            />
            <Text style={[styles.menuText, { color: colors.textPrimary }]}>Manage Accounts</Text>
            <View style={{ flex: 1 }} />
            <Ionicons
              name={isAccountsExpanded ? "chevron-down" : "chevron-forward"}
              size={18}
              color={colors.textTertiary}
            />
          </TouchableOpacity>

          {/* Expanded Accounts List */}
          {isAccountsExpanded && (
            <View style={[styles.accountsExpanded, { backgroundColor: colors.bgSecondary }]}>
              {isLoadingStatus ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.textTertiary} />
                </View>
              ) : isGoogleConnected ? (
                /* Connected Account */
                <View style={styles.accountRow}>
                  <Text style={[styles.accountEmail, { color: colors.textPrimary }]}>{connectedEmail}</Text>
                  <View style={[styles.connectedBadge, { backgroundColor: colors.success + '20' }]}>
                    <Text style={[styles.connectedText, { color: colors.success }]}>CONNECTED</Text>
                  </View>
                </View>
              ) : (
                /* No accounts connected */
                <TouchableOpacity
                  style={styles.connectAccountRow}
                  onPress={() => handleConnectGoogle()}
                  disabled={isConnecting}
                  activeOpacity={0.7}
                >
                  {isConnecting ? (
                    <ActivityIndicator size="small" color={colors.textTertiary} />
                  ) : (
                    <>
                      <Ionicons name="link-outline" size={18} color={colors.accent} />
                      <Text style={[styles.connectAccountText, { color: colors.accent }]}>Connect Google Account</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Spacer */}
        <View style={{ flex: 1 }} />
      </ScrollView>

      {/* Bottom Actions - Fixed at bottom */}
      <View style={[styles.bottomActions, { borderTopColor: colors.glassBorder }]}>
        {/* Sign Out */}
        <TouchableOpacity style={styles.bottomRow} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
        </TouchableOpacity>

        {/* Delete Account */}
        <TouchableOpacity style={styles.bottomRow} onPress={handleDeleteAccount} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={20} color={colors.textTertiary} />
          <Text style={[styles.deleteText, { color: colors.textTertiary }]}>Delete Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    opacity: 0.4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
  },
  // Profile Section
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  avatarContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '600',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  profileEmail: {
    fontSize: 14,
    marginTop: 2,
  },
  // Section
  section: {
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '400',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  // Menu Row
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  menuIconContainer: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {
    fontSize: 16,
    fontWeight: '400',
  },
  googleLogo: {
    width: 20,
    height: 20,
    marginRight: spacing.md,
  },
  // Accounts Expanded
  accountsExpanded: {
    marginLeft: spacing.lg + 28 + spacing.md, // Align with text
    marginRight: spacing.lg,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  loadingContainer: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  accountEmail: {
    fontSize: 14,
    flex: 1,
  },
  connectedBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  connectedText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  connectAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  connectAccountText: {
    fontSize: 14,
    fontWeight: '500',
  },
  // Bottom Actions
  bottomActions: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '400',
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '400',
  },
});
