'use client';

import React, { useState, useEffect } from 'react';
import { ChevronForwardIcon, ChevronDownIcon } from '@/components/icons';
import { Spinner } from '@/components/ui';
import { apiClient } from '@/lib/api/client';
import Image from 'next/image';

export interface ConnectedAccountRowProps {
  email?: string;
}

/**
 * ConnectedAccountRow - Expandable account management section
 */
export function ConnectedAccountRow({ email }: ConnectedAccountRowProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState<any>(null);

  const loadStatus = async () => {
    setIsLoading(true);
    try {
      const status = await apiClient.getIntegrationStatus();
      setIntegrationStatus(status);
    } catch (error) {
      console.error('Failed to load integration status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleConnectGoogle = async () => {
    setIsConnecting(true);
    try {
      const response = await apiClient.connectGmail();
      if (response.redirectUrl) {
        const popup = window.open(response.redirectUrl, '_blank', 'width=600,height=700');

        const checkInterval = setInterval(async () => {
          try {
            const status = await apiClient.getIntegrationStatus();
            if (status.gmail?.connected || status.calendar?.connected) {
              clearInterval(checkInterval);
              popup?.close();
              await loadStatus();
            }
          } catch (err) {
            console.error('Failed to check status:', err);
          }
        }, 2000);

        setTimeout(() => clearInterval(checkInterval), 120000);
      }
    } catch (error) {
      console.error('Failed to connect Google:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const isGoogleConnected = integrationStatus?.gmail?.connected || integrationStatus?.calendar?.connected || false;
  const connectedEmail = integrationStatus?.gmail?.email || integrationStatus?.calendar?.email || email;

  return (
    <div className="mt-2">
      <h3 className="px-6 py-2 text-sm text-text-tertiary">
        Connected Accounts
      </h3>

      {/* Manage Accounts Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-4 px-6 py-3 hover:bg-bg-tertiary active-opacity transition-colors"
      >
        <Image
          src="https://www.google.com/favicon.ico"
          alt="Google"
          width={20}
          height={20}
          className="flex-shrink-0"
        />
        <span className="flex-1 text-base text-text-primary text-left">
          Manage Accounts
        </span>
        {isExpanded ? (
          <ChevronDownIcon className="w-4 h-4 text-text-tertiary" />
        ) : (
          <ChevronForwardIcon className="w-4 h-4 text-text-tertiary" />
        )}
      </button>

      {/* Expanded Accounts List */}
      {isExpanded && (
        <div className="ml-14 mr-6 bg-bg-secondary rounded-lg overflow-hidden border border-glass-border">
          {isLoading ? (
            <div className="p-6 flex items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : isGoogleConnected ? (
            /* Connected Account */
            <div className="flex items-center px-4 py-3 gap-3">
              <p className="flex-1 text-sm text-text-primary">
                {connectedEmail}
              </p>
              <div className="px-2 py-1 bg-success/20 rounded">
                <span className="text-[10px] font-semibold text-success tracking-wider">
                  CONNECTED
                </span>
              </div>
            </div>
          ) : (
            /* Connect Account Button */
            <button
              onClick={handleConnectGoogle}
              disabled={isConnecting}
              className="w-full flex items-center justify-center gap-2 py-3 hover:bg-bg-tertiary active-opacity transition-colors"
            >
              {isConnecting ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span className="text-sm font-medium text-accent">
                    Connect Google Account
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
