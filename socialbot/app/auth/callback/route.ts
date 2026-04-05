import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * OAuth return: exchange code on a redirect response so Set-Cookie is applied to the same
 * response the browser follows (session is not lost).
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;

  const failRedirect = NextResponse.redirect(`${origin}/admin/login?error=auth`);
  const okRedirect = NextResponse.redirect(`${origin}/admin`);

  if (!code) {
    return failRedirect;
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            okRedirect.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[auth/callback] exchangeCodeForSession:', exchangeError.message);
    }
    return failRedirect;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[auth/callback] getUser after exchange:', userError?.message);
    }
    return failRedirect;
  }

  return okRedirect;
}
