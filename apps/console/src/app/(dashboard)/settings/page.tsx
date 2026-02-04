'use client';

import { useRouter } from 'next/navigation';
import { User, CreditCard, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Settings</h1>
        <p className="text-zinc-400 mt-1">Manage your account settings</p>
      </div>

      {/* Account Section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
        <div className="px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-zinc-500" />
            <h2 className="text-sm font-medium text-zinc-100">Account</h2>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Email</label>
            <p className="text-sm text-zinc-200">{user?.email}</p>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Name</label>
            <p className="text-sm text-zinc-200">{user?.name || '—'}</p>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">User ID</label>
            <p className="text-sm text-zinc-400 font-mono">{user?.id}</p>
          </div>
        </div>
      </div>

      {/* Plan Section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
        <div className="px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-zinc-500" />
            <h2 className="text-sm font-medium text-zinc-100">Plan</h2>
          </div>
        </div>
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-200">Free Plan</span>
                <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                  Current
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                10,000 memories, 1,000 API calls/day
              </p>
            </div>
            <a
              href="https://askcortex.in/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View Plans
            </a>
          </div>
        </div>
      </div>

      {/* Sign Out Section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-zinc-100">Sign Out</h2>
              <p className="text-xs text-zinc-500 mt-1">
                Sign out of your Cortex account
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md px-3 py-1.5 text-sm transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
