'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Key, Code, Settings } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/keys', label: 'API Keys', icon: Key },
  { href: '/quickstart', label: 'Quickstart', icon: Code },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return email?.slice(0, 2).toUpperCase() || '??';
  };

  return (
    <aside className="w-60 bg-zinc-900 border-r border-zinc-800 flex flex-col h-screen">
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-zinc-100">Cortex</span>
          <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">Console</span>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-zinc-800 text-white border-l-2 border-indigo-500 -ml-0.5 pl-[14px]'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-medium text-zinc-300">
            {getInitials(user?.name, user?.email)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-300 truncate">{user?.email}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
