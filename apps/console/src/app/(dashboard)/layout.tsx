'use client';

import { ProtectedLayout } from '@/lib/auth';
import { Sidebar } from '@/components/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedLayout>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </ProtectedLayout>
  );
}
