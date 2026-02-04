'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import { apiClient } from '@/lib/api/client';
import { ProfileHeader, MenuRow, ThemeSelector, ConnectedAccountRow } from '@/components/settings';
import { Spinner } from '@/components/ui';
import {
  CalendarOutlineIcon,
  LogoWhatsappIcon,
  LogOutOutlineIcon,
  TrashIcon
} from '@/components/icons';

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
    }
  }, [user, router]);

  if (!user) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  function handleSignOut(): void {
    if (confirm('Are you sure you want to sign out?')) {
      signOut();
      router.push('/auth/signin');
    }
  }

  async function handleDeleteAccount(): Promise<void> {
    const confirmed = confirm(
      'Are you sure you want to delete your account? This will permanently delete all your data including memories, conversations, and connected accounts. This action cannot be undone.'
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await apiClient.deleteAccount();
      signOut();
      router.push('/auth/signin');
    } catch (error: any) {
      alert(error.message || 'Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }

  const handleContactUs = () => {
    window.open('https://wa.me/917780185418', '_blank');
  };

  const handleNavigateToCalendar = () => {
    router.push('/calendar');
  };

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Sheet Handle (visual indicator) */}
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-9 h-1 bg-text-tertiary/40 rounded-full" />
      </div>

      {/* Scrollable Content */}
      <div className="pb-6">
        {/* Profile Section */}
        <ProfileHeader name={user.name} email={user.email} />

        {/* Menu Section */}
        <div className="mt-2">
          <h3 className="px-6 py-2 text-sm text-text-tertiary">
            Menu
          </h3>

          <MenuRow
            icon={<CalendarOutlineIcon className="w-5 h-5" />}
            label="Calendar"
            onClick={handleNavigateToCalendar}
          />

          <MenuRow
            icon={<LogoWhatsappIcon className="w-5 h-5" />}
            iconColor="text-whatsapp"
            label="Contact Us"
            onClick={handleContactUs}
          />
        </div>

        {/* Appearance Section */}
        <ThemeSelector />

        {/* Connected Accounts Section */}
        <ConnectedAccountRow email={user.email} />

        {/* Spacer */}
        <div className="h-8" />
      </div>

      {/* Bottom Actions - Fixed at bottom */}
      <div className="border-t border-glass-border px-6 pb-8 pt-3 bg-bg-primary">
        {/* Sign Out */}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-4 py-3 active-opacity"
        >
          <LogOutOutlineIcon className="w-5 h-5 text-error" />
          <span className="text-base text-error">Sign Out</span>
        </button>

        {/* Delete Account */}
        <button
          onClick={handleDeleteAccount}
          disabled={isDeleting}
          className="w-full flex items-center gap-4 py-3 active-opacity disabled:opacity-50"
        >
          <TrashIcon className="w-5 h-5 text-text-tertiary" />
          <span className="text-base text-text-tertiary">
            {isDeleting ? 'Deleting...' : 'Delete Account'}
          </span>
        </button>
      </div>
    </div>
  );
}
