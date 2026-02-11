/**
 * Settings Screen - Unified & Minimal
 *
 * Contains:
 * - Profile display
 * - Theme selection
 * - All integrations (Google, Slack, Notion)
 * - Sign out / Delete account
 */

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
  Linking,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';

import { useAuth } from '../../src/context/AuthContext';
import { integrationsService, authService, mcpService, MCPIntegration } from '../../src/services';
import { spacing, borderRadius, useTheme } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';
import { useAppStore } from '../../src/stores/appStore';

WebBrowser.maybeCompleteAuthSession();

type Provider = 'google' | 'slack' | 'notion';

interface IntegrationConfig {
  name: string;
  icon: string;
  color: string;
  description: string;
}

const INTEGRATIONS: Record<Provider, IntegrationConfig> = {
  google: {
    name: 'Google',
    icon: 'https://www.google.com/favicon.ico',
    color: '#4285F4',
    description: 'Gmail, Calendar, Drive, Docs',
  },
  slack: {
    name: 'Slack',
    icon: 'https://slack.com/favicon.ico',
    color: '#4A154B',
    description: 'Messages & DMs',
  },
  notion: {
    name: 'Notion',
    icon: 'https://www.notion.so/favicon.ico',
    color: '#000000',
    description: 'Pages & Comments',
  },
};

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const posthog = usePostHog();
  const { colors, mode: themeMode, setMode: setThemeMode } = useTheme();

  const cachedIntegrationStatus = useAppStore((state) => state.integrationStatus);
  const setIntegrationStatus = useAppStore((state) => state.setIntegrationStatus);

  const [connectingProvider, setConnectingProvider] = useState<Provider | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(!cachedIntegrationStatus);

  // MCP Integrations state
  const [mcpIntegrations, setMcpIntegrations] = useState<MCPIntegration[]>([]);
  const [isLoadingMcp, setIsLoadingMcp] = useState(true);
  const [showAddMcpModal, setShowAddMcpModal] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [isAddingMcp, setIsAddingMcp] = useState(false);

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

  const loadMcpIntegrations = useCallback(async () => {
    try {
      const integrations = await mcpService.listIntegrations();
      setMcpIntegrations(integrations);
    } catch (error) {
      logger.error('Failed to load MCP integrations:', error);
    } finally {
      setIsLoadingMcp(false);
    }
  }, []);

  const handleAddMcpServer = async () => {
    if (!newMcpName.trim() || !newMcpUrl.trim()) {
      Alert.alert('Error', 'Please enter both name and URL');
      return;
    }
    setIsAddingMcp(true);
    try {
      await mcpService.addServer({ name: newMcpName, server_url: newMcpUrl });
      await loadMcpIntegrations();
      setShowAddMcpModal(false);
      setNewMcpName('');
      setNewMcpUrl('');
      posthog?.capture('mcp_server_added', { name: newMcpName });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add MCP server');
    } finally {
      setIsAddingMcp(false);
    }
  };

  const handleDeleteMcpServer = (integration: MCPIntegration) => {
    Alert.alert(
      `Remove ${integration.name}`,
      `Are you sure you want to remove this MCP server?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await mcpService.deleteIntegration(integration.id);
              await loadMcpIntegrations();
              posthog?.capture('mcp_server_removed');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to remove MCP server');
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      const { url } = event;
      if (url.includes('oauth/success') || url.includes('oauth/callback')) {
        loadIntegrationStatus();
        setConnectingProvider(null);
      }
    };

    const subscription = ExpoLinking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, [loadIntegrationStatus]);

  useEffect(() => {
    posthog?.capture(ANALYTICS_EVENTS.SETTINGS_OPENED);
    loadIntegrationStatus();
    loadMcpIntegrations();
  }, []);

  const handleConnect = async (provider: Provider) => {
    setConnectingProvider(provider);
    try {
      const returnUrl = ExpoLinking.createURL('oauth/success');
      let oauthUrl: string;

      switch (provider) {
        case 'google':
          oauthUrl = await integrationsService.getGoogleConnectUrl(returnUrl);
          break;
        case 'slack':
          oauthUrl = await integrationsService.getSlackConnectUrl(returnUrl);
          break;
        case 'notion':
          oauthUrl = await integrationsService.getNotionConnectUrl(returnUrl);
          break;
      }

      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, returnUrl);

      if (result.type === 'success') {
        await loadIntegrationStatus();
        posthog?.capture(`${provider}_connected`, { source: 'settings' });
      }
    } catch (error: any) {
      logger.error(`${provider} connect error:`, error);
      Alert.alert('Error', error.message || `Failed to connect ${INTEGRATIONS[provider].name}`);
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleDisconnect = async (provider: Provider) => {
    Alert.alert(
      `Disconnect ${INTEGRATIONS[provider].name}`,
      `Are you sure you want to disconnect ${INTEGRATIONS[provider].name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await integrationsService.disconnect(provider);
              await loadIntegrationStatus();
              posthog?.capture(`${provider}_disconnected`);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to disconnect');
            }
          },
        },
      ]
    );
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
      'This will permanently delete all your data. This action cannot be undone.',
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

  const isConnected = (provider: Provider): boolean => {
    if (!cachedIntegrationStatus) return false;
    switch (provider) {
      case 'google':
        return cachedIntegrationStatus.google?.connected || cachedIntegrationStatus.googlesuper?.connected || false;
      case 'slack':
        return cachedIntegrationStatus.slack?.connected || false;
      case 'notion':
        return cachedIntegrationStatus.notion?.connected || false;
    }
  };

  const displayName = user?.name?.toUpperCase() || user?.email?.split('@')[0].toUpperCase() || 'USER';
  const displayEmail = user?.email || '';
  const avatarName = user?.name || user?.email?.split('@')[0] || 'User';

  const renderIntegrationRow = (provider: Provider) => {
    const config = INTEGRATIONS[provider];
    const connected = isConnected(provider);
    const isConnecting = connectingProvider === provider;

    return (
      <TouchableOpacity
        key={provider}
        style={styles.integrationRow}
        onPress={() => connected ? handleDisconnect(provider) : handleConnect(provider)}
        disabled={isConnecting}
        activeOpacity={0.7}
      >
        <Image source={{ uri: config.icon }} style={styles.integrationIcon} />
        <View style={styles.integrationInfo}>
          <Text style={[styles.integrationName, { color: colors.textPrimary }]}>{config.name}</Text>
          <Text style={[styles.integrationDesc, { color: colors.textTertiary }]}>{config.description}</Text>
        </View>
        {isConnecting ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : connected ? (
          <View style={[styles.statusBadge, { backgroundColor: colors.success + '20' }]}>
            <Text style={[styles.statusText, { color: colors.success }]}>Connected</Text>
          </View>
        ) : (
          <Text style={[styles.connectText, { color: colors.accent }]}>Connect</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={['top']}>
      {/* Handle */}
      <View style={styles.handleContainer}>
        <View style={[styles.handle, { backgroundColor: colors.textTertiary }]} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile */}
        <View style={styles.profileSection}>
          <Image
            source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarName)}&background=random&size=128` }}
            style={styles.avatar}
          />
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.textPrimary }]}>{displayName}</Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{displayEmail}</Text>
          </View>
        </View>

        {/* Integrations */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Integrations</Text>
          {isLoadingStatus ? (
            <ActivityIndicator style={styles.loader} color={colors.textTertiary} />
          ) : (
            <>
              {renderIntegrationRow('google')}
              {renderIntegrationRow('slack')}
              {renderIntegrationRow('notion')}
            </>
          )}
        </View>

        {/* MCP Servers */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>MCP Servers</Text>
          {isLoadingMcp ? (
            <ActivityIndicator style={styles.loader} color={colors.textTertiary} />
          ) : (
            <>
              {mcpIntegrations.map((mcp) => (
                <TouchableOpacity
                  key={mcp.id}
                  style={styles.integrationRow}
                  onPress={() => handleDeleteMcpServer(mcp)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.mcpIcon, { backgroundColor: colors.accent + '20' }]}>
                    <Ionicons name="cube-outline" size={20} color={colors.accent} />
                  </View>
                  <View style={styles.integrationInfo}>
                    <Text style={[styles.integrationName, { color: colors.textPrimary }]}>{mcp.name}</Text>
                    <Text style={[styles.integrationDesc, { color: colors.textTertiary }]} numberOfLines={1}>
                      {mcp.capabilities?.toolCount || 0} tools
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: mcp.isActive ? colors.success + '20' : colors.textTertiary + '20' }]}>
                    <Text style={[styles.statusText, { color: mcp.isActive ? colors.success : colors.textTertiary }]}>
                      {mcp.isActive ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => setShowAddMcpModal(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                <Text style={[styles.actionText, { color: colors.accent }]}>Add MCP Server</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Appearance */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Appearance</Text>
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={styles.themeRow}
              onPress={() => setThemeMode(mode)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={mode === 'system' ? 'phone-portrait-outline' : mode === 'light' ? 'sunny-outline' : 'moon-outline'}
                size={20}
                color={colors.textSecondary}
              />
              <Text style={[styles.themeText, { color: colors.textPrimary }]}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
              <View style={{ flex: 1 }} />
              {themeMode === mode && <Ionicons name="checkmark" size={20} color={colors.accent} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Quick Actions</Text>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => router.push('/(main)/calendar')}
            activeOpacity={0.7}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            <Text style={[styles.actionText, { color: colors.textPrimary }]}>View Calendar</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => Linking.openURL('https://wa.me/917780185418')}
            activeOpacity={0.7}
          >
            <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
            <Text style={[styles.actionText, { color: colors.textPrimary }]}>Contact Support</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom Actions */}
      <View style={[styles.bottomActions, { borderTopColor: colors.glassBorder }]}>
        <TouchableOpacity style={styles.bottomRow} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={[styles.bottomText, { color: colors.error }]}>Sign Out</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomRow} onPress={handleDeleteAccount} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={20} color={colors.textTertiary} />
          <Text style={[styles.bottomText, { color: colors.textTertiary }]}>Delete Account</Text>
        </TouchableOpacity>
      </View>

      {/* Add MCP Server Modal */}
      <Modal
        visible={showAddMcpModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddMcpModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.bgPrimary }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Add MCP Server</Text>
              <TouchableOpacity onPress={() => setShowAddMcpModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Name</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: colors.fill, color: colors.textPrimary }]}
                placeholder="My MCP Server"
                placeholderTextColor={colors.textTertiary}
                value={newMcpName}
                onChangeText={setNewMcpName}
                autoCapitalize="none"
              />

              <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: spacing.md }]}>Server URL</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: colors.fill, color: colors.textPrimary }]}
                placeholder="https://your-mcp-server.com/sse"
                placeholderTextColor={colors.textTertiary}
                value={newMcpUrl}
                onChangeText={setNewMcpUrl}
                autoCapitalize="none"
                keyboardType="url"
              />

              <Text style={[styles.inputHint, { color: colors.textTertiary }]}>
                MCP servers extend Cortex with custom tools. The server must implement the Model Context Protocol.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.fill }]}
                onPress={() => setShowAddMcpModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.accent }]}
                onPress={handleAddMcpServer}
                disabled={isAddingMcp}
              >
                {isAddingMcp ? (
                  <ActivityIndicator size="small" color={colors.bgPrimary} />
                ) : (
                  <Text style={[styles.modalButtonText, { color: colors.bgPrimary }]}>Add Server</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  handleContainer: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs },
  handle: { width: 36, height: 5, borderRadius: 2.5, opacity: 0.4 },
  scrollView: { flex: 1 },

  // Profile
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '600', letterSpacing: 0.5 },
  profileEmail: { fontSize: 14, marginTop: 2 },

  // Section
  section: { marginTop: spacing.md },
  sectionTitle: { fontSize: 13, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  loader: { padding: spacing.lg },

  // Integration Row
  integrationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  integrationIcon: { width: 32, height: 32, borderRadius: 8 },
  integrationInfo: { flex: 1 },
  integrationName: { fontSize: 16, fontWeight: '500' },
  integrationDesc: { fontSize: 12, marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.sm },
  statusText: { fontSize: 11, fontWeight: '600' },
  connectText: { fontSize: 14, fontWeight: '500' },

  // Theme Row
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  themeText: { fontSize: 16 },

  // Action Row
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  actionText: { fontSize: 16 },

  // Bottom
  bottomActions: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, borderTopWidth: 1, paddingTop: spacing.md },
  bottomRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.md },
  bottomText: { fontSize: 16 },

  // MCP Icon
  mcpIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingBottom: spacing.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  modalBody: {
    padding: spacing.lg,
  },
  inputLabel: {
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  modalInput: {
    height: 44,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  inputHint: {
    fontSize: 12,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalButton: {
    flex: 1,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
