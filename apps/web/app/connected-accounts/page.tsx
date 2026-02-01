'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { ArrowBackIcon, SyncIcon, CloseIcon } from '@/components/icons';
import { Button, Spinner } from '@/components/ui';
import Image from 'next/image';

interface IntegrationStatus {
  connected: boolean;
  email?: string;
  gmail_connected?: boolean;
  calendar_connected?: boolean;
  status?: string;
}

interface IntegrationsStatus {
  google: IntegrationStatus;
  microsoft: IntegrationStatus;
}

export default function ConnectedAccountsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState({ google: false, microsoft: false });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiClient.getIntegrationStatus() as IntegrationsStatus;
      setStatus(data);
    } catch (error) {
      console.error('Failed to load integrations status:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadStatus();
  };

  const handleConnectGoogle = async () => {
    setIsConnecting(true);
    try {
      const response = await apiClient.connectGmail();
      if (response.redirectUrl) {
        const popup = window.open(response.redirectUrl, '_blank', 'width=600,height=700');

        const checkInterval = setInterval(async () => {
          try {
            const newStatus = await apiClient.getIntegrationStatus() as any;
            if (newStatus.google?.connected) {
              clearInterval(checkInterval);
              popup?.close();
              await loadStatus();
              alert('Google connected successfully!');
            }
          } catch (err) {
            console.error('Failed to check status:', err);
          }
        }, 2000);

        setTimeout(() => clearInterval(checkInterval), 120000);
      }
    } catch (error: any) {
      alert(error.message || 'Failed to connect Google. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectGoogle = () => {
    if (confirm('Remove Google account?')) {
      // TODO: Implement disconnect API
      alert('Disconnect coming soon');
    }
  };

  const handleSyncGoogle = async () => {
    setIsSyncing((prev) => ({ ...prev, google: true }));
    try {
      // TODO: Implement sync API
      await new Promise((resolve) => setTimeout(resolve, 2000));
      alert('Sync completed!');
      await loadStatus();
    } catch (error: any) {
      alert(error.message || 'Sync failed');
    } finally {
      setIsSyncing((prev) => ({ ...prev, google: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-primary">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 bg-text-tertiary/40 rounded-full" />
        </div>
        <Header onBack={() => router.back()} />
        <div className="flex items-center justify-center py-20">
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Sheet Handle */}
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-9 h-1 bg-text-tertiary/40 rounded-full" />
      </div>

      <Header onBack={() => router.back()} onRefresh={handleRefresh} isRefreshing={isRefreshing} />

      <div className="p-6">
        {/* Accounts Section */}
        <div className="bg-bg-secondary rounded-lg overflow-hidden border border-glass-border">
          {/* Google Account */}
          <AccountRow
            provider="google"
            status={status?.google || { connected: false }}
            onConnect={handleConnectGoogle}
            onDisconnect={handleDisconnectGoogle}
            onSync={handleSyncGoogle}
            isLoading={isConnecting}
            isSyncing={isSyncing.google}
          />

          <div className="h-px bg-glass-border ml-20" />

          {/* Microsoft Account */}
          <AccountRow
            provider="microsoft"
            status={status?.microsoft || { connected: false }}
            onConnect={() => alert('Microsoft integration coming soon')}
            onDisconnect={() => {}}
            onSync={() => {}}
            isLoading={false}
            isSyncing={isSyncing.microsoft}
          />
        </div>

        {/* Footer Text */}
        <p className="text-sm text-text-tertiary text-center mt-6 px-4 leading-relaxed">
          Connected accounts sync emails and calendar events to provide context for Cortex.
        </p>
      </div>
    </div>
  );
}

function Header({ onBack, onRefresh, isRefreshing }: { onBack: () => void; onRefresh?: () => void; isRefreshing?: boolean }) {
  return (
    <div className="flex items-center px-6 py-3">
      <button onClick={onBack} className="p-2 -ml-2 hover:bg-bg-tertiary rounded-lg active-opacity">
        <ArrowBackIcon className="w-5 h-5 text-text-primary" />
      </button>
      <h1 className="flex-1 text-lg font-semibold text-text-primary ml-3">
        Accounts
      </h1>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 hover:bg-bg-tertiary rounded-lg active-opacity disabled:opacity-50"
        >
          <SyncIcon className={`w-5 h-5 text-text-primary ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      )}
      <div className="w-5" />
    </div>
  );
}

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
    google: { name: 'Google', color: 'bg-google', icon: 'https://www.google.com/favicon.ico' },
    microsoft: { name: 'Microsoft', color: 'bg-microsoft', icon: 'https://www.microsoft.com/favicon.ico' },
  }[provider];

  const isConnected = status.connected;
  const isExpired = status.status === 'expired';
  const isPartiallyConnected = provider === 'google' &&
    (status.gmail_connected || status.calendar_connected) &&
    !isConnected;

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
    <div className="flex items-center p-4 gap-4">
      {/* Icon */}
      <div className={`w-10 h-10 rounded-lg ${config.color}/10 flex items-center justify-center flex-shrink-0`}>
        <Image
          src={config.icon}
          alt={config.name}
          width={20}
          height={20}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-base font-medium text-text-primary">
          {config.name}
        </p>
        {isConnected && status.email && (
          <p className="text-sm text-text-secondary mt-0.5 truncate">
            {status.email}
          </p>
        )}
        {statusText && !isConnected && (
          <p className={`text-sm mt-0.5 truncate ${isExpired ? 'text-warning' : 'text-text-secondary'}`}>
            {statusText}
          </p>
        )}
      </div>

      {/* Actions */}
      {isConnected ? (
        <div className="flex items-center gap-3">
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="p-2 hover:bg-bg-tertiary rounded-lg active-opacity disabled:opacity-50"
          >
            {isSyncing ? (
              <Spinner size="sm" />
            ) : (
              <SyncIcon className="w-4 h-4 text-text-secondary" />
            )}
          </button>
          <button
            onClick={onDisconnect}
            className="p-2 hover:bg-bg-tertiary rounded-lg active-opacity"
          >
            <CloseIcon className="w-4 h-4 text-text-tertiary" />
          </button>
        </div>
      ) : (
        <Button
          variant={isExpired ? 'primary' : 'secondary'}
          size="sm"
          onClick={onConnect}
          disabled={isLoading}
          className="flex-shrink-0"
        >
          {isLoading ? (
            <Spinner size="sm" />
          ) : (
            isExpired ? 'Reconnect' : isPartiallyConnected ? 'Complete' : 'Connect'
          )}
        </Button>
      )}
    </div>
  );
}
