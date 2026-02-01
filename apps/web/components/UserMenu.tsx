import { useState, useRef, useEffect } from 'react';
import type { User } from '@/lib/api/client';

interface UserMenuProps {
  user: User;
  onSignOut: () => void;
}

export function UserMenu({ user, onSignOut }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const firstName = user.name?.split(' ')[0] || 'User';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm"
      >
        {firstName}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-zinc-900 border border-zinc-800 rounded-lg shadow-lg z-50">
          <div className="p-4 border-b border-zinc-800">
            <div className="font-semibold">{user.name || 'User'}</div>
            <div className="text-sm text-zinc-400">{user.email}</div>
          </div>

          <nav className="py-2">
            <MenuItem icon="👤" label="Profile" />
            <MenuItem icon="💳" label="Billing" />
            <MenuItem icon="🔌" label="Integrations" />
            <MenuItem icon="🧩" label="Chrome Extension" />
          </nav>

          <div className="py-2 border-t border-zinc-800">
            <button
              onClick={onSignOut}
              className="w-full px-4 py-2 text-left hover:bg-zinc-800 flex items-center gap-2"
            >
              <span>🚪</span>
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon: string;
  label: string;
}

function MenuItem({ icon, label }: MenuItemProps) {
  return (
    <button className="w-full px-4 py-2 text-left hover:bg-zinc-800 flex items-center gap-2">
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
