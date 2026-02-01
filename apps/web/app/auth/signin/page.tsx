'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';

declare global {
  interface Window {
    google: any;
  }
}

export default function SignInPage() {
  const router = useRouter();
  const { signIn, user, checkAuth } = useAuthStore();
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if already logged in
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      router.push('/dashboard');
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    script.onload = () => {
      if (window.google && googleButtonRef.current) {
        window.google.accounts.id.initialize({
          client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
          callback: handleGoogleSignIn,
        });

        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'filled_black',
          size: 'large',
          type: 'standard',
          text: 'signin_with',
          shape: 'pill',
          logo_alignment: 'left',
        });
      }
    };

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, [user]);

  const handleGoogleSignIn = async (response: any) => {
    try {
      await signIn(response.credential);
      router.push('/dashboard');
    } catch (error) {
      console.error('Sign in failed:', error);
      alert('Sign in failed. Please try again.');
    }
  };

  if (user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-white mb-4">Welcome to Cortex</h1>
          <p className="text-zinc-400 text-lg">
            Sign in to start auto-ingesting your life
          </p>
        </div>

        <div className="flex justify-center pt-8">
          <div ref={googleButtonRef} />
        </div>

        <p className="text-center text-sm text-zinc-500 pt-8">
          By signing in, you agree to sync your Gmail and Calendar
          <br />
          for a proactive AI experience
        </p>
      </div>
    </div>
  );
}
