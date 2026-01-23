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
import * as Linking from 'expo-linking';

import { useAuth } from '../../src/context/AuthContext';
import { integrationsService, IntegrationsStatus, authService } from '../../src/services';
import { colors, spacing, borderRadius, sheetHandle } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';
import { useAppStore } from '../../src/stores/appStore';

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

  // Use cached integration status from store
  const cachedIntegrationStatus = useAppStore((state) => state.integrationStatus);
  const setIntegrationStatus = useAppStore((state) => state.setIntegrationStatus);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isAccountsExpanded, setIsAccountsExpanded] = useState(true);

  // Only show loading if we have no cached data
  const [isLoadingStatus, setIsLoadingStatus] = useState(!cachedIntegrationStatus);

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

  // Listen for OAuth callback
  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      if (event.url.includes('oauth/success') || event.url.includes('oauth/callback')) {
        loadIntegrationStatus();
        setIsConnecting(false);
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, [loadIntegrationStatus]);

  const handleConnectGoogle = async () => {
    setIsConnecting(true);
    try {
      const returnUrl = Linking.createURL('oauth/success');
      const oauthUrl = await integrationsService.getGoogleConnectUrl(returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, returnUrl);

      if (result.type === 'success') {
        await loadIntegrationStatus();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to connect Google');
    } finally {
      setIsConnecting(false);
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

  const displayName = user?.name?.toUpperCase() || 'USER';
  const displayEmail = user?.email || '';
  const isGoogleConnected = cachedIntegrationStatus?.google?.connected || false;
  const connectedEmail = cachedIntegrationStatus?.google?.email || displayEmail;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Sheet Handle */}
      <View style={styles.handleContainer}>
        <View style={styles.handle} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Section */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {user?.name ? (
              <Image
                source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=random&size=128` }}
                style={styles.avatarImage}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>?</Text>
              </View>
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileEmail}>{displayEmail}</Text>
          </View>
        </View>

        {/* Menu Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Menu</Text>

          {/* Calendar Row */}
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/(main)/calendar')} activeOpacity={0.7}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            </View>
            <Text style={styles.menuText}>Calendar</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Contact Us Row */}
          <TouchableOpacity style={styles.menuRow} onPress={handleContactUs} activeOpacity={0.7}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
            </View>
            <Text style={styles.menuText}>Contact Us</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Connected Accounts Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connected Accounts</Text>

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
            <Text style={styles.menuText}>Manage Accounts</Text>
            <View style={{ flex: 1 }} />
            <Ionicons
              name={isAccountsExpanded ? "chevron-down" : "chevron-forward"}
              size={18}
              color={colors.textTertiary}
            />
          </TouchableOpacity>

          {/* Expanded Accounts List */}
          {isAccountsExpanded && (
            <View style={styles.accountsExpanded}>
              {isLoadingStatus ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.textTertiary} />
                </View>
              ) : isGoogleConnected ? (
                /* Connected Account */
                <View style={styles.accountRow}>
                  <Text style={styles.accountEmail}>{connectedEmail}</Text>
                  <View style={styles.connectedBadge}>
                    <Text style={styles.connectedText}>CONNECTED</Text>
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
                      <Text style={styles.connectAccountText}>Connect Google Account</Text>
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
      <View style={styles.bottomActions}>
        {/* Sign Out */}
        <TouchableOpacity style={styles.bottomRow} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* Delete Account */}
        <TouchableOpacity style={styles.bottomRow} onPress={handleDeleteAccount} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={20} color={colors.textTertiary} />
          <Text style={styles.deleteText}>Delete Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
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
    backgroundColor: colors.textTertiary,
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
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  profileEmail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // Section
  section: {
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textTertiary,
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
    color: colors.textPrimary,
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
    backgroundColor: colors.bgSecondary,
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
    color: colors.textPrimary,
    flex: 1,
  },
  connectedBadge: {
    backgroundColor: colors.success + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  connectedText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.success,
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
    color: colors.accent,
    fontWeight: '500',
  },
  // Bottom Actions
  bottomActions: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
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
    color: colors.error,
    fontWeight: '400',
  },
  deleteText: {
    fontSize: 16,
    color: colors.textTertiary,
    fontWeight: '400',
  },
});
