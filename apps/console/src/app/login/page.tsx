'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

// Google Client ID from apps/backend/src/handlers/auth.ts line 45
const GOOGLE_CLIENT_ID = '266293132252-ce19t4pktv5t8o5k34rito52r4opi7rk.apps.googleusercontent.com';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            config: { theme: string; size: string; width: number }
          ) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace('/dashboard');
      return;
    }

    const initGoogle = () => {
      if (!window.google || !buttonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          setLoading(true);
          setError(null);
          try {
            const result = await api.auth.google(response.credential);
            login(result.access_token, {
              id: result.user.id,
              email: result.user.email,
              name: result.user.name,
            });
            router.push('/dashboard');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
            setLoading(false);
          }
        },
      });

      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
      });
    };

    // Check if Google script is already loaded
    if (window.google) {
      initGoogle();
    } else {
      // Wait for script to load
      const checkGoogle = setInterval(() => {
        if (window.google) {
          clearInterval(checkGoogle);
          initGoogle();
        }
      }, 100);

      return () => clearInterval(checkGoogle);
    }
  }, [user, login, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 max-w-sm w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-100">Cortex</h1>
          <p className="text-zinc-400 mt-1">Developer Console</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-4">
            <div className="text-zinc-400 text-sm">Signing in...</div>
          </div>
        ) : (
          <div ref={buttonRef} className="flex justify-center" />
        )}

        <p className="mt-8 text-center text-xs text-zinc-500">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
