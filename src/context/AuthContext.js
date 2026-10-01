import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { trackRegistration } from '../services/analyticsTracker.js';

const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

function clearSupabaseAuthStorage() {
  if (typeof window === 'undefined') return;

  const shouldRemove = (key) =>
    key === 'supabase.auth.token' ||
    key.startsWith('sb-') ||
    key.includes('supabase') ||
    key.includes('auth-token');

  [window.localStorage, window.sessionStorage].forEach((storage) => {
    if (!storage) return;
    try {
      Object.keys(storage)
        .filter(shouldRemove)
        .forEach((key) => storage.removeItem(key));
    } catch (_error) {
      // Ignore storage access errors so logout can still finish.
    }
  });
}

async function clearNativeIdentity() {
  await Promise.allSettled([
    window.secureStore?.clearIdentity?.(),
    window.secureStore?.setCurrentUser?.(null),
    window.sessionStore?.clear?.(),
  ]);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Safety valve: never stay stuck on the loading screen for more than 6 seconds.
    const safetyTimer = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 6000);

    const init = async () => {
      // NOTE: The Supabase ping was removed — it was blocking init() whenever
      // Supabase was slow, causing the app to hang on "Restoring your session".
      // getSession() is sufficient to restore auth state from local storage.

      const { data } = await supabase.auth.getSession();

      if (data?.session?.user) {
        const u = data.session.user;
        setUser(u);
        // Keep electron-store userId in sync with the live Supabase session
        window.secureStore?.setCurrentUser?.(u.id)?.catch?.(() => {});
        // Load profile in background — don't await so auth resolves immediately,
        // then profile arrives and triggers a re-render once available.
        loadProfile(u.id).catch((e) =>
          console.warn('[AuthContext] loadProfile error:', e?.message)
        );
      } else {
        // No valid Supabase session — wipe any stale local identity immediately
        clearSupabaseAuthStorage();
        clearNativeIdentity();
      }

      if (mounted) {
        setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const u = session.user;
        setUser(u);
        window.secureStore?.setCurrentUser?.(u.id)?.catch?.(() => {});

        // Never await a Supabase call inside this callback. Supabase runs it
        // while still holding its auth lock -- mid token refresh, for example --
        // and waits for it to return, while any Supabase request made here queues
        // behind that same lock. Each waits on the other forever, and from then
        // on every request in the app stalls: installed booths hung on "Preparing
        // your gallery" this way whenever a refresh coincided with startup.
        // Deferring lets the callback return and the lock go first.
        setTimeout(async () => {
          try {
            // For OAuth sign-ins, ensure a profile row exists (first-time Google login)
            if (event === 'SIGNED_IN') {
              await ensureProfile(u);
            }
            await loadProfile(u.id);
          } catch (e) {
            console.warn('[AuthContext] profile refresh failed:', e?.message);
          }
        }, 0);
      } else {
        setUser(null);
        setProfile(null);
        clearSupabaseAuthStorage();
        clearNativeIdentity();
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (data) {
      setProfile(data);
    } else if (error) {
      console.warn('[AuthContext] loadProfile error:', error.message);
    } else {
      // Profile row deleted from Supabase — force full sign-out immediately
      console.warn('[AuthContext] Profile not found — forcing sign-out');
      setUser(null);
      setProfile(null);
      clearSupabaseAuthStorage();
      clearNativeIdentity();
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  };

  /**
   * Ensure a profile row exists for OAuth users signing in for the first time.
   * Uses upsert so it's safe to call on every sign-in — existing rows are untouched.
   */
  const ensureProfile = async (u) => {
    try {
      const meta = u.user_metadata || {};
      const fullName = meta.full_name || meta.name || '';
      const email = u.email || meta.email || '';
      const avatarUrl = meta.avatar_url || meta.picture || null;

      await supabase.from('profiles').upsert(
        {
          id: u.id,
          full_name: fullName,
          email,
          avatar_url: avatarUrl,
          subscription_plan: 'free',
        },
        { onConflict: 'id', ignoreDuplicates: true }
      );

      // Track registration for new OAuth users
      const source = u.app_metadata?.provider || 'google';
      trackRegistration(u.id, source).catch((err) =>
        console.warn('[AuthContext] Analytics tracking failed:', err)
      );
    } catch (err) {
      console.warn('[AuthContext] ensureProfile error:', err?.message);
    }
  };

  const login = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Supabase's own wording ("Email not confirmed") does not say what to do.
      if (/not confirmed/i.test(error.message || '')) {
        throw new Error('Please confirm your email first. Open the link we sent to your inbox, then sign in again.');
      }
      throw error;
    }
    // An account created while email confirmation was pending could not write
    // its profile (no session yet), so the Terms acceptance travelled in the
    // sign-up metadata. Copy it across on the first sign-in.
    const acceptedAt = data?.user?.user_metadata?.terms_accepted_at;
    if (data?.user?.id && acceptedAt) {
      supabase.from('profiles')
        .update({ terms_accepted_at: acceptedAt })
        .eq('id', data.user.id)
        .is('terms_accepted_at', null)
        .then(({ error: e }) => { if (e) console.warn('[AuthContext] terms backfill failed:', e.message); });
    }
  }, []);

  /**
   * Creates an account. Resolves to { needsConfirmation } rather than assuming
   * the operator is now signed in: this project requires email confirmation, so
   * a successful sign-up returns no session until the link in the email is
   * opened. Treating that as "signed in" is what made the app say "Account
   * created successfully" while leaving the operator on the form.
   */
  const register = useCallback(async (email, password, name, { termsAccepted = false } = {}) => {
    const acceptedAt = termsAccepted ? new Date().toISOString() : null;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name, terms_accepted_at: acceptedAt } },
    });

    if (error) throw error;

    // Supabase answers a sign-up for an existing email with a look-alike user
    // that has no identities (so it cannot be used to discover accounts).
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('This email is already registered. Sign in instead, or use Forgot Password.');
    }

    // No session: the account exists but waits for email confirmation. The
    // profile row comes from the on_auth_user_created trigger; the Terms
    // acceptance is copied over on first sign-in (see login).
    if (!data?.session) return { needsConfirmation: true };

    if (data?.user?.id) {
      await supabase.from('profiles').upsert(
        {
          id: data.user.id,
          full_name: name,
          email,
          subscription_plan: 'free',
          terms_accepted_at: acceptedAt,
        },
        { onConflict: 'id' }
      );

      // Only track registration analytics when the operator has explicitly
      // accepted the Terms of Service and Privacy Policy (GDPR Art. 6/7).
      if (termsAccepted) {
        const source = new URLSearchParams(window.location.search).get('source') || 'website';
        const utmSource = new URLSearchParams(window.location.search).get('utm_source');
        trackRegistration(data.user.id, source, utmSource).catch(err =>
          console.warn('[AuthContext] Analytics tracking failed:', err)
        );
      }
    }
    return { needsConfirmation: false };
  }, []);

  const resendConfirmation = useCallback(async (email) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) throw error;
  }, []);

  /**
   * Sign in with Google via Supabase OAuth.
   * Opens a popup/redirect to Google's consent screen.
   * On success, onAuthStateChange fires and sets the user.
   */
  const loginWithGoogle = useCallback(async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;

    if (data?.url) {
      if (window.electron?.invoke) {
        const result = await window.electron.invoke('auth:oauth-popup', data.url);
        if (result?.access_token && result?.refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: result.access_token,
            refresh_token: result.refresh_token,
          });
          if (sessionError) throw sessionError;
        } else if (result?.error) {
          throw new Error(result.error);
        }
      } else {
        window.location.href = data.url;
      }
    }
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    setProfile(null);
    clearSupabaseAuthStorage();
    await clearNativeIdentity();

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('[AuthContext] signOut error (state already cleared):', e.message);
    }

    clearSupabaseAuthStorage();
    await clearNativeIdentity();
  }, []);

  const sendPasswordReset = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };

  const value = {
    user,
    profile,
    loading,
    login,
    loginWithGoogle,
    register,
    resendConfirmation,
    logout,
    sendPasswordReset,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}