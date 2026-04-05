'use client';

import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useState } from 'react';

const ACCENT = '#25D366';

function AdminLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const errorMessage =
    error === 'forbidden'
      ? 'Your account does not have admin access. Contact an administrator if you need access.'
      : error === 'auth'
        ? 'Sign-in failed. Please try again.'
        : null;

  const signInWithGoogle = async () => {
    setLoading(true);
    const origin = window.location.origin;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (oauthError) {
      alert(oauthError.message);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-xl">
        <h1 className="text-center text-2xl font-black tracking-tight text-white">SocialBot Admin</h1>
        <p className="mt-2 text-center text-sm font-medium text-zinc-400">Sign in to access the dashboard</p>

        {errorMessage ? (
          <div
            className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200"
            role="alert"
          >
            {errorMessage}
            {error === 'forbidden' ? (
              <button
                type="button"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true);
                  await supabase.auth.signOut();
                  router.replace('/admin/login');
                  router.refresh();
                  setSigningOut(false);
                }}
                className="mt-3 w-full rounded-lg border border-amber-400/40 py-2 text-xs font-black uppercase tracking-wide text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {signingOut ? 'Signing out…' : 'Sign out and use another account'}
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          disabled={loading}
          onClick={() => void signInWithGoogle()}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-black text-white shadow-lg transition hover:opacity-95 disabled:opacity-50"
          style={{ backgroundColor: ACCENT }}
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {loading ? 'Redirecting…' : 'Sign in with Google'}
        </button>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Only users with the <span className="font-bold text-zinc-400">admin</span> role can access this panel.
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      }
    >
      <AdminLoginInner />
    </Suspense>
  );
}
