'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import { useMemories } from '@/hooks/useMemories';
import { useSearch } from '@/hooks/useSearch';
import { AddMemoryModal } from '@/components/AddMemoryModal';
import { UserMenu } from '@/components/UserMenu';
import { ChatInput } from '@/components/ChatInput';
import { MemoriesSection } from '@/components/MemoriesSection';
import { SettingsOutlineIcon } from '@/components/icons';
import { IconButton as UiIconButton } from '@/components/ui';

export default function DashboardPage() {
  const router = useRouter();
  const { user, checkAuth, signOut } = useAuthStore();
  const { memories, isLoading, addMemory } = useMemories(user?.id);
  const { results, isSearching, search, clearSearch, hasResults } = useSearch();
  const [showAddMemory, setShowAddMemory] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
    }
  }, [user, router]);

  if (!user) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <TopNav user={user} onAddMemory={() => setShowAddMemory(true)} onSignOut={signOut} />

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="space-y-8">
          <WelcomeHeader userName={user.name} />
          <ChatInput onSearch={search} isSearching={isSearching} />
          <ScrollIndicator />
          <MemoriesSection
            memories={memories}
            searchResults={results}
            isLoading={isLoading}
            onClearSearch={clearSearch}
            onAddMemory={() => setShowAddMemory(true)}
          />
        </div>
      </main>

      <AddMemoryModal
        isOpen={showAddMemory}
        onClose={() => setShowAddMemory(false)}
        onSave={addMemory}
      />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="animate-pulse text-text-tertiary">Loading...</div>
    </div>
  );
}

interface TopNavProps {
  user: { id: string; name?: string; email: string; created_at: string };
  onAddMemory: () => void;
  onSignOut: () => void;
}

function TopNav({ user, onAddMemory, onSignOut }: TopNavProps) {
  const router = useRouter();

  return (
    <nav className="border-b border-separator">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-3">
          <AddMemoryButton onClick={onAddMemory} />
          <IconButtons />
          <UiIconButton onClick={() => router.push('/settings')}>
            <SettingsOutlineIcon className="w-5 h-5 text-text-secondary" />
          </UiIconButton>
          <UserMenu user={user} onSignOut={onSignOut} />
        </div>
      </div>
    </nav>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="text-2xl font-bold">cortex™</div>
    </div>
  );
}

function AddMemoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium flex items-center gap-2"
    >
      <span>+</span>
      <span>Add Memory</span>
      <span className="text-zinc-500">c</span>
    </button>
  );
}

function IconButtons() {
  return (
    <>
      <IconButton icon={<ClockIcon />} />
      <IconButton icon={<LightningIcon />} />
      <IconButton icon={<SettingsIcon />} />
    </>
  );
}

function IconButton({ icon }: { icon: React.ReactNode }) {
  return <button className="p-2 hover:bg-zinc-800 rounded-lg">{icon}</button>;
}

function WelcomeHeader({ userName }: { userName?: string }) {
  const firstName = userName?.split(' ')[0] || 'User';
  return (
    <h1 className="text-4xl font-normal text-center">
      Welcome, <span className="text-blue-500">{firstName}</span>
    </h1>
  );
}

function ScrollIndicator() {
  return (
    <p className="text-center text-sm text-zinc-600 flex items-center justify-center gap-2">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
      Scroll down to see memories
    </p>
  );
}

// Icon Components
function ClockIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function LightningIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
