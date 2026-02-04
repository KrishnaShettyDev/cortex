import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import {
  integrationsService,
  IntegrationsStatus,
  IntegrationStatus,
} from '../../src/services';
import { colors, spacing, borderRadius, typography, sheetHandle } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';

const goBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)/settings');
  }
};

interface AccountRowProps {
  provider: 'google' | 'microsoft';
  status: IntegrationStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  isLoading: boolean;
  isSyncing: boolean;
}

function AccountRow({
  provider,
  status,
  onConnect,
  onDisconnect,
  onSync,
  isLoading,
  isSyncing,
}: AccountRowProps) {
  const config = {
    google: { name: 'Google', icon: 'logo-google' as const, color: colors.google },
    microsoft: { name: 'Microsoft', icon: 'logo-microsoft' as const, color: colors.microsoft },
  }[provider];

  const isConnected = status.connected;
  const isExpired = status.status === 'expired';
  const isPartiallyConnected = provider === 'google' &&
    (status.gmail_connected || status.calendar_connected) &&
    !isConnected;

  // Build status text
  let statusText = '';
  if (provider === 'google') {
    if (isExpired) {
      statusText = 'Reconnect required';
    } else if (isPartiallyConnected) {
      const parts = [];
      if (status.gmail_connected) parts.push('Gmail');
      if (status.calendar_connected) parts.push('Calendar');
      statusText = `${parts.join(' + ')} connected`;
    }
  }

  return (
    <View style={styles.accountRow}>
      <View style={[styles.accountIcon, { backgroundColor: config.color + '15' }]}>
        <Ionicons name={config.icon} size={20} color={config.color} />
      </View>

      <View style={styles.accountInfo}>
        <Text style={styles.accountName}>{config.name}</Text>
        {isConnected && status.email && (
          <Text style={styles.accountEmail} numberOfLines={1}>{status.email}</Text>
        )}
        {statusText && !isConnected && (
          <Text style={[styles.accountEmail, isExpired && styles.expiredText]} numberOfLines={1}>
            {statusText}
          </Text>
        )}
      </View>

      {isConnected ? (
        <View style={styles.accountActions}>
          <TouchableOpacity
            onPress={onSync}
            disabled={isSyncing}
            style={styles.iconButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Ionicons name="sync" size={18} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDisconnect}
            style={styles.iconButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.connectBtn, isExpired && styles.reconnectBtn]}
          onPress={onConnect}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={isExpired ? colors.warning : colors.accent} />
          ) : (
            <Text style={[styles.connectBtnText, isExpired && styles.reconnectBtnText]}>
              {isExpired ? 'Reconnect' : isPartiallyConnected ? 'Complete' : 'Connect'}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function ConnectedAccountsScreen() {
  const posthog = usePostHog();
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState<{ google: boolean; microsoft: boolean }>({
    google: false,
    microsoft: false,
  });
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await integrationsService.getStatus();
      setStatus(data);
    } catch (error) {
      logger.error('Failed to load integrations status:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      const { url } = event;
      if (url.includes('oauth/success') || url.includes('oauth/callback')) {
        loadStatus();
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, [loadStatus]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadStatus();
  };

  const handleConnectGoogle = async () => {
    posthog?.capture(ANALYTICS_EVENTS.ACCOUNT_CONNECT_TAPPED, { provider: 'google' });
    setIsConnecting(true);
    try {
      const returnUrl = Linking.createURL('oauth/success');
      const oauthUrl = await integrationsService.getGoogleConnectUrl(returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, returnUrl);

      if (result.type === 'success') {
        posthog?.capture(ANALYTICS_EVENTS.GOOGLE_CONNECTED);
        await loadStatus();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to connect');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectGoogle = () => {
    Alert.alert('Disconnect', 'Remove Google account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await integrationsService.disconnectGoogle();
            posthog?.capture(ANALYTICS_EVENTS.GOOGLE_DISCONNECTED);
            await loadStatus();
          } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to disconnect');
          }
        },
      },
    ]);
  };

  const handleSyncGoogle = async () => {
    posthog?.capture(ANALYTICS_EVENTS.ACCOUNT_SYNC_TAPPED, { provider: 'google' });
    setIsSyncing((prev) => ({ ...prev, google: true }));
    try {
      const result = await integrationsService.syncGoogle();
      const totalMemoriesAdded = (result.gmail?.memories_added || 0) + (result.calendar?.memories_added || 0);
      posthog?.capture(ANALYTICS_EVENTS.GOOGLE_SYNC_COMPLETED, {
        memories_added: totalMemoriesAdded,
      });
      await loadStatus();
      Alert.alert('Synced', `${totalMemoriesAdded} new memories added`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Sync failed');
    } finally {
      setIsSyncing((prev) => ({ ...prev, google: false }));
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Accounts</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.handle} />

      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Accounts</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {status && (
          <View style={styles.section}>
            <AccountRow
              provider="google"
              status={status.google}
              onConnect={handleConnectGoogle}
              onDisconnect={handleDisconnectGoogle}
              onSync={handleSyncGoogle}
              isLoading={isConnecting}
              isSyncing={isSyncing.google}
            />

            <View style={styles.separator} />

            <AccountRow
              provider="microsoft"
              status={status.microsoft}
              onConnect={() => Alert.alert('Coming Soon', 'Microsoft integration coming soon')}
              onDisconnect={() => {}}
              onSync={() => {}}
              isLoading={false}
              isSyncing={isSyncing.microsoft}
            />
          </View>
        )}

        <Text style={styles.footerText}>
          Connected accounts sync emails and calendar events to provide context for Cortex.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  handle: {
    ...sheetHandle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: {
    marginRight: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 22,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  section: {
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  accountEmail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  expiredText: {
    color: colors.warning,
  },
  accountActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconButton: {
    padding: spacing.xs,
  },
  connectBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accent + '15',
  },
  connectBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  reconnectBtn: {
    backgroundColor: colors.warning + '15',
  },
  reconnectBtnText: {
    color: colors.warning,
  },
  separator: {
    height: 1,
    backgroundColor: colors.glassBorder,
    marginLeft: spacing.md + 40 + spacing.md,
  },
  footerText: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    lineHeight: 18,
  },
});
