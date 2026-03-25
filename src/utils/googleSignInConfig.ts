/**
 * Canonical Google **Web** OAuth client ID (`client_type: 3`).
 * Must match Supabase Dashboard → Auth → Google, and `google-services.json` web client rows.
 */
export const GOOGLE_WEB_CLIENT_ID =
  '309496298521-recmd3pe2d6g2cqhkmc86g9ha7dffntn.apps.googleusercontent.com';

/**
 * Always returns {@link GOOGLE_WEB_CLIENT_ID} so login + `signInWithIdToken` stay aligned with Supabase.
 */
export function getGoogleWebClientId(): string {
  return GOOGLE_WEB_CLIENT_ID;
}

/**
 * Params for `GoogleSignin.configure`.
 * `prompt: 'select_account'` is forwarded where supported; Android also needs `signOut()` before `signIn()` for a reliable account picker.
 */
export function getGoogleSignInConfigureParams(webClientId: string) {
  return {
    webClientId,
    offlineAccess: true,
    prompt: 'select_account' as const,
  };
}
