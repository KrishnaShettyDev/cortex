'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';

export default function HomePage() {
  const router = useRouter();
  const { user, checkAuth } = useAuthStore();

  useEffect(() => {
    // Check if user is already logged in
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      router.push('/dashboard');
    }
  }, [user, router]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 text-white">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            Cortex
          </h1>
          <p className="text-2xl text-zinc-300">
            Your Proactive AI Assistant
          </p>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Auto-ingest your life. Connect Gmail, Calendar, and more. 
            Get proactive suggestions before you even ask.
          </p>

          {/* Sign In Button */}
          <div className="pt-8">
            <a
              href="/auth/signin"
              className="inline-flex items-center gap-3 bg-white text-black px-8 py-4 rounded-full font-semibold text-lg hover:bg-zinc-200 transition-colors"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </a>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-8 pt-16 text-left">
            <div className="space-y-2">
              <div className="text-4xl">📧</div>
              <h3 className="text-xl font-semibold">Auto-Sync Gmail</h3>
              <p className="text-zinc-400">
                Automatically ingests your emails into your personal memory layer.
              </p>
            </div>
            <div className="space-y-2">
              <div className="text-4xl">📅</div>
              <h3 className="text-xl font-semibold">Smart Calendar</h3>
              <p className="text-zinc-400">
                Syncs events and suggests optimal scheduling automatically.
              </p>
            </div>
            <div className="space-y-2">
              <div className="text-4xl">🤖</div>
              <h3 className="text-xl font-semibold">Proactive AI</h3>
              <p className="text-zinc-400">
                Suggests actions before you ask. Like Poke, but better.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
