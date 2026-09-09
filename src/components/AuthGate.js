import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLicense } from '../context/LicenseContext';
import * as api from '../services/licensingApi';

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-1.7 3.6-5.5 3.6-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.3.8 4.1 1.6l2.8-2.8C16.7 2.3 14.6 1.5 12 1.5 6.8 1.5 2.5 5.8 2.5 11S6.8 20.5 12 20.5c7 0 9.7-4.9 9.7-7.4 0-.5 0-1-.1-1.4H12z" />
    <path fill="#4285F4" d="M21.6 12.2c0-.8-.1-1.4-.2-2H12v3.9h5.5c-.1.9-.7 2.2-2 3.1l3.2 2.5c1.9-1.8 2.9-4.4 2.9-7.5z" />
    <path fill="#FBBC05" d="M5.6 13.3c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2L2.4 6.8C1.6 8.3 1.1 10.1 1.1 12s.5 3.7 1.3 5.2l3.2-2.5c-.4-.9-.7-1.9-.7-3z" />
    <path fill="#34A853" d="M12 22.5c2.7 0 5-.9 6.7-2.4l-3.2-2.5c-.9.6-2 1-3.5 1-2.7 0-5-1.8-5.8-4.3l-3.2 2.5C4.6 20.4 8 22.5 12 22.5z" />
  </svg>
);

// Facebook and Apple sign-in are not implemented. Their icons were removed
// with the disabled buttons — re-add them when the providers actually ship.

/* ------------------------------------------------------------------ */
/*  Small subcomponents                                                */
/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500">
      <nav className="flex items-center justify-center gap-4">
        <a href="mailto:support@photuna.app" className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">Contact Us</a>
        <a href="https://www.studiophotuna.com/operator-agreement" target="_blank" rel="noopener noreferrer" className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">Terms &amp; Conditions</a>
        <a href="https://www.studiophotuna.com/privacy-framework" target="_blank" rel="noopener noreferrer" className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">Privacy Policy</a>
      </nav>
      <p className="mt-2">&copy; {new Date().getFullYear()} Studio Photuna. All Rights Reserved.</p>
    </footer>
  );
}

function AuthMessage({ message }) {
  if (!message) return null;
  const isError = /error|failed|invalid|unexpected|restricted/i.test(message);
  return (
    <div
      className={[
        'rounded-2xl border px-4 py-3 text-sm',
        isError
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700',
      ].join(' ')}
    >
      {message}
    </div>
  );
}

function PillInput({ id, label, type = 'text', value, onChange, placeholder, required, minLength, autoComplete }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-slate-900 dark:text-slate-100">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        className="h-11 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-sm text-slate-900 dark:text-slate-100 outline-none transition placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
      />
    </div>
  );
}

function PillPasswordField({ value, onChange, showPassword, onToggle }) {
  return (
    <div>
      <label htmlFor="password" className="mb-1.5 block text-[13px] font-semibold text-slate-900 dark:text-slate-100">
        Password
      </label>
      <div className="group flex h-11 items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pr-2 transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/15">
        <input
          id="password"
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder="Enter your password"
          autoComplete="current-password"
          className="w-full bg-transparent px-4 text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          required
          minLength={6}
        />
        <button
          type="button"
          className="rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 transition hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          onClick={onToggle}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

const authInfoSlides = [
  {
    eyebrow: 'Account access',
    title: 'Connect this booth to your operator workspace.',
    copy: 'Your login unlocks the Windows app, keeps license status in sync, and connects this device to the same account used for events, templates, galleries, and subscription access.',
    cards: [
      ['01', 'Account sync', 'Reads the correct Supabase user, profile, plan, and trial state.'],
      ['02', 'License access', 'Refreshes subscription access after checkout and keeps restricted mode accurate.'],
      ['03', 'Operator workspace', 'Opens dashboard tools for events, templates, settings, reports, and galleries.'],
      ['04', 'Device session', 'Keeps this Windows booth signed in until you intentionally log out.'],
    ],
  },
  {
    eyebrow: 'Business workflow',
    title: 'Run booth operations from one production workspace.',
    copy: 'Studio Photuna keeps the setup focused on the work operators need before and during an event, without adding a kiosk-only workflow.',
    cards: [
      ['01', 'Event setup', 'Create client events and prepare booth settings before the booking starts.'],
      ['02', 'Template control', 'Manage layouts, frames, branding, safe margins, and event-specific designs.'],
      ['03', 'Guest flow', 'Move guests through capture, retake, preview, QR sharing, and thank-you screens.'],
      ['04', 'Reports', 'Review sessions, output, revenue, print counts, and event activity after bookings.'],
    ],
  },
  {
    eyebrow: 'Subscription ready',
    title: 'Built for operators who need reliable app access.',
    copy: 'The account layer keeps trial, subscription, and device access attached to the correct operator so refreshes and restarts stay predictable.',
    cards: [
      ['01', '14-day trial', 'Start with full access before choosing a paid plan.'],
      ['02', 'Monthly plan', '₱1,800 per month for operators who need flexibility.'],
      ['03', 'Yearly plan', '₱11,400 yearly, equal to ₱950 per month for the best value.'],
      ['04', 'Secure logout', 'Clears stored identity so the next restart does not restore the old user.'],
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function AuthGate({ children }) {
  const {
    user,
    login,
    register,
    logout,
    loginWithGoogle,
    sendPasswordReset,
  } = useAuth();
  const { gating, refreshLicense } = useLicense();

  const [mode, setMode] = useState('landing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [billingCycle, setBillingCycle] = useState('yearly');
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeAuthSlide, setActiveAuthSlide] = useState(0);

  const isLoggedIn = !!user;
  const proPlans = {
    monthly: {
      label: 'Monthly',
      plan: 'monthly',
      price: '₱1,800/mo',
      note: 'Best for operators who want monthly flexibility before committing.',
      cta: 'Subscribe Monthly',
      chips: ['Monthly billing', 'Full software access', 'Cancel when needed'],
    },
    yearly: {
      label: 'Yearly',
      plan: 'yearly',
      price: '₱950/mo',
      note: '₱11,400 billed yearly. Save 47% compared with monthly billing.',
      cta: 'Subscribe Yearly',
      chips: ['Best value', 'Priority support', '12-month business access'],
    },
  };
  const selectedProPlan = proPlans[billingCycle];

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (isLoggedIn) return undefined;
    const interval = setInterval(() => {
      setActiveAuthSlide((current) => (current + 1) % authInfoSlides.length);
    }, 60000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  const activeInfo = authInfoSlides[activeAuthSlide];

  const viewCopy = useMemo(() => {
    if (mode === 'register') {
      return {
        eyebrow: 'Start',
        title: 'Create account',
        subtitle: '',
        submitLabel: loading ? 'Creating account...' : 'Create account',
        switchPrompt: 'Already have an account?',
        switchAction: 'Sign in',
      };
    }
    return {
      eyebrow: 'Login',
      title: 'Welcome back',
      subtitle: '',
      submitLabel: loading ? 'Signing in...' : 'Login',
      switchPrompt: 'New to Photuna?',
      switchAction: 'Create an account',
    };
  }, [loading, mode]);

  /* -------------------- handlers -------------------- */

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        setMsg('Signed in successfully.');
      } else {
        if (!termsAccepted) {
          setMsg('Please accept the Privacy Policy and Terms to create an account.');
          return;
        }
        await register(email, password, name, { termsAccepted: true });
        setMsg('Account created successfully.');
      }
    } catch (err) {
      setMsg(err?.message ? String(err.message) : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setMsg('');
    try {
      if (!email) {
        setMsg('Enter your email first to receive a password reset link.');
        return;
      }
      if (!sendPasswordReset) {
        setMsg('Password reset is not available right now.');
        return;
      }
      await sendPasswordReset(email);
      setMsg('Password reset email sent.');
    } catch (error) {
      setMsg(error?.message ? String(error.message) : 'Reset failed.');
    }
  };

  const handleGoogleLogin = async () => {
    setMsg('');
    setLoading(true);
    try {
      if (!loginWithGoogle) throw new Error('Google sign-in not available.');
      await loginWithGoogle();
    } catch (error) {
      setMsg(error?.message ? String(error.message) : 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const redeemTrial = async () => {
    setMsg('');
    if (!isLoggedIn) return;
    setPlanLoading(true);
    try {
      await api.redeemTrial();
      await refreshLicense();
      setMsg('Trial activated! Your 14-day trial is now live.');
    } catch (err) {
      setMsg(err?.message ? `Trial error: ${err.message}` : 'Trial: Unexpected error');
    } finally {
      setPlanLoading(false);
    }
  };


  const handleRefreshLicense = async () => {
    setMsg('');
    setPlanLoading(true);
    try {
      await refreshLicense();
      setMsg('License refreshed.');
    } catch (err) {
      setMsg('Refresh failed. Please try again.');
    } finally {
      setPlanLoading(false);
    }
  };

  /* -------------------- LOGGED OUT -------------------- */

  if (!isLoggedIn) {
    // Shared: blue gradient background used by both landing and form screens
    const BG = (
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #3B82F6 0%, #2563EB 45%, #1E3A8A 100%)' }}>
        <img
          src={process.env.PUBLIC_URL + '/tone-preview.jpg'}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.3, mixBlendMode: 'luminosity' }}
        />
      </div>
    );

    // Shared card width: responsive, at least 60% on md+ screens, never full-width
    const cardCls = 'w-[92%] sm:w-[78%] md:w-[65%] lg:w-[60%] max-w-[560px]';

    /* ---- Landing screen ---- */
    if (mode === 'landing') {
      return (
        <div className="relative flex h-screen items-center justify-center overflow-auto font-sans" style={{ fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
          {BG}

          {/* Logo above card */}
          <div className="absolute top-8 left-1/2 z-10 -translate-x-1/2 sm:top-10">
            <img src={process.env.PUBLIC_URL + '/logo-dark.png'} alt="Studio Photuna" className="h-20 w-auto brightness-0 invert sm:h-24" />
          </div>

          {/* Card — same placement and size as form screen */}
          <div
            className={[
              cardCls,
              'relative z-10 mt-20 rounded-2xl bg-white dark:bg-slate-900 px-7 py-8 shadow-[0_8px_28px_rgba(15,23,42,0.16)] transition-all duration-500',
              mounted ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
            ].join(' ')}
          >
            <h1 className="text-[30px] leading-tight font-bold tracking-tight text-slate-900 dark:text-slate-100" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>Let&apos;s get started</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">Sign in to your operator account, or create one to start a 14-day trial.</p>

              <div className="mt-7 space-y-2.5">
                <button
                  type="button"
                  onClick={() => { setMsg(''); setMode('register'); }}
                  className="flex h-12 w-full items-center justify-center rounded-lg bg-blue-600 text-[15px] font-semibold text-white shadow-md shadow-blue-200 dark:shadow-none transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg active:translate-y-0"
                >
                  Create an account
                </button>
                <button
                  type="button"
                  onClick={() => { setMsg(''); setMode('login'); }}
                  className="flex h-12 w-full items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-[15px] font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Sign in
                </button>
              </div>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">or</span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              </div>

              {/* Google is the only working provider, so it gets the full width.
                  A three-up grid where two thirds are permanently disabled reads
                  as broken, not as a roadmap. */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-[15px] font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GoogleIcon />
                Continue with Google
              </button>

              <AuthMessage message={msg} />

              <p className="mt-6 text-center text-[11px] leading-5 text-slate-400 dark:text-slate-500">
                By continuing you agree to our{' '}
                <a href="https://www.studiophotuna.com/operator-agreement" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-600 dark:text-slate-300 underline underline-offset-2 hover:text-slate-900 dark:hover:text-slate-100">Terms</a>
                {' '}and{' '}
                <a href="https://www.studiophotuna.com/privacy-framework" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-600 dark:text-slate-300 underline underline-offset-2 hover:text-slate-900 dark:hover:text-slate-100">Privacy Policy</a>.
              </p>
          </div>
        </div>
      );
    }

    /* ---- Sign In / Sign Up form — same background, card centered ---- */
    return (
      <div className="relative flex h-screen items-center justify-center overflow-auto font-sans" style={{ fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        {BG}

        {/* Logo above card */}
        <div className="absolute top-8 left-1/2 z-10 -translate-x-1/2 sm:top-10">
          <img src={process.env.PUBLIC_URL + '/logo-dark.png'} alt="Studio Photuna" className="h-20 w-auto brightness-0 invert sm:h-24" />
        </div>

        {/* Card */}
        <div
          className={[
            cardCls,
            'relative z-10 mt-20 rounded-2xl bg-white dark:bg-slate-900 px-7 py-8 shadow-[0_8px_28px_rgba(15,23,42,0.16)] transition-all duration-500',
            mounted ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
          ].join(' ')}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => { setMsg(''); setMode('landing'); }}
            className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 dark:text-slate-500 transition hover:text-slate-900 dark:hover:text-slate-100"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
            Back
          </button>

          {/* Mode toggle */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            {[['login', 'Sign In'], ['register', 'Sign Up']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setMsg(''); setMode(key); }}
                className={[
                  'rounded-lg px-4 py-2.5 text-sm font-semibold transition',
                  mode === key ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === 'register' && (
              <PillInput id="name" label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" autoComplete="name" required />
            )}
            <PillInput id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
            <PillPasswordField value={password} onChange={(e) => setPassword(e.target.value)} showPassword={showPassword} onToggle={() => setShowPassword((s) => !s)} />

            {mode === 'login' && (
              <div className="flex justify-end">
                <button type="button" className="text-sm font-bold text-blue-700 dark:text-blue-400 transition hover:text-blue-800 dark:hover:text-blue-300" onClick={handleForgotPassword}>
                  Forgot Password?
                </button>
              </div>
            )}

            {mode === 'register' && (
              <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-500 dark:text-slate-400">
                <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded accent-blue-600 cursor-pointer" required />
                <span>
                  I agree to the{' '}
                  <a href="https://www.studiophotuna.com/privacy-framework" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 dark:text-blue-400 underline underline-offset-2">Privacy Policy</a>
                  {' '}and{' '}
                  <a href="https://www.studiophotuna.com/operator-agreement" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 dark:text-blue-400 underline underline-offset-2">Terms of Service</a>.
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading || (mode === 'register' && !termsAccepted)}
              className="mt-2 flex h-12 w-full items-center justify-center rounded-lg bg-blue-600 text-[15px] font-semibold text-white shadow-md shadow-blue-200 dark:shadow-none transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none"
            >
              {viewCopy.submitLabel}
            </button>

            <AuthMessage message={msg} />
          </form>
        </div>
      </div>
    );
  }

  /* -------------------- LOGGED IN — account center -------------------- */

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-6 font-sans text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8" style={{ fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
      />

      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <img src={process.env.PUBLIC_URL + '/logo-dark.png'} alt="Studio Photuna" className="h-11 w-auto" />
          <button
            className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 text-sm font-extrabold text-slate-900 dark:text-slate-100 transition hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={logout}
          >
            Logout
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_6px_20px_rgba(15,23,42,0.06)]">
          <div className="relative overflow-hidden border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-6 py-7 text-slate-900 dark:text-slate-100 sm:px-8">
            <div className="pointer-events-none absolute right-[-80px] top-[-70px] h-48 w-64 rotate-[10deg] rounded-[46px] bg-[radial-gradient(circle_at_70%_30%,rgba(37,99,235,0.2),transparent_50%),#dbeafe]" />
            <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
                  Account Center
                </div>
                <h2
                  className="mt-3 text-4xl font-black tracking-[-0.055em] text-slate-900 dark:text-slate-100"
                >
                  Signed in successfully
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Manage authentication, subscription access, and booth business workflow.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="space-y-6">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Account</p>
                <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Signed in as</p>
                    <p className="text-lg font-black text-slate-900 dark:text-slate-100">{user?.email || 'Unknown user'}</p>
                  </div>
                  <div className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-500 dark:text-slate-400">
                    Plan: <span className="font-black text-slate-900 dark:text-slate-100">{gating.plan || 'none'}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">License status</p>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900">
                      {gating.allow ? 'Workspace unlocked' : 'Restricted mode active'}
                    </h3>
                  </div>
                  <span
                    className={[
                      'inline-flex rounded-full px-3 py-1 text-xs font-semibold',
                      gating.allow ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                    ].join(' ')}
                  >
                    {gating.allow ? 'Licensed' : 'Restricted'}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {gating.allow
                    ? 'All configured dashboard features are available for this account.'
                    : `Watermark and feature limitations are active${gating.reason ? ` - ${gating.reason}` : '.'}`}
                </p>

                {!gating.allow && (
                  <div className="mt-5 rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Studio Photuna Pro</p>
                        <h4 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{selectedProPlan.price}</h4>
                        <p className="mt-1 max-w-lg text-sm leading-6 text-slate-600">{selectedProPlan.note}</p>
                      </div>

                      <div className="inline-flex rounded-full border border-blue-200 bg-white p-1">
                        {Object.values(proPlans).map((item) => (
                          <button
                            key={item.plan}
                            type="button"
                            onClick={() => setBillingCycle(item.plan)}
                            className={[
                              'rounded-full px-4 py-2 text-xs font-semibold transition',
                              billingCycle === item.plan
                                ? 'bg-slate-950 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-950',
                            ].join(' ')}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedProPlan.chips.map((chip) => (
                        <span key={chip} className="rounded-full border border-blue-100 bg-white px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-3">
                  {!gating.allow && (
                    <>
                      <button
                        className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-50"
                        onClick={redeemTrial}
                        disabled={planLoading}
                      >
                        {planLoading ? 'Please wait...' : 'Redeem 14-day Trial'}
                      </button>
                      <button
                        className="rounded-full border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                        onClick={() => setMsg('Go to Settings → Billing to subscribe.')}
                      >
                        {selectedProPlan.cta}
                      </button>
                    </>
                  )}
                  <button
                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 transition hover:bg-slate-50 disabled:opacity-50"
                    onClick={handleRefreshLicense}
                    disabled={planLoading}
                  >
                    {planLoading ? 'Refreshing...' : 'Refresh License'}
                  </button>
                </div>
              </div>

              <AuthMessage message={msg} />

              <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                {children}
              </div>
            </section>

            <aside className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">License entitlements</p>
                <div className="mt-4 space-y-2.5 text-sm text-slate-600">
                  {[
                    { label: 'Plan', value: gating.plan || 'Free' },
                    { label: 'Status', value: gating.allow ? 'Licensed' : 'Restricted' },
                    { label: 'Watermark', value: gating.watermark ? 'Enabled' : 'Off' },
                    { label: 'Max events', value: gating.maxEvents ? String(gating.maxEvents) : 'Unlimited' },
                    { label: 'Templates', value: gating.templates ? String(gating.templates) : 'Unlimited' },
                    { label: 'Priority support', value: gating.prioritySupport ? 'Yes' : 'No' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5">
                      <span className="text-slate-500">{label}</span>
                      <span className="font-semibold text-slate-900">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>

        <Footer />
      </div>
    </div>
  );
}