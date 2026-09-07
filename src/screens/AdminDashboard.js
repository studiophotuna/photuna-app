// src/pages/AdminDashboard.jsx
// NOTE: Kept ALL original logic/handlers. Only adjusted layout & tokens to match the screenshot.
// Look for // UPDATED: comments for changes.

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import QRCodeSVG from "react-qr-code";
import QRCodeLib from "qrcode";
import { DEFAULT_TEMPLATES, DEFAULT_FRAMES } from "../data/defaultTemplates";
import { supabase } from "../services/supabase.js";
import { useNavigate } from "react-router-dom";
import { useLicense } from "../context/LicenseContext";
import AccountMenu from "../components/navigation/AccountMenu";
import WebFont from "webfontloader";
import PlanCards from "../components/subscription/PlanCards";
import { useAuth } from "../context/AuthContext";
import * as licensingApi from "../services/licensingApi";
import SubscriptionSummary from "../components/subscription/SubscriptionSummary";
import TemplateEditor from "../components/TemplateEditor";
import { initSettingsSync, pullSettings, pushSettings, pushSettingsNow } from "../services/settingsSync.js";
import AnalyticsDashboard from "../components/AnalyticsDashboard";
import OnboardingTour from "../components/OnboardingTour";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const native =
  typeof window !== "undefined"
    ? window.api || window.electron || null
    : null;

// True when running inside the Capacitor iOS app (iPad). window.Capacitor is
// injected by the Capacitor runtime and is absent in Electron.
const isIpadApp =
  typeof window !== "undefined" && typeof window.Capacitor !== "undefined";

// A small, sensible starter list — add/remove as you like:
const GOOGLE_FONTS = [
  "Inter",
  "Plus Jakarta Sans",
  "Manrope",
  "Outfit",
  "Space Grotesk",
  "Sora",
  "Urbanist",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Lato",
  "Raleway",
  "Nunito",
  "Rubik",
  "Source Sans 3",
  "Noto Sans",
  "Playfair Display",
  "Cormorant Garamond",
  "Libre Baskerville",
  "Fraunces",
  "Merriweather",
  "Oswald",
  "DM Sans",
  "Lexend",
  "Work Sans",
  "Bebas Neue",
  "Kanit",
  "Fira Sans",
  "Josefin Sans",
  "Abril Fatface",
  "Caveat",
  "Pacifico",
  "Dancing Script",
];

// Load a font family (all common weights so your UI has choices)
function loadGoogleFont(family) {
  if (!family) return;
  WebFont.load({
    google: {
      families: [`${family}:100,200,300,400,500,600,700,800,900`],
    },
  });
}

// A robust fallback stack
const FALLBACK_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";

const PAGE_TITLES = {
  home: "Dashboard",
  events: "Events",
  settings: "Settings",
  reports: "Reports",
  account: "Account",
  helpcenter: "Help Center",
  subscription: "Subscription",
  dashboard: "Event Dashboard",
  remotebooth: "Remote Booth",
};

function getStatusTone(value) {
  if (value === true) return "bg-emerald-400";
  if (value === false) return "bg-red-400";
  return "bg-amber-400";
}

function getSettingsSectionMeta(tab) {
  switch (tab) {
    case "camera":
      return {
        title: "Camera Settings",
        description: "Configure your connected camera device and resolution.",
      };
    case "printing":
      return {
        title: "Printer Settings",
        description: "Manage your printer, paper size, quality, and print output behavior.",
      };
    case "storage":
      return {
        title: "Storage Settings",
        description: "Choose where sessions are stored and control cleanup behavior.",
      };
    case "general":
      return {
        title: "General Settings",
        description: "Adjust booth idle behavior, language, and core preferences.",
      };
    case "logs":
      return {
        title: "Audit & Logs",
        description: "Review exported logs and maintenance records for troubleshooting.",
      };
    case "system":
      return {
        title: "System Settings",
        description: "Control startup, recovery, updates, and system maintenance options.",
      };
    default:
      return {
        title: "Settings",
        description: "Configure hardware, storage, printing behavior, recovery options, and overall booth preferences.",
      };
  }
}

/** Theme tokens — aligned with AuthGate design language */
const ACCENT_COLOR = "#2563eb"; // blue-600
const BODY_BG = "bg-slate-50 dark:bg-slate-950";
const SURFACE_BG = "bg-white dark:bg-slate-900";
const SURFACE_BORDER = "border border-slate-200 dark:border-slate-700";
const BODY_TEXT = "text-slate-900 dark:text-slate-100";
const MUTED_TEXT = "text-slate-600 dark:text-slate-300";
const SOFT_TEXT = "text-slate-500 dark:text-slate-400";
const CARD_RADIUS = "rounded-xl";
const SMALL_CARD_RADIUS = "rounded-lg";
const INPUT_RADIUS = "rounded-lg";
const TOOLBAR_RADIUS = "rounded-lg";
const CHIP_RADIUS = "rounded-full";
const FOCUS_RING_INDIGO = "focus:ring-2 focus:ring-blue-200";
const BTN_PRIMARY = "inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60";
const BTN_SECONDARY = "inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60";
const BTN_GHOST = "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white dark:bg-slate-800 dark:border-slate-600 px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60";
const EYEBROW = "text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400";

// Shadows
const SHADOW_SOFT = "shadow-[0_8px_30px_rgba(15,23,42,0.06)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)]";
const SHADOW_CARD = "shadow-[0_24px_64px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.4)]";

/* ─── Settings primitives ──────────────────────────────────────────────────
   Shared building blocks so every Settings tab reads the same way: the label
   and its explanation on the left, the control right-aligned. Defined at module
   level so they are not re-created on each render of the dashboard.

   Pick by option count, not by habit:
     SettingToggle    — on/off
     SettingSegmented — 2-4 fixed choices, all visible at once
     a plain <select> — long or dynamic lists (camera devices, printers)
*/

// Blue gradient section header. Every top-level destination opens with one so
// the sections read as siblings; `eyebrow` names the area, `title` the page.
// WavePattern is passed in because it is declared later in this module.
const PageHero = ({ eyebrow, title, description, wave, children }) => (
  <div className="relative overflow-hidden rounded-xl border border-white/20 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 px-6 py-6 text-white shadow-[0_24px_64px_rgba(37,99,235,0.25)]">
    {wave}
    <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
            {eyebrow}
          </div>
        )}
        <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>
          {title}
        </h2>
        {description && <p className="mt-1.5 text-sm text-white/80">{description}</p>}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  </div>
);

// Label + description on the left, control on the right.
const SettingRow = ({ label, description, htmlFor, disabled, children }) => (
  <div className={`flex items-center justify-between gap-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0 ${disabled ? "opacity-40" : ""}`}>
    <div className="min-w-0">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-800 dark:text-slate-200"
      >
        {label}
      </label>
      {description && (
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      )}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

// Bounded numeric value. Clamping stays with the caller, which owns the range.
const SettingNumber = ({ value, onChange, min, max, step, id, disabled, suffix }) => (
  <div className="flex items-center gap-2">
    <input
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-24 px-3 py-2 text-sm tabular-nums text-slate-700 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60`}
    />
    {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
  </div>
);

// Binary on/off.
const SettingToggle = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={!!checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 ${
      checked ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-600"
    }`}
  >
    <span
      className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
        checked ? "translate-x-5" : "translate-x-0.5"
      }`}
    />
  </button>
);

// 2-4 fixed choices. Every option stays visible — no hidden state.
const SettingSegmented = ({ value, onChange, options, label, disabled }) => (
  <div role="group" aria-label={label} className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 gap-1">
    {options.map((opt) => {
      const active = value === opt.value;
      return (
        <button
          key={opt.value}
          type="button"
          aria-pressed={active}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed ${
            active
              ? "bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          {opt.short ?? opt.label}
        </button>
      );
    })}
  </div>
);

// Long or dynamic lists, where a segmented control cannot fit.
const SettingSelect = ({ value, onChange, children, id, disabled }) => (
  <select
    id={id}
    value={value}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} min-w-[12rem] max-w-[16rem] px-3 py-2 text-sm text-slate-700 dark:text-slate-200 disabled:opacity-40`}
  >
    {children}
  </select>
);

// Read-only derived value, shown so it is visible but clearly not editable.
const SettingReadout = ({ children }) => (
  <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-300">{children}</span>
);

const DEFAULT_SCREEN_TIMERS = {
  template: 60,
  payment: 90,
  retake: 30,
  photoselect: 60,
  framefilter: 90,
  printing: 30,
  thankyou: 15,
};

const CUSTOM_PAPER_SIZE_OPTIONS = [
  { value: "2x6", label: "Photo 2 × 6", source: "app", widthIn: 2, heightIn: 6 },
  { value: "4x6", label: "Photo 4 × 6", source: "app", widthIn: 4, heightIn: 6 },
  { value: "4x4", label: "Photo 4 × 4 Square", source: "app", widthIn: 4, heightIn: 4 },
  { value: "6x4", label: "Photo 6 × 4", source: "app", widthIn: 6, heightIn: 4 },
  { value: "6x2", label: "Photo 6 × 2", source: "app", widthIn: 6, heightIn: 2 },
];

function normalizePaperName(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[×x]/g, "x");
}

function extractPrinterPaperOptions(caps) {
  const raw =
    caps?.paperSizes ||
    caps?.papers ||
    caps?.mediaOptions ||
    caps?.media ||
    [];

  const printerItems = Array.isArray(raw)
    ? raw.map((item) => {
      if (typeof item === "string") {
        return {
          value: item,
          label: item,
          source: "printer",
        };
      }

      const name =
        item?.name ||
        item?.label ||
        item?.paperName ||
        item?.media ||
        "Unknown";

      return {
        value: name,
        label: name,
        source: "printer",
        width: item?.width ?? item?.w ?? null,
        height: item?.height ?? item?.h ?? null,
        raw: item,
      };
    })
    : [];

  const map = new Map();

  [...printerItems, ...CUSTOM_PAPER_SIZE_OPTIONS].forEach((item) => {
    const key = normalizePaperName(item.value);
    if (!map.has(key)) map.set(key, item);
  });

  return Array.from(map.values());
}

const CUSTOM_ORIENTATION_OPTIONS = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

// safe unique id
function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function notify(showToast, message) {
  showToast?.(message);
}

function WavePattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="dash-waves" x="0" y="0" width="600" height="120" patternUnits="userSpaceOnUse">
          <path d="M0 60 Q 75 20, 150 60 T 300 60 T 450 60 T 600 60" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3" />
          <path d="M0 90 Q 75 50, 150 90 T 300 90 T 450 90 T 600 90" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        </pattern>
      </defs>
      <rect width="600" height="200" fill="url(#dash-waves)" />
    </svg>
  );
}

// Currencies each payment gateway supports — used to warn/disable when currency doesn't match
const GATEWAY_SUPPORTED_CURRENCIES = {
  paymongo: ["PHP"],
  xendit:   ["PHP"],  // Xendit default; other currencies require account approval from Xendit
  stripe:   ["USD", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "SGD", "MYR", "THB", "JPY", "KRW", "INR", "HKD", "TWD", "CNY", "AUD", "CAD", "NZD"],
  paypal:   ["USD", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "HUF", "CZK", "MYR", "PHP", "SGD", "THB", "TWD", "JPY", "AUD", "CAD", "NZD", "HKD"],
};

// Payment gateway default method selections — module-level so useState initializers can reference them
const DEFAULT_PAYMONGO_PROVIDERS = { gcash: true, maya: false, grabpay: false, card: false };
const DEFAULT_STRIPE_PROVIDERS   = { card: false, applePay: false, googlePay: false, link: false, sepa: false, ideal: false };
const DEFAULT_XENDIT_PROVIDERS   = { card: false, ovo: false, dana: false, gopay: false, linkaja: false, shopeepay: false, qris: false, va_bca: false, va_bni: false, va_bri: false, va_mandiri: false, alfamart: false, indomaret: false };
const DEFAULT_PAYPAL_PROVIDERS   = { wallet: false, payLater: false, venmo: false, card: false };

export default function AdminDashboard({ onLogout, onStartPhotobooth, jumpToUpdate, onJumpToUpdateHandled, jumpToBilling, onJumpToBillingHandled }) {

  const { user, profile, loading: authLoading, logout } = useAuth();

  const identity = useMemo(() => ({
    username:
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      user?.email ||
      null,
    userId: user?.id || null,
  }), [profile?.full_name, user?.user_metadata?.full_name, user?.email, user?.id]);

  // Suppress Supabase Auth navigator.locks "stolen lock" noise (non-critical SDK warning)
  useEffect(() => {
    const handler = (event) => {
      if (event?.message?.includes?.("was released because another request stole it")) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        console.debug("[Supabase Auth] Lock contention suppressed — safe to ignore.");
        return true;
      }
    };
    window.addEventListener("error", handler);
    window.addEventListener("unhandledrejection", (event) => {
      const msg = event?.reason?.message || String(event?.reason || "");
      if (msg.includes("was released because another request stole it")) {
        event.preventDefault?.();
        console.debug("[Supabase Auth] Lock contention suppressed — safe to ignore.");
      }
    });
    return () => window.removeEventListener("error", handler);
  }, []);

  // --- state  --------------------
  const ready = !!identity.userId;
  const [hydrated, setHydrated] = useState(false);

  const [reportEventId, setReportEventId] = useState("all");

  const [booths, setBooths] = useState([]);
  const [boothsLoading, setBoothsLoading] = useState(false);

  /** Primary nav */
  const [activeMain, setActiveMain] = useState("home"); // "events" | "dashboard" | "account"
  const [activeSettingsTab, setActiveSettingsTab] = useState("camera");
  const [activeSub, setActiveSub] = useState("branding"); // dashboard sub-tabs
  const [helpArticle, setHelpArticle] = useState(null);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [runTour, setRunTour] = useState(false);

  // Show onboarding tour on first login
  useEffect(() => {
    if (!native) return;
    native?.getMetaFlag?.({ key: "onboarding-tour-v1" })
      .then((seen) => { if (!seen) setRunTour(true); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to Settings → System when App.js banner triggers an update jump
  useEffect(() => {
    if (!jumpToUpdate) return;
    setActiveMain("settings");
    setActiveSettingsTab("system");
    onJumpToUpdateHandled?.();
  }, [jumpToUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to Billing & Gallery when App.js trial modal triggers a billing
  // jump. Billing is now its own top-level page rather than an Account tab.
  useEffect(() => {
    if (!jumpToBilling) return;
    setActiveMain("subscription");
    onJumpToBillingHandled?.();
  }, [jumpToBilling]); // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = useNavigate();
  const { license, gating, loading: licenseLoading, refreshLicense: ctxRefreshLicense } = useLicense();
  const [accountTab, setAccountTab] = useState("profile");
  const [healthSnapshot, setHealthSnapshot] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [accountForm, setAccountForm] = useState({
    displayName: profile?.full_name || user?.user_metadata?.full_name || user?.email || "",
    email: profile?.email || user?.email || "",
    phone: profile?.phone || "",
    company: profile?.company || "",
    role: profile?.role || "Administrator",
    badgePhoto: profile?.avatar_url || "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  // Account-level only. Booth-level values were removed rather than mirrored
  // here: `language` and `soundEnabled` are booth settings owned by Settings
  // and read by the booth from event/booth settings; `autoLaunch` duplicated
  // Settings → System's launch-on-startup but was never applied to the OS
  // (startup:set does that); `emailNotifications` had no UI and no consumer.
  const [accountPreferences, setAccountPreferences] = useState({
    theme: "system",
    desktopNotifications: true,
  });
  // Prevents the theme effect from applying OS dark mode before the real
  // stored preference is loaded (race: setCurrentUser is fire-and-forget,
  // so getAccountPreferences may read users.null.preferences on first boot).
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [libraryReloading, setLibraryReloading] = useState(false);
  const [galleryQrModal, setGalleryQrModal] = useState(null); // { ev, loading, sessions, error }
  const [sampleFormatFilter, setSampleFormatFilter] = useState("all");
  const [billingCycle, setBillingCycle] = useState("yearly"); // "monthly" | "yearly"
  // Legacy alias so shared UI references still compile
  const accountSaving = profileSaving || passwordSaving || prefsSaving;

  // PayMongo
  const [paymongoConfigured, setPaymongoConfigured] = useState(false);
  const [paymongoTestMode, setPaymongoTestMode] = useState(false);
  const [paymongoPublicKey, setPaymongoPublicKey] = useState("");
  const [paymongoSaving, setPaymongoSaving] = useState(false);
  const [paymongoKeyInputs, setPaymongoKeyInputs] = useState({ publicKey: "", secretKey: "" });
  // Multi-provider payment gateway state
  const [activeProvider, setActiveProvider] = useState(null); // null | "paymongo" | "stripe" | "xendit" | "paypal"
  const [stripeProviders, setStripeProviders] = useState({ ...DEFAULT_STRIPE_PROVIDERS });
  const [xenditProviders, setXenditProviders] = useState({ ...DEFAULT_XENDIT_PROVIDERS });
  const [paypalProviders, setPaypalProviders] = useState({ ...DEFAULT_PAYPAL_PROVIDERS });
  // Stripe connection
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [stripeTestMode, setStripeTestMode] = useState(false);
  const [stripeKeyDisplay, setStripeKeyDisplay] = useState("");
  const [stripeSaving, setStripeSaving] = useState(false);
  const [stripeKeyInputs, setStripeKeyInputs] = useState({ publishableKey: "", secretKey: "" });
  // Xendit connection
  const [xenditConfigured, setXenditConfigured] = useState(false);
  const [xenditTestMode, setXenditTestMode] = useState(false);
  const [xenditKeyDisplay, setXenditKeyDisplay] = useState("");
  const [xenditSaving, setXenditSaving] = useState(false);
  const [xenditKeyInput, setXenditKeyInput] = useState("");
  // PayPal connection
  const [paypalConfigured, setPaypalConfigured] = useState(false);
  const [paypalSandboxMode, setPaypalSandboxMode] = useState(false);
  const [paypalClientIdDisplay, setPaypalClientIdDisplay] = useState("");
  const [paypalSaving, setPaypalSaving] = useState(false);
  const [paypalKeyInputs, setPaypalKeyInputs] = useState({ clientId: "", clientSecret: "" });

  /** State: events, templates, palettes */
  const [events, setEvents] = useState([]);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [frames, setFrames] = useState([]);
  const [tones, setTones] = useState([]);
  const [palettes, setPalettes] = useState([]);

  // === BG COLOR STATE ===========================
  const [isNewBgColorOpen, setIsNewBgColorOpen] = useState(false);
  const [newBgHex, setNewBgHex] = useState("#ffffff");
  const [newBgName, setNewBgName] = useState("");

  const getEffectiveStoragePath = () => storagePath?.trim() || "";

  const PRINT_LAYOUTS = [
    { value: "4x6", label: "4 × 6 Portrait" },
    { value: "6x4", label: "6 × 4 Landscape" },
    { value: "2x6", label: "2 × 6 Strip" },
    { value: "6x2", label: "6 × 2 Strip" },
  ];

  const PRINT_QUALITY_OPTIONS = [
    { value: "draft", label: "Draft" },
    { value: "standard", label: "Standard" },
    { value: "high", label: "High" },
  ];

  const PRINT_COLOR_OPTIONS = [
    { value: "color", label: "Color" },
    { value: "grayscale", label: "Grayscale" },
  ];

  const PRINT_ORIENTATION_OPTIONS = [
    { value: "auto", label: "Auto" },
    { value: "portrait", label: "Portrait" },
    { value: "landscape", label: "Landscape" },
  ];
  const [availablePrinterOptions, setAvailablePrinterOptions] = useState(null);

  const CAMERA_RESOLUTION_OPTIONS = [
    // `short` is used by segmented controls, where the full label will not fit.
    { value: "720p", short: "720p", label: "1280 × 720 (HD)", width: 1280, height: 720 },
    { value: "1080p", short: "1080p", label: "1920 × 1080 (Full HD)", width: 1920, height: 1080 },
    { value: "1440p", short: "1440p", label: "2560 × 1440 (QHD)", width: 2560, height: 1440 },
    { value: "4k", short: "4K", label: "3840 × 2160 (4K)", width: 3840, height: 2160 },
  ];

  const CAMERA_FACING_OPTIONS = [
    // Only user/environment are meaningful. The spec also defines left/right
    // for side-mounted cameras, which no real hardware implements — they could
    // only ever fail the constraint, so they are not offered.
    { value: "user", short: "Front", label: "Front / User" },
    { value: "environment", short: "Rear", label: "Rear / Environment" },
  ];

  const getResolutionMeta = (value) =>
    CAMERA_RESOLUTION_OPTIONS.find((r) => r.value === value) ||
    CAMERA_RESOLUTION_OPTIONS.find((r) => r.value === "1080p");

  // The active bg color to attach to frames when a frame is applied
  const [selectedBgColorId, setSelectedBgColorId] = useState(null);

  // === BG color picker per-frame (popover) =======================
  const [frameColorPickerOpenId, setFrameColorPickerOpenId] = useState(null);

  /** Return array of hex colors from a palette-like record (robust to mixed shapes) */
  function extractHexes(p) {
    if (!p) return [];
    if (Array.isArray(p.colors)) return p.colors.filter(Boolean);
    const single =
      p.value || p.hex || p.color || (typeof p === "string" ? p : null);
    return single ? [single] : [];
  }

  /** Pretty name for palette/color */
  function paletteName(p) {
    return p?.name || (extractHexes(p)[0] ?? "Color");
  }

  const loadAccountCenterData = React.useCallback(async () => {
    if (!user?.id) return;

    try {
      const [meRes, prefRes] = await Promise.all([
        typeof licensingApi.me === "function"
          ? licensingApi.me().catch(() => null)
          : Promise.resolve(null),
        window.electron?.getAccountPreferences?.().catch(() => null),
      ]);

      const resolvedProfile = meRes?.profile || profile || null;
      const resolvedUser = meRes?.user || user;

      setAccountForm((prev) => ({
        ...prev,
        displayName:
          resolvedProfile?.full_name ||
          resolvedUser?.user_metadata?.full_name ||
          resolvedUser?.email ||
          "",
        email: resolvedProfile?.email || resolvedUser?.email || "",
        phone: resolvedProfile?.phone || "",
        role: resolvedProfile?.role || "Administrator",
        company: resolvedProfile?.company || "",
        badgePhoto: resolvedProfile?.avatar_url || "",
      }));

      if (prefRes?.ok && prefRes.preferences) {
        setAccountPreferences((prev) => ({
          ...prev,
          ...prefRes.preferences,
        }));
        // soundEnabled is deliberately NOT applied from account preferences.
        // It is a booth setting owned by Settings → Camera and read by the
        // booth from event/booth settings; pulling it from a second store here
        // let a stale account value silently override the real one.
      }
    } catch (err) {
      console.error("Failed to load account center:", err);
    } finally {
      setPrefsLoaded(true);
    }
  }, [profile, user]);

  // Apply theme to the dashboard root div (not <html>) so dark: variants
  // are scoped to AdminDashboard and never leak into booth screens.
  // Guard with prefsLoaded: on first boot setCurrentUser is fire-and-forget,
  // so getAccountPreferences may return the default "system" before the real
  // stored pref is read. Without the guard, the OS dark-mode state is applied
  // immediately and overrides the user's saved "light" (or other) preference.
  React.useEffect(() => {
    if (!prefsLoaded) return;
    const root = dashboardRef.current;
    if (!root) return;
    const applyTheme = (isDark) => root.classList.toggle("dark", isDark);
    const theme = accountPreferences.theme;
    if (theme === "dark") {
      applyTheme(true);
      return () => root.classList.remove("dark");
    } else if (theme === "light") {
      applyTheme(false);
      return () => root.classList.remove("dark");
    } else {
      // system — follow OS preference
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches);
      const handler = (e) => applyTheme(e.matches);
      mq.addEventListener("change", handler);
      return () => {
        mq.removeEventListener("change", handler);
        root.classList.remove("dark");
      };
    }
  }, [accountPreferences.theme, prefsLoaded]);

  /** Appearance */
  const [headerFont, setHeaderFont] = useState("Inter");
  const [generalFont, setGeneralFont] = useState("Inter");
  const [headerFontColor, setHeaderFontColor] = useState("#111827");
  const [generalFontColor, setGeneralFontColor] = useState("#374151");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [logoPath, setLogoPath] = useState(null); // {url, name, previewUrl?}
  const [logoSize, setLogoSize] = useState(100); // 40–200 %
  const [backgroundMediaPath, setBackgroundMediaPath] = useState(null); // {url, name, previewUrl?}
  const [backgroundType, setBackgroundType] = useState("media"); // "media" | "camera"
  const [boothName, setBoothName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [boothSlogan, setBoothSlogan] = useState("");

  /** Button theming */
  const [buttonBgColor, setButtonBgColor] = useState(ACCENT_COLOR);
  const [buttonHoverColor, setButtonHoverColor] = useState("#5348ff");
  const [buttonFont, setbuttonFont] = useState("Inter");
  const [buttonFontColor, setButtonFontColor] = useState("#ffffff");

  // NEW: Start button options
  const [startButtonHidden, setStartButtonHidden] = useState(false);
  const [startButtonText, setStartButtonText] = useState("Tap to Start");

  /** Session settings */
  const [countdown, setCountdown] = useState(5);
  const [screenTimers, setScreenTimers] = useState(DEFAULT_SCREEN_TIMERS);
  const [timersEnabled, setTimersEnabled] = useState(false);
  const [consentEnabled, setConsentEnabled] = useState(true);
  const [storageChoiceEnabled, setStorageChoiceEnabled] = useState(false);
  const [galleryOptionDisabled, setGalleryOptionDisabled] = useState(false);
  const [operatorStorageEnabled, setOperatorStorageEnabled] = useState(false);
  const [cloudGoogleStatus, setCloudGoogleStatus] = useState({ connected: false, email: null, loading: false });
  const [cloudDropboxStatus, setCloudDropboxStatus] = useState({ connected: false, email: null, loading: false });
  const [operatorStorageLabel, setOperatorStorageLabel] = useState("Our Storage");
  const [operatorStorageUrl, setOperatorStorageUrl] = useState("");
  const [operatorStorageApiKey, setOperatorStorageApiKey] = useState("");
  const [numberOfShots, setNumberOfShots] = useState(3);
  const [retakeLimit, setRetakeLimit] = useState(0);

  /** Features */
  const [flashEnabled, setFlashEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [language, setLanguage] = useState("en");
  const [price, setPrice] = useState(0); // legacy/global default

  /** Booth identity */
  const [boothIdentityName, setBoothIdentityName] = useState("");
  const [boothLocation, setBoothLocation] = useState("");
  const [operatorName, setOperatorName] = useState("");

  // --- Map Admin names/ids to FrameFilterScreen constants ---
  function mapFrameNameToStyleId(name = "") {
    const k = String(name).trim().toLowerCase();
    if (k === "white") return "white";
    if (k === "black") return "black";
    if (k === "gold") return "gold";
    if (k === "silver") return "silver";
    if (k === "bronze") return "bronze";
    if (k === "pink") return "pink";
    if (k === "purple") return "purple";
    if (k === "pastel pink") return "pastel-pink";
    if (k === "pastel blue") return "pastel-blue";
    if (k === "pastel green") return "pastel-green";
    return null; // unknown graphic frame name -> no color style gate
  }

  function mapToneToEffectId(tone) {
    switch (tone?.id) {
      case "pb-blackwhite": return "bw";
      case "pb-vintage":    return "vintage";
      case "pb-warm":       return "warm";
      case "pb-cool":       return "cool";
      case "pb-bright":
      case "pb-vivid":      return "vivid";
      case "pb-party":      return "party";
      case "pb-soft":       return "soft";
      case "pb-dreamy":     return "dreamy";
      case "pb-drama":      return "drama";
      case "pb-film":       return "film";
      case "pb-sepia":      return "sepia";
      case "pb-normal":     return "normal";
      default: {
        const k = String(tone?.name || "").trim().toLowerCase();
        if (k.includes("black") && k.includes("white")) return "bw";
        if (k.includes("vintage"))  return "vintage";
        if (k.includes("warm"))     return "warm";
        if (k.includes("cool"))     return "cool";
        if (k.includes("sepia"))    return "sepia";
        if (k.includes("vivid") || k.includes("bright")) return "vivid";
        if (k.includes("party"))    return "party";
        if (k.includes("soft"))     return "soft";
        if (k.includes("dreamy"))   return "dreamy";
        if (k.includes("drama"))    return "drama";
        if (k.includes("film"))     return "film";
        return null;
      }
    }
  }

  // === SIDEBAR RESPONSIVE STATE ==============================
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dashboardRef = React.useRef(null);

  // === CAMERA STATE ==========================================
  // (was lower in the file; move it up to the other useState blocks)
  const [cameraList, setCameraList] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [mirrorCamera, setMirrorCamera] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraStatusText, setCameraStatusText] = useState("Not checked");
  const [cameraOnline, setCameraOnline] = useState(false);
  const [cameraCapabilities, setCameraCapabilities] = useState(null);
  const [cameraError, setCameraError] = useState("");

  // === PRINTER STATE ==========================================
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [paperSize, setPaperSize] = useState("4x6");
  const [printCopies, setPrintCopies] = useState(1);
  const [printColorMode, setPrintColorMode] = useState("color");
  const [printQuality, setPrintQuality] = useState("high");
  const [printOrientation, setPrintOrientation] = useState("landscape");
  const [printDuplexMode, setPrintDuplexMode] = useState("simplex");
  const [printDpi, setPrintDpi] = useState(300);

  const [printerOnline, setPrinterOnline] = useState(false);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerStatusText, setPrinterStatusText] = useState("Not checked");
  const [printerCapabilities, setPrinterCapabilities] = useState(null);
  const [printerError, setPrinterError] = useState("");

  const [printerSystemLayout, setPrinterSystemLayout] = useState("Unknown");
  const [printerSystemOrientation, setPrinterSystemOrientation] = useState("Unknown");
  const [usePrinterDefaults, setUsePrinterDefaults] = useState(false);

  // -------------------- States --------------------
  const [cameraResolution, setCameraResolution] = useState("1080p");
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [paperSizeOptions, setPaperSizeOptions] = useState(CUSTOM_PAPER_SIZE_OPTIONS);

  // frame settings

  const handleThumb25Upload = async ({ frameId, file }) => {
    const err = validateImage(file);
    if (err) {
      notify(showToast, err);
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      const thumb25DataUrl = await to25x25(dataUrl);

      const updatedFrames = frames.map((fr) => {
        if (fr.id !== frameId) return fr;
        return {
          ...fr,
          thumbnail25: {
            thumb25DataUrl,
            fileName: file.name,
            updatedAt: new Date().toISOString()
          },
          // If other parts of the app still read `previewMeta.thumbnailDataUrl`,
          // optionally mirror it here, otherwise omit previewMeta entirely.
          // previewMeta: { thumbnailDataUrl: thumb25DataUrl }
        };
      });

      await persistAll({ nextFrames: updatedFrames });
      notify(showToast, "25×25 thumbnail updated.");
    } catch (e) {
      console.error(e);
      notify(showToast, "Failed to create 25×25 thumbnail.");
    }
  };


  const handleLayoutUpload = async ({ frameId, layout, file }) => {
    const err = validateImage(file);
    if (err) {
      notify(showToast, err);
      return;
    }

    try {
      const originalDataUrl = await fileToDataUrl(file);

      const nextFrames = frames.map((fr) => {
        if (fr.id !== frameId) return fr;

        return {
          ...fr,
          previews: {
            ...(fr.previews || {}),
            [layout]: {
              ...(fr.previews?.[layout] || {}),
              originalDataUrl,
              fileName: file.name,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });

      await persistAll({ nextFrames });
      notify(showToast, `Uploaded ${layout.toUpperCase()} layout.`);
    } catch (e) {
      console.error(e);
      notify(showToast, "Failed to process layout image.");
    }
  };

  // Remove a specific layout preview from a frame
  async function handleLayoutRemove({ frameId, layout }) {
    try {
      const next = frames.map((f) => {
        if (f.id !== frameId) return f;
        const nextPreviews = { ...(f.previews || {}) };
        delete nextPreviews[layout];
        return { ...f, previews: nextPreviews };
      });

      await persistAll({ nextFrames: next });
      notify(showToast, `Removed ${layout.toUpperCase()} overlay from frame`);
    } catch (err) {
      console.error("handleLayoutRemove failed:", err);
      notify(showToast, "Failed to remove overlay. Please try again.");
    }
  }

  // file -> DataURL
  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Create a 25x25 square thumbnail (center-cropped)
  const to25x25 = (dataUrl) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const size = 25;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        const sw = img.naturalWidth;
        const sh = img.naturalHeight;
        const side = Math.min(sw, sh);
        const sx = (sw - side) / 2;
        const sy = (sh - side) / 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });

  // Add near the other helpers (e.g., under validateImage)
  function suggestLayoutFromWH(w, h) {
    const targets = [
      { id: "4x6", ratio: 2 / 3 }, // portrait
      { id: "2x6", ratio: 1 / 3 }, // portrait strip
      { id: "6x4", ratio: 3 / 2 }, // landscape
      { id: "6x2", ratio: 3 / 1 }, // landscape strip
    ];
    const r = w / h;
    let best = targets[0], diff = Infinity;
    for (const t of targets) {
      const d = Math.abs(r - t.ratio);
      if (d < diff) { best = t; diff = d; }
    }
    return best.id; // "4x6" | "2x6" | "6x4" | "6x2"
  }

  async function readImageWH(file) {
    const dataUrl = await fileToDataUrl(file); // you already have this helper
    const img = new Image();
    img.crossOrigin = "anonymous";
    return await new Promise((resolve, reject) => {
      img.onload = () => resolve({ dataUrl, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  const validateImage = (file) => {
    if (!file) return "No file selected.";
    const okTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!okTypes.includes(file.type)) return "Unsupported file type.";
    const maxMB = 5;
    if (file.size > maxMB * 1024 * 1024) return `File too large (max ${maxMB}MB).`;
    return null;
  };

  /** Modes */
  const DEFAULT_APP_MODE = "rental";
  const DEFAULT_RENTAL = {
    timerEnabled: false,
    timerHours: 2,
    sessionLimitEnabled: false,
    sessionLimit: 100,
    offlineModeEnabled: false,
    autoSaveTarget: "local", // "local" | "usb" | "cloud"
    endSessionSummaryEnabled: true,
  };
  const DEFAULT_BUSINESS = {
    activeProvider: null, // "paymongo" | "stripe" | "xendit" | "paypal"
    paymentEnabled: true,
    payment: {
      providers: { gcash: true, maya: false, grabpay: false, card: false, cash: true },
      stripeProviders: { ...DEFAULT_STRIPE_PROVIDERS },
      xenditProviders: { ...DEFAULT_XENDIT_PROVIDERS },
      paypalProviders: { ...DEFAULT_PAYPAL_PROVIDERS },
      cashMode: "manual", // "manual" | "hardware"
      gcashStaticQrDataUrl: "",
    },
    pricing: {
      model: "perSession", // "perSession" | "perPhoto"
      pricePerSession: 0,
      additionalPrintPrice: 0,
      currency: "PHP",
      taxEnabled: false,
      taxRate: 0,
    },
  };

  const DEFAULT_APPEARANCE = {
    headerFont: "Inter",
    generalFont: "Inter",
    headerFontColor: "#111827",
    generalFontColor: "#374151",
    bgColor: "#ffffff",
    logoPath: null,
    backgroundMediaPath: null,
    backgroundType: "media",
    boothName: "",
    boothSlogan: "",
    contactEmail: "",
    buttonBgColor: ACCENT_COLOR,
    buttonHoverColor: "#5348ff",
    buttonFont: "Inter",
    buttonFontColor: "#ffffff",
    startButtonHidden: false,
    startButtonText: "Tap to Start",
  };

  const normalizeCameraList = (list) => {
    if (!Array.isArray(list)) return [];
    return list
      .filter(Boolean)
      .map((d, index) => ({
        id: d.id || d.deviceId || `camera-${index}`,
        label: d.label || d.name || `Camera ${index + 1}`,
        kind: d.kind || "videoinput",
        facingMode: d.facingMode || null,
      }));
  };

  const refreshCameras = async () => {
    setCameraLoading(true);
    setCameraError("");

    if (!native) {
      setCameraList([]);
      setSelectedCameraId("");
      setCameraOnline(false);
      setCameraStatusText("Camera access requires the Photuna desktop app");
      setCameraError("Cameras can only be accessed from the Photuna desktop app. Open the app on your booth computer to configure the camera.");
      setCameraLoading(false);
      return;
    }

    try {
      const devices = (await native?.listCameras?.()) ?? [];
      const normalized = normalizeCameraList(devices);

      setCameraList(normalized);

      if (!normalized.length) {
        setSelectedCameraId("");
        setCameraOnline(false);
        setCameraStatusText("No cameras detected");
        showToast("No cameras found");
        return;
      }

      const saved = (() => {
        try {
          return JSON.parse(localStorage.getItem("boothSettings") || "{}");
        } catch {
          return {};
        }
      })();

      const currentStillExists = normalized.some((d) => d.id === selectedCameraId);
      const savedCameraId = saved.selectedCameraId ?? "";
      const savedStillExists = normalized.some((d) => d.id === savedCameraId);

      let nextCameraId = "";

      if (currentStillExists) {
        nextCameraId = selectedCameraId;
      } else if (savedStillExists) {
        nextCameraId = savedCameraId;
      } else {
        nextCameraId = normalized[0]?.id ?? "";
      }

      if (nextCameraId !== selectedCameraId) {
        setSelectedCameraId(nextCameraId);
      }

      if (currentStillExists) {
        setCameraStatusText("Camera list refreshed");
      } else if (savedStillExists) {
        setCameraStatusText("Restored saved camera");
      } else {
        setCameraStatusText("Camera changed to first available device");
      }

      setCameraOnline(true);
    } catch (e) {
      console.warn("listCameras failed", e);
      setCameraList([]);
      setSelectedCameraId("");
      setCameraOnline(false);
      setCameraStatusText("Unable to load cameras");
      setCameraError(e?.message || "Unable to load cameras from the native bridge."); // FIX 3: surface native bridge failure inline in settings UI.
      showToast("Failed to load cameras");
    } finally {
      setCameraLoading(false);
    }
  };

  const loadCameraCapabilities = async (cameraId) => {
    if (!cameraId) {
      setCameraCapabilities(null);
      setCameraOnline(false);
      setCameraStatusText("No camera selected");
      return;
    }

    try {
      const caps = await native?.getCameraCapabilities?.(cameraId);

      if (caps) {
        setCameraCapabilities(caps);
        setCameraOnline(true);
        setCameraStatusText("Camera ready");
        return;
      }

      setCameraCapabilities(null);
      setCameraOnline(true);
      setCameraStatusText("Camera selected");
    } catch (err) {
      console.warn("getCameraCapabilities failed", err);
      setCameraCapabilities(null);
      setCameraOnline(false);
      setCameraStatusText("Unable to read camera capabilities");
    }
  };

  useEffect(() => {
    setAccountForm((prev) => ({
      ...prev,
      displayName:
        prev.displayName ||
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        user?.email ||
        "",
      email: prev.email || profile?.email || user?.email || "",
      phone: prev.phone || profile?.phone || "",
      company: prev.company || profile?.company || "",
      role: prev.role || profile?.role || "Administrator",
      badgePhoto: prev.badgePhoto || profile?.avatar_url || "",
    }));
  }, [
    profile?.full_name,
    profile?.email,
    profile?.phone,
    profile?.company,
    profile?.role,
    profile?.avatar_url,
    user?.email,
    user?.user_metadata?.full_name,
  ]);

  useEffect(() => {
    if (!window.electron?.onUpdaterStatus) return;

    const STICKY_STATES = new Set(["downloaded", "ready"]);

    const unsubscribe = window.electron.onUpdaterStatus((payload) => {
      const incoming = payload.status || "idle";

      setUpdateState((prev) => {
        if (STICKY_STATES.has(prev)) return prev;
        if (STICKY_STATES.has(incoming)) return "downloaded";
        return incoming;
      });

      if (STICKY_STATES.has(incoming)) {
        setUpdateStatusText(payload.message || "Update downloaded. Ready to install.");
      } else {
        setUpdateStatusText(payload.message || "Updater status changed");
      }

      if (incoming === "downloading") {
        setUpdatePercent(Math.round(payload.percent || 0));
      }
    });

    return unsubscribe;
  }, []);

  const checkForUpdates = async () => {
    if (updateStateRef.current === "downloaded") return;
    setUpdateState("checking");
    setUpdateStatusText("Checking for updates...");
    try {
      const result = await window.electron.invoke("app:check-updates");
      if (updateStateRef.current === "downloaded") return;
      if (!result?.ok) {
        setUpdateState("idle");
        setUpdateStatusText(result?.error || "Failed to check for updates");
        showToast?.(result?.error || "Update check failed");
        return;
      }
      if (result.hasUpdate) {
        if (updateStateRef.current !== "downloaded") setUpdateState("available");
        setUpdateStatusText(`Update ${result.version} available`);
        showToast?.(`Update ${result.version} is available`);
      } else {
        if (updateStateRef.current !== "downloaded") setUpdateState("idle");
        setUpdateStatusText(`You're on the latest version (${result.version})`);
        showToast?.("No updates available");
      }
    } catch (err) {
      if (updateStateRef.current !== "downloaded") setUpdateState("idle");
      setUpdateStatusText(err?.message || "Update check failed");
      showToast?.("Update check failed");
    }
  };

  const downloadUpdate = async () => {
    setUpdateState((prev) => prev === "downloaded" ? prev : "downloading");
    setUpdateStatusText("Downloading update...");
    setUpdatePercent(0);
    try {
      const result = await window.electron.invoke("app:download-update");
      if (!result?.ok) {
        setUpdateState((prev) => prev === "downloaded" ? prev : "available");
        setUpdateStatusText(result?.error || "Download failed");
        showToast?.(result?.error || "Download failed");
      }
    } catch (err) {
      setUpdateState((prev) => prev === "downloaded" ? prev : "available");
      setUpdateStatusText("Download failed");
    }
  };

  const installUpdate = async () => {
    setUpdateStatusText("Installing update and restarting...");
    const result = await window.electron.invoke("app:install-update");
    if (!result?.ok) {
      setUpdateStatusText(result?.error || "Install failed");
    }
  };

  const clearCache = async () => {
    try {
      const result = await safeInvoke("app:clear-cache");

      if (!result) {
        setCacheStatusText("Cache clearing is unavailable");
        showToast("Cache clearing is unavailable");
        return;
      }

      if (result.ok === false) {
        setCacheStatusText(result.error || "Failed to clear cache");
        showToast(result.error || "Failed to clear cache");
        return;
      }

      setCacheStatusText(result.message || "Cache cleared");
      showToast(result.message || "Cache cleared");
    } catch (err) {
      console.error("clearCache failed", err);
      setCacheStatusText("Failed to clear cache");
      showToast("Failed to clear cache");
    }
  };

  const deleteStoredPhotos = async () => {
    const targetPath = getEffectiveStoragePath();

    if (!targetPath) {
      setStorageStatusText("No storage folder selected");
      showToast("Select a storage folder first");
      return;
    }

    const confirmed = window.confirm?.(
      `Delete all stored photos in:
${targetPath}

This cannot be undone.`
    );

    if (confirmed === false) return;

    setStorageLoading(true);

    try {
      const attempts = [
        () => safeInvoke("storage:delete-all", targetPath),
        () => safeInvoke("storage:delete-all", { path: targetPath }),
        () =>
          safeInvoke("storage:cleanup", {
            path: targetPath,
            autoDeleteDays: 0,
            deleteAll: true,
          }),
        () => native?.deleteStoredPhotos?.({ path: targetPath, userId: identity?.userId }),
        () => native?.deleteStoredPhotos?.(targetPath),
      ];

      let result = null;

      for (const attempt of attempts) {
        try {
          result = await attempt();
          if (result) break;
        } catch (err) {
          console.warn("deleteStoredPhotos attempt failed", err);
        }
      }

      if (!result) {
        setStorageStatusText("Delete stored photos is unavailable");
        showToast("Delete stored photos is unavailable");
        return;
      }

      if (result.ok === false) {
        setStorageStatusText(result.error || "Failed to delete stored photos");
        showToast(result.error || "Failed to delete stored photos");
        return;
      }

      setStorageStatusText(result.message || "Stored photos deleted");
      showToast(result.message || "Stored photos deleted");
      await loadStorageInfo(targetPath);
    } catch (err) {
      console.error("deleteStoredPhotos failed", err);
      setStorageStatusText("Failed to delete stored photos");
      showToast("Failed to delete stored photos");
    } finally {
      setStorageLoading(false);
    }
  };

  const openHelpArticle = (articleKey) => {
    const articles = {
      docs: {
        title: "Help Center",
        sections: [
          "Use Getting Started for first-time setup, Template Editor for layout adjustments, and Payments when the booth is running in business mode.",
          "To make changes that affect the live booth flow, open an event first and save the event after updating its dashboard tabs.",
          "For hardware-related issues, use the Settings area to refresh devices, run checks, and save the final configuration.",
        ],
      },
      gettingStarted: {
        title: "Getting Started",
        sections: [
          "1. Create or open an event from the Events page.",
          "2. Go to Dashboard > Branding to set booth name, logo, welcome text, and background media.",
          "3. Open Dashboard > Controls to configure countdown, number of shots, retakes, timers, and sharing behavior.",
          "4. Go to Settings to select the camera, printer, storage path, and general booth behavior, then click Save settings.",
          "5. Run a test session before going live so you can confirm camera, template, printer, and storage output are all working together.",
        ],
      },
      templateEditor: {
        title: "Template Editor",
        sections: [
          "Open an event first, then go to Dashboard > Templates.",
          "Create or edit a template to drag, resize, rotate, and align photo slots for each print layout.",
          "Save the template, apply it to the event, and run a preview or test print to verify slot positions before production use.",
        ],
      },
      payments: {
        title: "Payments",
        sections: [
          "Payment options are configured per event when the booth is using Business mode.",
          "Open an event, go to Dashboard > Analytics, enable payment, then choose the methods you want such as GCash, PayPal, Stripe, or Cash.",
          "Set the session price and any additional print price, then save the event so the payment flow uses the updated values.",
        ],
      },
    };

    setHelpArticle(articles[articleKey] || articles.docs);
  };

  const openAllDocs = () => {
    openHelpArticle("docs");
  };

  const openGettingStartedGuide = () => {
    openHelpArticle("gettingStarted");
  };

  const openTemplateEditorGuide = () => {
    if (currentEvent) {
      setActiveMain("dashboard");
      setActiveSub("templates");
      showToast(`Opened Templates for ${currentEvent.name || "current event"}`);
      return;
    }

    openHelpArticle("templateEditor");
    showToast("Create or open an event to use the template editor");
  };

  const openPaymentsGuide = () => {
    if (currentEvent) {
      setActiveMain("dashboard");
      setActiveSub("analytics");
      showToast(`Opened Analytics for ${currentEvent.name || "current event"}`);
      return;
    }

    openHelpArticle("payments");
    showToast("Create or open an event to configure payments");
  };

  const resetSettingsToDefault = async () => {
    setSelectedCameraId(cameraList[0]?.id || "");
    setCameraResolution("1080p");
    setMirrorCamera(false);
    setFlashEnabled(true);
    setSoundEnabled(true);

    const defaultPrinter = printers.find((p) => p.isDefault) || printers[0] || null;
    setSelectedPrinter(defaultPrinter?.name || "");
    setPaperSize("4x6");
    setPrintCopies(1);
    setPrintColorMode("color");
    setPrintQuality("high");
    setPrintOrientation("landscape");

    setStoragePath("");
    setAutoDeleteDays(14);

    setDimWhenIdle(true);
    setIdleTimeout(60);

    setLaunchOnStartup(true);
    setAutoRestart(true);

    setLanguage("en");
    setAutoUpdateEnabled(true);

    setBoothIdentityName("");
    setBoothLocation("");
    setOperatorName("");

    setPrinterOnline(false);
    setPrinterStatusText("Not checked");
    setPrinterCapabilities(null);
    setUsePrinterDefaults(false);
    setPrintDuplexMode("simplex");
    setPrintDpi(300);
    setPrinterSystemLayout("Unknown");
    setPrinterSystemOrientation("Unknown");

    await saveSettings();
    showToast("Settings reset to default");
  };

  const prices = {
    currency: "PHP",
    monthly: { display: "₱1,800 / mo", amount: 1800 },
    yearly: { display: "₱950 / mo", amount: 950, annualAmount: 11400, annual: "₱11,400", monthlyEquivalent: "₱950/mo" },
  };

  const [appMode, setAppMode] = useState(DEFAULT_APP_MODE);
  // Rental
  const [rentalTimerEnabled, setRentalTimerEnabled] = useState(DEFAULT_RENTAL.timerEnabled);
  const [rentalTimerHours, setRentalTimerHours] = useState(DEFAULT_RENTAL.timerHours);
  const [rentalSessionLimitEnabled, setRentalSessionLimitEnabled] = useState(DEFAULT_RENTAL.sessionLimitEnabled);
  const [rentalSessionLimit, setRentalSessionLimit] = useState(DEFAULT_RENTAL.sessionLimit);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(DEFAULT_RENTAL.offlineModeEnabled);
  const [autoSaveTarget, setAutoSaveTarget] = useState(DEFAULT_RENTAL.autoSaveTarget);
  const [endSessionSummaryEnabled, setEndSessionSummaryEnabled] = useState(DEFAULT_RENTAL.endSessionSummaryEnabled);
  // Business
  const [paymentEnabled, setPaymentEnabled] = useState(DEFAULT_BUSINESS.paymentEnabled);
  const [paymentProviders, setPaymentProviders] = useState({ ...DEFAULT_BUSINESS.payment.providers });
  const [cashMode, setCashMode] = useState("manual"); // "manual" | "hardware"
  const [cashHardwareDetected, setCashHardwareDetected] = useState(false);
  const [cashHardwareDetecting, setCashHardwareDetecting] = useState(false);
  const [cashHardwareDevices, setCashHardwareDevices] = useState([]);
  const [gcashStaticQrDataUrl, setGcashStaticQrDataUrl] = useState("");
  const [pricingModel, setPricingModel] = useState(DEFAULT_BUSINESS.pricing.model);
  const [pricePerSession, setPricePerSession] = useState(DEFAULT_BUSINESS.pricing.pricePerSession);
  const [additionalPrintPrice, setAdditionalPrintPrice] = useState(DEFAULT_BUSINESS.pricing.additionalPrintPrice);
  const [currency, setCurrency] = useState(DEFAULT_BUSINESS.pricing.currency);
  const [taxEnabled, setTaxEnabled] = useState(DEFAULT_BUSINESS.pricing.taxEnabled);
  const [taxRate, setTaxRate] = useState(DEFAULT_BUSINESS.pricing.taxRate);
  const [msg, setMsg] = useState("");

  /** New event state */
  const [newEventName, setNewEventName] = useState("");
  const [newEventNotes, setNewEventNotes] = useState("");
  // Off = start blank. When on, copyDesignFromEventId names the event whose
  // applied templates, frames and tones are copied into the new event. Only
  // the applied selections are copied — the template/frame libraries stay
  // global and the source event is never modified.
  const [copyDesignEnabled, setCopyDesignEnabled] = useState(false);
  const [copyDesignFromEventId, setCopyDesignFromEventId] = useState("");

  const getTemplateSlotCount = (tpl) =>
    tpl.previewMeta?.slots?.length ?? 0;

  // "applied" shows only what this event uses; "all" shows the shared library.
  // Defaults to "applied" so a new event reads as empty instead of listing the
  // whole library, which is shared across every event.
  const [templateViewMode, setTemplateViewMode] = useState("applied");
  const [frameViewMode, setFrameViewMode] = useState("applied");

  // Reset to "applied" only when a DIFFERENT event is opened — keyed on the id,
  // not on currentEvent. Applying a template or frame replaces the currentEvent
  // object, so keying this on the object snapped the tab back to "applied" after
  // every apply and forced the operator to re-open Library for each one.
  useEffect(() => {
    setTemplateViewMode("applied");
    setFrameViewMode("applied");
  }, [currentEvent?.id]);

  /** Template editor state */
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isFrameModalOpen, setIsFrameModalOpen] = useState(false);
  const [isToneModalOpen, setIsToneModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [editingFrame, setEditingFrame] = useState(null);
  const [editingTone, setEditingTone] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const [templateSlotsState, setTemplateSlotsState] = useState([]); // [{id,slotNumber,x,y,w,h,rotation}]
  const [templateError, setTemplateError] = useState("");
  const [thumbnailUploadPreview, setThumbnailUploadPreview] = useState(null);
  const [addTemplateToScreen, setAddTemplateToScreen] = useState(false);

  // State for new frame modal
  const [isNewFrameOpen, setIsNewFrameOpen] = useState(false);
  const [newFrameName, setNewFrameName] = useState("");

  // Add in top-level state (Frames section scope is OK; keep near isNewFrameOpen)
  const [isCreateFrameOpen, setIsCreateFrameOpen] = useState(false);
  const [createFrameName, setCreateFrameName] = useState("");
  const [createDraft, setCreateDraft] = useState({
    file: null, dataUrl: null, w: 0, h: 0, layout: "4x6", error: ""
  });

  // At the top of your component:
  const [editingFrameId, setEditingFrameId] = useState(null);
  const [editingName, setEditingName] = useState("");

  // Photo-lab strip profile management (DNP + HiTi)
  const [cutScanning, setCutScanning] = useState(false);
  const [cutPrinters, setCutPrinters] = useState([]);
  const [cutAllPrinters, setCutAllPrinters] = useState([]);
  const [cutScanError, setCutScanError] = useState("");
  const [cutScanned, setCutScanned] = useState(false);
  const [cutCreating, setCutCreating] = useState(null); // printerName being created
  const [cutModeApplied, setCutModeApplied] = useState({}); // { [printerName]: true } when SetPrinter succeeded
  const [cutNeedsSave, setCutNeedsSave] = useState({}); // { [printerName]: true } when DS-RX1 Printing Preferences not yet saved

  // helper: choose proper frame preview given layout
  const getFramePreviewForLayout = (frame, layout) =>
    frame?.previews?.[layout]?.originalDataUrl ??
    frame?.previews?.["4x6"]?.originalDataUrl ?? // fallback
    null;

  // Helper for IDs
  const persistFrames = async (nextFrames) => {
    setFrames(nextFrames);
    try {
      await native?.setFrames?.(nextFrames, ctx);
    } catch { }
    return nextFrames;
  };

  const persistEvents = async (nextEvents) => {
    setEvents(nextEvents);
    syncCurrentEventFromEvents(nextEvents);

    if (currentEvent?.id && !nextEvents.some((e) => e.id === currentEvent.id)) {
      setActiveMain("events");
    }

    try {
      await native?.setEvents?.(nextEvents, ctx);
    } catch { }
    return nextEvents;
  };

  const syncCurrentEventFromEvents = React.useCallback((nextEvents) => {
    if (!currentEvent?.id) return;
    const freshCurrent = nextEvents.find((e) => e.id === currentEvent.id) || null;
    setCurrentEvent(freshCurrent ? JSON.parse(JSON.stringify(freshCurrent)) : null);
  }, [currentEvent?.id]);

  const persistTemplates = async (nextTemplates) => {
    setTemplates(nextTemplates);
    try {
      await native?.setTemplates?.(nextTemplates, ctx);
    } catch { }
    return nextTemplates;
  };

  const persistPalettes = async (nextPalettes) => {
    setPalettes(nextPalettes);
    try {
      await native?.setPalettes?.(nextPalettes, ctx);
    } catch { }
    return nextPalettes;
  };

  const persistAll = async ({
    nextEvents = null,
    nextTemplates = null,
    nextFrames = null,
    nextPalettes = null,
  } = {}) => {
    if (nextTemplates) {
      setTemplates(nextTemplates);
      try { await native?.setTemplates?.(nextTemplates, ctx); } catch { }
    }

    if (nextFrames) {
      setFrames(nextFrames);
      try { await native?.setFrames?.(nextFrames, ctx); } catch { }
    }

    if (nextPalettes) {
      setPalettes(nextPalettes);
      try { await native?.setPalettes?.(nextPalettes, ctx); } catch { }
    }

    if (nextEvents) {
      setEvents(nextEvents);
      syncCurrentEventFromEvents(nextEvents);
      try { await native?.setEvents?.(nextEvents, ctx); } catch { }
    }

    // Debounced push to Supabase booth_settings table
    pushSettings({
      ...(nextEvents && { events: nextEvents }),
      ...(nextTemplates && { templates: nextTemplates }),
      ...(nextFrames && { frames: nextFrames }),
      ...(nextPalettes && { palettes: nextPalettes }),
    });
  };


  // ── Photo-lab printer cut-mode scan handler ───────────────────────────────
  const handleCutScan = async () => {
    setCutScanning(true);
    setCutScanError("");
    setCutScanned(false);
    try {
      const res = await safeInvoke("printer:dnpScan");
      if (res?.ok) {
        setCutPrinters(res.printers ?? []);
        setCutAllPrinters(res.allPrinters ?? []);
      } else {
        setCutScanError(res?.error ?? "Scan failed — ensure you are running on Windows.");
        setCutPrinters([]);
        setCutAllPrinters([]);
      }
    } catch (err) {
      setCutScanError(err?.message ?? "Unknown error during scan.");
      setCutPrinters([]);
      setCutAllPrinters([]);
    } finally {
      setCutScanning(false);
      setCutScanned(true);
    }
  };

  const handleCreateStripProfile = async (printerName) => {
    setCutCreating(printerName);
    try {
      const res = await (window.api?.createStripProfile
        ? window.api.createStripProfile(printerName)
        : safeInvoke("printer:createStripProfile", printerName));
      if (res?.ok) {
        if (res.cutModeApplied) {
          setCutModeApplied((prev) => ({ ...prev, [printerName]: true }));
        }
        if (res.needsManualSetup) {
          setCutNeedsSave((prev) => ({ ...prev, [printerName]: true }));
        }
        // Re-scan to reflect the new profile
        const scanRes = await safeInvoke("printer:dnpScan");
        if (scanRes?.ok) {
          setCutPrinters(scanRes.printers ?? []);
          setCutAllPrinters(scanRes.allPrinters ?? []);
        }
      } else {
        setCutScanError(res?.error ?? "Failed to create STRIP profile.");
      }
    } catch (err) {
      setCutScanError(err?.message ?? "Unknown error creating STRIP profile.");
    } finally {
      setCutCreating(null);
    }
  };

  const handleSaveStripDevmode = async (printerName, stripProfileName) => {
    try {
      const res = await (window.api?.saveStripDevmode
        ? window.api.saveStripDevmode(stripProfileName, printerName)
        : safeInvoke("printer:saveStripDevmode", { stripProfileName, printerKey: printerName }));
      if (res?.ok) {
        setCutModeApplied((prev) => ({ ...prev, [printerName]: true }));
        setCutNeedsSave((prev) => { const n = { ...prev }; delete n[printerName]; return n; });
      } else if (res?.error === "no_user_devmode") {
        alert("The Printing Preferences window should still be open.\nSet 2inch cut to Enable and click OK, then try again.");
      } else {
        alert("Could not save the setting. Make sure you clicked OK in the Printing Preferences window first.");
      }
    } catch (err) {
      alert("Error saving setting: " + err.message);
    }
  };

  const handleSetCutMode = async (printerName, propertyName, value) => {
    try {
      const res = await safeInvoke("printer:setCutMode", { printerName, propertyName, value });
      if (res?.ok) {
        showToast("Cut mode updated — restart the print spooler if the change doesn't take effect immediately.");
        await handleCutScan(); // refresh
      } else {
        showToast(`Failed to set cut mode: ${res?.error ?? "unknown error"}`);
      }
    } catch (err) {
      showToast(`Error: ${err?.message}`);
    }
  };

  // ── Sample layout handlers ────────────────────────────────────────────────
  const handleAddSampleTemplate = async (tpl) => {
    if (templates.some(t => t.id === tpl.id)) {
      showToast(`"${tpl.name}" is already in your library`);
      return;
    }
    if (Number.isFinite(templateLimit) && templateLimit > 0 && templates.length >= templateLimit) {
      showToast(`Template limit reached (${templateLimit}). Upgrade your plan for more templates.`);
      return;
    }
    const nextTemplates = [tpl, ...templates];
    setTemplates(nextTemplates);
    await persistAll({ nextTemplates });
    showToast(`"${tpl.name}" added to your library`);
  };

  const handleApplySampleTemplate = async (tpl) => {
    if (!currentEvent) return;
    let nextTemplates = templates;
    if (!templates.some(t => t.id === tpl.id)) {
      if (Number.isFinite(templateLimit) && templateLimit > 0 && templates.length >= templateLimit) {
        showToast(`Template limit reached (${templateLimit}). Upgrade your plan for more templates.`);
        return;
      }
      nextTemplates = [tpl, ...templates];
      setTemplates(nextTemplates);
      await persistAll({ nextTemplates });
    }
    if (currentEvent?.appliedTemplates?.some(t => t.id === tpl.id)) {
      showToast(`"${tpl.name}" is already applied to ${currentEvent.name}`);
      return;
    }
    const evCopy = JSON.parse(JSON.stringify(currentEvent));
    evCopy.appliedTemplates = evCopy.appliedTemplates ?? [];
    evCopy.appliedTemplates.push({ id: tpl.id, name: tpl.name, previewMeta: tpl.previewMeta ?? null });
    const updatedEvents = events.map(e => e.id === evCopy.id ? evCopy : e);
    setEvents(updatedEvents);
    setCurrentEvent(evCopy);
    native?.setEvents?.(updatedEvents, ctx).catch(() => {});
    const templateSlotCount = tpl.previewMeta?.slots?.length ?? 0;
    if (templateSlotCount > numberOfShots) {
      setNumberOfShots(templateSlotCount);
      showToast(`"${tpl.name}" applied — shots per session updated to ${templateSlotCount} to match template slots`);
    } else {
      showToast(`"${tpl.name}" applied to ${currentEvent.name}`);
    }
  };


  const toggleTemplateOnEvent = async (tpl) => {
    if (!currentEvent) return;

    const evCopy = JSON.parse(JSON.stringify(currentEvent));
    evCopy.appliedTemplates = evCopy.appliedTemplates ?? [];

    const alreadyApplied = evCopy.appliedTemplates.some((t) => t.id === tpl.id);

    if (alreadyApplied) {
      evCopy.appliedTemplates = evCopy.appliedTemplates.filter((t) => t.id !== tpl.id);
    } else {
      evCopy.appliedTemplates.push({
        id: tpl.id,
        name: tpl.name,
        previewMeta: tpl.previewMeta ?? null,
      });
    }

    const nextEvents = events.map((e) => (e.id === evCopy.id ? evCopy : e));
    await persistAll({ nextEvents });

    if (!alreadyApplied) {
      const templateSlotCount = tpl.previewMeta?.slots?.length ?? 0;
      if (templateSlotCount > numberOfShots) {
        setNumberOfShots(templateSlotCount);
        showToast(`Applied "${tpl.name}" — shots per session updated to ${templateSlotCount} to match template slots`);
        return;
      }
    }
    showToast(
      alreadyApplied
        ? `Removed "${tpl.name}" from ${evCopy.name}`
        : `Applied "${tpl.name}" to ${evCopy.name}`
    );
  };

  // Preset tones — built-in, merged with user-created tones via allTones below.
  // hue values follow CSS hue-rotate convention (degrees; + = warmer shift, - = cooler shift).
  const presetTones = [
    { id: "pb-normal",     name: "Normal",       previewMeta: { brightness: 1.0,  contrast: 1.0,  saturation: 1.0,  hue:   0 } },
    { id: "pb-bright",     name: "Vivid",         previewMeta: { brightness: 1.1,  contrast: 1.1,  saturation: 1.4,  hue:   0 } },
    { id: "pb-soft",       name: "Soft",          previewMeta: { brightness: 1.25, contrast: 0.88, saturation: 0.8,  hue:   0 } },
    { id: "pb-dreamy",     name: "Dreamy",        previewMeta: { brightness: 1.15, contrast: 0.9,  saturation: 0.75, hue:   5 } },
    { id: "pb-warm",       name: "Warm",          previewMeta: { brightness: 1.05, contrast: 1.0,  saturation: 1.15, hue:  15 } },
    { id: "pb-cool",       name: "Cool",          previewMeta: { brightness: 1.02, contrast: 1.05, saturation: 1.1,  hue: -20 } },
    { id: "pb-vintage",    name: "Vintage",       previewMeta: { brightness: 0.9,  contrast: 1.1,  saturation: 0.75, hue:  15 } },
    { id: "pb-film",       name: "Film",          previewMeta: { brightness: 1.0,  contrast: 1.1,  saturation: 0.85, hue:  -5 } },
    { id: "pb-sepia",      name: "Sepia",         previewMeta: { brightness: 1.0,  contrast: 1.1,  saturation: 1.0,  hue:   0 } },
    { id: "pb-blackwhite", name: "Black & White", previewMeta: { brightness: 1.0,  contrast: 1.2,  saturation: 0,    hue:   0 } },
    { id: "pb-drama",      name: "Drama",         previewMeta: { brightness: 0.88, contrast: 1.4,  saturation: 1.15, hue:   0 } },
    { id: "pb-party",      name: "Party Pop",     previewMeta: { brightness: 1.15, contrast: 1.15, saturation: 1.5,  hue:   0 } },
  ];

  const safeInvoke = async (channel, ...args) => {
    try {
      if (window.electron?.invoke) {
        return await window.electron.invoke(channel, ...args);
      }
      if (window.api?.invoke) {
        return await window.api.invoke(channel, ...args);
      }
      return null;
    } catch (err) {
      console.warn(`IPC call failed: ${channel}`, err);
      return null;
    }
  };

  const normalizePrinterList = (list) => {
    if (!Array.isArray(list)) return [];
    return list
      .filter(Boolean)
      .map((p) => ({
        name: p.name || p.displayName || "Unknown printer",
        displayName: p.displayName || p.name || "Unknown printer",
        isDefault: !!p.isDefault,
        status: p.status ?? null,
        options: p.options || {},
      }));
  };

  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  // Merge preset tones with custom tones in your component
  const allTones = [...presetTones, ...tones];

  // CSS filter strings that match FrameFilterScreen's TONE_FILTERS — used to
  // render live tone previews in the dashboard without importing from that file.
  const TONE_FILTER_CSS = {
    normal:  "none",
    bw:      "grayscale(1) contrast(1.15)",
    sepia:   "sepia(1) contrast(1.1)",
    vintage: "sepia(0.35) contrast(1.1) saturate(0.75)",
    warm:    "brightness(1.05) hue-rotate(15deg) saturate(1.15)",
    cool:    "brightness(1.02) hue-rotate(-20deg) saturate(1.1) contrast(1.05)",
    vivid:   "brightness(1.1) contrast(1.1) saturate(1.4)",
    party:   "brightness(1.15) contrast(1.15) saturate(1.5)",
    soft:    "brightness(1.25) contrast(0.88) saturate(0.8)",
    dreamy:  "brightness(1.15) contrast(0.9) saturate(0.75) hue-rotate(5deg)",
    drama:   "brightness(0.88) contrast(1.4) saturate(1.15)",
    film:    "contrast(1.1) saturate(0.85) hue-rotate(-5deg)",
  };

  // Derive a CSS filter string from a tone's previewMeta for custom (user-created) tones.
  function previewMetaToFilter(meta) {
    if (!meta) return "none";
    const parts = [];
    if (meta.saturation === 0) { parts.push("grayscale(1)"); }
    if ((meta.brightness ?? 1) !== 1) parts.push(`brightness(${meta.brightness})`);
    if ((meta.contrast   ?? 1) !== 1) parts.push(`contrast(${meta.contrast})`);
    if (meta.saturation > 0 && (meta.saturation ?? 1) !== 1) parts.push(`saturate(${meta.saturation})`);
    if ((meta.hue ?? 0) !== 0) parts.push(`hue-rotate(${meta.hue}deg)`);
    return parts.length ? parts.join(" ") : "none";
  }

  // Built-in background colors — shown at the top of the palette list, not deletable.
  const presetPalettes = [
    { id: "preset-white",     name: "White",      colors: ["#FFFFFF"] },
    { id: "preset-ivory",     name: "Ivory",      colors: ["#FAF5EC"] },
    { id: "preset-cream",     name: "Cream",      colors: ["#FFF0E0"] },
    { id: "preset-blush",     name: "Blush",      colors: ["#FFD6E7"] },
    { id: "preset-peach",     name: "Peach",      colors: ["#FFD6C0"] },
    { id: "preset-rose",      name: "Rose",       colors: ["#F5C2C7"] },
    { id: "preset-lavender",  name: "Lavender",   colors: ["#E8DCF5"] },
    { id: "preset-mint",      name: "Mint",       colors: ["#D4F5E9"] },
    { id: "preset-sky",       name: "Sky Blue",   colors: ["#D4EDFF"] },
    { id: "preset-champagne", name: "Champagne",  colors: ["#F5E6C4"] },
    { id: "preset-sage",      name: "Sage",       colors: ["#D4E8D4"] },
    { id: "preset-black",     name: "Black",      colors: ["#1A1A1A"] },
  ];
  const allPalettes = [...presetPalettes, ...(palettes ?? [])];

  const ctx = useMemo(() => ({ userId: identity.userId }), [identity.userId]);

  useEffect(() => {
    if (authLoading) return;

    if (!identity?.userId) {
      setEvents([]);
      setCurrentEvent(null);
      setHydrated(false);
      setAccountForm({
        displayName: "",
        email: "",
        phone: "",
        company: "",
        role: "Administrator",
        badgePhoto: "",
      });
      return;
    }

    loadAccountCenterData();
  }, [authLoading, identity?.userId, loadAccountCenterData]);

  const handleSaveFrame = async (frame) => {
    const existingIndex = frames.findIndex((f) => f.id === frame.id);

    const nextFrames =
      existingIndex !== -1
        ? frames.map((f) => (f.id === frame.id ? frame : f))
        : [...frames, frame];

    await persistAll({ nextFrames });

    return frame;
  };

  const handleCreateFrame = async (name) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) { notify(showToast, "Frame name is required."); return; }

    const exists = frames.some((f) => (f.name ?? "").trim().toLowerCase() === trimmed.toLowerCase());
    if (exists) { notify(showToast, "A frame with that name already exists."); return; }

    const newFrame = { id: makeId(), name: trimmed, previews: {} };
    const nextFrames = [newFrame, ...frames];
    await persistAll({ nextFrames });
    notify(showToast, `Created frame "${trimmed}".`);
  };

  const handleCreateFrameWithUpload = async ({ name, file, layout }) => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) { notify(showToast, "Frame name is required."); return; }
    const err = validateImage(file); // existing helper
    if (err) { notify(showToast, err); return; }

    // Read image to get a stable DataURL
    const { dataUrl } = await readImageWH(file);

    // Build frame with a single layout populated
    const newFrame = {
      id: makeId(),   // you have this helper
      name: trimmed,
      previews: {
        [layout]: {
          originalDataUrl: dataUrl,
          fileName: file.name,
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const nextFrames = [newFrame, ...frames];
    await persistAll({ nextFrames });
    notify(showToast, `Created frame "${trimmed}"`);
    return newFrame;
  };

  const handleDeleteFrame = async (frameId) => {
    // Optional confirm
    const ok = window.confirm?.("Delete this frame? This cannot be undone.");
    if (ok === false) return;

    const nextFrames = frames.filter((f) => f.id !== frameId);

    // Remove from appliedFrames in ALL events (including currentEvent)
    const updatedEvents = events.map((ev) => {
      const applied = (ev.appliedFrames || []).filter((af) => af.id !== frameId);
      return { ...ev, appliedFrames: applied };
    });

    await persistAll({
      nextFrames,
      nextEvents: updatedEvents
    });
    pushSettingsNow({ frames: nextFrames, events: updatedEvents });

    notify(showToast, "Frame deleted.");
  };

  const handleRenameFrame = async ({ frameId, newName }) => {
    const trimmed = (newName || "").trim();
    if (!trimmed) {
      notify(showToast, "Name cannot be empty.");
      return;
    }

    const nextFrames = frames.map((f) =>
      f.id === frameId ? { ...f, name: trimmed } : f
    );

    // Sync the name in appliedFrames snapshots across ALL events
    const updatedEvents = events.map((ev) => {
      const applied = (ev.appliedFrames || []).map((af) =>
        af.id === frameId ? { ...af, name: trimmed } : af
      );
      return { ...ev, appliedFrames: applied };
    });

    await persistAll({
      nextFrames,
      nextEvents: updatedEvents
    });

    setEditingFrameId(null);
    setEditingName("");
    notify(showToast, `Renamed frame to "${trimmed}".`);
  };

  /** Grid & snap */
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapPercent, setSnapPercent] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  /** Selection */
  const [selectionIds, setSelectionIds] = useState([]);
  const [aspectLock, setAspectLock] = useState(false);
  const [presetAspect, setPresetAspect] = useState(null);

  const [templateLayout, setTemplateLayout] = useState("4x6"); // "4x6" | "2x6"
  const [templatePrintMode, setTemplatePrintMode] = useState("single"); // "single" | "dual"

  /** Delete confirmation */
  const [deleteTarget, setDeleteTarget] = useState(null);

  /** Autosave & toast */
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const autosaveTimer = useRef(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  /** Settings */
  /* ================= Settings State ================= */

  /* -------- Printer -------- */

  const refreshPrinters = async () => {
    setPrinterLoading(true);
    setPrinterError("");

    // On iPad (Capacitor/iOS) there is no API to enumerate printers.
    // iOS presents its own AirPrint picker at print time. Inject a synthetic
    // entry so the dropdown doesn't show "No printers found".
    if (isIpadApp) {
      setPrinters([{ name: "AirPrint", displayName: "AirPrint (iOS)", isDefault: true, status: null, options: {} }]);
      setSelectedPrinter((prev) => prev || "AirPrint");
      setPrinterOnline(true);
      setPrinterStatusText("AirPrint ready — printer selected when you print");
      setPrinterLoading(false);
      return;
    }

    // In a browser (no Electron bridge) printer enumeration is not possible —
    // browsers have no API to list OS print queues. Show a clear message instead
    // of silently returning an empty list.
    if (!native) {
      setPrinters([]);
      setSelectedPrinter("");
      setPrinterOnline(false);
      setPrinterStatusText("Printer access requires the Photuna desktop app");
      setPrinterError("Printers can only be managed from the Photuna desktop app. Open the app on your booth computer to configure printing.");
      setPrinterLoading(false);
      return;
    }

    try {
      let found = [];

      if (typeof native?.getPrinters === "function") {
        found = await native.getPrinters();
      } else {
        found = await safeInvoke("printer:list");
      }

      const normalized = normalizePrinterList(found);
      setPrinters(normalized);

      if (!normalized.length) {
        setSelectedPrinter("");
        setPrinterOnline(false);
        setPrinterStatusText("No printers detected");
        showToast("No printers found");
        return;
      }

      const saved = (() => {
        try {
          return JSON.parse(localStorage.getItem("boothSettings") || "{}");
        } catch {
          return {};
        }
      })();

      const currentStillExists = normalized.some((p) => p.name === selectedPrinter);
      const savedPrinter = saved.selectedPrinter ?? "";
      const savedStillExists = normalized.some((p) => p.name === savedPrinter);

      let nextPrinter = "";

      if (currentStillExists) {
        nextPrinter = selectedPrinter;
      } else if (savedStillExists) {
        nextPrinter = savedPrinter;
      } else {
        nextPrinter = (normalized.find((p) => p.isDefault) || normalized[0])?.name || "";
      }

      if (nextPrinter !== selectedPrinter) {
        setSelectedPrinter(nextPrinter);
      }

      setPrinterOnline(true);
      setPrinterStatusText("Printer list refreshed");
    } catch (err) {
      console.error("refreshPrinters failed", err);
      setPrinters([]);
      setSelectedPrinter("");
      setPrinterOnline(false);
      setPrinterStatusText("Unable to load printers");
      setPrinterError(err?.message || "Unable to load printers from the native bridge."); // FIX 3: surface native bridge failure inline in settings UI.
      showToast("Failed to load printers");
    } finally {
      setPrinterLoading(false);
    }
  };

  const inferOrientationFromPaper = (paper) => {
    const value = String(paper || "").toLowerCase();

    if (value.includes("6x4")) return "Landscape";
    if (value.includes("4x6")) return "Portrait";
    if (value.includes("6x2")) return "Landscape";
    if (value.includes("2x6")) return "Portrait";

    return "Unknown";
  };

  const normalizeSystemPrinterSettings = (caps) => {
    const rawOrientation =
      caps?.orientation ||
      caps?.options?.orientation ||
      caps?.options?.printerOrientation ||
      "";

    const rawPaper =
      caps?.defaultPaperSize ||
      caps?.paperSize ||
      caps?.options?.paperSize ||
      caps?.options?.media ||
      caps?.options?.defaultMedia ||
      caps?.options?.pageSize ||
      "";

    const orientation =
      ["portrait", "landscape"].includes(String(rawOrientation).toLowerCase())
        ? String(rawOrientation).charAt(0).toUpperCase() +
        String(rawOrientation).slice(1).toLowerCase()
        : inferOrientationFromPaper(rawPaper);

    return {
      layout: rawPaper || "System default",
      orientation,
    };
  };

  const loadPrinterCapabilities = async (printerName) => {
    if (!printerName) {
      setPrinterCapabilities(null);
      setPrinterSystemLayout("Unknown");
      setPrinterSystemOrientation("Unknown");
      setPaperSizeOptions(CUSTOM_PAPER_SIZE_OPTIONS);
      return;
    }

    try {
      const caps = await safeInvoke("printer:get-capabilities", printerName);
      setPrinterCapabilities(caps || null);

      const normalized = normalizeSystemPrinterSettings(caps || {});
      setPrinterSystemLayout(normalized.layout);
      setPrinterSystemOrientation(normalized.orientation);

      const nextPaperOptions = extractPrinterPaperOptions(caps || {});
      setPaperSizeOptions(nextPaperOptions);

      const hasCurrentPaper = nextPaperOptions.some(
        (opt) => normalizePaperName(opt.value) === normalizePaperName(paperSize)
      );

      if (!hasCurrentPaper && nextPaperOptions.length) {
        setPaperSize(nextPaperOptions[0].value);
      }
    } catch (err) {
      console.warn("loadPrinterCapabilities failed", err);
      setPrinterCapabilities(null);
      setPrinterSystemLayout("Unknown");
      setPrinterSystemOrientation("Unknown");
      setPaperSizeOptions(CUSTOM_PAPER_SIZE_OPTIONS);
    }
  };

  const checkPrinterHealth = async ({ silent = false } = {}) => {
    if (!selectedPrinter) {
      setPrinterOnline(false);
      setPrinterStatusText("No printer selected");
      if (!silent) showToast("Select a printer first");
      return;
    }

    setPrinterLoading(true);

    try {
      const status = await safeInvoke("printer:status", selectedPrinter);
      const online = !!status?.online;

      setPrinterOnline(online);
      setPrinterStatusText(
        status?.message ||
        status?.status ||
        (online ? "Printer is online" : "Printer is offline")
      );

      if (!status) {
        setPrinterStatusText("Printer status unavailable");
      }
    } catch (err) {
      console.error("checkPrinterHealth failed", err);
      setPrinterOnline(false);
      setPrinterStatusText("Printer status check failed");
      if (!silent) showToast("Failed to check printer status");
    } finally {
      setPrinterLoading(false);
    }
  };

  const testPrint = async () => {
    if (!selectedPrinter) {
      showToast("Select a printer first");
      return;
    }

    try {
      const result = await safeInvoke("printer:test", {
        printer: selectedPrinter,
        layout: "4x6", // safe booth layout for test output
        paperSize,
        colorMode: printColorMode,
        quality: printQuality,
        orientation: printOrientation,
        copies: printCopies,
        duplexMode: printDuplexMode,
        dpi: printDpi,
        usePrinterDefaults,
      });

      if (result?.ok === false) {
        showToast(result.error || "Test print failed");
        return;
      }

      showToast("Test print sent");
    } catch (err) {
      console.error("testPrint failed", err);
      showToast("Test print failed");
    }
  };

  /* -------- Storage -------- */
  const [storagePath, setStoragePath] = useState("");
  const [autoDeleteDays, setAutoDeleteDays] = useState(14);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageStatusText, setStorageStatusText] = useState("No storage folder selected");
  const [storageInfo, setStorageInfo] = useState(null);

  const loadStorageInfo = async (pathOverride = storagePath) => {
    if (!pathOverride) {
      setStorageInfo(null);
      setStorageStatusText("No storage folder selected");
      return;
    }

    try {
      const info = await safeInvoke("storage:info", pathOverride);

      if (!info) {
        setStorageInfo(null);
        setStorageStatusText("Storage inspection unavailable");
        return;
      }

      if (info.ok === false) {
        setStorageInfo(null);
        setStorageStatusText(info.error || "Unable to validate storage folder");
        return;
      }

      setStorageInfo(info);
      setStorageStatusText(info.message || "Storage folder checked");
    } catch (err) {
      console.error("loadStorageInfo failed", err);
      setStorageInfo(null);
      setStorageStatusText("Unable to validate storage folder");
    }
  };

  const selectStoragePath = async () => {
    setStorageLoading(true);
    try {
      const path = await window.electron.invoke("storage:select");
      if (!path) return;

      setStoragePath(path);
      await loadStorageInfo(path);

      const nextSettings = sanitizeSettings({
        selectedCameraId,
        mirrorCamera,
        cameraResolution,
        cameraWidth,
        cameraHeight,
        facingMode,
        selectedPrinter,
        paperSize,
        printCopies,
        printColorMode,
        printQuality,
        printOrientation,
        printDuplexMode,
        printDpi,
        usePrinterDefaults,
        storagePath: path,
        autoDeleteDays,
        dimWhenIdle,
        idleTimeout,
        launchOnStartup,
        autoRestart,
        autoUpdateEnabled,
        countdown,
        retakeLimit,
        screenTimers,
        numberOfShots,
        flashEnabled,
        soundEnabled,
        language,
        price,
        appMode,
        timersEnabled,
        consentEnabled,
        storageChoiceEnabled,
        galleryOptionDisabled,
        operatorStorageEnabled,
        operatorStorageLabel,
        operatorStorageUrl,
        operatorStorageApiKey,
        rental: {
          timerEnabled: rentalTimerEnabled,
          timerHours: rentalTimerHours,
          sessionLimitEnabled: rentalSessionLimitEnabled,
          sessionLimit: rentalSessionLimit,
          offlineModeEnabled,
          autoSaveTarget,
          endSessionSummaryEnabled,
        },
        business: {
          activeProvider,
          paymentEnabled,
          payment: { providers: { ...paymentProviders }, stripeProviders: { ...stripeProviders }, xenditProviders: { ...xenditProviders }, paypalProviders: { ...paypalProviders }, cashMode, gcashStaticQrDataUrl },
          pricing: {
            model: pricingModel,
            pricePerSession,
            additionalPrintPrice,
            currency,
            taxEnabled,
            taxRate,
          },
        },
      });

      localStorage.setItem("boothSettings", JSON.stringify(nextSettings));
      await native?.setSettings?.(nextSettings);

      showToast("Storage folder updated");
    } catch (err) {
      console.error("selectStoragePath failed", err);
      setStorageStatusText("Failed to choose storage folder");
      showToast("Failed to choose folder");
    } finally {
      setStorageLoading(false);
    }
  };

  const runStorageCleanup = async () => {
    try {
      const result = await safeInvoke("storage:cleanup", {
        path: storagePath,
        autoDeleteDays,
      });

      if (!result) {
        showToast("Storage cleanup is unavailable");
        return;
      }

      if (result.ok === false) {
        showToast(result.error || "Cleanup failed");
        return;
      }

      showToast(result.message || "Storage cleanup completed");
      await loadStorageInfo();
    } catch (err) {
      console.error("runStorageCleanup failed", err);
      showToast("Cleanup failed");
    }
  };

  /* -------- General / Idle -------- */
  const [dimWhenIdle, setDimWhenIdle] = useState(true);
  const [idleTimeout, setIdleTimeout] = useState(60);
  const [cameraWidth, setCameraWidth] = useState(1920);
  const [cameraHeight, setCameraHeight] = useState(1080);
  const [facingMode, setFacingMode] = useState("user");

  const handleIdleTimeoutChange = (value) => {
    setIdleTimeout(clamp(value, 5, 3600, 60));
  };

  const generalStatusText = !dimWhenIdle
    ? "Idle dimming is disabled"
    : `Screen dims after ${idleTimeout} seconds of inactivity`;

  /* -------- Audit & Logs -------- */
  const [logsLoading, setLogsLoading] = useState(false);
  const [lastExportedLogPath, setLastExportedLogPath] = useState("");
  const [logsStatusText, setLogsStatusText] = useState("Ready to export logs");

  const exportLogs = async () => {
    setLogsLoading(true);

    try {
      const logPath = await window.electron.invoke("log:export");

      if (!logPath) {
        setLogsStatusText("Log export cancelled");
        return;
      }

      setLastExportedLogPath(logPath);
      setLogsStatusText("Logs exported successfully");
      showToast(`Logs exported: ${logPath}`);
    } catch (err) {
      console.error("exportLogs failed", err);
      setLogsStatusText("Log export failed");
      showToast("Failed to export logs");
    } finally {
      setLogsLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      const result = await safeInvoke("log:clear");
      if (result?.ok === false) {
        showToast(result.error || "Failed to clear logs");
        return;
      }

      setLogsStatusText("Logs cleared");
      showToast("Logs cleared");
    } catch (err) {
      console.error("clearLogs failed", err);
      showToast("Failed to clear logs");
    }
  };

  /* -------- Startup & Recovery -------- */
  const [systemLoading, setSystemLoading] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState("No update check yet");
  const [updateState, setUpdateState] = useState("idle");
  const updateStateRef = useRef("idle");
  useEffect(() => { updateStateRef.current = updateState; }, [updateState]);
  const [updatePercent, setUpdatePercent] = useState(0);
  const [cacheStatusText, setCacheStatusText] = useState("Cache status unknown");
  const [launchOnStartup, setLaunchOnStartup] = useState(true);

  // The operating system is the source of truth for this toggle, so read it
  // back rather than trusting saved settings. Re-run whenever Settings is
  // opened so the state shown is current, not whatever it was at launch.
  const syncLaunchOnStartup = useCallback(async () => {
    try {
      const result = await window.electron?.invoke?.("startup:get");
      if (typeof result?.enabled === "boolean") {
        setLaunchOnStartup(result.enabled);
      }
    } catch (err) {
      console.error("startup:get failed", err);
    }
  }, []);

  useEffect(() => { syncLaunchOnStartup(); }, [syncLaunchOnStartup]);

  useEffect(() => {
    if (activeMain === "settings") syncLaunchOnStartup();
  }, [activeMain, activeSettingsTab, syncLaunchOnStartup]);

  const toggleLaunchOnStartup = async (enabled) => {
    try {
      setLaunchOnStartup(enabled);
      const result = await window.electron.invoke("startup:set", enabled);

      if (result?.ok === false) {
        setLaunchOnStartup(!enabled);
        showToast(result.error || "Failed to update startup setting");
      }
    } catch (err) {
      console.error("toggleLaunchOnStartup failed", err);
      setLaunchOnStartup(!enabled);
      showToast("Failed to update startup setting");
    }
  };

  const [autoRestart, setAutoRestart] = useState(true);

  /* -------- Save Settings -------- */
  // Machine-level settings describe THIS booth (its camera, printer, storage,
  // system prefs) so they are mirrored onto every event — PhotoBooth reads
  // them from event.settings. Everything not listed here is event-level
  // (flow, pricing, business, rental) and must only touch the current event,
  // otherwise saving settings once flattens every event to look identical.
  const MACHINE_LEVEL_SETTING_KEYS = [
    // Camera
    "selectedCameraId", "mirrorCamera", "cameraResolution",
    "cameraWidth", "cameraHeight", "facingMode",
    // Printing
    "selectedPrinter", "paperSize", "printCopies", "printColorMode",
    "printQuality", "printOrientation", "printDuplexMode", "printDpi",
    "usePrinterDefaults",
    // Storage
    "storagePath", "autoDeleteDays",
    // General
    "dimWhenIdle", "idleTimeout",
    // System
    "launchOnStartup", "autoRestart", "autoUpdateEnabled",
    // Booth identity
    "boothIdentityName", "boothLocation", "operatorName",
  ];

  const saveSettings = async () => {
    const rawSettings = {
      // CAMERA
      selectedCameraId,
      mirrorCamera,
      cameraResolution,
      cameraWidth,
      cameraHeight,
      facingMode,

      // CAPTURE
      flashEnabled,
      soundEnabled,

      // PRINTING
      selectedPrinter,
      paperSize,
      printCopies: clamp(printCopies, 1, 20, 1),
      printColorMode,
      printQuality,
      printOrientation,
      printDuplexMode,
      printDpi,
      usePrinterDefaults,

      // STORAGE
      storagePath,
      autoDeleteDays,

      // GENERAL
      dimWhenIdle,
      idleTimeout,

      // SYSTEM
      launchOnStartup,
      autoRestart,
      autoUpdateEnabled,

      // BOOTH IDENTITY
      boothIdentityName,
      boothLocation,
      operatorName,

      // EXISTING BOOTH FLOW SETTINGS
      countdown,
      retakeLimit,
      screenTimers,
      numberOfShots,
      language,
      price,
      appMode,
      timersEnabled,
      consentEnabled,
      rental: {
        timerEnabled: rentalTimerEnabled,
        timerHours: rentalTimerHours,
        sessionLimitEnabled: rentalSessionLimitEnabled,
        sessionLimit: rentalSessionLimit,
        offlineModeEnabled,
        autoSaveTarget,
        endSessionSummaryEnabled,
      },
      business: {
        activeProvider,
        paymentEnabled,
        payment: { providers: { ...paymentProviders }, stripeProviders: { ...stripeProviders }, xenditProviders: { ...xenditProviders }, paypalProviders: { ...paypalProviders } },
        pricing: {
          model: pricingModel,
          pricePerSession,
          additionalPrintPrice,
          currency,
          taxEnabled,
          taxRate,
        },
      },
    };

    const settings = sanitizeSettings(rawSettings);

    localStorage.setItem("boothSettings", JSON.stringify(settings));
    await native?.setSettings?.(settings);

    pushSettings({ settings });

    // Re-apply sanitized values to state so UI immediately reflects clamped values
    setPrintCopies(settings.printCopies);
    setPrintDpi(settings.printDpi);
    setCountdown(settings.countdown);
    setRetakeLimit(settings.retakeLimit);
    setNumberOfShots(settings.numberOfShots);
    setIdleTimeout(settings.idleTimeout);
    setAutoDeleteDays(settings.autoDeleteDays);
    setBoothIdentityName(settings.boothIdentityName ?? "");
    setBoothLocation(settings.boothLocation ?? "");
    setOperatorName(settings.operatorName ?? "");

    // Appearance & Alerts renders inside Settings, so the main Save owns it too
    // rather than the panel carrying its own Save button. It persists to a
    // different store (account preferences), hence the separate call.
    try { await window.electron?.saveAccountPreferences?.(accountPreferences); } catch {}

    notify(showToast, "Settings saved");

    // Mirror machine-level settings onto every event so PhotoBooth (which reads
    // event.settings) picks up this booth's camera/printer/storage config.
    // Event-level settings are applied ONLY to the current event.
    if (events.length > 0) {
      const machineSettings = {};
      for (const key of MACHINE_LEVEL_SETTING_KEYS) {
        if (key in settings) machineSettings[key] = settings[key];
      }

      const updatedEvents = events.map((e) => {
        const merged = { ...(e.settings ?? {}), ...machineSettings };
        // The event being edited also receives the event-level settings
        return e.id === currentEvent?.id
          ? { ...e, settings: { ...merged, ...settings } }
          : { ...e, settings: merged };
      });
      await persistEvents(updatedEvents);

      if (currentEvent) {
        setCurrentEvent((prev) => prev ? { ...prev, settings: { ...(prev.settings ?? {}), ...settings } } : prev);
      }
    }
  };

  useEffect(() => {
    if (activeMain === "settings" && activeSettingsTab === "printing") {
      refreshPrinters();
    }
  }, [activeMain, activeSettingsTab]);

  useEffect(() => {
    if (selectedPrinter) {
      loadPrinterCapabilities(selectedPrinter);
      checkPrinterHealth({ silent: true });
    } else {
      setPrinterCapabilities(null);
      setPrinterOnline(false);
      setPrinterStatusText("No printer selected");
    }
  }, [selectedPrinter]);

  const loadSettingsFromStorage = useCallback(async () => {
    try {
      let s = null;

      if (native?.getSettings && identity?.userId) {
        const result = await native.getSettings({ userId: identity.userId });
        if (result && Object.keys(result).length > 0) {
          s = result;
        }
      }

      if (!s) {
        const saved = localStorage.getItem("boothSettings");
        if (!saved) return;
        s = JSON.parse(saved);
      }

      if (!s || Object.keys(s).length === 0) return;

      // CAMERA
      setSelectedCameraId(s.selectedCameraId ?? "");
      setMirrorCamera(s.mirrorCamera ?? false);
      setCameraResolution(s.cameraResolution ?? "1080p");
      setCameraWidth(s.cameraWidth ?? 1920);
      setCameraHeight(s.cameraHeight ?? 1080);
      setFacingMode(s.facingMode ?? "user");

      // CAPTURE
      setFlashEnabled(s.flashEnabled ?? true);
      setSoundEnabled(s.soundEnabled ?? true);

      // PRINTING
      setSelectedPrinter(s.selectedPrinter ?? "");
      setPaperSize(s.paperSize ?? "4x6");
      setPrintCopies(s.printCopies ?? 1);
      setPrintColorMode(s.printColorMode ?? "color");
      setPrintQuality(s.printQuality ?? "high");
      setPrintOrientation(s.printOrientation ?? "landscape");
      setPrintDuplexMode(s.printDuplexMode ?? "simplex");
      setPrintDpi(s.printDpi ?? 300);
      setUsePrinterDefaults(s.usePrinterDefaults ?? false);

      // STORAGE
      setStoragePath(s.storagePath ?? "");
      setAutoDeleteDays(s.autoDeleteDays ?? 14);

      // GENERAL
      setDimWhenIdle(s.dimWhenIdle ?? true);
      setIdleTimeout(s.idleTimeout ?? 60);
      setLanguage(s.language ?? "en");

      // BOOTH IDENTITY
      setBoothIdentityName(s.boothIdentityName ?? "");
      setBoothLocation(s.boothLocation ?? "");
      setOperatorName(s.operatorName ?? "");

      // SYSTEM
      // launchOnStartup is deliberately NOT restored from saved settings — the
      // operating system is the source of truth and syncLaunchOnStartup() owns
      // it. Restoring a stale saved value here made the toggle read "Enabled"
      // while Windows had no startup entry at all.
      setAutoRestart(s.autoRestart ?? true);
      setAutoUpdateEnabled(s.autoUpdateEnabled ?? true);

      // FLOW
      setCountdown(s.countdown ?? 5);
      setRetakeLimit(s.retakeLimit ?? 0);
      setScreenTimers(s.screenTimers ?? DEFAULT_SCREEN_TIMERS);
      setNumberOfShots(s.numberOfShots ?? 3);
      setPrice(s.price ?? 0);
      setAppMode(s.appMode ?? DEFAULT_APP_MODE);
      setTimersEnabled(s.timersEnabled ?? false);
      setConsentEnabled(s.consentEnabled ?? true);
      setStorageChoiceEnabled(s.storageChoiceEnabled ?? false);
      setGalleryOptionDisabled(s.galleryOptionDisabled ?? false);
      setOperatorStorageEnabled(s.operatorStorageEnabled ?? false);
      setOperatorStorageLabel(s.operatorStorageLabel ?? "Our Storage");
      setOperatorStorageUrl(s.operatorStorageUrl ?? "");
      setOperatorStorageApiKey(s.operatorStorageApiKey ?? "");

      // RENTAL
      setRentalTimerEnabled(s.rental?.timerEnabled ?? DEFAULT_RENTAL.timerEnabled);
      setRentalTimerHours(s.rental?.timerHours ?? DEFAULT_RENTAL.timerHours);
      setRentalSessionLimitEnabled(s.rental?.sessionLimitEnabled ?? DEFAULT_RENTAL.sessionLimitEnabled);
      setRentalSessionLimit(s.rental?.sessionLimit ?? DEFAULT_RENTAL.sessionLimit);
      setOfflineModeEnabled(s.rental?.offlineModeEnabled ?? DEFAULT_RENTAL.offlineModeEnabled);
      setAutoSaveTarget(s.rental?.autoSaveTarget ?? DEFAULT_RENTAL.autoSaveTarget);
      setEndSessionSummaryEnabled(s.rental?.endSessionSummaryEnabled ?? DEFAULT_RENTAL.endSessionSummaryEnabled);

      // BUSINESS
      setPaymentEnabled(s.business?.paymentEnabled ?? DEFAULT_BUSINESS.paymentEnabled);
      setActiveProvider(s.business?.activeProvider ?? null);
      setPaymentProviders(s.business?.payment?.providers ?? { ...DEFAULT_BUSINESS.payment.providers });
      setStripeProviders(s.business?.payment?.stripeProviders ?? { ...DEFAULT_STRIPE_PROVIDERS });
      setXenditProviders(s.business?.payment?.xenditProviders ?? { ...DEFAULT_XENDIT_PROVIDERS });
      setPaypalProviders(s.business?.payment?.paypalProviders ?? { ...DEFAULT_PAYPAL_PROVIDERS });
      setCashMode(s.business?.payment?.cashMode ?? "manual");
      setGcashStaticQrDataUrl(s.business?.payment?.gcashStaticQrDataUrl ?? "");
      setPricingModel(s.business?.pricing?.model ?? DEFAULT_BUSINESS.pricing.model);
      setPricePerSession(s.business?.pricing?.pricePerSession ?? DEFAULT_BUSINESS.pricing.pricePerSession);
      setAdditionalPrintPrice(s.business?.pricing?.additionalPrintPrice ?? DEFAULT_BUSINESS.pricing.additionalPrintPrice);
      setCurrency(s.business?.pricing?.currency ?? DEFAULT_BUSINESS.pricing.currency);
      setTaxEnabled(s.business?.pricing?.taxEnabled ?? DEFAULT_BUSINESS.pricing.taxEnabled);
      setTaxRate(s.business?.pricing?.taxRate ?? DEFAULT_BUSINESS.pricing.taxRate);
    } catch (err) {
      console.error("Failed to restore settings", err);
    }
  }, [identity?.userId, native]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Probe hardware status quietly on startup so dashboard tiles
      // reflect the real state without requiring a visit to Settings.

      // Camera — skip entirely when running in a browser with no Electron bridge
      if (native) {
        try {
          const devices = (await native?.listCameras?.()) ?? [];
          if (!cancelled) {
            const normalized = normalizeCameraList(devices);
            setCameraList(normalized);
            if (normalized.length) {
              setCameraOnline(true);
              setCameraStatusText(`${normalized.length} camera${normalized.length > 1 ? "s" : ""} detected`);
            } else {
              setCameraOnline(false);
              setCameraStatusText("No cameras detected");
            }
          }
        } catch { if (!cancelled) { setCameraOnline(false); setCameraStatusText("Camera check failed"); } }
      }

      // Read saved settings once for printer + storage probes
      let saved = null;
      try {
        if (native?.getSettings && identity?.userId) {
          saved = await native.getSettings({ userId: identity.userId });
        }
        if (!saved) {
          try { saved = JSON.parse(localStorage.getItem("boothSettings") || "{}"); } catch {}
        }
      } catch {}

      // Printer
      try {
        const savedPrinter = saved?.selectedPrinter;
        if (savedPrinter && !cancelled) {
          const status = await safeInvoke("printer:status", savedPrinter);
          if (!cancelled) {
            const online = !!status?.online;
            setPrinterOnline(online);
            setPrinterStatusText(status?.message || (online ? "Printer is online" : "Printer is offline"));
          }
        }
      } catch { if (!cancelled) { setPrinterOnline(false); setPrinterStatusText("Printer check failed"); } }

      // Storage
      try {
        const savedStoragePath = saved?.storagePath;
        if (savedStoragePath && !cancelled) {
          await loadStorageInfo(savedStoragePath);
        }
      } catch { /* silent */ }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeMain === "settings" && activeSettingsTab === "camera") {
      refreshCameras();
    }
  }, [activeMain, activeSettingsTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const rawPlan = license?.plan ?? gating?.plan ?? null;
  const plan = rawPlan === "pro_yearly" ? "yearly"
    : rawPlan === "pro_monthly" ? "monthly"
    : rawPlan === "pro" ? "monthly"
    : rawPlan;
  const planDisplayName = plan === "yearly" ? "Pro Yearly"
    : plan === "monthly" ? "Pro Monthly"
    : plan === "trial" ? "Trial"
    : "Free";
  const ent = license?.entitlements ?? {};
  const expiresAt = license?.expiresAt ?? 0;
  const eventLimit = Number(gating?.maxEvents || ent?.maxEvents || 1);
  const templateLimit = Number(gating?.templates || ent?.templates || 3);
  const galleryAddonEnabled = Boolean(gating?.galleryEnabled || gating?.galleryAddon || ent?.galleryEnabled || ent?.galleryAddon);
  const settingsToSave = sanitizeSettings({
    selectedCameraId,
    mirrorCamera,
    cameraResolution,
    cameraWidth,
    cameraHeight,
    facingMode,
    selectedPrinter,
    paperSize,
    printCopies,
    printColorMode,
    printQuality,
    printOrientation,
    printDuplexMode,
    printDpi,
    usePrinterDefaults,
    storagePath,
    autoDeleteDays,
    dimWhenIdle,
    idleTimeout,
    launchOnStartup,
    autoRestart,
    autoUpdateEnabled,
    countdown,
    retakeLimit,
    screenTimers,
    numberOfShots,
    flashEnabled,
    soundEnabled,
    language,
    price,
    appMode,
    timersEnabled,
    consentEnabled,
    storageChoiceEnabled,
    galleryOptionDisabled,
    operatorStorageEnabled,
    operatorStorageLabel,
    operatorStorageUrl,
    operatorStorageApiKey,
    rental: {
      timerEnabled: rentalTimerEnabled,
      timerHours: rentalTimerHours,
      sessionLimitEnabled: rentalSessionLimitEnabled,
      sessionLimit: rentalSessionLimit,
      offlineModeEnabled,
      autoSaveTarget,
      endSessionSummaryEnabled,
    },
    business: {
      activeProvider,
      paymentEnabled,
      payment: { providers: { ...paymentProviders }, stripeProviders: { ...stripeProviders }, xenditProviders: { ...xenditProviders }, paypalProviders: { ...paypalProviders }, cashMode, gcashStaticQrDataUrl },
      pricing: {
        model: pricingModel,
        pricePerSession,
        additionalPrintPrice,
        currency,
        taxEnabled,
        taxRate,
      },
    },
  });

  // Define trial eligibility:
  // Eligible only if not on paid plan and not redeemed/expired
  const hasPaidPlan = plan === "monthly" || plan === "yearly";
  const alreadyRedeemedOrExpired =
    Boolean(license?.trialRedeemed) || Boolean(license?.trialExpired);
  const trialEligible = !hasPaidPlan && !alreadyRedeemedOrExpired;
  // Payment gateway availability
  const anyProviderConfigured = paymongoConfigured || stripeConfigured || xenditConfigured || paypalConfigured;
  const activeProviderIsTest =
    (activeProvider === "paymongo" && paymongoTestMode) ||
    (activeProvider === "xendit" && xenditTestMode) ||
    (activeProvider === "paypal" && paypalSandboxMode);

  async function fallbackRedeemTrial() {
    if (typeof licensingApi.redeemTrial === "function") return licensingApi.redeemTrial();
    throw new Error("redeemTrial is not available.");
  }

  async function fallbackLicenseStatus() {
    if (typeof licensingApi.licenseStatus === "function") return licensingApi.licenseStatus();
    throw new Error("licenseStatus is not available.");
  }

  // 1) Extract your existing initial fetch into a function
  const loadPersisted = React.useCallback(async (userId) => {
    if (!native || !userId) return;
    const ctx = { userId };

    // Fast path: show events immediately from the local file before any network calls.
    // The events section UI checks `!hydrated && events.length === 0` so events render
    // immediately even while hydrated is still false (Supabase pull still in progress).
    try {
      const quickEvs = await native.getEvents?.(ctx);
      if (Array.isArray(quickEvs) && quickEvs.length > 0) setEvents(quickEvs);
    } catch { }

    // Sync from Supabase — captures the return value so we can use it as a
    // fallback below without making a second round-trip.
    initSettingsSync(userId);
    let sbData = null;
    try { sbData = await pullSettings(); } catch { }

    try {
      const [
        persistedEvents, appearance, settings,
        persistedTemplates, persistedFrames, persistedTones, persistedPalettes,
        currentEventId, currentSubTab, persistedActiveMain
      ] = await Promise.all([
        native.getEvents?.(ctx),   // re-read — pullSettings may have written new events
        native.getAppearance?.(ctx),
        native.getSettings?.(ctx),
        native.getTemplates?.(ctx),
        native.getFrames?.(ctx),
        native.getTones?.(ctx),
        native.getPalettes?.(ctx),
        native.getCurrentEventId?.(),
        native.getCurrentSubTab?.(),
        native.getActiveMain?.(),
      ]);

      // Prefer the freshly-read local file; if it is still empty (first login on
      // this machine), use the Supabase data already fetched by pullSettings.
      let resolvedEvents = Array.isArray(persistedEvents) ? persistedEvents : [];
      if (resolvedEvents.length === 0 && Array.isArray(sbData?.events) && sbData.events.length > 0) {
        resolvedEvents = sbData.events;
        native?.setEvents?.(resolvedEvents, ctx).catch(() => {});
      }
      // Only update if we have events, or the fast path also found nothing
      // (avoids overwriting the fast-path state with an empty array).
      if (resolvedEvents.length > 0) setEvents(resolvedEvents);

      // Appearance
      if (appearance) {
        setLogoSize(appearance.logoSize ?? 100);
        setLogoPath(appearance.logoPath ? { url: appearance.logoPath, name: "logo", previewUrl: appearance.logoPath } : null);
        setBackgroundMediaPath(
          appearance.backgroundMediaPath
            ? {
              url: appearance.backgroundMediaPath,
              name: appearance.backgroundMediaName ?? "background",
              previewUrl: appearance.backgroundMediaPath,
              mime: appearance.backgroundMediaMime ?? "",
            }
            : null
        );
        setBackgroundType(appearance.backgroundType ?? "media");
        setBoothName(appearance.boothName ?? "");
        setBoothSlogan(appearance.boothSlogan ?? "");
        setContactEmail(appearance.contactEmail ?? "");
        setHeaderFont(appearance.headerFont ?? "Inter");
        setGeneralFont(appearance.generalFont ?? "Inter");
        setHeaderFontColor(appearance.headerFontColor ?? "#111827");
        setGeneralFontColor(appearance.generalFontColor ?? "#374151");
        setBgColor(appearance.bgColor ?? "#ffffff");
        setButtonBgColor(appearance.buttonBgColor ?? ACCENT_COLOR);
        setButtonHoverColor(appearance.buttonHoverColor ?? "#5348ff");
        setbuttonFont(appearance.buttonFont ?? "Inter");
        setButtonFontColor(appearance.buttonFontColor ?? "#ffffff");
        setStartButtonHidden(!!appearance.startButtonHidden);
        setStartButtonText(appearance.startButtonText ?? "Tap to Start");
        setSelectedBgColorId(appearance.selectedBgColorId ?? null);
      }

      // Settings
      if (settings) {
        // Camera
        setSelectedCameraId(settings.selectedCameraId ?? "");
        setMirrorCamera(settings.mirrorCamera ?? false);
        setCameraResolution(settings.cameraResolution ?? "1080p");
        setCameraWidth(settings.cameraWidth ?? 1920);
        setCameraHeight(settings.cameraHeight ?? 1080);
        setFacingMode(settings.facingMode ?? "user");

        // Capture
        setFlashEnabled(settings.flashEnabled ?? true);
        setSoundEnabled(settings.soundEnabled ?? true);

        // Printing
        setSelectedPrinter(settings.selectedPrinter ?? "");
        setPaperSize(settings.paperSize ?? "4x6");
        setPrintCopies(settings.printCopies ?? 1);
        setPrintColorMode(settings.printColorMode ?? "color");
        setPrintQuality(settings.printQuality ?? "high");
        setPrintOrientation(settings.printOrientation ?? "landscape");
        setPrintDuplexMode(settings.printDuplexMode ?? "simplex");
        setPrintDpi(settings.printDpi ?? 300);
        setUsePrinterDefaults(settings.usePrinterDefaults ?? false);

        // Storage
        setStoragePath(settings.storagePath ?? "");
        setAutoDeleteDays(settings.autoDeleteDays ?? 14);

        // General
        setDimWhenIdle(settings.dimWhenIdle ?? true);
        setIdleTimeout(settings.idleTimeout ?? 60);
        setLanguage(settings.language ?? "en");

        // Booth identity
        setBoothIdentityName(settings.boothIdentityName ?? "");
        setBoothLocation(settings.boothLocation ?? "");
        setOperatorName(settings.operatorName ?? "");

        // System
        // launchOnStartup intentionally omitted — see syncLaunchOnStartup().
        // The OS state is authoritative; a saved value here would overwrite it.
        setAutoRestart(settings.autoRestart ?? true);
        setAutoUpdateEnabled(settings.autoUpdateEnabled ?? true);

        // Flow
        setCountdown(settings.countdown ?? 5);
        setRetakeLimit(settings.retakeLimit ?? 0);
        setScreenTimers(settings.screenTimers ?? DEFAULT_SCREEN_TIMERS);
        setNumberOfShots(settings.numberOfShots ?? 3);
        setPrice(settings.price ?? 0);
        setAppMode(settings.appMode ?? DEFAULT_APP_MODE);
        setTimersEnabled(settings.timersEnabled ?? false);
        setConsentEnabled(settings.consentEnabled ?? true);
        setStorageChoiceEnabled(settings.storageChoiceEnabled ?? false);
        setGalleryOptionDisabled(settings.galleryOptionDisabled ?? false);
        setOperatorStorageEnabled(settings.operatorStorageEnabled ?? false);
        setOperatorStorageLabel(settings.operatorStorageLabel ?? "Our Storage");
        setOperatorStorageUrl(settings.operatorStorageUrl ?? "");
        setOperatorStorageApiKey(settings.operatorStorageApiKey ?? "");

        // Rental
        const rental = settings.rental ?? {};
        setRentalTimerEnabled(rental.timerEnabled ?? DEFAULT_RENTAL.timerEnabled);
        setRentalTimerHours(rental.timerHours ?? DEFAULT_RENTAL.timerHours);
        setRentalSessionLimitEnabled(rental.sessionLimitEnabled ?? DEFAULT_RENTAL.sessionLimitEnabled);
        setRentalSessionLimit(rental.sessionLimit ?? DEFAULT_RENTAL.sessionLimit);
        setOfflineModeEnabled(rental.offlineModeEnabled ?? DEFAULT_RENTAL.offlineModeEnabled);
        setAutoSaveTarget(rental.autoSaveTarget ?? DEFAULT_RENTAL.autoSaveTarget);
        setEndSessionSummaryEnabled(rental.endSessionSummaryEnabled ?? DEFAULT_RENTAL.endSessionSummaryEnabled);

        // Business
        const business = settings.business ?? {};
        setPaymentEnabled(business.paymentEnabled ?? DEFAULT_BUSINESS.paymentEnabled);
        setActiveProvider(business.activeProvider ?? null);
        setPaymentProviders(business.payment?.providers ?? { ...DEFAULT_BUSINESS.payment.providers });
        setStripeProviders(business.payment?.stripeProviders ?? { ...DEFAULT_STRIPE_PROVIDERS });
        setXenditProviders(business.payment?.xenditProviders ?? { ...DEFAULT_XENDIT_PROVIDERS });
        setPaypalProviders(business.payment?.paypalProviders ?? { ...DEFAULT_PAYPAL_PROVIDERS });
        setCashMode(business.payment?.cashMode ?? "manual");
        const pricing = business.pricing ?? DEFAULT_BUSINESS.pricing;
        setPricingModel(pricing.model ?? DEFAULT_BUSINESS.pricing.model);
        setPricePerSession(pricing.pricePerSession ?? DEFAULT_BUSINESS.pricing.pricePerSession);
        setAdditionalPrintPrice(pricing.additionalPrintPrice ?? DEFAULT_BUSINESS.pricing.additionalPrintPrice);
        setCurrency(pricing.currency ?? DEFAULT_BUSINESS.pricing.currency);
        setTaxEnabled(pricing.taxEnabled ?? DEFAULT_BUSINESS.pricing.taxEnabled);
        setTaxRate(pricing.taxRate ?? DEFAULT_BUSINESS.pricing.taxRate);
      }

      // Templates / Frames / Tones / Palettes
      // Start with what's in the local store
      let resolvedTemplates = Array.isArray(persistedTemplates) ? [...persistedTemplates] : [];
      let resolvedFrames = Array.isArray(persistedFrames) ? [...persistedFrames] : [];

      // Recover any templates/frames that are referenced by events but missing from the
      // library (can happen after Supabase overwrites before the local-wins fix was applied).
      // Sources: (1) previewMeta snapshot stored in the event, (2) DEFAULT_TEMPLATES/FRAMES by id.
      if (Array.isArray(persistedEvents)) {
        const localTplIds = new Set(resolvedTemplates.map((t) => String(t.id)));
        const localFrmIds = new Set(resolvedFrames.map((f) => String(f.id)));
        const defaultTplById = new Map(DEFAULT_TEMPLATES.map((t) => [String(t.id), t]));
        const defaultFrmById = new Map(DEFAULT_FRAMES.map((f) => [String(f.id), f]));
        const recovered = [];
        const recoveredFrames = [];

        for (const ev of persistedEvents) {
          for (const at of (ev.appliedTemplates ?? [])) {
            if (localTplIds.has(String(at.id))) continue;
            if (at.previewMeta) {
              // Preferred: restore from the event's own previewMeta snapshot
              recovered.push({ id: at.id, name: at.name, previewMeta: at.previewMeta, isDefault: String(at.id).startsWith('default-') });
            } else if (defaultTplById.has(String(at.id))) {
              // Fallback: restore from the built-in defaults (for default- prefixed templates)
              recovered.push(defaultTplById.get(String(at.id)));
            }
            localTplIds.add(String(at.id));
          }
          for (const af of (ev.appliedFrames ?? [])) {
            if (localFrmIds.has(String(af.id))) continue;
            if (defaultFrmById.has(String(af.id))) {
              // Frame SVG data isn't stored in events — restore from built-in defaults
              recoveredFrames.push(defaultFrmById.get(String(af.id)));
            }
            localFrmIds.add(String(af.id));
          }
        }

        if (recovered.length > 0) {
          resolvedTemplates = [...resolvedTemplates, ...recovered];
          // Persist the recovered templates so they survive next reload
          native?.setTemplates?.(resolvedTemplates, ctx).catch?.(() => {});
        }
        if (recoveredFrames.length > 0) {
          resolvedFrames = [...resolvedFrames, ...recoveredFrames];
          native?.setFrames?.(resolvedFrames, ctx).catch?.(() => {});
        }
      }

      setTemplates(resolvedTemplates);
      setFrames(resolvedFrames);
      if (Array.isArray(persistedTones)) setTones(persistedTones);
      if (Array.isArray(persistedPalettes)) setPalettes(persistedPalettes);

      // A reload always closes the open event and lands on Home. Restoring the
      // last event and tab meant a reload dropped the operator back into
      // whatever screen they were on, with an event still open; starting from
      // a known state is both predictable and the reliable way back to Home.
      // currentEventId / currentSubTab / activeMain are still persisted for the
      // booth, they are just not used to restore the dashboard here.
      setCurrentEvent(null);
      setActiveMain("home");
      setActiveSub("branding");

      setHydrated(true);
    } catch (err) {
      console.error('loadPersisted error', err);
      // Always mark hydrated so the skeleton doesn't get stuck permanently.
      setHydrated(true);
    }
  }, [native]);

  // Lightweight reload for templates and frames only — no full hydration cycle.
  const reloadLibrary = React.useCallback(async () => {
    if (!native || !identity?.userId) return;
    const ctx = { userId: identity.userId };
    setLibraryReloading(true);
    try {
      const [fetchedTemplates, fetchedFrames] = await Promise.all([
        native.getTemplates?.(ctx),
        native.getFrames?.(ctx),
      ]);
      if (Array.isArray(fetchedTemplates) && fetchedTemplates.length > 0) setTemplates(fetchedTemplates);
      if (Array.isArray(fetchedFrames) && fetchedFrames.length > 0) setFrames(fetchedFrames);
    } catch (err) {
      console.warn('[reloadLibrary] failed:', err);
    } finally {
      setLibraryReloading(false);
    }
  }, [native, identity?.userId]);

  /** Canvas refs (Templates editor) */
  const canvasRef = useRef(null);
  const pointerState = useRef({ mode: null, slotId: null, start: null, orig: null, handle: null });
  const rotatingRef = useRef(null);
  const avatarInputRef = useRef(null);

  const asSelectValue = (v) => (typeof v === 'string' ? v : v ?? '');

  /** Card classes */
  // UPDATED: composed tokens to be consistent with screenshot style
  const cardClass = `${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} p-4 mt-4 ${SHADOW_SOFT}`;
  const smallCardClass = `${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-3 ${SHADOW_SOFT}`;

  /** Light helpers */
  const showToast = (message, ms = 1600) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  // This is the function the editor expects:

  // Save from TemplateEditor (persists multi-frame selection + optional apply)
  const handleSaveTemplatePayload = async (payload) => {
    if (!editingTemplate && Number.isFinite(templateLimit) && templateLimit > 0 && templates.length >= templateLimit) {
      showToast(`Template limit reached for your current plan (${templateLimit}).`);
      return;
    }

    const pm = payload?.previewMeta ?? {};
    const nextPreviewMeta = {
      ...pm,
      attachedFrameIds: Array.isArray(pm.attachedFrameIds) ? pm.attachedFrameIds : [],
      activeFrameId: pm.activeFrameId ?? null,
    };

    let nextTemplates = templates;
    let templateRef = null;

    if (editingTemplate) {
      templateRef = {
        id: editingTemplate.id,
        name: payload.name,
        previewMeta: nextPreviewMeta,
      };

      nextTemplates = templates.map((t) =>
        t.id === editingTemplate.id
          ? { ...t, name: payload.name, previewMeta: nextPreviewMeta }
          : t
      );
    } else {
      const newTemplate = {
        id: crypto.randomUUID(),
        name: payload.name,
        previewMeta: nextPreviewMeta,
      };

      templateRef = {
        id: newTemplate.id,
        name: newTemplate.name,
        previewMeta: nextPreviewMeta,
      };

      nextTemplates = [...templates, newTemplate];
    }

    let nextEvents = null;

    if (payload.applyToCurrentEvent && currentEvent && templateRef) {
      const ev = JSON.parse(JSON.stringify(currentEvent));
      ev.appliedTemplates = ev.appliedTemplates ?? [];

      if (!ev.appliedTemplates.find((x) => x.id === templateRef.id)) {
        ev.appliedTemplates.push(templateRef);
      }

      nextEvents = events.map((e) => (e.id === ev.id ? ev : e));
    }

    await persistAll({
      nextTemplates,
      nextEvents,
    });

    if (payload.applyToCurrentEvent && currentEvent) {
      showToast?.("Template applied to current event");
    }

    setIsTemplateModalOpen(false);
    setEditingTemplate(null);
  };

  // ⬇️ Replace handleCanvasBackgroundPointerDown with:
  const handleCanvasBackgroundPointerDown = React.useCallback(
    (ev) => {
      const target = ev.target;
      const isInsideSlot = !!(target && target.closest && target.closest('[data-is-slot="true"]'));
      if (!isInsideSlot) {
        setSelectionIds([]);
        // Clear any active pointer interaction
        pointerState.current = { mode: null, slotId: null, start: null, orig: null, handle: null };
        try {
          ev.target?.releasePointerCapture?.(ev.pointerId);
        } catch { }
      }
    },
    [setSelectionIds]
  );

  const updateAccountField = (key, value) => {
    setAccountForm((prev) => ({ ...prev, [key]: value }));
  };

  const updatePasswordField = (key, value) => {
    setPasswordForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateAccountPreference = (key, value) => {
    setAccountPreferences((prev) => ({ ...prev, [key]: value }));
  };

  const chooseBadgePhoto = () => {
    avatarInputRef.current?.click();
  };

  const handleAvatarFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected if needed
    e.target.value = "";

    setProfileSaving(true);
    try {
      // Upload through the embedded server (service role) so storage policies
      // and profile update both use admin credentials — no RLS surprises.
      const result = await licensingApi.uploadAvatar(file);
      const publicUrl = result?.avatar_url;
      // Append cache-buster so the browser reloads the new image
      const bustedUrl = publicUrl ? `${publicUrl}?t=${Date.now()}` : publicUrl;
      setAccountForm((prev) => ({ ...prev, badgePhoto: bustedUrl }));
      showToast?.("Badge photo updated");
    } catch (err) {
      console.error(err);
      showToast?.(err?.message || "Failed to save badge photo");
    } finally {
      setProfileSaving(false);
    }
  };

  const saveAccountProfile = async () => {
    if (!user?.id) return;
    setProfileSaving(true);

    try {
      const patch = {
        full_name: accountForm.displayName?.trim() || "",
        email: accountForm.email?.trim() || "",
        phone: accountForm.phone?.trim() || "",
        company: accountForm.company?.trim() || "",
      };
      // Only include avatar_url when we actually have one; sending "" would wipe
      // any previously uploaded photo stored in the profiles row.
      if (accountForm.badgePhoto) patch.avatar_url = accountForm.badgePhoto;

      // Use the embedded API server (service role) — avoids anon-client RLS issues.
      const result = await licensingApi.updateUserProfile(patch);
      const data = result?.profile || null;

      setAccountForm((prev) => ({
        ...prev,
        displayName: data?.full_name || patch.full_name || prev.displayName,
        email: data?.email || patch.email || prev.email,
        phone: data?.phone || patch.phone || prev.phone,
        company: data?.company || patch.company || prev.company,
        badgePhoto: data?.avatar_url || patch.avatar_url || prev.badgePhoto,
      }));

      showToast?.("Profile saved");
    } catch (err) {
      console.error(err);
      showToast?.(err?.message || "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async () => {
    if (!passwordForm.currentPassword) {
      showToast?.("Enter your current password");
      return;
    }
    if (!passwordForm.newPassword || !passwordForm.confirmPassword) {
      showToast?.("Complete the new password fields");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast?.("New password and confirm password do not match");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      showToast?.("New password must be at least 8 characters");
      return;
    }

    setPasswordSaving(true);
    try {
      // The embedded server verifies currentPassword via Supabase signInWithPassword
      // before calling the admin API to change it — current password is never skipped.
      await Promise.race([
        licensingApi.changePassword(passwordForm.currentPassword, passwordForm.newPassword),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out. Check your connection.")), 20000)
        ),
      ]);

      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showToast?.("Password changed");
    } catch (e) {
      console.error(e);
      showToast?.(e?.message || "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  const loadBooths = useCallback(async () => {
    if (!user?.id) return;
    setBoothsLoading(true);
    try {
      // Only load booths seen in the last 30 days — anything older is stale debris
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('booths')
        .select('*')
        .eq('user_id', user.id)
        .gte('last_seen_at', cutoff)
        .order('last_seen_at', { ascending: false });

      if (!error) {
        // Heartbeat is every 30 s. If last_seen_at is >2 min old the booth
        // has stopped sending heartbeats (crash / force-quit) — treat as offline.
        const STALE_MS = 2 * 60 * 1000;
        const now = Date.now();
        setBooths(
          (data || []).map((b) => ({
            ...b,
            is_online: b.is_online && b.last_seen_at
              ? now - new Date(b.last_seen_at).getTime() < STALE_MS
              : false,
          }))
        );
      }
    } catch (err) {
      console.error('loadBooths failed:', err);
    } finally {
      setBoothsLoading(false);
    }
  }, [user?.id]);

  const deleteBooth = useCallback(async (boothId) => {
    try {
      await supabase.from('booths').delete().eq('id', boothId).eq('user_id', user.id);
      setBooths(prev => prev.filter(b => b.id !== boothId));
    } catch (err) {
      console.error('deleteBooth failed:', err);
    }
  }, [user?.id]);

  // Subscribe to real-time booth status changes
  useEffect(() => {
    if (!user?.id) return;

    loadBooths();

    const channel = supabase
      .channel('booths-status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'booths', filter: `user_id=eq.${user.id}` },
        () => loadBooths()  // reload whenever any booth row changes
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [user?.id, loadBooths]);

  // Send a command and wait for the booth to acknowledge it
  const sendCommandToBooth = async (boothId, action, payload = {}) => {
    const labels = {
      ping:               'Pinging booth…',
      'restart-booth':    'Restarting booth…',
      'stop-booth':       'Stopping booth…',
      'update-event':     'Pushing event…',
    };
    const successLabels = {
      ping:               'Booth is online and responding',
      'restart-booth':    'Booth is restarting',
      'stop-booth':       'Booth closed',
      'update-event':     'Event pushed to booth',
    };

    showToast(labels[action] ?? `Sending "${action}"…`);

    try {
      const { sendCommandAndWaitForAck } = await import('../services/remoteControl');
      const result = await sendCommandAndWaitForAck(boothId, action, payload);

      if (action === 'stop-booth') {
        // Fire-and-forget — app closes before it can ACK, so any result is fine
        showToast(successLabels['stop-booth']);
        setTimeout(() => loadBooths(), 4000);
      } else if (result?.timedOut) {
        showToast('Booth did not respond — it may be offline or busy');
      } else if (result?.ok) {
        showToast(successLabels[action] ?? `"${action}" confirmed`);
      } else {
        showToast(result?.error ?? `Failed: "${action}"`);
      }
    } catch (err) {
      console.error('sendCommandToBooth failed:', err);
      showToast(`Failed to send "${action}"`);
    }
  };

  const saveAccountPreferences = async () => {
    setPrefsSaving(true);
    try {
      const res = await window.electron?.saveAccountPreferences?.(accountPreferences);
      if (res?.ok) {
        showToast?.("Preferences saved");
        // Fire a confirmation notification so the operator can verify desktop
        // notifications are working at OS level.
        if (accountPreferences.desktopNotifications &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted") {
          new Notification("Studio Photuna", {
            body: "Desktop notifications are enabled for this account.",
            silent: true,
          });
        }
      } else {
        showToast?.(res?.error || "Failed to save preferences");
      }
    } catch (err) {
      console.error(err);
      showToast?.("Failed to save preferences");
    } finally {
      setPrefsSaving(false);
    }
  };

  const profileImage =
    accountForm?.badgePhoto ||
    user?.user_metadata?.avatar_url ||
    user?.photoURL ||
    user?.avatar ||
    "";

  const sidebarDisplayName =
    accountForm?.displayName?.trim() ||
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.email ||
    identity?.username ||
    "User";

  const sidebarEmail =
    accountForm?.email?.trim() ||
    user?.email ||
    "Admin account";

  const sidebarInitial = sidebarDisplayName.charAt(0).toUpperCase();

  // Machine-level health monitoring. Rendered from Settings → System;
  // it reports on this booth PC, not on the account.
  const renderSystemHealth = () => {
        const loadHealth = async () => {
          setHealthLoading(true);
          try {
            const snap = await window.electron?.getHealthStatus?.();
            if (snap) setHealthSnapshot(snap);
          } catch {}
          finally { setHealthLoading(false); }
        };

        const snap = healthSnapshot;

        const Chip = ({ ok, label }) => (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>{label}</span>
        );

        const Row = ({ label, value, warn }) => (
          <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
            <span className="text-xs text-slate-500">{label}</span>
            <span className={`text-xs font-semibold ${warn ? "text-amber-600" : "text-slate-800"}`}>{value}</span>
          </div>
        );

        const fmtUptime = (sec) => {
          if (!sec && sec !== 0) return "—";
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };

        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

            {/* Run check button */}
            <div className="sm:col-span-2 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">System Health</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  {snap?.ts ? `Last checked ${new Date(snap.ts).toLocaleTimeString()}` : "Not yet checked this session"}
                </p>
              </div>
              <button
                type="button"
                onClick={loadHealth}
                disabled={healthLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 transition"
              >
                {healthLoading ? "Checking…" : "Run Check"}
              </button>
            </div>

            {!snap && !healthLoading && (
              <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
                Click Run Check to inspect system health.
              </div>
            )}

            {snap && (
              <>
                {/* Memory */}
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Memory</h5>
                    <Chip ok={!snap.memory?.warn} label={snap.memory?.warn ? "High" : "OK"} />
                  </div>
                  <Row label="Heap used" value={snap.memory?.heapMB != null ? `${snap.memory.heapMB} MB` : "—"} warn={snap.memory?.heapMB > 800} />
                  <Row label="RSS" value={snap.memory?.rssMB != null ? `${snap.memory.rssMB} MB` : "—"} warn={snap.memory?.rssMB > 1500} />
                  <p className="mt-2 text-[10px] text-slate-400">Warn if heap &gt;800 MB or RSS &gt;1 500 MB — may indicate a memory leak</p>
                </div>

                {/* Disk */}
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Disk</h5>
                    <Chip ok={!snap.disk?.warn} label={snap.disk?.error ? "N/A" : snap.disk?.warn ? "Low" : "OK"} />
                  </div>
                  <Row label="Free space" value={snap.disk?.freeGB != null ? `${snap.disk.freeGB} GB` : "—"} warn={snap.disk?.warn} />
                  <Row label="Total" value={snap.disk?.totalGB != null ? `${snap.disk.totalGB} GB` : "—"} />
                  <p className="mt-2 text-[10px] text-slate-400">Warn if &lt;1 GB free — photo sessions consume ~5–20 MB each</p>
                </div>

                {/* Sessions */}
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Sessions</h5>
                    <Chip ok={!snap.sessions?.warn} label={snap.sessions?.warn ? "High" : "OK"} />
                  </div>
                  <Row label="Saved sessions" value={snap.sessions?.count != null ? snap.sessions.count.toLocaleString() : "—"} warn={snap.sessions?.warn} />
                  <p className="mt-2 text-[10px] text-slate-400">Warn if &gt;1 000 folders — consider archiving old sessions to free disk space</p>
                </div>

                {/* Uptime & errors */}
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Process</h5>
                    <Chip ok={snap.errors?.total === 0} label={snap.errors?.total > 0 ? `${snap.errors.total} error${snap.errors.total !== 1 ? "s" : ""}` : "No errors"} />
                  </div>
                  <Row label="App uptime" value={fmtUptime(snap.uptime?.appSeconds)} />
                  <Row label="OS uptime" value={fmtUptime(snap.uptime?.osSeconds)} />
                  <Row label="Unhandled errors" value={snap.errors?.total ?? 0} warn={snap.errors?.total > 0} />
                  <p className="mt-2 text-[10px] text-slate-400">Error details saved to AppData/logs/errors.log</p>
                </div>

                {/* Overall */}
                <div className="sm:col-span-2">
                  <div className={`rounded-xl border p-4 text-sm font-medium ${snap.ok ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                    {snap.ok
                      ? "System is healthy — no warnings detected."
                      : "One or more warnings detected. Review the cards above and address them before a long unattended run."}
                  </div>
                </div>
              </>
            )}
          </div>
        );
  };

  // Dashboard appearance + alert preferences. Rendered from
  // Settings → General. Account-scoped values, but they are settings,
  // so they belong with the other settings rather than under Account.
  const renderAppearanceAlerts = () => (
        // Spans the full width of the Settings grid and splits into two cards,
        // so it sits with its neighbours instead of stacking full-bleed.
        <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ── Notifications & Behavior ── */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
            <div className="mb-5">
              <h4 className={`text-sm font-bold ${BODY_TEXT}`}>Notifications</h4>
              <p className={`mt-1 text-xs ${SOFT_TEXT}`}>Control how the dashboard behaves for this account.</p>
            </div>

            <div className="space-y-1">
              {/* Booth-level controls do NOT belong here. "Enable sounds" was
                  removed: the booth reads soundEnabled from event/booth settings
                  (PhotoScreen.js), never from account preferences, so this copy
                  wrote to a second store and only reached the booth via a
                  sync-back. The working control lives in Settings → Camera. */}
              {[
                { key: "desktopNotifications", label: "Desktop notifications", desc: "Show system notifications for important alerts" },
              ].map(({ key, label, desc }) => {
                const checked = Boolean(accountPreferences[key]);
                return (
                  <label key={key} className={`flex items-center justify-between gap-4 rounded-xl p-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors`}>
                    <div>
                      <div className={`text-sm font-medium ${BODY_TEXT}`}>{label}</div>
                      <div className={`text-xs ${SOFT_TEXT} mt-0.5`}>{desc}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      onClick={() => {
                        const next = !accountPreferences[key];
                        setAccountPreferences((p) => ({ ...p, [key]: next }));
                        // desktopNotifications: request OS permission when turned on
                        if (key === "desktopNotifications" && next) {
                          if (typeof Notification !== "undefined" && Notification.permission === "default") {
                            Notification.requestPermission();
                          }
                        }
                      }}
                      className={`relative flex-shrink-0 h-6 w-11 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 ${checked ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-600"}`}
                    >
                      <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </label>
                );
              })}
            </div>

          </div>

          {/* ── Appearance & Language ── */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
            <div className="mb-5">
              <h4 className={`text-sm font-bold ${BODY_TEXT}`}>Appearance</h4>
              <p className={`mt-1 text-xs ${SOFT_TEXT}`}>Theme controls the dashboard UI. Language applies to booth screens shown to guests.</p>
            </div>

            <div className="space-y-5">
              {/* Theme */}
              <div className="space-y-1.5">
                <label className={EYEBROW}>Theme</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "system", label: "System", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
                    { value: "light",  label: "Light",  icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" },
                    { value: "dark",   label: "Dark",   icon: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" },
                  ].map(({ value, label, icon }) => {
                    const active = accountPreferences.theme === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAccountPreferences((p) => ({ ...p, theme: value }))}
                        className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-semibold transition-all ${
                          active
                            ? "border-blue-400 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 shadow-sm"
                            : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500"
                        }`}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
                        </svg>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* The Booth Language pointer that used to sit here is gone: this
                  panel now renders inside Settings → General, where the real
                  Language control is a few rows further down. */}
            </div>

          </div>
        </div>
  );

  // `billingOnly` renders just the Billing & Gallery section as its own
  // top-level page (reached from the left navigator) without Account Central's
  // tab bar. Billing is a destination in its own right, not a sub-tab.
  // Built-in sample layouts. Shown inside the Templates tab under its
  // "Samples" view rather than as a separate destination — it is a source
  // you add from, not a property of the event.
  const renderSampleTemplates = () => (
                    <div className={cardClass}>
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Sample Layouts</div>
                        <p className="mt-1 text-xs text-gray-500">
                          Ready-made templates and frames. Pick what you want — nothing is added unless you choose it.
                          Applied layouts only affect <strong>{currentEvent.name}</strong>.
                        </p>
                      </div>

                      {/* Sample templates */}
                      <div className="mt-6">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Templates</div>
                          {/* Format filter chips */}
                          <div className="flex items-center gap-1">
                            {["all", "4x6", "2x6", "6x4", "6x2"].map((fmt) => (
                              <button
                                key={fmt}
                                onClick={() => setSampleFormatFilter(fmt)}
                                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition ${
                                  sampleFormatFilter === fmt
                                    ? "bg-blue-600 text-white"
                                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                }`}
                              >
                                {fmt === "all" ? "All" : fmt}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory scroll-smooth">
                          {DEFAULT_TEMPLATES.filter((tpl) => {
                            if (sampleFormatFilter === "all") return true;
                            return (tpl.previewMeta?.layout ?? "4x6") === sampleFormatFilter;
                          }).map((tpl) => {
                            const inLibrary = templates.some(t => t.id === tpl.id);
                            const alreadyApplied = currentEvent?.appliedTemplates?.some(t => t.id === tpl.id) ?? false;
                            const layout = tpl.previewMeta?.layout ?? "4x6";
                            const thumbSrc = tpl.previewMeta?.thumbnailDataUrl;
                            return (
                              <div key={tpl.id} className="w-44 flex-shrink-0 snap-start rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2">
                                {thumbSrc ? (
                                  <div className="h-36 w-full overflow-hidden rounded-lg border border-slate-100 bg-slate-50 flex items-center justify-center">
                                    <img src={thumbSrc} alt={tpl.name} className="h-full w-full object-contain" loading="lazy" />
                                  </div>
                                ) : (
                                  <div className="h-36 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-[10px] text-slate-400">No preview</div>
                                )}
                                <div>
                                  <div className="text-xs font-semibold text-slate-800 truncate">{tpl.name}</div>
                                  <div className="text-[10px] text-slate-400">{(tpl.previewMeta?.slots?.length ?? 0)} slots · {layout}</div>
                                </div>
                                <div className="mt-auto flex flex-col gap-1.5">
                                  {alreadyApplied ? (
                                    <span className="inline-flex items-center gap-1 justify-center rounded-lg bg-emerald-50 px-2 py-1.5 text-[10px] font-semibold text-emerald-700">
                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                      Applied
                                    </span>
                                  ) : (
                                    <button type="button" onClick={() => handleApplySampleTemplate(tpl)} className="w-full rounded-lg bg-blue-600 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-blue-700 transition">
                                      Apply
                                    </button>
                                  )}
                                  {!inLibrary && !alreadyApplied && (
                                    <button type="button" onClick={() => handleAddSampleTemplate(tpl)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                                      Save to library
                                    </button>
                                  )}
                                  {inLibrary && !alreadyApplied && (
                                    <span className="text-center text-[10px] text-slate-400">In library</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                    </div>
  );

  const renderAccountBilling = ({ billingOnly = false } = {}) => (
    <div className="space-y-6">
      {billingOnly && (
        <PageHero
          eyebrow="Billing"
          title="Billing & Gallery"
          description="Your plan, payment history, and the gallery add-on."
          wave={<WavePattern />}
        />
      )}

      {/* Account identity hero. Hidden on the standalone Billing page — that
          is its own destination, not part of the account panel. */}
      {!billingOnly && (
      <div className="relative overflow-hidden rounded-xl border border-white/20 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 px-6 py-7 text-white shadow-[0_24px_64px_rgba(37,99,235,0.25)]">
        <WavePattern />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5">
            {/* Avatar */}
            <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 border-white/30 bg-white/10 shadow-lg">
              {accountForm.badgePhoto ? (
                <img src={accountForm.badgePhoto} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white/60">
                  {(user?.user_metadata?.full_name || user?.email || "U").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                Account Center
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>
                {user?.user_metadata?.full_name || user?.email || "Your account"}
              </h2>
              <p className="mt-1 text-sm text-white/80">
                Manage your profile, security, subscription, and preferences.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${(license?.active || gating?.allow) ? "bg-emerald-100 text-emerald-700" : trialEligible ? "bg-amber-100 text-amber-700" : "bg-white/20 text-white"}`}>
              {(license?.active || gating?.allow) ? "Licensed" : trialEligible ? "Trial available" : "No active plan"}
            </span>
            {(license?.active || gating?.allow) && (
              <a
                href={`mailto:support@studiophotuna.com?subject=${encodeURIComponent(`Billing Inquiry — ${plan === "yearly" ? "Yearly" : plan === "monthly" ? "Monthly" : "Pro"} Plan`)}&body=${encodeURIComponent(`Hi Studio Photuna,\n\nI need help with my current subscription.\n\nAccount: ${user?.email ?? ""}\nPlan: ${plan ?? "active"}\n\nDetails:\n`)}`}
                className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                Manage billing
              </a>
            )}
            <button
              onClick={async () => {
                try { await refreshLicense(); showToast?.("License refreshed"); }
                catch (e) { showToast?.("Failed to refresh"); }
              }}
              className="inline-flex items-center justify-center rounded-lg border border-white/25 bg-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25"
            >
              Refresh status
            </button>
          </div>
        </div>

        {/* Plan stat tiles inside the gradient */}
        <div className="relative z-10 mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Plan", value: licenseLoading && !plan ? "…" : planDisplayName },
            { label: "Status", value: (license?.active || gating?.allow) ? "Active" : "Inactive" },
            { label: "Events", value: `${events.length} / ${eventLimit === Infinity ? "∞" : eventLimit}` },
            { label: "Templates", value: `${templateLimit === Infinity ? "∞" : templateLimit} max` },
            { label: "Gallery", value: galleryAddonEnabled ? "Enabled" : "Off" },
            { label: "Best Value", value: prices?.yearly?.display ?? "₱950 / mo" },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">{label}</div>
              <div className="mt-1 text-sm font-bold text-white truncate">{value}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ===== ACCOUNT NAV TABS ===== */}
      {!billingOnly && (
      <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${TOOLBAR_RADIUS} ${SHADOW_SOFT} p-1.5 flex flex-wrap items-center gap-1.5`}>
        {[
          ["profile", "Profile"],
          ["security", "Security"],
          ["business", "Business"],
          // Appearance & Alerts moved to Settings → General and System Health to
          // Settings → System: both configure the app/machine, not the account.
          // Billing is now a top-level destination in the left navigator.
          // What remains here is identity, security and business configuration.
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setAccountTab(key)}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${accountTab === key
              ? "bg-blue-600 text-white shadow-md shadow-blue-200"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              }`}
          >
            {label}
          </button>
        ))}
      </div>
      )}

      {/* ===== PROFILE TAB ===== */}
      {!billingOnly && accountTab === "profile" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px,minmax(0,1fr)]">
          {/* Left — avatar card */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
            <div className="flex flex-col items-center text-center">
              <div className="h-28 w-28 overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-100 shadow-inner">
                {accountForm.badgePhoto ? (
                  <img src={accountForm.badgePhoto} alt="Badge" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-slate-300">
                    {(user?.user_metadata?.full_name || user?.email || "U").charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <h4 className="mt-4 text-sm font-bold text-slate-900">
                {accountForm.displayName || user?.user_metadata?.full_name || "Your Name"}
              </h4>
              <p className="mt-0.5 text-xs text-slate-500">{accountForm.role || "Operator"}</p>
              <p className="mt-0.5 text-xs text-slate-400">{accountForm.email || user?.email || ""}</p>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleAvatarFileChange}
              />
              <button
                type="button"
                onClick={chooseBadgePhoto}
                disabled={profileSaving}
                className="mt-5 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {profileSaving ? "Uploading…" : "Update photo"}
              </button>
            </div>

            {/* Quick info */}
            <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
              {[
                { label: "Company", value: accountForm.company || "—" },
                { label: "Phone", value: accountForm.phone || "—" },
                { label: "Plan", value: planDisplayName },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">{label}</span>
                  <span className="text-slate-700 font-semibold">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — edit form */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
            <div className="mb-5">
              <h4 className="text-sm font-bold text-slate-900">Edit Profile</h4>
              <p className="mt-1 text-xs text-slate-500">Update your display name, contact info, and team details.</p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Display Name</label>
                <input
                  type="text"
                  value={accountForm.displayName}
                  onChange={(e) => updateAccountField("displayName", e.target.value)}
                  placeholder="Your full name"
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-4 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Email</label>
                <input
                  type="email"
                  value={accountForm.email}
                  onChange={(e) => updateAccountField("email", e.target.value)}
                  placeholder="you@example.com"
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-4 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Phone</label>
                <input
                  type="tel"
                  value={accountForm.phone}
                  onChange={(e) => updateAccountField("phone", e.target.value)}
                  placeholder="+63 9XX XXX XXXX"
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-4 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Role</label>
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-4 py-2.5 text-sm text-slate-500`}>
                  {accountForm.role || "Administrator"}
                </div>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Company / Team</label>
                <input
                  type="text"
                  value={accountForm.company}
                  onChange={(e) => updateAccountField("company", e.target.value)}
                  placeholder="Your business name"
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-4 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={saveAccountProfile}
                disabled={profileSaving}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {profileSaving ? "Saving..." : "Save profile"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== SECURITY TAB ===== */}
      {!billingOnly && accountTab === "security" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Change password */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
            <div className="mb-5">
              <h4 className="text-sm font-bold text-slate-900">Change Password</h4>
              <p className="mt-1 text-xs text-slate-500">Keep your account secure by updating your credentials regularly.</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Password</label>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => updatePasswordField("currentPassword", e.target.value)}
                  placeholder="Enter current password"
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-4 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">New Password</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => updatePasswordField("newPassword", e.target.value)}
                  placeholder="At least 8 characters"
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-4 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => updatePasswordField("confirmPassword", e.target.value)}
                  placeholder="Re-enter new password"
                  className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-4 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={changePassword}
                disabled={passwordSaving}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {passwordSaving ? "Updating..." : "Change password"}
              </button>
            </div>
          </div>

          {/* Security overview */}
          <div className="space-y-5">
            <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
              <h4 className="text-sm font-bold text-slate-900 mb-4">Account Security</h4>
              <div className="space-y-4">
                {[
                  { label: "Email verified", status: user?.email_confirmed_at ? true : false, detail: user?.email || "—" },
                  { label: "Password set", status: true, detail: "Last changed via Supabase Auth" },
                  { label: "Two-factor auth", status: false, detail: "Not yet available" },
                ].map(({ label, status, detail }) => (
                  <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                    <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${status ? "bg-emerald-100" : "bg-slate-100"}`}>
                      {status ? (
                        <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01" /></svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-800">{label}</div>
                      <div className="text-xs text-slate-500 truncate">{detail}</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {status ? "Active" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
              <h4 className="text-sm font-bold text-slate-900 mb-3">Security Tips</h4>
              <div className="space-y-3">
                {[
                  "Use at least 8 characters with a mix of letters, numbers, and symbols.",
                  "Avoid reusing passwords from other services or sharing them across operators.",
                  "Change credentials immediately when booth access is shared with new team members.",
                ].map((tip, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold text-blue-600 mt-px">{i + 1}</span>
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== BILLING TAB ===== */}
      {/* Shown as its own page from the left navigator (billingOnly), or via the
          Account tab bar for anyone arriving the old way. */}
      {(billingOnly || accountTab === "billing") && (
        <>
          {/* Current subscription summary */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
            <SubscriptionSummary license={license} gating={gating} prices={prices} />
          </div>

          {/* ===== Pricing Cards — mirrors website structure ===== */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Choose a Plan</h4>
                <p className="mt-1 text-xs text-slate-500">Start free, then choose monthly flexibility or yearly savings.</p>
              </div>
              <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700">Recommended: Yearly</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
              {/* Trial Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                <div className="space-y-4">
                  <span className="inline-flex rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-blue-600">Trial</span>
                  <h3 className="text-xl font-bold text-slate-900">14-Day Free Trial</h3>
                  <div className="text-4xl font-black text-slate-900">₱0</div>
                  <p className="text-sm text-slate-500">Test the operator workspace before committing to a plan.</p>
                  <div className="space-y-2 pt-3">
                    {["3 events, 5 templates", "Watermark enabled", "Full booth flow experience", "No payment required"].map((feat) => (
                      <div key={feat} className="flex items-center gap-2 text-sm text-slate-700">
                        <svg className="h-4 w-4 flex-shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!trialEligible || trialLoading}
                  onClick={async () => {
                    setTrialLoading(true);
                    try {
                      await licensingApi.redeemTrial();
                      await ctxRefreshLicense();
                      showToast?.("Trial started");
                    } catch (e) {
                      console.error("trial failed:", e);
                      showToast?.(`Trial failed: ${e?.message ?? "unknown error"}`);
                    } finally {
                      setTrialLoading(false);
                    }
                  }}
                  className={`mt-6 w-full rounded-lg py-3 text-sm font-bold transition-all duration-200 ${trialEligible && !trialLoading
                    ? "border border-slate-200 text-slate-800 hover:bg-slate-50 hover:-translate-y-0.5 hover:shadow-md"
                    : "border border-slate-100 text-slate-400 cursor-not-allowed bg-slate-50"
                    }`}
                >
                  {trialLoading ? "Starting trial…" : trialEligible ? "Start Free Trial" : "Trial unavailable"}
                </button>
              </div>

              {/* Pro Card — with billing cycle toggle */}
              <div className="relative rounded-xl border-2 border-blue-500 bg-slate-900 p-6 flex flex-col justify-between text-white shadow-[0_24px_64px_rgba(37,99,235,0.2)] md:scale-[1.02]">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-white shadow-md">
                  Best Value
                </span>
                <div className="space-y-4 mt-2">
                  <h3 className="text-xl font-bold text-white">Studio Photuna Pro</h3>

                  {/* Billing toggle — matching website structure */}
                  <div className="grid grid-cols-2 gap-1.5 rounded-full border border-white/20 bg-white/10 p-1.5">
                    <button
                      type="button"
                      onClick={() => setBillingCycle("monthly")}
                      className={`rounded-full py-2 text-xs font-bold transition-all duration-200 ${billingCycle === "monthly" ? "bg-white text-slate-900 shadow-sm" : "text-white/70 hover:text-white"}`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingCycle("yearly")}
                      className={`rounded-full py-2 text-xs font-bold transition-all duration-200 ${billingCycle === "yearly" ? "bg-white text-slate-900 shadow-sm" : "text-white/70 hover:text-white"}`}
                    >
                      Yearly
                    </button>
                  </div>

                  <div>
                    <div className="text-4xl font-black text-white">
                      {billingCycle === "yearly"
                        ? (prices?.yearly?.display ?? "₱950/mo")
                        : (prices?.monthly?.display ?? "₱1,800/mo")}
                    </div>
                    <p className="mt-1 text-sm text-white/70">
                      {billingCycle === "yearly"
                        ? `${prices?.yearly?.annual ?? "₱11,400"} one-time payment for 12 months. Save ₱10,200 vs monthly.`
                        : "Billed monthly via GCash. Switch to yearly for better value."}
                    </p>
                  </div>

                  <div className="space-y-2 pt-2">
                    {[
                      { icon: "star", text: billingCycle === "yearly" ? "50 events, 100 templates" : "20 events, 30 templates" },
                      { icon: "check", text: "Watermark removed" },
                      { icon: "check", text: billingCycle === "yearly" ? "Priority support included" : "Standard support" },
                      { icon: "check", text: "Continuous software feature releases" },
                    ].map(({ icon, text }) => (
                      <div key={text} className="flex items-center gap-2 text-sm font-medium text-white/90">
                        {icon === "star" ? (
                          <svg className="h-4 w-4 flex-shrink-0 text-yellow-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
                        ) : (
                          <svg className="h-4 w-4 flex-shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        )}
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {hasPaidPlan ? (
                  <div className="mt-6 space-y-2">
                    <div className="w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-white text-center shadow-md cursor-default">
                      Plan Active
                    </div>
                    <p className="text-center text-[11px] text-white/60">
                      To change or cancel, email{" "}
                      <a href="mailto:support@studiophotuna.com" className="underline text-white/80">support@studiophotuna.com</a>
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openPayMongoPayment("subscription", billingCycle)}
                    className="mt-6 w-full rounded-lg bg-blue-600 py-3 text-sm font-bold text-white shadow-md transition-all duration-200 hover:bg-blue-500 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
                  >
                    {`Pay via PayMongo — ${billingCycle === "yearly" ? "Yearly" : "Monthly"}`}
                  </button>
                )}
              </div>
            </div>

            {/* PlanCards kept for backward compatibility if needed */}
          </div>

          {/* Trust signals */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { title: "Secure billing", desc: "Payments processed securely via PayMongo. Your plan activates automatically once payment is confirmed.", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
              { title: "Flexible changes", desc: "Upgrade, downgrade, or cancel anytime based on booth usage and event demand.", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
              { title: "Trial friendly", desc: "Start with a 14-day trial when eligible. Switch to a paid plan whenever you're ready.", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
            ].map(({ title, desc, icon }) => (
              <div key={title} className={`${CARD_RADIUS} border border-slate-100 bg-slate-50/60 p-5`}>
                <div className="flex items-center gap-2.5 mb-2">
                  <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} /></svg>
                  <div className="text-sm font-semibold text-slate-800">{title}</div>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">{desc}</p>
              </div>
            ))}
          </div>

          {/* ── Gallery & Video Archive ── */}
          <div className="flex items-center gap-4 pt-2">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Gallery & Video Archive</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Gate notice for free / trial users */}
          {!hasPaidPlan && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
              <svg className="h-4 w-4 flex-shrink-0 text-amber-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Gallery add-ons require an active Pro plan.</span>{" "}
                Upgrade to Monthly or Yearly above, then come back to activate a Gallery tier.
              </p>
            </div>
          )}

          {/* Gallery header */}
          <div className="text-center max-w-2xl mx-auto">
            <h3 className="text-lg font-bold text-slate-900">Gallery & Video Archive Plans</h3>
            <p className="mt-1 text-sm text-slate-500">Host event galleries, share via QR, and archive booth videos with a plan that fits your scale.</p>
          </div>

          {/* 3-tier pricing grid */}
          <div className={`grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch ${!hasPaidPlan ? "opacity-60 pointer-events-none select-none" : ""}`}>

            {/* FREE tier */}
            <div className={`rounded-xl border ${galleryPlan === "free" ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"} bg-white p-6 flex flex-col justify-between hover:shadow-md transition-all`}>
              <div className="space-y-4">
                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-600">Free</span>
                <div>
                  <div className="text-4xl font-black text-slate-900">₱0</div>
                  <p className="text-xs text-slate-400 mt-1">No credit card required</p>
                </div>

                <div className="pt-3 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Video Archive</div>
                      <div className="text-xs text-slate-500">Up to 1 week</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Photo Archive</div>
                      <div className="text-xs text-slate-500">Up to 1 week</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Unlimited Events</div>
                      <div className="text-xs text-slate-500">Capture an unlimited number of events</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-slate-300 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-400">Custom Event Colors</div>
                      <div className="text-xs text-slate-400">Plus &amp; Business only</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-slate-300 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-400">Event Link</div>
                      <div className="text-xs text-slate-400">Plus &amp; Business only</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-slate-300 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-400">Embed Event Album</div>
                      <div className="text-xs text-slate-400">Plus &amp; Business only</div>
                    </div>
                  </div>
                </div>
              </div>
              {galleryPlan === "free" ? (
                <div className="mt-6 w-full rounded-lg bg-blue-600 py-3 text-sm font-bold text-white text-center shadow-md cursor-default">
                  Current Plan
                </div>
              ) : (
                <div className="mt-6 space-y-2">
                  <div className="w-full rounded-lg border border-slate-100 bg-slate-50 py-3 text-sm font-bold text-slate-400 text-center cursor-not-allowed">
                    Included in your plan
                  </div>
                  <p className="text-center text-[11px] text-slate-400">
                    Email <a href="mailto:support@studiophotuna.com" className="underline">support@studiophotuna.com</a> to downgrade
                  </p>
                </div>
              )}
            </div>

            {/* PLUS tier — ₱900/mo */}
            <div className={`relative rounded-xl border-2 ${galleryPlan === "plus" ? "border-blue-500 ring-2 ring-blue-100" : "border-blue-400"} bg-slate-900 p-6 flex flex-col justify-between text-white shadow-[0_24px_64px_rgba(37,99,235,0.18)] md:scale-[1.03]`}>
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-white shadow-md">
                Popular
              </span>
              <div className="space-y-4 mt-2">
                <span className="inline-flex rounded-full bg-white/15 border border-white/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white">Plus</span>
                <div>
                  <div className="text-4xl font-black text-white">₱900<small className="text-sm font-semibold text-white/70">/mo</small></div>
                  <p className="text-xs text-white/60 mt-1">Billed monthly</p>
                </div>

                <div className="pt-3 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-yellow-400 mt-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-white">Video Archive</div>
                      <div className="text-xs text-white/60">Up to 6 months</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-yellow-400 mt-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-white">Photo Archive</div>
                      <div className="text-xs text-white/60">Up to 6 months</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-white">Unlimited Events</div>
                      <div className="text-xs text-white/60">No limits on event capture</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-white">Custom Event Colors</div>
                      <div className="text-xs text-white/60">Background and text customization</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-white">Event Link & Embed</div>
                      <div className="text-xs text-white/60">Public link + embeddable album</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-white">QR Code Sharing</div>
                      <div className="text-xs text-white/60">Guests scan to download at the booth</div>
                    </div>
                  </div>
                </div>
              </div>
              {galleryPlan === "plus" ? (
                <div className="mt-6 w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-white text-center shadow-md cursor-default">
                  Current Plan
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!hasPaidPlan}
                  onClick={() => hasPaidPlan && openPayMongoPayment("gallery", "plus")}
                  className={`mt-6 w-full rounded-lg py-3 text-sm font-bold shadow-md transition-all active:scale-[0.98] ${hasPaidPlan ? "bg-blue-600 text-white hover:bg-blue-500 hover:-translate-y-0.5 hover:shadow-lg" : "bg-white/10 text-white/40 cursor-not-allowed"}`}
                >
                  Pay via PayMongo — Plus
                </button>
              )}
            </div>

            {/* BUSINESS tier — ₱1,700/mo */}
            <div className={`rounded-xl border ${galleryPlan === "business" ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"} bg-white p-6 flex flex-col justify-between hover:shadow-md transition-all`}>
              <div className="space-y-4">
                <span className="inline-flex rounded-full bg-violet-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-violet-600">Business</span>
                <div>
                  <div className="text-4xl font-black text-slate-900">₱1,700<small className="text-sm font-semibold text-slate-400">/mo</small></div>
                  <p className="text-xs text-slate-400 mt-1">Best for high-volume operators</p>
                </div>

                <div className="pt-3 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-violet-500 mt-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Video Archive</div>
                      <div className="text-xs text-slate-500">Up to 12 months</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-violet-500 mt-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Photo Archive</div>
                      <div className="text-xs text-slate-500">Up to 12 months</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Unlimited Events</div>
                      <div className="text-xs text-slate-500">No limits on event capture</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Custom Event Colors</div>
                      <div className="text-xs text-slate-500">Background and text customization</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Event Link & Embed</div>
                      <div className="text-xs text-slate-500">Public link + embeddable album</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg className="h-4 w-4 flex-shrink-0 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">QR Code Sharing</div>
                      <div className="text-xs text-slate-500">Guests scan to download at the booth</div>
                    </div>
                  </div>
                </div>
              </div>
              {galleryPlan === "business" ? (
                <div className="mt-6 w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-white text-center shadow-md cursor-default">
                  Current Plan
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!hasPaidPlan}
                  onClick={() => hasPaidPlan && openPayMongoPayment("gallery", "business")}
                  className={`mt-6 w-full rounded-lg py-3 text-sm font-bold transition-all active:scale-[0.98] ${hasPaidPlan ? "bg-slate-900 text-white hover:bg-slate-700 hover:-translate-y-0.5 hover:shadow-md" : "border border-slate-100 text-slate-400 cursor-not-allowed bg-slate-50"}`}
                >
                  Pay via PayMongo — Business
                </button>
              )}
            </div>
          </div>

          {/* Feature comparison */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} overflow-hidden`}>
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-sm font-bold text-slate-800">Plan Comparison</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/80">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Feature</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Free</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-blue-600 bg-blue-50/50">Plus</th>
                    <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Business</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { feature: "Video Archive", free: "1 week", plus: "6 months", business: "12 months" },
                    { feature: "Photo Archive", free: "1 week", plus: "6 months", business: "12 months" },
                    { feature: "Unlimited Events", free: true, plus: true, business: true },
                    { feature: "Custom Colors", free: false, plus: true, business: true },
                    { feature: "Event Link", free: false, plus: true, business: true },
                    { feature: "Embed Album", free: false, plus: true, business: true },
                    { feature: "QR Code Sharing", free: false, plus: true, business: true },
                    { feature: "Price", free: "₱0", plus: "₱900/mo", business: "₱1,700/mo" },
                  ].map(({ feature, free, plus, business }) => (
                    <tr key={feature} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-medium text-slate-700">{feature}</td>
                      {[free, plus, business].map((val, i) => (
                        <td key={i} className={`text-center px-4 py-3 ${i === 1 ? "bg-blue-50/30" : ""}`}>
                          {val === true ? (
                            <svg className="h-4 w-4 text-emerald-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          ) : val === false ? (
                            <svg className="h-4 w-4 text-slate-300 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          ) : (
                            <span className="text-sm font-semibold text-slate-700">{val}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </>
      )}

      {/* ===== BUSINESS TAB ===== */}
      {!billingOnly && accountTab === "business" && (
        <div className="space-y-6">
          {/* Header */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
            <h4 className="text-sm font-bold text-slate-900">Payment Gateway</h4>
            <p className="mt-1 text-xs text-slate-500">
              Connect one payment provider to enable Business mode. Only one gateway can be active at a time.
              Payment methods are configured per-event in Controls.
            </p>
            {anyProviderConfigured && !activeProvider && (
              <p className="mt-2 text-xs text-amber-600 font-medium">A provider is connected but not selected as active. Select one below.</p>
            )}
          </div>

          {/* Provider selector — 2×2 grid */}
          {(() => {
            const PROVIDERS = [
              {
                key: "paymongo",
                name: "PayMongo",
                region: "Philippines",
                methods: ["GCash", "Maya", "GrabPay", "Cards"],
                configured: paymongoConfigured,
                testMode: paymongoTestMode,
                docsHref: "paymongo.com",
              },
              {
                key: "stripe",
                name: "Stripe",
                region: "Global",
                methods: ["Cards", "Apple Pay", "Google Pay", "Link"],
                configured: stripeConfigured,
                testMode: stripeTestMode,
                docsHref: "dashboard.stripe.com",
              },
              {
                key: "xendit",
                name: "Xendit",
                region: "Indonesia & Philippines",
                methods: ["Cards", "OVO", "DANA", "GoPay", "QRIS", "Virtual Accounts"],
                configured: xenditConfigured,
                testMode: xenditTestMode,
                docsHref: "xendit.co",
              },
              {
                key: "paypal",
                name: "PayPal",
                region: "200+ countries",
                methods: ["PayPal Wallet", "Pay Later", "Venmo", "Cards"],
                configured: paypalConfigured,
                testMode: paypalSandboxMode,
                docsHref: "developer.paypal.com",
              },
            ];
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PROVIDERS.map((p) => {
                  const isActive = activeProvider === p.key;
                  const supportedCurrencies = GATEWAY_SUPPORTED_CURRENCIES[p.key];
                  const currencyMatch = !supportedCurrencies || supportedCurrencies.includes(String(currency).toUpperCase());
                  const isDisabled = !currencyMatch && !isActive;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => {
                        if (isDisabled) return;
                        const newProvider = isActive ? null : p.key;
                        setActiveProvider(newProvider);
                        if (currentEvent) {
                          const updatedEvent = {
                            ...currentEvent,
                            settings: {
                              ...(currentEvent.settings ?? {}),
                              business: {
                                ...(currentEvent.settings?.business ?? {}),
                                activeProvider: newProvider,
                              },
                            },
                          };
                          const updatedEvents = events.map((e) => (e.id === currentEvent.id ? updatedEvent : e));
                          setEvents(updatedEvents);
                          setCurrentEvent(updatedEvent);
                          native?.setEvents?.(updatedEvents, ctx)?.catch?.(() => {});
                        }
                      }}
                      className={`text-left rounded-xl border-2 p-4 transition-all ${
                        isDisabled
                          ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed"
                          : isActive
                            ? "border-blue-500 bg-blue-50 shadow-md shadow-blue-100"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold text-slate-900">{p.name}</span>
                            {p.configured && (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Connected</span>
                            )}
                            {p.configured && p.testMode && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Test</span>
                            )}
                            {!currencyMatch && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">Currency not supported</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-400">{p.region}</p>
                          {!currencyMatch && (
                            <p className="mt-1 text-[10px] text-red-500">
                              {p.key === 'xendit'
                                ? `Xendit accounts default to PHP only. Change your pricing currency to PHP, or contact Xendit to enable ${currency}.`
                                : `${p.name} does not support ${currency}. Supported: ${(GATEWAY_SUPPORTED_CURRENCIES[p.key] ?? []).join(', ')}`}
                            </p>
                          )}
                        </div>
                        <div className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 transition-all ${isActive ? "border-blue-500 bg-blue-500" : "border-slate-300"}`}>
                          {isActive && <div className="h-full w-full rounded-full bg-white scale-[0.45]" />}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {p.methods.map((m) => (
                          <span key={m} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{m}</span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* No provider selected */}
          {!activeProvider && (
            <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} px-6 py-5 text-center`}>
              <p className="text-sm text-slate-500">Select a payment provider above to connect your account.</p>
            </div>
          )}

          {/* ── PayMongo config card ── */}
          {activeProvider === "paymongo" && (
            <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">PayMongo</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Get your API keys from paymongo.com → Developers. Use test keys first.</p>
                </div>
                {paymongoConfigured && (
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${paymongoTestMode ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{paymongoTestMode ? "Test Mode" : "Live"}</span>
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">Connected</span>
                  </div>
                )}
              </div>
              {paymongoConfigured ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-700">
                    <div className="font-semibold">Keys configured — public key: {paymongoPublicKey}</div>
                    <div className="mt-0.5 text-green-600">Business mode is available in Controls → Mode.</div>
                  </div>
                  <button type="button" onClick={async () => {
                    const res = await window.electron?.clearPayMongoKeys?.();
                    if (res?.ok) { setPaymongoConfigured(false); setPaymongoTestMode(false); setPaymongoPublicKey(""); setPaymongoKeyInputs({ publicKey: "", secretKey: "" }); showToast?.("PayMongo keys removed"); }
                  }} className="text-xs font-semibold text-red-600 hover:underline">Disconnect</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Public Key</label>
                      <input type="text" value={paymongoKeyInputs.publicKey} onChange={(e) => setPaymongoKeyInputs((p) => ({ ...p, publicKey: e.target.value }))} placeholder="pk_test_... or pk_live_..." className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-3 py-2 text-sm font-mono outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Secret Key</label>
                      <input type="password" value={paymongoKeyInputs.secretKey} onChange={(e) => setPaymongoKeyInputs((p) => ({ ...p, secretKey: e.target.value }))} placeholder="sk_test_... or sk_live_..." className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-3 py-2 text-sm font-mono outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`} />
                    </div>
                  </div>
                  <button type="button" disabled={paymongoSaving || !paymongoKeyInputs.publicKey || !paymongoKeyInputs.secretKey} onClick={async () => {
                    setPaymongoSaving(true);
                    try {
                      const res = await window.electron?.savePayMongoKeys?.(paymongoKeyInputs);
                      if (res?.ok) { setPaymongoConfigured(true); setPaymongoTestMode(res.testMode); setPaymongoPublicKey(paymongoKeyInputs.publicKey.slice(0, 12) + "..."); setPaymongoKeyInputs({ publicKey: "", secretKey: "" }); showToast?.("PayMongo keys validated and saved"); }
                      else showToast?.(res?.error || "Failed to validate keys");
                    } catch (err) { showToast?.(err?.message || "Failed to save keys"); }
                    finally { setPaymongoSaving(false); }
                  }} className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-not-allowed">
                    {paymongoSaving ? "Validating…" : "Validate & Save"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Stripe config card ── */}
          {activeProvider === "stripe" && (
            <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Stripe</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Get your API keys from dashboard.stripe.com → Developers → API keys.</p>
                </div>
                {stripeConfigured && (
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${stripeTestMode ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{stripeTestMode ? "Test Mode" : "Live"}</span>
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">Connected</span>
                  </div>
                )}
              </div>
              {stripeConfigured ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-700">
                    <div className="font-semibold">Keys configured — publishable key: {stripeKeyDisplay}</div>
                    <div className="mt-0.5 text-green-600">Business mode is available in Controls → Mode.</div>
                  </div>
                  <button type="button" onClick={async () => {
                    const res = await window.electron?.clearStripeKeys?.();
                    if (res?.ok) { setStripeConfigured(false); setStripeTestMode(false); setStripeKeyDisplay(""); setStripeKeyInputs({ publishableKey: "", secretKey: "" }); showToast?.("Stripe keys removed"); }
                  }} className="text-xs font-semibold text-red-600 hover:underline">Disconnect</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Publishable Key</label>
                      <input type="text" value={stripeKeyInputs.publishableKey} onChange={(e) => setStripeKeyInputs((p) => ({ ...p, publishableKey: e.target.value }))} placeholder="pk_test_... or pk_live_..." className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-3 py-2 text-sm font-mono outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Secret Key</label>
                      <input type="password" value={stripeKeyInputs.secretKey} onChange={(e) => setStripeKeyInputs((p) => ({ ...p, secretKey: e.target.value }))} placeholder="sk_test_... or sk_live_..." className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-3 py-2 text-sm font-mono outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`} />
                    </div>
                  </div>
                  <button type="button" disabled={stripeSaving || !stripeKeyInputs.publishableKey || !stripeKeyInputs.secretKey} onClick={async () => {
                    setStripeSaving(true);
                    try {
                      const res = await window.electron?.saveStripeKeys?.(stripeKeyInputs);
                      if (res?.ok) { setStripeConfigured(true); setStripeTestMode(res.testMode); setStripeKeyDisplay(stripeKeyInputs.publishableKey.slice(0, 14) + "..."); setStripeKeyInputs({ publishableKey: "", secretKey: "" }); showToast?.("Stripe keys validated and saved"); }
                      else showToast?.(res?.error || "Failed to validate keys");
                    } catch (err) { showToast?.(err?.message || "Failed to save keys"); }
                    finally { setStripeSaving(false); }
                  }} className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-not-allowed">
                    {stripeSaving ? "Validating…" : "Validate & Save"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Xendit config card ── */}
          {activeProvider === "xendit" && (
            <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Xendit</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Get your API key from dashboard.xendit.co → Settings → API Keys.</p>
                </div>
                {xenditConfigured && (
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${xenditTestMode ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{xenditTestMode ? "Test Mode" : "Live"}</span>
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">Connected</span>
                  </div>
                )}
              </div>
              {xenditConfigured ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-700">
                    <div className="font-semibold">API key configured: {xenditKeyDisplay}</div>
                    <div className="mt-0.5 text-green-600">Business mode is available in Controls → Mode.</div>
                  </div>
                  <button type="button" onClick={async () => { await window.electron?.clearXenditKeys?.().catch(() => {}); setXenditConfigured(false); setXenditTestMode(false); setXenditKeyDisplay(""); setXenditKeyInput(""); showToast?.("Xendit key removed"); }} className="text-xs font-semibold text-red-600 hover:underline">Disconnect</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Secret API Key</label>
                    <input type="password" value={xenditKeyInput} onChange={(e) => setXenditKeyInput(e.target.value)} placeholder="xnd_development_... or xnd_production_..." className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-3 py-2 text-sm font-mono outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`} />
                    <p className="text-[11px] text-slate-400">Keys starting with <code>xnd_development</code> run in test mode.</p>
                  </div>
                  <button type="button" disabled={xenditSaving || !xenditKeyInput} onClick={async () => {
                    setXenditSaving(true);
                    try {
                      const res = await window.electron?.saveXenditKeys?.({ apiKey: xenditKeyInput });
                      if (res && !res.ok) { showToast?.(res.error || "Failed to save key"); return; }
                      setXenditConfigured(true);
                      setXenditTestMode(res?.testMode ?? xenditKeyInput.startsWith("xnd_development"));
                      setXenditKeyDisplay(xenditKeyInput.slice(0, 16) + "...");
                      setXenditKeyInput("");
                      showToast?.("Xendit key saved");
                    } catch (err) { showToast?.(err?.message || "Failed to save key"); }
                    finally { setXenditSaving(false); }
                  }} className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-not-allowed">
                    {xenditSaving ? "Saving…" : "Save Key"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── PayPal config card ── */}
          {activeProvider === "paypal" && (
            <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">PayPal</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Get your credentials from developer.paypal.com → Apps &amp; Credentials.</p>
                </div>
                {paypalConfigured && (
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${paypalSandboxMode ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{paypalSandboxMode ? "Sandbox" : "Live"}</span>
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">Connected</span>
                  </div>
                )}
              </div>
              {paypalConfigured ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-700">
                    <div className="font-semibold">Credentials configured — Client ID: {paypalClientIdDisplay}</div>
                    <div className="mt-0.5 text-green-600">Business mode is available in Controls → Mode.</div>
                  </div>
                  <button type="button" onClick={async () => { await window.electron?.clearPaypalKeys?.().catch(() => {}); setPaypalConfigured(false); setPaypalSandboxMode(false); setPaypalClientIdDisplay(""); setPaypalKeyInputs({ clientId: "", clientSecret: "" }); showToast?.("PayPal credentials removed"); }} className="text-xs font-semibold text-red-600 hover:underline">Disconnect</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client ID</label>
                      <input type="text" value={paypalKeyInputs.clientId} onChange={(e) => setPaypalKeyInputs((p) => ({ ...p, clientId: e.target.value }))} placeholder="Sandbox or Live Client ID" className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-3 py-2 text-sm font-mono outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client Secret</label>
                      <input type="password" value={paypalKeyInputs.clientSecret} onChange={(e) => setPaypalKeyInputs((p) => ({ ...p, clientSecret: e.target.value }))} placeholder="Sandbox or Live Client Secret" className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} w-full px-3 py-2 text-sm font-mono outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`} />
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input type="checkbox" checked={paypalSandboxMode} onChange={(e) => setPaypalSandboxMode(e.target.checked)} />
                    <span className="text-slate-600">Use Sandbox (test) mode</span>
                  </label>
                  <button type="button" disabled={paypalSaving || !paypalKeyInputs.clientId || !paypalKeyInputs.clientSecret} onClick={async () => {
                    setPaypalSaving(true);
                    try {
                      const res = await window.electron?.savePaypalKeys?.({ ...paypalKeyInputs, sandboxMode: paypalSandboxMode });
                      if (res && !res.ok) { showToast?.(res.error || "Failed to save credentials"); return; }
                      setPaypalConfigured(true);
                      setPaypalSandboxMode(res?.sandboxMode ?? paypalSandboxMode);
                      setPaypalClientIdDisplay(paypalKeyInputs.clientId.slice(0, 14) + "...");
                      setPaypalKeyInputs({ clientId: "", clientSecret: "" });
                      showToast?.("PayPal credentials saved");
                    } catch (err) { showToast?.(err?.message || "Failed to save credentials"); }
                    finally { setPaypalSaving(false); }
                  }} className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-not-allowed">
                    {paypalSaving ? "Saving…" : "Save Credentials"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== PREFERENCES TAB ===== */}


      {/* ===== SYSTEM HEALTH TAB ===== */}

      {/* ===== PAYMONGO PAYMENT MODAL ===== */}
      {showPaymongoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={closePaymongoModal}>
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-[0_32px_80px_rgba(0,0,0,0.15)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Pay via PayMongo</h3>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>
                    {paymongoPlanType === "gallery"
                      ? `Gallery ${paymongoPlan.charAt(0).toUpperCase() + paymongoPlan.slice(1)}`
                      : `Pro ${paymongoPlan.charAt(0).toUpperCase() + paymongoPlan.slice(1)}`}
                    {" — "}
                  </span>
                  {discountResult?.valid ? (
                    <>
                      <span className="line-through text-slate-400">
                        ₱{PAYMONGO_PHP_AMOUNTS[paymongoPlan]?.toLocaleString("en-PH") ?? ""}
                        {paymongoPlanType === "gallery" ? "/mo" : ""}
                      </span>
                      <span className="font-bold text-emerald-600">
                        ₱{discountResult.discountedAmountPhp?.toLocaleString("en-PH")}
                        {paymongoPlanType === "gallery" ? "/mo" : ""}
                      </span>
                    </>
                  ) : (
                    <span>
                      ₱{PAYMONGO_PHP_AMOUNTS[paymongoPlan]?.toLocaleString("en-PH") ?? ""}
                      {paymongoPlanType === "gallery" ? "/mo" : ""}
                    </span>
                  )}
                </p>
              </div>
              <button type="button" onClick={closePaymongoModal} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-col items-center gap-5 p-8">

              {/* Code entry + proceed step */}
              {paymongoStatus === "idle" && (
                <div className="w-full space-y-4">
                  {/* Price display */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                    {discountResult?.valid ? (
                      <>
                        <p className="text-sm text-slate-400 line-through">₱{PAYMONGO_PHP_AMOUNTS[paymongoPlan]?.toLocaleString("en-PH")}</p>
                        <p className="text-3xl font-black text-slate-900">₱{discountResult.discountedAmountPhp?.toLocaleString("en-PH")}</p>
                        <p className="mt-1 text-xs font-semibold text-emerald-600">You save ₱{discountResult.savingsPhp?.toLocaleString("en-PH")}</p>
                      </>
                    ) : (
                      <p className="text-3xl font-black text-slate-900">₱{PAYMONGO_PHP_AMOUNTS[paymongoPlan]?.toLocaleString("en-PH")}</p>
                    )}
                  </div>

                  {/* Discount code input */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-500">Discount code (optional)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={discountCode}
                        onChange={(e) => { setDiscountCode(e.target.value.toUpperCase()); setDiscountResult(null); }}
                        placeholder="Enter code"
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 placeholder:font-sans placeholder:normal-case focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <button
                        type="button"
                        disabled={!discountCode.trim() || discountApplying}
                        onClick={async () => {
                          if (!discountCode.trim()) return;
                          setDiscountApplying(true);
                          try {
                            const result = await licensingApi.validateDiscountCode(discountCode.trim(), paymongoPlan);
                            setDiscountResult(result);
                            if (!result.valid) showToast?.(result.error || "Invalid discount code");
                          } catch (err) {
                            showToast?.(err?.message || "Failed to validate code");
                          } finally {
                            setDiscountApplying(false);
                          }
                        }}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {discountApplying ? "…" : "Apply"}
                      </button>
                    </div>
                    {discountResult?.valid && (
                      <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-emerald-600">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                        Code applied
                      </p>
                    )}
                    {discountResult && !discountResult.valid && (
                      <p className="mt-1.5 text-xs font-semibold text-red-500">{discountResult.error}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={proceedToPayMongoPayment}
                    className="w-full rounded-lg bg-blue-600 py-3 text-sm font-bold text-white shadow-md transition-all hover:bg-blue-500 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
                  >
                    {discountResult?.valid
                      ? `Proceed — ₱${discountResult.discountedAmountPhp?.toLocaleString("en-PH")}`
                      : "Proceed to Payment"}
                  </button>
                </div>
              )}

              {/* Loading state */}
              {paymongoStatus === "loading" && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
                  <p className="text-sm text-slate-500">Generating payment link…</p>
                </div>
              )}

              {/* Error state */}
              {paymongoStatus === "error" && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <svg className="h-10 w-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                  <p className="text-sm font-semibold text-red-600">{paymongoError}</p>
                  <button type="button" onClick={() => setPaymongoStatus("idle")} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-500">Try again</button>
                </div>
              )}

              {/* Confirmed */}
              {paymongoStatus === "confirmed" && (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                    <svg className="h-8 w-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p className="text-base font-bold text-slate-900">Payment Confirmed!</p>
                  <p className="text-sm text-slate-500">Your plan is being activated…</p>
                </div>
              )}

              {/* QR + polling */}
              {(paymongoStatus === "polling") && (
                <>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <QRCodeSVG value={paymongoCheckoutUrl || ' '} size={208} />
                  </div>

                  <div className="text-center space-y-1">
                    <p className="text-xs text-slate-500">Scan with GCash, Maya, or any QR payment app</p>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-blue-500">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                      Waiting for payment…
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => { window.system?.openExternal?.(paymongoCheckoutUrl) ?? window.open(paymongoCheckoutUrl, "_blank", "noopener,noreferrer"); }}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    Open in browser
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const openEventsLibrary = () => {
    setActiveMain("events");
  };

  const createNewEventFromHome = () => {
    setCurrentEvent(null);
    setActiveMain("events");

    requestAnimationFrame(() => {
      const input = document.getElementById("create-event-input");
      input?.focus?.();
      input?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
  };
  const openEventEditor = (eventToOpen) => {
    if (!eventToOpen) {
      showToast?.("No event selected");
      return;
    }

    setCurrentEvent(eventToOpen);
    setActiveSub("branding");
    setActiveMain("dashboard");
  };

  const openLatestEventFromHome = () => {
    if (!events.length) {
      showToast?.("No saved events yet");
      setActiveMain("events");
      return;
    }

    openEventEditor(events[0]);
  };

  const renderHomeDashboard = () => (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-white/20 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 px-6 py-6 text-white shadow-[0_24px_64px_rgba(37,99,235,0.25)]">
        <WavePattern />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">Dashboard</div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>
              {boothIdentityName ? `Welcome back — ${boothIdentityName}` : "Studio Photuna"}
            </h2>
            <p className="mt-1.5 text-sm text-white/80">
              {boothLocation ? `${boothLocation} · ` : ""}{events.length} event{events.length !== 1 ? "s" : ""} · {templates.length} template{templates.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={createNewEventFromHome}
              className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
            >
              + New event
            </button>
            <button
              type="button"
              onClick={openLatestEventFromHome}
              className="inline-flex items-center justify-center rounded-lg border border-white/25 bg-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25 active:scale-[0.98]"
            >
              Resume latest
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          {
            label: "Total Events", value: events.length, sub: "saved",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
            color: "text-blue-600", bg: "bg-blue-50",
          },
          {
            label: "Templates", value: templates.length, sub: "available",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />,
            color: "text-violet-600", bg: "bg-violet-50",
          },
          {
            label: "Sessions Today", value: sessionsToday, sub: "across all events",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
            color: "text-emerald-600", bg: "bg-emerald-50",
          },
          {
            label: "Printer", value: printerOnline ? "Online" : "Offline", sub: printerStatusText || "status",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />,
            color: printerOnline ? "text-emerald-600" : "text-amber-600", bg: printerOnline ? "bg-emerald-50" : "bg-amber-50",
          },
        ].map(({ label, value, sub, icon, color, bg }) => (
          <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</div>
                <div className={`mt-1.5 text-2xl font-bold ${color} tabular-nums`}>{value}</div>
                <div className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</div>
              </div>
              <div className={`${bg} rounded-full p-2.5 flex-shrink-0`}>
                <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {icon}
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row — Photo Activity & Top Templates */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr,1fr] gap-5">
        {/* Photo Activity Line Chart */}
        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className={EYEBROW}>Photo activity</div>
              <p className="mt-0.5 text-xs text-slate-400">Sessions captured over the last 7 days</p>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={(() => {
                const days = [];
                for (let i = 6; i >= 0; i--) {
                  const d = new Date();
                  d.setDate(d.getDate() - i);
                  const label = d.toLocaleDateString("en", { month: "short", day: "numeric" });
                  const count = events.reduce((sum, ev) =>
                    sum + (ev.sessions ?? []).filter(s => {
                      try {
                        const sd = new Date(s.createdAt);
                        return sd.toDateString() === d.toDateString();
                      } catch { return false; }
                    }).length, 0);
                  days.push({ date: label, sessions: count });
                }
                return days;
              })()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }} />
                <Line type="monotone" dataKey="sessions" stroke="#2563eb" strokeWidth={2.5} dot={{ fill: "#2563eb", r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Templates Donut Chart */}
        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
          <div className={`${EYEBROW} mb-4`}>Top templates</div>
          {templates.length > 0 ? (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={templates.slice(0, 5).map((t, i) => ({
                        name: t.name || `Template ${i + 1}`,
                        value: t.usageCount || (t.sessions?.length ?? Math.max(1, 5 - i)),
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={68}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {templates.slice(0, 5).map((_, i) => (
                        <Cell key={i} fill={["#2563eb", "#06b6d4", "#8b5cf6", "#f59e0b", "#10b981"][i % 5]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1.5">
                {templates.slice(0, 5).map((t, i) => (
                  <div key={t.id || i} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ["#2563eb", "#06b6d4", "#8b5cf6", "#f59e0b", "#10b981"][i % 5] }} />
                    <span className="text-slate-500 truncate flex-1">{t.name || `Template ${i + 1}`}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-44 flex items-center justify-center text-sm text-slate-400">No templates yet</div>
          )}
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr,1fr] gap-5">

        {/* Left col */}
        <div className="space-y-5">

          {/* Quick actions */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
            <div className={`${EYEBROW} mb-1`}>Quick actions</div>
            <p className="mt-0.5 text-xs text-slate-400 mb-4">Jump into the most common tasks.</p>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "Manage events", sub: "Create, edit, or archive events", onClick: openEventsLibrary },
                { label: "Resume latest", sub: "Jump back into your last event", onClick: openLatestEventFromHome },
                { label: "Settings", sub: "Camera, printer, storage setup", onClick: () => setActiveMain("settings") },
                { label: "Account", sub: "Profile, security, and business", onClick: () => setActiveMain("account") },
                { label: "Help center", sub: "Guides and troubleshooting", onClick: () => setActiveMain("helpcenter") },
              ].map(({ label, sub, onClick }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-blue-200 hover:bg-blue-50/40 transition-all group active:scale-[0.98]"
                >
                  <div className="text-sm font-semibold text-slate-800 group-hover:text-blue-700 transition-colors">{label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Recent events */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className={EYEBROW}>Recent events</div>
                <p className="mt-0.5 text-xs text-slate-400">Jump back into an event editor.</p>
              </div>
              <button onClick={openEventsLibrary} className="text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors">
                View all →
              </button>
            </div>

            <div className="space-y-1.5">
              {events.slice(0, 5).map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEventEditor(ev)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-200 hover:bg-blue-50/30 transition-all group active:scale-[0.98]"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate group-hover:text-blue-700 transition-colors">
                      {ev.name || "Untitled event"}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {ev.date || ev.created || "No date"} · {ev.sessions?.length ?? 0} sessions
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-slate-300 group-hover:text-blue-400 flex-shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}

              {!hydrated && events.length === 0 && (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`home-ev-skel-${i}`} className="animate-pulse bg-slate-100 rounded-lg h-12 w-full" />
                  ))}
                </div>
              )}

              {hydrated && events.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
                  <div className="text-sm text-slate-400">No events yet.</div>
                  <button
                    onClick={createNewEventFromHome}
                    className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Create your first event →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right col */}
        <div className="space-y-5">

          {/* System health */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
            <div className={`${EYEBROW} mb-4`}>System health</div>
            <div className="space-y-3">
              {[
                {
                  label: "Printer",
                  ok: printerOnline,
                  status: printerOnline ? "Online" : "Offline",
                },
                {
                  label: "Camera",
                  ok: cameraOnline,
                  status: cameraOnline ? "Ready" : "Not detected",
                },
                {
                  label: "Storage path",
                  ok: !!getEffectiveStoragePath(),
                  status: getEffectiveStoragePath() ? "Configured" : "Not set",
                },
                {
                  label: "Account",
                  ok: !!(license?.active || gating?.allow),
                  status: (license?.active || gating?.allow) ? "Active" : "Inactive",
                },
              ].map(({ label, ok, status }) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <span className={`text-xs font-medium ${ok ? "text-emerald-600" : "text-amber-600"}`}>
                      {status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workspace */}
          <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
            <div className={`${EYEBROW} mb-4`}>Workspace</div>
            <div className="space-y-2.5">
              {[
                { label: "User", value: user?.name || identity?.username || "Unknown" },
                { label: "Mode", value: appMode || "—" },
                { label: "Plan", value: licenseLoading && !plan ? "…" : planDisplayName },
                { label: "Printer", value: selectedPrinter || "None selected" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-400 flex-shrink-0">{label}</span>
                  <span className="text-gray-800 font-medium text-right truncate">{value}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );

  const getDashboardSectionMeta = () => {
    switch (activeSub) {
      case "branding":
        return {
          title: "Branding",
          description: "Update booth identity, logo, welcome presentation, fonts, and start button styling.",
        };
      case "templates":
        return {
          title: "Templates",
          description: "Create and manage print layouts, slot positioning, and template assignments.",
        };
      case "frames":
        return {
          title: "Frames",
          description: "Manage frame overlays, supported layouts, and frame assignments.",
        };
      case "tones":
        return {
          title: "Tones",
          description: "Control preset and custom tone treatments used during booth flow.",
        };
      case "background color":
        return {
          title: "Background Color",
          description: "Manage event background colors and visual palette options.",
        };
      case "controls":
        return {
          title: "Controls",
          description: "Configure countdown, number of shots, timers, retakes, and booth flow behavior.",
        };
      case "sharing":
        return {
          title: "Sharing",
          description: "Set sharing methods, delivery flow, and guest output behavior.",
        };
      case "analytics":
        return {
          title: "Analytics",
          description: "View and analyze booth performance, usage statistics, and user engagement.",
        };
      default:
        return {
          title: "Dashboard",
          description: "Manage the active event workspace.",
        };
    }
  };

  const Section = ({ title, children, defaultOpen = true }) => {
    const [open, setOpen] = React.useState(defaultOpen);

    return (
      <div className="mt-6">
        <button
          onClick={() => setOpen(!open)}
          className={`w-full flex items-center justify-between ${EYEBROW} mb-2`}
        >
          <span>{title}</span>
          <span className="text-slate-400 text-xs">{open ? "−" : "+"}</span>
        </button>

        {open && children}
      </div>
    );
  };

  // Camera useEffect

  useEffect(() => {
    const meta = getResolutionMeta(cameraResolution);
    setCameraWidth(meta.width);
    setCameraHeight(meta.height);
  }, [cameraResolution]);

  useEffect(() => {
    if (activeMain === "settings" && activeSettingsTab === "camera") {
      refreshCameras();
    }
  }, [activeMain, activeSettingsTab]);

  useEffect(() => {
    if (selectedCameraId) {
      loadCameraCapabilities(selectedCameraId);
    } else {
      setCameraCapabilities(null);
      setCameraOnline(false);
      setCameraStatusText("No camera selected");
    }
  }, [selectedCameraId]);

  // Storage useEffect

  useEffect(() => {
    if (storagePath) {
      loadStorageInfo(storagePath);
    } else {
      setStorageInfo(null);
      setStorageStatusText("No storage folder selected");
    }
  }, [storagePath]);

  // 3) Subscribe to AuthGate's broadcast
  useEffect(() => {
    if (authLoading) return;

    if (identity.userId) {
      setHydrated(false);
      loadPersisted(identity.userId);
      return;
    }

    setEvents([]);
    setCurrentEvent(null);
  }, [authLoading, identity.userId, loadPersisted]);

  // Load cloud storage connection status once on mount
  React.useEffect(() => {
    const api = native;
    if (!api) return;
    api.cloudGoogleDrive?.status?.().then((s) => setCloudGoogleStatus((p) => ({ ...p, ...s }))).catch(() => {});
    api.cloudDropbox?.status?.().then((s) => setCloudDropboxStatus((p) => ({ ...p, ...s }))).catch(() => {});
  }, [native]);

  // Auto-refresh license and events when the window regains focus (throttled to 30 s).
  // This keeps plan details and event counts up to date after admin changes without
  // requiring a full page reload.
  const lastFocusRefresh = useRef(0);
  useEffect(() => {
    if (!identity?.userId || !ready) return;

    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.current < 30000) return;
      lastFocusRefresh.current = now;
      ctxRefreshLicense().catch(() => {});
      if (native?.getEvents) {
        native.getEvents({ userId: identity.userId })
          .then((evs) => { if (Array.isArray(evs) && evs.length) setEvents(evs); })
          .catch(() => {});
      }
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [identity?.userId, ready, native, ctxRefreshLicense]);

  // Periodic license refresh every 5 minutes so plan changes from Supabase
  // appear without requiring a manual page reload.
  useEffect(() => {
    if (!identity?.userId) return;
    const id = setInterval(() => ctxRefreshLicense().catch(() => {}), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [identity?.userId, ctxRefreshLicense]);

  function sanitizeSettings(input = {}) {
    const {
      countdown,
      retakeLimit,
      screenTimers,
      numberOfShots,
      flashEnabled,
      soundEnabled,
      language,
      price,
      appMode,
      timersEnabled,
      consentEnabled,
      storageChoiceEnabled,
      galleryOptionDisabled,
      operatorStorageEnabled,
      operatorStorageLabel,
      operatorStorageUrl,
      operatorStorageApiKey,
      rental,
      business,
      selectedCameraId,
      mirrorCamera,
      cameraResolution,
      cameraWidth,
      cameraHeight,
      facingMode,
      selectedPrinter,
      paperSize,
      printCopies,
      printColorMode,
      printQuality,
      printOrientation,
      printDuplexMode,
      printDpi,
      storagePath,
      autoDeleteDays,
      dimWhenIdle,
      idleTimeout,
      launchOnStartup,
      autoRestart,
      boothIdentityName,
      boothLocation,
      operatorName,
      autoUpdateEnabled,
    } = input;

    const clampNum = (n, min, max, fallback = 0) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(min, Math.min(max, v));
    };

    const activeGateway = business?.activeProvider ?? null;
    const safeBusinessProviders = {
      gcash: !!business?.payment?.providers?.gcash,
      maya: !!business?.payment?.providers?.maya,
      grabpay: !!business?.payment?.providers?.grabpay,
      // Map gateway-specific "card" flags to the unified providers.card that PaymentScreen reads.
      card: !!(
        business?.payment?.providers?.card ||
        business?.payment?.providers?.stripe ||
        (activeGateway === 'stripe' && business?.payment?.stripeProviders?.card) ||
        (activeGateway === 'xendit' && business?.payment?.xenditProviders?.card) ||
        (activeGateway === 'paypal' && business?.payment?.paypalProviders?.card)
      ),
      cash: business?.payment?.providers?.cash ?? true,
    };

    const safeTimers =
      timersEnabled && screenTimers
        ? Object.fromEntries(
          Object.entries(screenTimers).map(([k, v]) => [
            k,
            clampNum(v, 0, 600, DEFAULT_SCREEN_TIMERS[k] ?? 0),
          ])
        )
        : DEFAULT_SCREEN_TIMERS;

    return {
      countdown: clampNum(countdown, 1, 30, 5),
      retakeLimit: clampNum(retakeLimit, 0, 20, 0),
      screenTimers: safeTimers,
      numberOfShots: clampNum(numberOfShots, 1, 10, 3),

      flashEnabled: flashEnabled ?? true,
      soundEnabled: soundEnabled ?? true,
      language: ["en", "fil"].includes(language) ? language : "en",
      price: clampNum(price, 0, 999999, 0),
      appMode: appMode ?? DEFAULT_APP_MODE,
      timersEnabled: timersEnabled ?? false,
      consentEnabled: consentEnabled ?? true,
      storageChoiceEnabled: storageChoiceEnabled ?? false,
      galleryOptionDisabled: galleryOptionDisabled ?? false,
      operatorStorageEnabled: operatorStorageEnabled ?? false,
      operatorStorageLabel: typeof operatorStorageLabel === "string" ? operatorStorageLabel.trim().slice(0, 60) || "Our Storage" : "Our Storage",
      operatorStorageUrl: typeof operatorStorageUrl === "string" ? operatorStorageUrl.trim().slice(0, 500) : "",
      operatorStorageApiKey: typeof operatorStorageApiKey === "string" ? operatorStorageApiKey.trim().slice(0, 200) : "",

      selectedCameraId: selectedCameraId ?? "",
      mirrorCamera: mirrorCamera ?? false,
      cameraResolution: ["720p", "1080p", "1440p", "4k"].includes(cameraResolution)
        ? cameraResolution
        : "1080p",
      cameraWidth: clampNum(cameraWidth, 320, 7680, 1920),
      cameraHeight: clampNum(cameraHeight, 240, 4320, 1080),
      facingMode: ["user", "environment", "left", "right"].includes(facingMode)
        ? facingMode
        : "user",

      selectedPrinter: selectedPrinter ?? "",
      paperSize:
        typeof paperSize === "string" && paperSize.trim()
          ? paperSize.trim()
          : "4x6",
      printCopies: clampNum(printCopies, 1, 20, 1),
      printColorMode: ["color", "grayscale"].includes(printColorMode)
        ? printColorMode
        : "color",
      printQuality: ["draft", "standard", "high"].includes(printQuality)
        ? printQuality
        : "high",
      printOrientation: ["auto", "portrait", "landscape"].includes(printOrientation)
        ? printOrientation
        : "landscape",
      printDuplexMode: ["simplex", "shortEdge", "longEdge"].includes(printDuplexMode)
        ? printDuplexMode
        : "simplex",
      printDpi: clampNum(printDpi, 72, 1200, 300),
      usePrinterDefaults: input.usePrinterDefaults ?? false,

      storagePath: storagePath ?? "",
      autoDeleteDays: clampNum(autoDeleteDays, 0, 3650, 14),

      dimWhenIdle: dimWhenIdle ?? true,
      idleTimeout: clampNum(idleTimeout, 5, 3600, 60),

      launchOnStartup: launchOnStartup ?? true,
      autoRestart: autoRestart ?? true,
      autoUpdateEnabled: autoUpdateEnabled ?? true,

      boothIdentityName: typeof boothIdentityName === 'string' ? boothIdentityName.trim().slice(0, 100) : '',
      boothLocation: typeof boothLocation === 'string' ? boothLocation.trim().slice(0, 200) : '',
      operatorName: typeof operatorName === 'string' ? operatorName.trim().slice(0, 100) : '',

      rental: {
        timerEnabled: !!rental?.timerEnabled,
        timerHours: clampNum(
          rental?.timerHours,
          0,
          24,
          DEFAULT_RENTAL.timerHours
        ),
        sessionLimitEnabled: !!rental?.sessionLimitEnabled,
        sessionLimit: clampNum(
          rental?.sessionLimit,
          0,
          10000,
          DEFAULT_RENTAL.sessionLimit
        ),
        offlineModeEnabled: !!rental?.offlineModeEnabled,
        autoSaveTarget: ["local", "usb", "cloud"].includes(rental?.autoSaveTarget)
          ? rental.autoSaveTarget
          : "local",
        endSessionSummaryEnabled: !!rental?.endSessionSummaryEnabled,
      },

      business: {
        activeProvider: typeof business?.activeProvider === 'string' ? business.activeProvider : null,
        paymentEnabled: business?.paymentEnabled ?? true,
        payment: {
          providers: safeBusinessProviders,
          stripeProviders: typeof business?.payment?.stripeProviders === 'object' && business.payment.stripeProviders !== null
            ? { ...DEFAULT_STRIPE_PROVIDERS, ...business.payment.stripeProviders }
            : { ...DEFAULT_STRIPE_PROVIDERS },
          xenditProviders: typeof business?.payment?.xenditProviders === 'object' && business.payment.xenditProviders !== null
            ? { ...DEFAULT_XENDIT_PROVIDERS, ...business.payment.xenditProviders }
            : { ...DEFAULT_XENDIT_PROVIDERS },
          paypalProviders: typeof business?.payment?.paypalProviders === 'object' && business.payment.paypalProviders !== null
            ? { ...DEFAULT_PAYPAL_PROVIDERS, ...business.payment.paypalProviders }
            : { ...DEFAULT_PAYPAL_PROVIDERS },
          cashMode: ['manual', 'auto'].includes(business?.payment?.cashMode) ? business.payment.cashMode : 'manual',
          gcashStaticQrDataUrl: typeof business?.payment?.gcashStaticQrDataUrl === 'string' ? business.payment.gcashStaticQrDataUrl : null,
        },
        pricing: {
          model:
            business?.pricing?.model === "perPhoto" ? "perPhoto" : "perSession",
          pricePerSession: clampNum(
            business?.pricing?.pricePerSession,
            0,
            999999,
            0
          ),
          additionalPrintPrice: clampNum(
            business?.pricing?.additionalPrintPrice,
            0,
            999999,
            0
          ),
          currency: ["PHP","USD","EUR","GBP","CHF","SEK","NOK","DKK","PLN","CZK","HUF","RON","BGN","TRY","SGD","MYR","THB","IDR","JPY","KRW","INR","HKD","TWD","CNY","AUD","CAD","NZD"].includes(business?.pricing?.currency)
            ? business.pricing.currency
            : "PHP",
          taxEnabled: !!business?.pricing?.taxEnabled,
          taxRate: clampNum(business?.pricing?.taxRate, 0, 100, 0),
        },
      },
    };
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!selectedPrinter || !native?.invoke) return;

      try {
        const caps = await window.electron.invoke(
          "printer:get-capabilities",
          selectedPrinter
        );

        if (!mounted) return;

        setAvailablePrinterOptions(caps || null);

        const nextPaperOptions = extractPrinterPaperOptions(caps);
        setPaperSizeOptions(nextPaperOptions);

        const hasCurrentPaper = nextPaperOptions.some(
          (p) => normalizePaperName(p.value) === normalizePaperName(paperSize)
        );

        if (!hasCurrentPaper && nextPaperOptions.length) {
          setPaperSize(nextPaperOptions[0].value);
        }
      } catch (err) {
        console.warn("Failed to load printer capabilities", err);
        if (mounted) {
          setAvailablePrinterOptions(null);
          setPaperSizeOptions(CUSTOM_PAPER_SIZE_OPTIONS);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [selectedPrinter]);

  // ---------- Analytics helpers ----------

  const fmtAmt = (n = 0, cur = "PHP") => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: cur,
        currencyDisplay: "narrowSymbol",
      }).format(Number(n));
    } catch {
      return `${cur} ${Number(n).toFixed(2)}`;
    }
  };

  // Assumptions:
  // ev.sessions = [{ createdAt, photosCount }]
  // ev.settings.business.pricing.pricePerSession

  const allSessions = events.flatMap(ev => ev.sessions ?? []);

  const isToday = (d) => {
    const x = new Date(d);
    const t = new Date();
    return (
      x.getDate() === t.getDate() &&
      x.getMonth() === t.getMonth() &&
      x.getFullYear() === t.getFullYear()
    );
  };

  const sessionsToday = events.reduce((sum, ev) =>
    sum + (ev.sessions ?? []).filter(s => isToday(s.createdAt)).length
  , 0);

  const grossToday = events.reduce((sum, ev) =>
    sum + (ev.sessions ?? [])
      .filter(s => isToday(s.createdAt))
      .reduce((s, sess) => s + getSessionRevenue(sess, ev), 0)
  , 0);

  const totalGross = events.reduce((sum, ev) =>
    sum + (ev.sessions ?? []).reduce((s, sess) => s + getSessionRevenue(sess, ev), 0)
  , 0);

  const totalPhotos = events.reduce(
    (sum, ev) =>
      sum + (ev.sessions ?? []).reduce((s, sess) => s + (sess.photosCount ?? 0), 0),
    0
  );

  // ---- Mini chart: sessions per hour (today) ----
  const sessionsPerHour = Array.from({ length: 24 }, (_, h) => {
    return events.reduce((sum, ev) => {
      return (
        sum +
        (ev.sessions ?? []).filter((s) => {
          const d = new Date(s.createdAt);
          return isToday(d) && d.getHours() === h;
        }).length
      );
    }, 0);
  });

  const maxHourValue = Math.max(...sessionsPerHour, 1);

  const reportEvents =
    reportEventId === "all"
      ? events
      : events.filter(ev => ev.id === reportEventId);

  const reportCurrency =
    reportEvents[0]?.settings?.business?.pricing?.currency ?? "PHP";

  const reportSessions = reportEvents.flatMap(
    ev => ev.sessions ?? []
  );

  const reportGross = reportEvents.reduce((sum, ev) =>
    sum + (ev.sessions ?? []).reduce((s, sess) => s + getSessionRevenue(sess, ev), 0)
  , 0);

  const reportPhotos = reportEvents.reduce(
    (sum, ev) =>
      sum +
      (ev.sessions ?? []).reduce(
        (s, sess) => s + (sess.photosCount ?? 0),
        0
      ),
    0
  );

  const reportConversionRate =
    reportSessions.length > 0
      ? Math.round(
        (reportSessions.filter(s => s.completed !== false).length /
          reportSessions.length) * 100
      )
      : 0;

  const reportSessionsPerHour = Array.from({ length: 24 }, (_, h) =>
    reportEvents.reduce((sum, ev) => {
      return (
        sum +
        (ev.sessions ?? []).filter(s => {
          const d = new Date(s.createdAt);
          return d.getHours() === h;
        }).length
      );
    }, 0)
  );

  const reportMaxHour = Math.max(...reportSessionsPerHour, 1);

  const peakHour =
    reportSessionsPerHour.indexOf(reportMaxHour);

  // ---- Extended analytics helpers (dashboard analytics tab) ----

  const isThisWeek = (ts) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      return d >= startOfWeek && d <= now;
    } catch { return false; }
  };

  const isThisMonth = (ts) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    } catch { return false; }
  };

  const isThisYear = (ts) => {
    try {
      return new Date(ts).getFullYear() === new Date().getFullYear();
    } catch { return false; }
  };

  function getEvPrice(ev) {
    return ev?.settings?.business?.pricing?.pricePerSession ?? ev?.settings?.price ?? 0;
  }

  // Returns actual revenue recorded in a session record.
  // Business sessions written by the new recordSession carry sess.revenue.totalAmount.
  // Rental sessions never have revenue — return 0.
  // Older sessions without the revenue field fall back to the event's configured price.
  function getSessionRevenue(sess, ev) {
    if (sess?.appMode === "rental") return 0;
    if (typeof sess?.revenue?.totalAmount === "number") return sess.revenue.totalAmount;
    // Legacy session (no appMode field): use event price only for business events
    const evMode = ev?.settings?.appMode ?? "business";
    if (evMode === "rental") return 0;
    return getEvPrice(ev);
  }

  function getSessionTax(sess) {
    return sess?.revenue?.taxAmount ?? 0;
  }

  function getSessionAdditionalPrints(sess) {
    return sess?.revenue?.additionalPrints ?? 0;
  }

  function getSessionAdditionalFee(sess) {
    return sess?.revenue?.additionalFee ?? 0;
  }

  function isSameLocalDay(ts) {
    try {
      const d = new Date(ts);
      const now = new Date();
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    } catch { return false; }
  }

  // Per-event computed stats for the analytics tab
  const evSessions = currentEvent?.sessions ?? [];
  const evLog = currentEvent?.analytics?.sessionLog ?? [];
  const evIsRental = (currentEvent?.settings?.appMode ?? "business") === "rental";
  const evCurrency = currentEvent?.settings?.business?.pricing?.currency ?? "PHP";

  const evDaySessions = evSessions.filter(s => isSameLocalDay(s.createdAt));
  const evWeekSessions = evSessions.filter(s => isThisWeek(s.createdAt));
  const evMonthSessions = evSessions.filter(s => isThisMonth(s.createdAt));
  const evYtdSessions = evSessions.filter(s => isThisYear(s.createdAt));
  const evDayCount = evDaySessions.length;
  const evWeekCount = evWeekSessions.length;
  const evMonthCount = evMonthSessions.length;
  const evYtdCount = evYtdSessions.length;
  const evTotalCount = evSessions.length;

  const sumRevenue = (arr) => arr.reduce((s, sess) => s + getSessionRevenue(sess, currentEvent), 0);
  const evDayRevenue = evIsRental ? 0 : sumRevenue(evDaySessions);
  const evWeekRevenue = evIsRental ? 0 : sumRevenue(evWeekSessions);
  const evMonthRevenue = evIsRental ? 0 : sumRevenue(evMonthSessions);
  const evYtdRevenue = evIsRental ? 0 : sumRevenue(evYtdSessions);
  const evTotalRevenue = evIsRental ? 0 : sumRevenue(evSessions);

  const evTotalPhotos = evSessions.reduce((s, sess) => s + (sess.photosCount ?? 0), 0);
  const evAvgRevPerSession = (!evIsRental && evTotalCount > 0) ? evTotalRevenue / evTotalCount : 0;
  const evAvgPhotosPerSession = evTotalCount > 0 ? (evTotalPhotos / evTotalCount).toFixed(1) : "0.0";

  // Additional prints analytics (business only)
  const evTotalAdditionalPrints = evIsRental ? 0 : evSessions.reduce((s, sess) => s + getSessionAdditionalPrints(sess), 0);
  const evAdditionalPrintRevenue = evIsRental ? 0 : evSessions.reduce((s, sess) => s + getSessionAdditionalFee(sess), 0);
  const evTotalTaxCollected = evIsRental ? 0 : evSessions.reduce((s, sess) => s + getSessionTax(sess), 0);

  // Average session duration
  const evSessionsWithDuration = evSessions.filter(s => typeof s.durationSec === "number" && s.durationSec > 0);
  const evAvgDurationSec = evSessionsWithDuration.length > 0
    ? Math.round(evSessionsWithDuration.reduce((s, sess) => s + sess.durationSec, 0) / evSessionsWithDuration.length)
    : null;

  // Payment provider breakdown (business only)
  const evProviderBreakdown = evIsRental ? {} : evSessions.reduce((acc, sess) => {
    const prov = sess?.revenue?.paymentProvider ?? "unknown";
    acc[prov] = (acc[prov] || 0) + 1;
    return acc;
  }, {});

  // Tone/filter usage
  const evToneUsage = evSessions.reduce((acc, sess) => {
    if (sess.tone) acc[sess.tone] = (acc[sess.tone] || 0) + 1;
    return acc;
  }, {});

  // Frame style usage
  const evFrameUsage = evSessions.reduce((acc, sess) => {
    if (sess.frameStyle) acc[sess.frameStyle] = (acc[sess.frameStyle] || 0) + 1;
    return acc;
  }, {});

  // Offline vs online sessions
  const evOfflineCount = evSessions.filter(s => !!s.offlineMode).length;
  const evOnlineCount = evTotalCount - evOfflineCount;

  const evCompletedCount = evSessions.filter(s => s.completed !== false).length;
  const evAbandonedCount = evTotalCount - evCompletedCount;
  const evTotalAttempted = evTotalCount;
  const evCompletionRate = evTotalAttempted > 0
    ? Math.round((evCompletedCount / evTotalAttempted) * 100)
    : 100;

  // Sessions per hour today (scoped to currentEvent)
  const evHourlyData = Array.from({ length: 24 }, (_, h) =>
    evSessions.filter(s => {
      const d = new Date(s.createdAt);
      return isSameLocalDay(s.createdAt) && d.getHours() === h;
    }).length
  );
  const evMaxHourly = Math.max(...evHourlyData, 1);

  // Sessions per day this week (Sun–Sat)
  const _nowAn = new Date();
  const _startOfWeekAn = new Date(_nowAn);
  _startOfWeekAn.setDate(_nowAn.getDate() - _nowAn.getDay());
  _startOfWeekAn.setHours(0, 0, 0, 0);
  const EV_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const evWeeklyData = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(_startOfWeekAn);
    day.setDate(_startOfWeekAn.getDate() + i);
    return evSessions.filter(s => {
      const sd = new Date(s.createdAt);
      return sd.getFullYear() === day.getFullYear() &&
        sd.getMonth() === day.getMonth() &&
        sd.getDate() === day.getDate();
    }).length;
  });
  const evMaxWeekly = Math.max(...evWeeklyData, 1);

  // Sessions per day — last 30 days
  const evLast30Data = Array.from({ length: 30 }, (_, i) => {
    const day = new Date();
    day.setDate(day.getDate() - (29 - i));
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    return evSessions.filter(s => {
      const sd = new Date(s.createdAt);
      return sd >= day && sd < next;
    }).length;
  });
  const evMax30 = Math.max(...evLast30Data, 1);

  // Template usage
  const evTplUsage = currentEvent?.analytics?.templateUsage ?? {};
  const evTplEntries = Object.entries(evTplUsage).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const evMaxTpl = evTplEntries.length ? evTplEntries[0][1] : 1;

  // ---- Enhanced Report Analytics (for the Reports tab) ----

  // Daily sessions trend — last 30 days (report-scoped)
  const reportDailyTrend = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const day = new Date();
      day.setDate(day.getDate() - (29 - i));
      day.setHours(0, 0, 0, 0);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const sessions = reportSessions.filter(s => {
        try { const sd = new Date(s.createdAt); return sd >= day && sd < next; }
        catch { return false; }
      }).length;
      const revenue = reportEvents.reduce((sum, ev) =>
        sum + (ev.sessions ?? [])
          .filter(s => { try { const sd = new Date(s.createdAt); return sd >= day && sd < next; } catch { return false; } })
          .reduce((s, sess) => s + getSessionRevenue(sess, ev), 0)
      , 0);
      return {
        date: day.toLocaleDateString("en", { month: "short", day: "numeric" }),
        sessions,
        revenue,
      };
    });
  }, [reportSessions, reportEvents]);

  // Weekly sessions trend — last 12 weeks (report-scoped)
  const reportWeeklyTrend = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - (11 - i) * 7);
      weekEnd.setHours(23, 59, 59, 999);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);
      const count = reportSessions.filter(s => {
        try { const sd = new Date(s.createdAt); return sd >= weekStart && sd <= weekEnd; }
        catch { return false; }
      }).length;
      return {
        week: `W${weekStart.toLocaleDateString("en", { month: "numeric", day: "numeric" })}`,
        sessions: count,
      };
    });
  }, [reportSessions]);

  // Per-event breakdown for the report table
  const reportEventBreakdown = useMemo(() => {
    return reportEvents.map(ev => {
      const s = ev.sessions ?? [];
      const evMode = ev.settings?.appMode ?? "business";
      const isRental = evMode === "rental";
      const completed = s.filter(sess => sess.completed !== false).length;
      const photos = s.reduce((sum, sess) => sum + (sess.photosCount ?? 0), 0);
      const revenue = isRental ? 0 : s.reduce((sum, sess) => sum + getSessionRevenue(sess, ev), 0);
      const taxCollected = isRental ? 0 : s.reduce((sum, sess) => sum + getSessionTax(sess), 0);
      const additionalPrints = isRental ? 0 : s.reduce((sum, sess) => sum + getSessionAdditionalPrints(sess), 0);
      const additionalFeeTotal = isRental ? 0 : s.reduce((sum, sess) => sum + getSessionAdditionalFee(sess), 0);
      const avgDurationSec = (() => {
        const ds = s.filter(sess => typeof sess.durationSec === "number" && sess.durationSec > 0);
        return ds.length ? Math.round(ds.reduce((a, b) => a + b.durationSec, 0) / ds.length) : null;
      })();
      return {
        id: ev.id,
        name: ev.name || "Untitled",
        date: ev.date || ev.created || "—",
        mode: evMode,
        currency: ev.settings?.business?.pricing?.currency ?? "PHP",
        sessions: s.length,
        completed,
        abandoned: s.length - completed,
        photos,
        revenue,
        taxCollected,
        additionalPrints,
        additionalFeeTotal,
        rate: s.length > 0 ? Math.round((completed / s.length) * 100) : 0,
        avgPhotos: s.length > 0 ? (photos / s.length).toFixed(1) : "0.0",
        avgDurationMin: avgDurationSec != null ? (avgDurationSec / 60).toFixed(1) : "—",
      };
    }).sort((a, b) => b.sessions - a.sessions);
  }, [reportEvents]);

  // Revenue by day-of-week (report-scoped)
  const reportDayOfWeekData = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const counts = Array(7).fill(0);
    reportSessions.forEach(s => {
      try { counts[new Date(s.createdAt).getDay()]++; } catch { }
    });
    return days.map((d, i) => ({ day: d, sessions: counts[i] }));
  }, [reportSessions]);

  // Report time-range computed values
  const reportSessionsToday = reportSessions.filter(s => {
    try { return isToday(s.createdAt); } catch { return false; }
  }).length;

  const reportSessionsThisWeek = reportSessions.filter(s => {
    try { return isThisWeek(s.createdAt); } catch { return false; }
  }).length;

  const reportSessionsThisMonth = reportSessions.filter(s => {
    try { return isThisMonth(s.createdAt); } catch { return false; }
  }).length;

  const reportRevenueToday = reportEvents.reduce((sum, ev) =>
    sum + (ev.sessions ?? [])
      .filter(s => { try { return isToday(s.createdAt); } catch { return false; } })
      .reduce((s, sess) => s + getSessionRevenue(sess, ev), 0)
  , 0);

  const reportRevenueThisWeek = reportEvents.reduce((sum, ev) =>
    sum + (ev.sessions ?? [])
      .filter(s => { try { return isThisWeek(s.createdAt); } catch { return false; } })
      .reduce((s, sess) => s + getSessionRevenue(sess, ev), 0)
  , 0);

  const reportRevenueThisMonth = reportEvents.reduce((sum, ev) =>
    sum + (ev.sessions ?? [])
      .filter(s => { try { return isThisMonth(s.createdAt); } catch { return false; } })
      .reduce((s, sess) => s + getSessionRevenue(sess, ev), 0)
  , 0);

  // Additional print and tax analytics for reports
  const reportTotalAdditionalPrints = reportSessions.reduce((s, sess) => s + getSessionAdditionalPrints(sess), 0);
  const reportTotalAdditionalFee = reportSessions.reduce((s, sess) => s + getSessionAdditionalFee(sess), 0);
  const reportTotalTaxCollected = reportSessions.reduce((s, sess) => s + getSessionTax(sess), 0);

  // Sessions by mode
  const reportRentalSessions = reportSessions.filter(s => s?.appMode === "rental").length;
  const reportBusinessSessions = reportSessions.filter(s => s?.appMode === "business" || !s?.appMode).length;

  // Average session duration (minutes)
  const reportSessionsWithDuration = reportSessions.filter(s => typeof s.durationSec === "number" && s.durationSec > 0);
  const reportAvgDurationMin = reportSessionsWithDuration.length > 0
    ? (reportSessionsWithDuration.reduce((s, sess) => s + sess.durationSec, 0) / reportSessionsWithDuration.length / 60).toFixed(1)
    : null;

  // Payment provider breakdown (business sessions only)
  const reportProviderBreakdown = reportSessions.reduce((acc, sess) => {
    if (sess?.appMode === "rental") return acc;
    const prov = sess?.revenue?.paymentProvider;
    if (prov) acc[prov] = (acc[prov] || 0) + 1;
    return acc;
  }, {});

  // Tone/filter usage across report
  const reportToneUsage = reportSessions.reduce((acc, sess) => {
    if (sess.tone) acc[sess.tone] = (acc[sess.tone] || 0) + 1;
    return acc;
  }, {});

  // Offline vs online count
  const reportOfflineCount = reportSessions.filter(s => !!s.offlineMode).length;

  const reportAvgSessionsPerEvent = reportEvents.length > 0
    ? Math.round(reportSessions.length / reportEvents.length)
    : 0;

  const reportAvgPhotosPerSession = reportSessions.length > 0
    ? (reportPhotos / reportSessions.length).toFixed(1)
    : "0.0";

  const reportTotalCompleted = reportSessions.filter(s => s.completed !== false).length;

  // Template usage across all report events
  const reportTemplateUsage = useMemo(() => {
    const usage = {};
    reportEvents.forEach(ev => {
      const tplUse = ev.analytics?.templateUsage ?? {};
      Object.entries(tplUse).forEach(([name, count]) => {
        usage[name] = (usage[name] || 0) + count;
      });
    });
    return Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [reportEvents]);
  const reportMaxTplUsage = reportTemplateUsage.length ? reportTemplateUsage[0][1] : 1;

  // Export helpers for Reports
  const exportReportCSV = () => {
    const header = "Event,Date,Mode,Sessions,Completed,Abandoned,Photos,Revenue,Tax Collected,Additional Prints,Add-On Revenue,Completion Rate,Avg Photos/Session,Avg Duration (min)";
    const rows = reportEventBreakdown.map(ev =>
      `"${ev.name}","${ev.date}","${ev.mode}",${ev.sessions},${ev.completed},${ev.abandoned},${ev.photos},${ev.revenue},${ev.taxCollected},${ev.additionalPrints},${ev.additionalFeeTotal},${ev.rate}%,${ev.avgPhotos},${ev.avgDurationMin}`
    );

    // Report-level summary row
    const summary = `"TOTAL","","",${reportSessions.length},${reportTotalCompleted},${reportSessions.length - reportTotalCompleted},${reportPhotos},${reportGross},${reportTotalTaxCollected},${reportTotalAdditionalPrints},${reportTotalAdditionalFee},${reportConversionRate}%,${reportAvgPhotosPerSession},${reportAvgDurationMin ?? "—"}`;

    // Rental vs business breakdown
    const modeRows = [
      ``,
      `"Mode Breakdown"`,
      `"Rental Sessions",${reportRentalSessions}`,
      `"Business Sessions",${reportBusinessSessions}`,
    ];

    // Tone usage
    const toneRows = Object.entries(reportToneUsage).length > 0
      ? [``, `"Tone Usage"`, ...Object.entries(reportToneUsage).sort((a,b) => b[1]-a[1]).map(([t,c]) => `"${t}",${c}`)]
      : [];

    // Provider breakdown
    const provRows = Object.entries(reportProviderBreakdown).length > 0
      ? [``, `"Payment Provider Breakdown"`, ...Object.entries(reportProviderBreakdown).sort((a,b) => b[1]-a[1]).map(([p,c]) => `"${p}",${c}`)]
      : [];

    const csv = [header, ...rows, summary, ...modeRows, ...toneRows, ...provRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `photuna-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Report exported as CSV");
  };

  // --- Event save/create/delete ---
  const saveCurrentEvent = () => {
    if (!currentEvent) {
      showToast('No event loaded');
      return;
    }

    const settingsToSave = {
      _settingsSaved: true,
      ...sanitizeSettings({
        selectedCameraId,
        mirrorCamera,
        cameraResolution,
        cameraWidth,
        cameraHeight,
        facingMode,
        countdown,
        retakeLimit,
        screenTimers,
        numberOfShots,
        flashEnabled,
        soundEnabled,
        language,
        price,
        appMode,
        timersEnabled,
        consentEnabled,
        storageChoiceEnabled,
        galleryOptionDisabled,
        operatorStorageEnabled,
        operatorStorageLabel,
        operatorStorageUrl,
        operatorStorageApiKey,
        rental: {
          timerEnabled: rentalTimerEnabled,
          timerHours: rentalTimerHours,
          sessionLimitEnabled: rentalSessionLimitEnabled,
          sessionLimit: rentalSessionLimit,
          offlineModeEnabled,
          autoSaveTarget,
          endSessionSummaryEnabled,
        },
        business: {
          activeProvider,
          paymentEnabled,
          payment: { providers: { ...paymentProviders }, stripeProviders: { ...stripeProviders }, xenditProviders: { ...xenditProviders }, paypalProviders: { ...paypalProviders }, cashMode, gcashStaticQrDataUrl },
          pricing: {
            model: pricingModel,
            pricePerSession,
            additionalPrintPrice,
            currency,
            taxEnabled,
            taxRate,
          },
        },
      }),
    };

    const updatedEvent = {
      ...currentEvent,
      appearance: {
        _brandingSaved: true,
        headerFont,
        generalFont,
        headerFontColor,
        generalFontColor,
        bgColor,
        logoPath: logoPath?.url ?? null,
        logoSize,
        backgroundMediaPath: backgroundMediaPath?.url ?? null,
        backgroundMediaName: backgroundMediaPath?.name ?? null,
        backgroundMediaMime: backgroundMediaPath?.mime ?? null,
        backgroundType,
        boothName,
        boothSlogan,
        contactEmail,
        buttonBgColor,
        buttonHoverColor,
        buttonFont,
        buttonFontColor,
        startButtonHidden,
        startButtonText,
      },
      settings: settingsToSave,
      appliedTemplates: currentEvent.appliedTemplates ?? [],
      appliedFrames: currentEvent.appliedFrames ?? [],
      appliedTones: currentEvent.appliedTones ?? [],
      analytics: currentEvent.analytics ?? {},
      notes: currentEvent.notes ?? '',
    };

    const updated = events.map((e) => (e.id === currentEvent.id ? updatedEvent : e));
    setEvents(updated);
    setCurrentEvent(updatedEvent);
    native?.setEvents?.(updated, ctx).catch?.(() => { });
    showToast('Event saved');
  };

  // Persist state (electron-store + Supabase)
  useEffect(() => {
    if (!native?.setEvents || !ready || !hydrated) return;
    native.setEvents(events, ctx).catch?.(() => { });
    pushSettings({ events });
  }, [events, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setTemplates || !ready || !hydrated) return;
    native?.setTemplates(templates, ctx).catch?.(() => { });
    pushSettings({ templates });
  }, [templates, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setFrames || !ready || !hydrated) return;
    native?.setFrames(frames, ctx).catch?.(() => { });
    pushSettings({ frames });
  }, [frames, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setTones || !ready || !hydrated) return;
    native?.setTones(tones, ctx).catch?.(() => { });
  }, [tones, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setPalettes || !ready || !hydrated) return;
    native?.setPalettes(palettes, ctx).catch?.(() => { });
    pushSettings({ palettes });
  }, [palettes, native, ready, ctx]);
  useEffect(() => {
    if (!native?.setAppearance || !ready || !hydrated) return;
    const appearance = {
      headerFont,
      generalFont,
      headerFontColor,
      generalFontColor,
      bgColor,
      logoPath: logoPath?.url ?? null,
      logoSize,
      backgroundMediaPath: backgroundMediaPath?.url ?? null,
      backgroundMediaName: backgroundMediaPath?.name ?? null,
      backgroundMediaMime: backgroundMediaPath?.mime ?? null,
      backgroundType,
      boothName,
      boothSlogan,
      contactEmail,
      buttonBgColor,
      buttonHoverColor,
      buttonFont,
      buttonFontColor,
      startButtonHidden,
      startButtonText,
      selectedBgColorId,
    };
    native.setAppearance(appearance, ctx).catch?.(() => { });
    // Sync to Supabase (debounced)
    pushSettings({ appearance });
  }, [
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
    startButtonHidden,
    startButtonText,
    logoPath,
    logoSize,
    backgroundMediaPath,
    boothName,
    boothSlogan,
    contactEmail,
    native,
    ready,
    ctx,
  ]);

  // Auto-sync booth branding to gallery_event_branding so the gallery reflects
  // any appearance changes the operator makes without needing the manual admin page.
  const _galleryBrandingTimer = React.useRef(null);
  useEffect(() => {
    if (!currentEvent?.id || !identity?.userId || !hydrated || !ready) return;
    if (_galleryBrandingTimer.current) clearTimeout(_galleryBrandingTimer.current);
    _galleryBrandingTimer.current = setTimeout(async () => {
      try {
        await supabase.from('gallery_event_branding').upsert({
          event_id: currentEvent.id,
          owner_user_id: identity.userId,
          accent_color: buttonBgColor || null,
          bg_color: bgColor || null,
          text_color: headerFontColor || null,
          secondary_text_color: generalFontColor || null,
          event_name: boothName || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'event_id' });
      } catch {}
    }, 2500);
    return () => { if (_galleryBrandingTimer.current) clearTimeout(_galleryBrandingTimer.current); };
  }, [buttonBgColor, bgColor, headerFontColor, generalFontColor, boothName, currentEvent?.id, identity?.userId, hydrated, ready]);

  useEffect(() => {
    if (!native?.setSettings || !ready || !hydrated) return;

    const settingsToSave = sanitizeSettings({
      selectedCameraId,
      mirrorCamera,
      cameraResolution,
      cameraWidth,
      cameraHeight,
      facingMode,
      selectedPrinter,
      paperSize,
      printCopies,
      printColorMode,
      printQuality,
      printOrientation,
      printDuplexMode,
      printDpi,
      usePrinterDefaults,
      storagePath,
      autoDeleteDays,
      dimWhenIdle,
      idleTimeout,
      launchOnStartup,
      autoRestart,
      autoUpdateEnabled,
      boothIdentityName,
      boothLocation,
      operatorName,
      countdown,
      retakeLimit,
      screenTimers,
      numberOfShots,
      flashEnabled,
      soundEnabled,
      language,
      price,
      appMode,
      timersEnabled,
      consentEnabled,
      storageChoiceEnabled,
      galleryOptionDisabled,
      operatorStorageEnabled,
      operatorStorageLabel,
      operatorStorageUrl,
      operatorStorageApiKey,
      rental: {
        timerEnabled: rentalTimerEnabled,
        timerHours: rentalTimerHours,
        sessionLimitEnabled: rentalSessionLimitEnabled,
        sessionLimit: rentalSessionLimit,
        offlineModeEnabled,
        autoSaveTarget,
        endSessionSummaryEnabled,
      },
      business: {
        activeProvider,
        paymentEnabled,
        payment: { providers: { ...paymentProviders }, stripeProviders: { ...stripeProviders }, xenditProviders: { ...xenditProviders }, paypalProviders: { ...paypalProviders }, cashMode, gcashStaticQrDataUrl },
        pricing: {
          model: pricingModel,
          pricePerSession,
          additionalPrintPrice,
          currency,
          taxEnabled,
          taxRate,
        },
      },
    });

    try { localStorage.setItem("boothSettings", JSON.stringify(settingsToSave)); } catch {}
    native
      .setSettings(settingsToSave, ctx)
      .catch?.(() => { });
  }, [
    selectedCameraId,
    mirrorCamera,
    cameraResolution,
    cameraWidth,
    cameraHeight,
    facingMode,
    selectedPrinter,
    paperSize,
    printCopies,
    printColorMode,
    printQuality,
    printOrientation,
    printDuplexMode,
    printDpi,
    usePrinterDefaults,
    storagePath,
    autoDeleteDays,
    dimWhenIdle,
    idleTimeout,
    launchOnStartup,
    autoRestart,
    autoUpdateEnabled,
    boothIdentityName,
    boothLocation,
    operatorName,
    countdown,
    retakeLimit,
    screenTimers,
    numberOfShots,
    flashEnabled,
    soundEnabled,
    language,
    price,
    appMode,
    timersEnabled,
    consentEnabled,
    storageChoiceEnabled,
    galleryOptionDisabled,
    operatorStorageEnabled,
    operatorStorageLabel,
    operatorStorageUrl,
    operatorStorageApiKey,
    rentalTimerEnabled,
    rentalTimerHours,
    rentalSessionLimitEnabled,
    rentalSessionLimit,
    offlineModeEnabled,
    autoSaveTarget,
    endSessionSummaryEnabled,
    activeProvider,
    paymentEnabled,
    paymentProviders,
    stripeProviders,
    xenditProviders,
    paypalProviders,
    cashMode,
    gcashStaticQrDataUrl,
    pricingModel,
    pricePerSession,
    additionalPrintPrice,
    currency,
    taxEnabled,
    taxRate,
    native,
    ready,
    ctx,
  ]);

  useEffect(() => {
    if (!native?.setCurrentEventId || !hydrated) return;
    // Never write null. The booth reads this id as a fallback when it is not
    // handed an event directly (FrameFilterScreen, PrintPreviewScreen), and a
    // dashboard reload now closes the open event — without this guard that
    // reload would clear the id out from under a running booth. Start Booth
    // always sets it explicitly, so it stays correct.
    if (!currentEvent?.id) return;
    native.setCurrentEventId(currentEvent.id).catch?.(() => { });
  }, [currentEvent, native]);
  useEffect(() => {
    if (!native?.setCurrentSubTab) return;
    native?.setCurrentSubTab(activeSub).catch?.(() => { });
  }, [activeSub, native]);
  useEffect(() => {
    if (!native?.setActiveMain || !hydrated) return;
    native.setActiveMain(activeMain).catch?.(() => { });
  }, [activeMain, native, hydrated]);

  useEffect(() => {
    // Load event-level settings (flow, mode, business, rental) straight from the
    // event. createEvent seeds a new event with proper defaults, so this is
    // correct for both cases: a saved event shows its own values, a new one
    // shows the defaults. Do NOT fall back to the global settings here —
    // saveSettings writes the global FROM the current form, so the global is
    // whatever the last-opened event had, and using it re-creates the exact
    // duplication this is meant to prevent.
    // Machine-level settings (camera, printer, storage) are not touched below;
    // they stay global by design.
    if (!currentEvent) return;
    const s = currentEvent.settings ?? {};
    setCountdown(s.countdown ?? 5);
    setRetakeLimit(s.retakeLimit ?? 0);
    setScreenTimers(s.screenTimers ?? DEFAULT_SCREEN_TIMERS);
    setNumberOfShots(s.numberOfShots ?? 3);
    setTimersEnabled(s.timersEnabled ?? false);
    setConsentEnabled(s.consentEnabled ?? true);
    setStorageChoiceEnabled(s.storageChoiceEnabled ?? false);
    setGalleryOptionDisabled(s.galleryOptionDisabled ?? false);
    setOperatorStorageEnabled(s.operatorStorageEnabled ?? false);
    setOperatorStorageLabel(s.operatorStorageLabel ?? "Our Storage");
    setOperatorStorageUrl(s.operatorStorageUrl ?? "");
    setOperatorStorageApiKey(s.operatorStorageApiKey ?? "");
    setFlashEnabled(s.flashEnabled ?? true);
    setSoundEnabled(s.soundEnabled ?? true);
    setLanguage(s.language ?? 'en');
    setPrice(s.price ?? 0);
    setAppMode(s.appMode ?? DEFAULT_APP_MODE);
    const rental = s.rental ?? {};
    setRentalTimerEnabled(rental.timerEnabled ?? DEFAULT_RENTAL.timerEnabled);
    setRentalTimerHours(rental.timerHours ?? DEFAULT_RENTAL.timerHours);
    setRentalSessionLimitEnabled(rental.sessionLimitEnabled ?? DEFAULT_RENTAL.sessionLimitEnabled);
    setRentalSessionLimit(rental.sessionLimit ?? DEFAULT_RENTAL.sessionLimit);
    setOfflineModeEnabled(rental.offlineModeEnabled ?? DEFAULT_RENTAL.offlineModeEnabled);
    setAutoSaveTarget(rental.autoSaveTarget ?? DEFAULT_RENTAL.autoSaveTarget);
    setEndSessionSummaryEnabled(rental.endSessionSummaryEnabled ?? DEFAULT_RENTAL.endSessionSummaryEnabled);
    const business = s.business ?? {};
    setPaymentEnabled(business.paymentEnabled ?? DEFAULT_BUSINESS.paymentEnabled);
    setActiveProvider(business.activeProvider ?? DEFAULT_BUSINESS.activeProvider);
    setPaymentProviders(business.payment?.providers ?? { ...DEFAULT_BUSINESS.payment.providers });
    setStripeProviders(business.payment?.stripeProviders ?? { ...DEFAULT_STRIPE_PROVIDERS });
    setXenditProviders(business.payment?.xenditProviders ?? { ...DEFAULT_XENDIT_PROVIDERS });
    setPaypalProviders(business.payment?.paypalProviders ?? { ...DEFAULT_PAYPAL_PROVIDERS });
    setCashMode(business.payment?.cashMode ?? 'manual');
    const pricing = business.pricing ?? {};
    setPricingModel(pricing.model ?? DEFAULT_BUSINESS.pricing.model);
    setPricePerSession(pricing.pricePerSession ?? DEFAULT_BUSINESS.pricing.pricePerSession);
    setAdditionalPrintPrice(pricing.additionalPrintPrice ?? DEFAULT_BUSINESS.pricing.additionalPrintPrice);
    setCurrency(pricing.currency ?? DEFAULT_BUSINESS.pricing.currency);
    setTaxEnabled(pricing.taxEnabled ?? DEFAULT_BUSINESS.pricing.taxEnabled);
    setTaxRate(pricing.taxRate ?? DEFAULT_BUSINESS.pricing.taxRate);
  }, [currentEvent]);

  useEffect(() => {
    // Load branding straight from the event, same reasoning as the settings
    // effect above: createEvent seeds new events with DEFAULT_APPEARANCE, so a
    // new event shows defaults and a saved event shows its own branding.
    // Falling back to the global appearance would re-introduce the leak, since
    // the global is written from the current form by the branding save.
    if (!currentEvent) return;
    const ap = currentEvent.appearance ?? {};
    setHeaderFont(ap.headerFont || 'Inter');
    setGeneralFont(ap.generalFont || 'Inter');
    setbuttonFont(ap.buttonFont || 'Inter');
    setHeaderFontColor(ap.headerFontColor || '#111827');
    setGeneralFontColor(ap.generalFontColor || '#374151');
    setBgColor(ap.bgColor || '#ffffff');
    setButtonBgColor(ap.buttonBgColor || ACCENT_COLOR);
    setButtonHoverColor(ap.buttonHoverColor || '#5348ff');
    setButtonFontColor(ap.buttonFontColor || '#ffffff');
    setBoothName(ap.boothName ?? '');
    setBoothSlogan(ap.boothSlogan ?? '');
    setContactEmail(ap.contactEmail ?? '');
    setBackgroundType(ap.backgroundType || 'media');
    setStartButtonText(ap.startButtonText || 'Tap to Start');
    setStartButtonHidden(ap.startButtonHidden ?? false);
    setLogoSize(ap.logoSize ?? 100);
    setLogoPath(ap.logoPath
      ? { url: ap.logoPath, name: 'logo', previewUrl: ap.logoPath }
      : null);
    setBackgroundMediaPath(ap.backgroundMediaPath
      ? { url: ap.backgroundMediaPath, name: ap.backgroundMediaName ?? 'background', previewUrl: ap.backgroundMediaPath, mime: ap.backgroundMediaMime ?? '' }
      : null);
  }, [currentEvent]);

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);


  // === CAMERA LOAD (ADD) ============================================
  // Try to fetch from Electron; if not available, provide a safe fallback.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cams = (await native?.listCameras?.()) || [];
        if (mounted) {
          setCameraList(Array.isArray(cams) ? normalizeCameraList(cams) : []);
        }
      } catch (e) {
        console.warn("listCameras not available; using fallback");
        if (mounted) {
          setCameraList([{ id: "default", label: "Default camera", kind: "videoinput" }]);
        }
      }
    })();
    return () => { mounted = false; };
  }, [native]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await native?.listPrinters?.();
        if (mounted && Array.isArray(list)) {
          setPrinters(normalizePrinterList(list));
        }
      } catch (err) {
        console.warn("listPrinters not available; using fallback");
        if (mounted) {
          setPrinters([{ name: "Virtual Printer", displayName: "Virtual Printer", isDefault: true, options: {} }]);
        }
      }
    })();
    return () => { mounted = false; };
  }, [native]);

  useEffect(() => {
    if (activeMain !== "account" || !identity?.userId) return;

    let cancelled = false;

    (async () => {
      try {
        const [meRes, prefRes] = await Promise.all([
          typeof licensingApi.me === "function" ? licensingApi.me().catch(() => null) : Promise.resolve(null),
          window.electron?.getAccountPreferences?.().catch(() => null),
        ]);

        if (!cancelled) {
          const resolvedProfile = meRes?.profile || profile || null;
          const resolvedUser = meRes?.user || user;

          setAccountForm((prev) => ({
            ...prev,
            displayName:
              resolvedProfile?.full_name ||
              resolvedUser?.user_metadata?.full_name ||
              resolvedUser?.email ||
              "",
            email: resolvedProfile?.email || resolvedUser?.email || "",
            phone: resolvedProfile?.phone || "",
            role: resolvedProfile?.role || "Administrator",
            company: resolvedProfile?.company || "",
            badgePhoto: resolvedProfile?.avatar_url || "",
          }));
        }

        if (!cancelled && prefRes?.ok && prefRes.preferences) {
          setAccountPreferences((prev) => ({ ...prev, ...prefRes.preferences }));
        }

        if (!cancelled) {
          const [pmStatus, stripeStatus, xenditStatus, paypalStatus] = await Promise.all([
            window.electron?.getPayMongoStatus?.().catch(() => null),
            window.electron?.getStripeStatus?.().catch(() => null),
            window.electron?.getXenditStatus?.().catch(() => null),
            window.electron?.getPaypalStatus?.().catch(() => null),
          ]);
          if (pmStatus?.ok) {
            setPaymongoConfigured(pmStatus.configured);
            setPaymongoTestMode(pmStatus.testMode);
            setPaymongoPublicKey(pmStatus.publicKey || "");
          }
          if (stripeStatus?.ok) {
            setStripeConfigured(stripeStatus.configured);
            setStripeTestMode(stripeStatus.testMode);
            if (stripeStatus.publishableKeyPreview) setStripeKeyDisplay(stripeStatus.publishableKeyPreview);
          }
          if (xenditStatus?.ok) {
            setXenditConfigured(xenditStatus.configured);
            setXenditTestMode(xenditStatus.testMode);
            if (xenditStatus.apiKeyPreview) setXenditKeyDisplay(xenditStatus.apiKeyPreview);
          }
          if (paypalStatus?.ok) {
            setPaypalConfigured(paypalStatus.configured);
            setPaypalSandboxMode(paypalStatus.sandboxMode);
            if (paypalStatus.clientIdPreview) setPaypalClientIdDisplay(paypalStatus.clientIdPreview);
          }
        }
      } catch (err) {
        console.error("Failed to load account center:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeMain, identity?.userId, profile, user]);

  // Load all payment gateway statuses at startup so Business mode reflects real state.
  useEffect(() => {
    if (!identity?.userId) return;
    let cancelled = false;
    Promise.all([
      window.electron?.getPayMongoStatus?.().catch(() => null),
      window.electron?.getStripeStatus?.().catch(() => null),
      window.electron?.getXenditStatus?.().catch(() => null),
      window.electron?.getPaypalStatus?.().catch(() => null),
    ]).then(([pmStatus, stripeStatus, xenditStatus, paypalStatus]) => {
      if (cancelled) return;
      if (pmStatus?.ok) {
        setPaymongoConfigured(pmStatus.configured);
        setPaymongoTestMode(pmStatus.testMode);
        setPaymongoPublicKey(pmStatus.publicKey || "");
      }
      if (stripeStatus?.ok) {
        setStripeConfigured(stripeStatus.configured);
        setStripeTestMode(stripeStatus.testMode);
        if (stripeStatus.publishableKeyPreview) setStripeKeyDisplay(stripeStatus.publishableKeyPreview);
      }
      if (xenditStatus?.ok) {
        setXenditConfigured(xenditStatus.configured);
        setXenditTestMode(xenditStatus.testMode);
        if (xenditStatus.apiKeyPreview) setXenditKeyDisplay(xenditStatus.apiKeyPreview);
      }
      if (paypalStatus?.ok) {
        setPaypalConfigured(paypalStatus.configured);
        setPaypalSandboxMode(paypalStatus.sandboxMode);
        if (paypalStatus.clientIdPreview) setPaypalClientIdDisplay(paypalStatus.clientIdPreview);
      }
    });
    return () => { cancelled = true; };
  }, [identity?.userId]);


  const handleGcashQrUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setGcashStaticQrDataUrl(ev.target.result ?? "");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDetectCashHardware = async () => {
    setCashHardwareDetecting(true);
    try {
      const res = await window.api?.invoke?.("cash:detectHardware");
      const detected = res?.detected ?? false;
      const devices = res?.devices ?? [];
      setCashHardwareDetected(detected);
      setCashHardwareDevices(devices);
      if (!detected) setCashMode("manual");
    } catch {
      setCashHardwareDetected(false);
      setCashHardwareDevices([]);
      setCashMode("manual");
    } finally {
      setCashHardwareDetecting(false);
    }
  };

  // Autosave
  useEffect(() => {
    if (!autosaveEnabled || !currentEvent) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    // Use a slightly longer debounce
    autosaveTimer.current = setTimeout(() => {
      try {
        saveCurrentEvent();
        showToast('Autosaved');
      } catch (e) {
        console.error('Autosave failed', e);
        showToast('Autosave failed');
      }
    }, 1600);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autosaveEnabled,
    currentEvent,
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    countdown,
    retakeLimit,
    screenTimers,
    numberOfShots,
    flashEnabled,
    soundEnabled,
    language,
    price,
    timersEnabled,
    consentEnabled,
    storageChoiceEnabled,
    galleryOptionDisabled,
    operatorStorageEnabled,
    operatorStorageLabel,
    operatorStorageUrl,
    operatorStorageApiKey,
    logoPath,
    backgroundMediaPath,
    boothName,
    boothSlogan,
    contactEmail,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
    startButtonHidden,
    startButtonText,
    appMode,
    rentalTimerEnabled,
    rentalTimerHours,
    rentalSessionLimitEnabled,
    rentalSessionLimit,
    offlineModeEnabled,
    autoSaveTarget,
    endSessionSummaryEnabled,
    paymentEnabled,
    paymentProviders,
    pricingModel,
    pricePerSession,
    additionalPrintPrice,
    currency,
    taxEnabled,
    taxRate,
  ]);

  // -- Utilities for events --
  const completedSessionsToday = (ev) => {
    const log = ev?.analytics?.sessionLog ?? [];
    if (Array.isArray(log) && log.length) {
      return log.filter((s) => s?.status === "completed" && isSameLocalDay(s?.ts)).length;
    }
    return ev?.analytics?.sessionsToday ?? 0;
  };

  const createEvent = (e) => {
    e.preventDefault();
    if (!newEventName.trim()) {
      showToast("Please enter an event name");
      return;
    }
    if (Number.isFinite(eventLimit) && eventLimit > 0 && events.length >= eventLimit) {
      showToast(`Event limit reached for your current plan (${eventLimit}).`);
      return;
    }
    const nextId = makeId();

    const appearanceClone = JSON.parse(JSON.stringify(DEFAULT_APPEARANCE));  // fresh defaults
    const settingsClone = JSON.parse(JSON.stringify({
      countdown: 5,
      retakeLimit: 0,
      screenTimers: DEFAULT_SCREEN_TIMERS,
      numberOfShots: 3,
      flashEnabled: true,
      soundEnabled: true,
      language: "en",
      price: 0,
      appMode: DEFAULT_APP_MODE,
      timersEnabled: false,
      rental: { ...DEFAULT_RENTAL },
      business: { ...DEFAULT_BUSINESS },
    }));

    // Optionally seed the applied design from an existing event. Deep-cloned so
    // the source event can never be mutated through the new event's arrays.
    const copySource = (copyDesignEnabled && copyDesignFromEventId)
      ? events.find((e) => String(e.id) === String(copyDesignFromEventId))
      : null;
    const clonedApplied = copySource
      ? JSON.parse(JSON.stringify({
          appliedTemplates: copySource.appliedTemplates ?? [],
          appliedFrames: copySource.appliedFrames ?? [],
          appliedTones: copySource.appliedTones ?? [],
        }))
      : { appliedTemplates: [], appliedFrames: [], appliedTones: [] };

    const newEv = {
      id: nextId,
      name: newEventName.trim(),
      created: new Date().toLocaleDateString(),
      appearance: appearanceClone,
      appliedTemplates: clonedApplied.appliedTemplates,
      appliedFrames: clonedApplied.appliedFrames,
      appliedTones: clonedApplied.appliedTones,
      settings: settingsClone,
      analytics: {
        sessionsToday: 0,
        sessionsWeekly: 0,
        sessionsMonthly: 0,
        revenueToday: 0,
        revenueWeekly: 0,
        revenueMonthly: 0,
        templateUsage: {},
      },
      notes: newEventNotes,
    };
    const updated = [newEv, ...events];
    setEvents(updated);
    native?.setEvents?.(updated, { userId: identity.userId }).catch?.(() => { });
    setNewEventName("");
    setNewEventNotes("");
    setCopyDesignEnabled(false);
    setCopyDesignFromEventId("");
    showToast(
      copySource
        ? `Event created — design copied from "${copySource.name || 'Untitled event'}"`
        : "Event created"
    );
  };

  async function handleLogoutClick() {
    try {
      if (native) {
        await native?.setEvents?.(events, ctx);
        await native?.setTemplates?.(templates, ctx);
        await native?.setFrames?.(frames, ctx);
        await native?.setTones?.(tones, ctx);
        await native?.setPalettes?.(palettes, ctx);
        await native?.setAppearance?.({
          logoPath: logoPath?.url ?? null,
          logoSize,
          backgroundMediaPath: backgroundMediaPath?.url ?? null,
          backgroundMediaName: backgroundMediaPath?.name ?? null,
          backgroundMediaMime: backgroundMediaPath?.mime ?? null,
          backgroundType,
          boothName,
          boothSlogan,
          contactEmail,
          headerFont,
          generalFont,
          headerFontColor,
          generalFontColor,
          bgColor,
          buttonBgColor,
          buttonHoverColor,
          buttonFont,
          buttonFontColor,
          startButtonHidden,
          startButtonText,
        }, ctx);

        await native?.setSettings?.({
          countdown,
          retakeLimit,
          screenTimers,
          numberOfShots,
          flashEnabled,
          soundEnabled,
          language,
          price,
          appMode,
          rental: {
            timerEnabled: rentalTimerEnabled,
            timerHours: rentalTimerHours,
            sessionLimitEnabled: rentalSessionLimitEnabled,
            sessionLimit: rentalSessionLimit,
            offlineModeEnabled,
            autoSaveTarget,
            endSessionSummaryEnabled,
          },
          business: {
            activeProvider,
            paymentEnabled,
            payment: { providers: { ...paymentProviders }, stripeProviders: { ...stripeProviders }, xenditProviders: { ...xenditProviders }, paypalProviders: { ...paypalProviders }, cashMode, gcashStaticQrDataUrl },
            pricing: {
              model: pricingModel,
              pricePerSession,
              additionalPrintPrice,
              currency,
              taxEnabled,
              taxRate,
            },
          },
        }, ctx);

        await native?.setCurrentEventId?.(currentEvent?.id ?? null);
        await native?.setCurrentSubTab?.(activeSub);
      }
    } catch (err) {
      console.error("persist before logout failed", err);
    } finally {
      // Sign out of Supabase — this sets user = null in AuthContext,
      // which causes App.js to re-render <AuthGate /> automatically.
      // Do NOT call navigate() here: the component will unmount as part
      // of the re-render, and navigating on an unmounting component throws.
      try {
        if (typeof logout === "function") {
          await logout();
        } else {
          await supabase.auth.signOut();
        }
      } catch (err) {
        console.error("logout() failed", err);
      }

      // Notify parent (App.js). The onLogout prop must NOT call logout()
      // again — logout() has already run above.
      onLogout?.();
    }
  }

  const refreshLicense = useCallback(async () => {
    await ctxRefreshLicense().catch((err) =>
      console.error("ctxRefreshLicense failed", err)
    );
  }, [ctxRefreshLicense]);

  const toNumber = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  // ---------------------------
  // PAYMONGO PAYMENT FLOW
  // ---------------------------
  const PAYMONGO_PHP_AMOUNTS = { monthly: 1800, yearly: 11400, plus: 900, business: 1700 };
  const [showPaymongoModal, setShowPaymongoModal] = useState(false);
  const [paymongoQrDataUrl, setPaymongoQrDataUrl] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discountResult, setDiscountResult] = useState(null); // { valid, discountedAmountPhp, savingsPhp, ... }
  const [discountApplying, setDiscountApplying] = useState(false);
  const [paymongoCheckoutUrl, setPaymongoCheckoutUrl] = useState("");
  const [paymongoLinkId, setPaymongoLinkId] = useState("");
  const [paymongoPlanType, setPaymongoPlanType] = useState("subscription");
  const [paymongoPlan, setPaymongoPlan] = useState("monthly");
  const [paymongoStatus, setPaymongoStatus] = useState("idle"); // idle | loading | polling | confirmed | error
  const [paymongoError, setPaymongoError] = useState("");
  const paymongoTimerRef = useRef(null);

  const stopPaymongoPoll = () => {
    if (paymongoTimerRef.current) {
      clearInterval(paymongoTimerRef.current);
      paymongoTimerRef.current = null;
    }
  };

  const [stripeCheckoutLoading, setStripeCheckoutLoading] = useState(false);

  const openStripeCheckout = async (planType, plan) => {
    setStripeCheckoutLoading(true);
    try {
      let res;
      if (planType === "gallery") {
        res = await licensingApi.createGalleryAddonSession();
      } else {
        res = await licensingApi.createStripeCheckoutSession(plan);
      }
      if (!res?.url) throw new Error("No checkout URL returned");
      window.system?.openExternal?.(res.url) ?? window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      showToast?.(`Failed to open checkout: ${err?.message || "Please try again."}`);
    } finally {
      setStripeCheckoutLoading(false);
    }
  };

  const openPayMongoPayment = (planType, plan) => {
    stopPaymongoPoll();
    setPaymongoPlanType(planType);
    setPaymongoPlan(plan);
    setPaymongoStatus("idle");
    setPaymongoError("");
    setPaymongoQrDataUrl("");
    setPaymongoLinkId("");
    setPaymongoCheckoutUrl("");
    setDiscountCode("");
    setDiscountResult(null);
    setShowPaymongoModal(true);
  };

  const proceedToPayMongoPayment = async () => {
    const planType = paymongoPlanType;
    const plan = paymongoPlan;
    const code = discountResult?.valid ? discountCode : undefined;
    setPaymongoStatus("loading");
    try {
      const res = await licensingApi.createPayMongoLink(planType, plan, code);
      setPaymongoQrDataUrl(res.qrDataUrl);
      setPaymongoLinkId(res.linkId);
      setPaymongoCheckoutUrl(res.checkoutUrl);
      setPaymongoStatus("polling");
      paymongoTimerRef.current = setInterval(async () => {
        try {
          const status = await licensingApi.getPayMongoLinkStatus(res.linkId, planType, plan);
          if (status.paid) {
            stopPaymongoPoll();
            setPaymongoStatus("confirmed");
            showToast?.("Payment confirmed! Activating your plan...");
            await refreshLicense();
          }
        } catch (_) { /* ignore transient poll errors */ }
      }, 3000);
    } catch (err) {
      setPaymongoStatus("error");
      setPaymongoError(err?.message || "Failed to create payment link. Check your internet connection.");
    }
  };

  const closePaymongoModal = () => {
    stopPaymongoPoll();
    setShowPaymongoModal(false);
    setPaymongoStatus("idle");
    setDiscountCode("");
    setDiscountResult(null);
  };


  // Gallery plan state
  const [galleryPlan, setGalleryPlan] = useState("free"); // "free" | "plus" | "business"

  // Reflect the live entitlement tier (free | plus | business) in the plan cards
  // so the "Current Plan" highlight matches what the account actually has.
  useEffect(() => {
    const tier = gating?.galleryTier
      || (gating?.galleryEnabled || gating?.galleryAddon ? "plus" : "free");
    if (["free", "plus", "business"].includes(tier)) setGalleryPlan(tier);
  }, [gating?.galleryTier, gating?.galleryEnabled, gating?.galleryAddon]);

  // ---------------------------
  // TEMPLATE EDITOR FUNCTIONS
  // ---------------------------
  function ensureSlotNumbers(slots) {
    // Return a NEW array and resequence slotNumber starting at 1
    return slots.map((s, i) => ({ ...s, slotNumber: i + 1 }));
  }
  const snapValue = (v) => {
    if (!snapEnabled) return v;
    const step = snapPercent / 100;
    return Math.round(v / step) * step;
  };

  // Grid rendering
  const renderGrid = (cols = 24, rows = 36) => {
    if (!showGrid) return null;
    const lines = [];
    for (let i = 1; i < cols; i++) {
      lines.push(
        <div
          key={`vc${i}`}
          style={{
            position: "absolute",
            left: `${(i / cols) * 100}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(0,0,0,0.06)",
          }}
        />
      );
    }
    for (let j = 1; j < rows; j++) {
      lines.push(
        <div
          key={`hr${j}`}
          style={{
            position: "absolute",
            top: `${(j / rows) * 100}%`,
            left: 0,
            right: 0,
            height: 1,
            background: "rgba(0,0,0,0.06)",
          }}
        />
      );
    }
    return lines;
  };

  // Preset generator (fills area with slots on grid)
  const applyPreset = (cols, rows) => {
    const padding = 0.04;
    const gridW = 1 - padding * 2;
    const gridH = 1 - padding * 2;
    const cellW = gridW / cols;
    const cellH = gridH / rows;
    const slots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = makeId();
        const w = Math.max(0.05, Math.min(1, cellW * 0.9));
        const h = Math.max(0.05, Math.min(1, cellH * 0.9));
        const x = padding + c * cellW + (cellW - w) / 2;
        const y = padding + r * cellH + (cellH - h) / 2;
        slots.push({
          id,
          x: snapValue(x),
          y: snapValue(y),
          w: snapValue(w),
          h: snapValue(h),
          rotation: 0,
        });
      }
    }
    setTemplateSlotsState(ensureSlotNumbers(slots));
    setSelectionIds(slots.map((s) => s.id));
    showToast(`Applied ${cols}×${rows} preset`);
  };

  // Align / distribute tools (operate on selection or all)
  const alignSlots = (action) => {
    const targetIds = selectionIds.length ? selectionIds : templateSlotsState.map((s) => s.id);
    if (!targetIds.length) return;
    const slotsMap = Object.fromEntries(templateSlotsState.map((s) => [s.id, s]));
    const targets = targetIds.map((id) => slotsMap[id]).filter(Boolean);
    if (!targets.length) return;
    const applyTo = (fn) => {
      setTemplateSlotsState((prev) => prev.map((s) => (targetIds.includes(s.id) ? fn(s) : s)));
    };
    if (["left", "centerX", "right"].includes(action)) {
      let refX = 0;
      if (action === "centerX") {
        const minX = Math.min(...targets.map((t) => t.x ?? 0));
        const maxX = Math.max(...targets.map((t) => (t.x ?? 0) + (t.w ?? 0)));
        refX = (minX + maxX) / 2;
      }
      if (action === "right") {
        const maxX = Math.max(...targets.map((t) => (t.x ?? 0) + (t.w ?? 0)));
        refX = maxX;
      }
      applyTo((s) => {
        const w = s.w ?? 0.25;
        let x;
        if (action === "left") x = 0;
        if (action === "centerX") x = Math.max(0, Math.min(1 - w, refX - w / 2));
        if (action === "right") x = Math.max(0, Math.min(1 - w, 1 - w));
        return { ...s, x: snapValue(x) };
      });
      return;
    }
    if (["top", "centerY", "bottom"].includes(action)) {
      let refY = 0;
      if (action === "centerY") {
        const minY = Math.min(...targets.map((t) => t.y ?? 0));
        const maxY = Math.max(...targets.map((t) => (t.y ?? 0) + (t.h ?? 0)));
        refY = (minY + maxY) / 2;
      }
      if (action === "bottom") {
        const maxY = Math.max(...targets.map((t) => (t.y ?? 0) + (t.h ?? 0)));
        refY = maxY;
      }
      applyTo((s) => {
        const h = s.h ?? 0.25;
        let y;
        if (action === "top") y = 0;
        if (action === "centerY") y = Math.max(0, Math.min(1 - h, refY - h / 2));
        if (action === "bottom") y = Math.max(0, Math.min(1 - h, 1 - h));
        return { ...s, y: snapValue(y) };
      });
      return;
    }
    if (action === "distributeX") {
      const sorted = targets.slice().sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      const n = sorted.length;
      const updatedPositions = {};
      sorted.forEach((s, i) => {
        const w = s.w ?? 0.25;
        const denom = Math.max(1, n - 1);
        const x = Math.max(0, Math.min(1 - w, (i / denom) * (1 - w)));
        updatedPositions[s.id] = snapValue(x);
      });
      setTemplateSlotsState((prev) =>
        prev.map((s) => (updatedPositions[s.id] !== undefined ? { ...s, x: updatedPositions[s.id] } : s))
      );
      return;
    }
    if (action === "distributeY") {
      const sorted = targets.slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
      const n = sorted.length;
      const updatedPositions = {};
      sorted.forEach((s, i) => {
        const h = s.h ?? 0.25;
        const y = Math.max(0, Math.min(1 - h, (i / (n - 1 || 1)) * (1 - h)));
        updatedPositions[s.id] = snapValue(y);
      });
      setTemplateSlotsState((prev) =>
        prev.map((s) => (updatedPositions[s.id] !== undefined ? { ...s, y: updatedPositions[s.id] } : s))
      );
      return;
    }
  };

  // Pointer (drag/resize)
  const toPixels = (norm, size) => Math.round(norm * size);
  const toNorm = (px, size) => Math.max(0, Math.min(1, px / size));

  const onCanvasPointerDown = (ev, slotId, handle = null) => {
    ev.preventDefault();

    // Capture on the actual element that receives the event (the slot).
    const targetEl = ev.currentTarget; // the slot div
    if (targetEl?.setPointerCapture) {
      try { targetEl.setPointerCapture(ev.pointerId); } catch { }
    }

    // Get the rect from the canvas container (the div with ref={canvasRef})
    // Fall back to the target element's rect if, for some reason, the ref is not set.
    const container = canvasRef.current ?? targetEl;
    if (!container) return; // should not happen, but keeps us safe

    const rect = container.getBoundingClientRect();
    const startX = ev.clientX - rect.left;
    const startY = ev.clientY - rect.top;

    const slot = templateSlotsState.find((s) => s.id === slotId);
    if (!slot) return;

    pointerState.current = {
      mode: handle ? "resize" : "move",
      slotId,
      start: { x: startX, y: startY, rect },
      orig: { ...slot },
      handle,
    };
  };

  const onCanvasPointerMove = (ev) => {
    const state = pointerState.current;
    if (!state || !state.mode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const curX = ev.clientX - rect.left;
    const curY = ev.clientY - rect.top;
    const dx = curX - state.start.x;
    const dy = curY - state.start.y;
    const canvasW = rect.width;
    const canvasH = rect.height;
    if (state.mode === "move") {
      const orig = state.orig;
      const newX = snapValue(toNorm(toPixels(orig.x, canvasW) + dx, canvasW));
      const newY = snapValue(toNorm(toPixels(orig.y, canvasH) + dy, canvasH));
      setTemplateSlotsState((s) =>
        s.map((slot) =>
          slot.id === state.slotId
            ? {
              ...slot,
              x: Math.max(0, Math.min(1 - (orig.w ?? 0.05), newX)),
              y: Math.max(0, Math.min(1 - (orig.h ?? 0.05), newY)),
            }
            : slot
        )
      );
    } else if (state.mode === "resize") {
      const orig = state.orig;
      const handle = state.handle;
      let newW = orig.w;
      let newH = orig.h;
      let newX = orig.x;
      let newY = orig.y;
      const deltaW = dx / canvasW;
      const deltaH = dy / canvasH;
      if (handle.includes("e")) {
        newW = Math.max(0.05, Math.min(1 - orig.x, (orig.w ?? 0.25) + deltaW));
      }
      if (handle.includes("w")) {
        const pxLeft = toPixels(orig.x, canvasW) + dx;
        const normLeft = toNorm(pxLeft, canvasW);
        const right = orig.x + orig.w;
        newX = Math.max(0, Math.min(right - 0.05, normLeft));
        newW = Math.max(0.05, Math.min(1 - newX, right - newX));
      }
      if (handle.includes("s")) {
        newH = Math.max(0.05, Math.min(1 - orig.y, (orig.h ?? 0.25) + deltaH));
      }
      if (handle.includes("n")) {
        const pxTop = toPixels(orig.y, canvasH) + dy;
        const normTop = toNorm(pxTop, canvasH);
        const bottom = orig.y + orig.h;
        newY = Math.max(0, Math.min(bottom - 0.05, normTop));
        newH = Math.max(0.05, Math.min(1 - newY, bottom - newY));
      }
      setTemplateSlotsState((s) =>
        s.map((slot) =>
          slot.id === state.slotId
            ? {
              ...slot,
              x: snapValue(newX),
              y: snapValue(newY),
              w: snapValue(newW),
              h: snapValue(newH),
            }
            : slot
        )
      );
    }
  };
  const onCanvasPointerUp = (ev) => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch { }
    }
    pointerState.current = { mode: null, slotId: null, start: null, orig: null, handle: null };
  };

  // Delete slot
  const deleteSlot = (e, slotId) => {
    setTemplateSlotsState((prev) =>
      prev.filter((s) => s.id !== slotId)
    );
    setSelectionIds((prev) =>
      prev.filter((id) => id !== slotId)
    );
  };

  // Duplicate slot
  const duplicateSlot = (e, slotId) => {
    const slotToCopy = templateSlotsState.find((s) => s.id === slotId);
    if (!slotToCopy) return;
    const newId = makeId();
    const offset = 0.02; // offset to avoid exact overlap
    const newSlot = {
      ...slotToCopy,
      id: newId,
      x: Math.min(slotToCopy.x + offset, 0.85),
      y: Math.min(slotToCopy.y + offset, 0.85),
      slotNumber: templateSlotsState.length + 1,
    };
    setTemplateSlotsState((prev) => [...prev, newSlot]);
    setSelectionIds([newId]);
  };

  // Rotation
  const startRotate = (e, slotId) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const slot = templateSlotsState.find((s) => s.id === slotId);
    if (!slot) return;

    const centerX = rect.left + (slot.x + slot.w / 2) * rect.width;
    const centerY = rect.top + (slot.y + slot.h / 2) * rect.height;
    const startAngle = (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI;

    rotatingRef.current = { id: slotId, startAngle, startRotation: slot.rotation ?? 0, centerX, centerY };

    const onMove = (ev) => {
      const r = rotatingRef.current;
      if (!r) return;
      const angle = (Math.atan2(ev.clientY - r.centerY, ev.clientX - r.centerX) * 180) / Math.PI;
      const delta = angle - r.startAngle;
      const newRot = Math.round(((r.startRotation + delta) % 360 + 360) % 360);
      setTemplateSlotsState((s) => s.map((slot) => (slot.id === r.id ? { ...slot, rotation: newRot } : slot)));
    };

    const onUp = () => {
      rotatingRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove, { once: false });
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const onRotateMove = (e) => {
    const r = rotatingRef.current;
    if (!r) return;
    const angle = (Math.atan2(e.clientY - r.centerY, e.clientX - r.centerX) * 180) / Math.PI;
    const delta = angle - r.startAngle;
    const newRot = Math.round(((r.startRotation + delta) % 360 + 360) % 360);
    setTemplateSlotsState((s) => s.map((slot) => (slot.id === r.id ? { ...slot, rotation: newRot } : slot)));
  };
  const endRotate = () => {
    rotatingRef.current = null;
    window.removeEventListener("pointermove", onRotateMove);
    window.removeEventListener("pointerup", endRotate);
  };

  // Copy slot helper
  function copySlotByIdWithId(slots, sourceId, newId) {
    const src = slots.find((s) => s.id === sourceId);
    if (!src) return slots.slice();
    // Slightly offset so the user can see the new copy
    const OFFSET = 0.02; // 2% of the canvas
    const newX = Math.min(src.x + OFFSET, Math.max(0, 1 - src.w));
    const newY = Math.min(src.y + OFFSET, Math.max(0, 1 - src.h));
    const copy = {
      ...src,
      id: newId,
      x: newX,
      y: newY,
      // Give it the next logical slotNumber at the end
      slotNumber: (slots.length || 0) + 1,
    };
    // Return a NEW array with the copy appended
    return [...slots, copy];
  }

  // REPLACE: generateTemplateThumbnail(slots, size=370)
  // WITH: layout-aware version
  const generateTemplateThumbnail = (slots, size = 370, layout = "4x6") => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      // bg
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, size, size);

      // aspect ratios per layout
      const LAYOUT_ASPECT = {
        "4x6": [2, 3], // portrait (4x6 printed portrait)
        "2x6": [1, 3], // portrait strip
        "6x4": [3, 2], // landscape postcard
        "6x2": [3, 1], // landscape strip
        "4x4": [1, 1], // square
      };
      const [ratioW, ratioH] = LAYOUT_ASPECT[layout] ?? LAYOUT_ASPECT["4x6"];

      // fit inside square canvas with ~80% coverage
      const maxH = size * 0.80;
      const maxW = size * 0.80;
      let targetW = maxW;
      let targetH = (targetW * ratioH) / ratioW;

      if (targetH > maxH) {
        targetH = maxH;
        targetW = (targetH * ratioW) / ratioH;
      }

      const x0 = (size - targetW) / 2;
      const y0 = (size - targetH) / 2;

      // frame border
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y0, targetW, targetH);

      // draw slots
      slots.forEach((s) => {
        const x = x0 + (s.x ?? 0) * targetW;
        const y = y0 + (s.y ?? 0) * targetH;
        const w = (s.w ?? 0.2) * targetW;
        const h = (s.h ?? 0.2) * targetH;
        ctx.save();
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(((s.rotation ?? 0) * Math.PI) / 180);
        ctx.translate(-cx, -cy);
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.strokeStyle = "#9ca3af";
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      });

      return canvas.toDataURL("image/jpeg", 0.85);
    } catch (err) {
      console.error("generateTemplateThumbnail error", err);
      return null;
    }
  };

  const handleThumbnailFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setThumbnailUploadPreview(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  // ⬇️ Replace your persistThumbnail with this
  const persistThumbnail = async (dataUrl, templateId) => {
    // If native API is not available, just return the data URL (in-memory).
    if (!native?.saveTemplateThumbnail) {
      return { savedPath: null, dataUrl, fileUrl: null };
    }
    try {
      const filename = `template-thumb-${templateId ?? Date.now()}.jpg`;
      const res = await native.saveTemplateThumbnail(dataUrl, filename, identity.userId);
      const savedPath = res?.savedPath ?? res?.filePath ?? null;
      const fileUrl = res?.fileUrl ?? null;
      return { savedPath, dataUrl, fileUrl };
    } catch (err) {
      console.error('saveTemplateThumbnail failed', err);
      return { savedPath: null, dataUrl, fileUrl: null };
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setTemplateError("Template name required");
      return;
    }
    if (!editingTemplate && Number.isFinite(templateLimit) && templateLimit > 0 && templates.length >= templateLimit) {
      setTemplateError(`Template limit reached for your current plan (${templateLimit}).`);
      return;
    }

    const slots = templateSlotsState.map((s) => ({
      id: s.id,
      slotNumber: s.slotNumber,
      x: Math.max(0, Math.min(1 - (s.w ?? 0.05), s.x ?? 0)),
      y: Math.max(0, Math.min(1 - (s.h ?? 0.05), s.y ?? 0)),
      w: Math.max(0.05, Math.min(1, s.w ?? 0.25)),
      h: Math.max(0.05, Math.min(1, s.h ?? 0.25)),
      rotation: s.rotation ?? 0,
    }));

    let localThumb = thumbnailUploadPreview;
    if (!localThumb) {
      localThumb = generateTemplateThumbnail(slots, 370, templateLayout);
      setThumbnailUploadPreview(localThumb);
    }

    let savedPath = null;
    if (localThumb) {
      const res = await persistThumbnail(localThumb, editingTemplate?.id ?? makeId());
      savedPath = res.savedPath ?? null;
    }

    const previewMeta = {
      layout: templateLayout,
      thumbnailPath: savedPath ?? null,
      thumbnailDataUrl: localThumb ?? null,
      slots: JSON.parse(JSON.stringify(slots)),
    };

    let nextTemplates = templates;
    let templateRef = null;

    if (editingTemplate) {
      templateRef = {
        id: editingTemplate.id,
        name: templateName.trim(),
        previewMeta,
      };

      nextTemplates = templates.map((t) =>
        t.id === editingTemplate.id
          ? { ...t, name: templateName.trim(), slots: slots.length, previewMeta }
          : t
      );

      showToast("Template updated");
    } else {
      const newTpl = {
        id: makeId(),
        name: templateName.trim(),
        slots: slots.length,
        previewMeta,
      };

      templateRef = {
        id: newTpl.id,
        name: newTpl.name,
        previewMeta: newTpl.previewMeta,
      };

      nextTemplates = [newTpl, ...templates];
      showToast("Template created");
    }

    let nextEvents = null;

    if (addTemplateToScreen && currentEvent && templateRef) {
      const ev = JSON.parse(JSON.stringify(currentEvent));
      ev.appliedTemplates = ev.appliedTemplates ?? [];

      if (!ev.appliedTemplates.find((x) => x.id === templateRef.id)) {
        ev.appliedTemplates.push(templateRef);
      }

      nextEvents = events.map((e) => (e.id === ev.id ? ev : e));
    }

    await persistAll({
      nextTemplates,
      nextEvents,
    });

    if (addTemplateToScreen && currentEvent) {
      showToast("Template applied to current event");
    }

    setIsTemplateModalOpen(false);
    setThumbnailUploadPreview(null);
    setSelectionIds([]);
    setAddTemplateToScreen(false);
  };

  // ---------------------------
  // Stripe-like layout & rendering
  // ---------------------------

  // UPDATED: Build a left sidebar + top bar shell to resemble the screenshot.
  // Live Preview & Template Editor blocks are untouched in behavior—only re-positioned.

  return (
    <div ref={dashboardRef}>
    <div className={`${BODY_BG} ${BODY_TEXT} h-screen overflow-hidden antialiased`} style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      {/* ===== Shell: Sidebar + Main ===== */}
      <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.06),_transparent_32%),linear-gradient(180deg,_#f8faff_0%,_#f1f5f9_100%)] dark:bg-none dark:bg-slate-950">
        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] xl:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* --- Left Sidebar --- */}
        <aside className={`fixed xl:relative h-screen w-[280px] flex-shrink-0 border-r border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-900/90 backdrop-blur-xl flex flex-col shadow-[10px_0_40px_rgba(15,23,42,0.06)] dark:shadow-[10px_0_40px_rgba(0,0,0,0.4)] z-40 transition-transform duration-300 ease-in-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full xl:translate-x-0"}`}>
          {/* Account summary */}
          <div className="relative border-b border-slate-200/80 dark:border-slate-700/80 px-4 py-4">
            {/* Close button — mobile only */}
            <button
              type="button"
              className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition xl:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => { setActiveMain("account"); setSidebarOpen(false); }}
              className="group w-full flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-100/70 active:scale-[0.99]"
            >
              <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-slate-200">
                {profileImage ? (
                  <img
                    src={profileImage}
                    alt="Profile"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center text-sm font-semibold text-white"
                    style={{
                      background: `linear-gradient(135deg, ${ACCENT_COLOR}, #7c3aed)`,
                    }}
                  >
                    {sidebarInitial}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100 group-hover:text-blue-600">
                  {sidebarDisplayName}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {sidebarEmail}
                </div>
              </div>

              <svg
                className="h-4 w-4 flex-shrink-0 text-slate-300 transition group-hover:text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>

          {/* Main nav — clicking any nav item also closes the mobile sidebar */}
          <div className="flex-1 overflow-y-auto px-4 py-4" onClick={() => setSidebarOpen(false)}>
            <div className="space-y-5">
              <div>
                <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  Main
                </div>
                <div className="space-y-1">
                  {[
                    {
                      id: "home",
                      label: "Home",
                      icon: (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                        />
                      ),
                    },
                    {
                      id: "events",
                      label: "Events",
                      icon: (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      ),
                    },
                    {
                      id: "dashboard",
                      label: "Dashboard",
                      icon: (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                        />
                      ),
                    },
                  ].map(({ id, label, icon }) => {
                    const active = activeMain === id;
                    return (
                      <button
                        key={id}
                        id={`nav-${id}`}
                        onClick={() => setActiveMain(id)}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${active
                          ? "bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                          : "text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                          }`}
                      >
                        <svg
                          className={`h-4 w-4 flex-shrink-0 ${active ? "text-blue-600" : "text-slate-400"
                            }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          {icon}
                        </svg>
                        <span>{label}</span>

                        {id === "events" && events.length > 0 && (
                          <span className="ml-auto rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                            {events.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  Configure
                </div>
                <button
                  id="nav-settings"
                  onClick={() => setActiveMain("settings")}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === "settings"
                    ? "bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === "settings" ? "text-blue-600" : "text-slate-400"
                      }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span>Settings</span>
                </button>

                {/* Billing is a destination in its own right, not a sub-tab of
                    Account Central. The "subscription" route already existed but
                    nothing navigated to it. */}
                <button
                  onClick={() => setActiveMain("subscription")}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === "subscription"
                    ? "bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === "subscription" ? "text-blue-600" : "text-slate-400"}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                    />
                  </svg>
                  <span>Billing &amp; Gallery</span>
                </button>

                <button
                  onClick={() => setActiveMain("booths")}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === "booths"
                    ? "bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === "booths" ? "text-blue-600" : "text-slate-400"
                      }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                    />
                  </svg>
                  <span>Remote Booth</span>
                </button>
              </div>

              <div>
                <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  Insights
                </div>
                <button
                  id="nav-reports"
                  onClick={() => setActiveMain("reports")}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === "reports"
                    ? "bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === "reports" ? "text-blue-600" : "text-slate-400"
                      }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M11 3v18M4 14l7-7 9 9"
                    />
                  </svg>
                  <span>Reports</span>
                </button>
              </div>

              {currentEvent && (
                <div className="mx-1">
                  <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Active event
                  </div>
                  <button
                    onClick={() => setActiveMain("dashboard")}
                    className="w-full rounded-lg border border-blue-100 bg-gradient-to-br from-blue-50 to-white px-3 py-3 text-left transition-all hover:border-blue-200 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-xs font-semibold text-blue-900">
                        {currentEvent.name || "Untitled"}
                      </div>
                      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
                    </div>
                    <div className="mt-1 text-[11px] text-blue-500">
                      Open event workspace
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom nav */}
          <div className="space-y-4 border-t border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/80 px-4 pb-5 pt-4">
            <div className="space-y-1">
              {[
                {
                  id: "helpcenter",
                  label: "Help Center",
                  icon: (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  ),
                },
              ].map(({ id, label, icon }) => (
                <button
                  key={id}
                  id={`nav-${id}`}
                  onClick={() => setActiveMain(id)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${activeMain === id
                    ? "bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                    }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${activeMain === id ? "text-blue-600" : "text-slate-400"
                      }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {icon}
                  </svg>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setRunTour(true)}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 transition-all hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 active:scale-[0.98]"
            >
              <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span>Take a tour</span>
            </button>

            <div className="border-t border-slate-200/80 dark:border-slate-700/80 pt-4">
              <button
                onClick={handleLogoutClick}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 transition-all hover:bg-red-50 hover:text-red-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  className="h-4 w-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </aside>

        {/* --- Main Content --- */}
        <div className="min-h-0 min-w-0 flex-1 bg-transparent">
          {/* Hamburger — tablet/mobile only, hidden once sidebar is open or on desktop */}
          {!sidebarOpen && (
            <button
              type="button"
              className="fixed top-3 left-3 z-50 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition xl:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}

          <main className="h-full min-h-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1600px] px-4 pt-14 pb-4 xl:pt-6 xl:pb-6 xl:px-8 2xl:px-10">

              {activeMain === "home" && renderHomeDashboard()}

              {activeMain === "dashboard" && !currentEvent && (
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} min-h-[360px] flex items-center justify-center p-10 text-center`}>
                  <div className="max-w-md">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                      <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21H5a2 2 0 01-2-2V7a2 2 0 012-2h4l2-2h8a2 2 0 012 2v14a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900">No event selected</h3>
                    <p className="mt-2 text-sm text-gray-500">Go to Events to open or create one.</p>
                    <button
                      type="button"
                      onClick={() => setActiveMain("events")}
                      className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                    >
                      Go to Events
                    </button>
                  </div>
                </div>
              )}

              {activeMain === "dashboard" && currentEvent && (
                <div className="mb-4">
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-1.5 mb-3 px-0.5">
                    <button
                      type="button"
                      onClick={() => { setCurrentEvent(null); setActiveMain("events"); }}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Events
                    </button>
                    <svg className="h-3 w-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-medium text-gray-600 truncate max-w-[260px]">
                      {currentEvent?.name || "Untitled event"}
                    </span>
                  </div>

                  {/* Event header card */}
                  <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} px-6 py-5`}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      {/* Left: identity */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h2 className="text-xl font-bold text-gray-900 tracking-tight truncate max-w-[360px]">
                            {currentEvent?.name || "Untitled event"}
                          </h2>
                          <span className="flex-shrink-0 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-600 uppercase tracking-wide">
                            {currentEvent?.settings?.appMode ?? appMode ?? DEFAULT_APP_MODE}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                          <span>{Array.isArray(currentEvent?.appliedTemplates) ? currentEvent.appliedTemplates.length : 0} template{(Array.isArray(currentEvent?.appliedTemplates) ? currentEvent.appliedTemplates.length : 0) !== 1 ? "s" : ""}</span>
                          <span className="text-gray-200">·</span>
                          <span>{Array.isArray(currentEvent?.appliedFrames) ? currentEvent.appliedFrames.length : 0} frame{(Array.isArray(currentEvent?.appliedFrames) ? currentEvent.appliedFrames.length : 0) !== 1 ? "s" : ""}</span>
                          <span className="text-gray-200">·</span>
                          <span>{currentEvent?.settings?.numberOfShots ?? numberOfShots ?? "—"} shots per session</span>
                        </div>
                      </div>

                      {/* Right: actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={autosaveEnabled}
                            onChange={(e) => setAutosaveEnabled(e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-blue-600"
                          />
                          Autosave
                        </label>
                        <div className="w-px h-5 bg-slate-200 mx-0.5" />
                        <button
                          type="button"
                          onClick={saveCurrentEvent}
                          className={BTN_GHOST}
                        >
                          Save
                        </button>
                        <button
                          id="btn-start-booth"
                          type="button"
                          onClick={async () => {
                            try {
                              const evCopy = JSON.parse(JSON.stringify(currentEvent));

                              const hasTemplates = Array.isArray(evCopy.appliedTemplates) && evCopy.appliedTemplates.length > 0;
                              if (!hasTemplates) {
                                showToast?.("This event has no templates. Create and apply at least one template before starting the booth.");
                                setActiveSub("templates");
                                return;
                              }

                              const mergedEvent = {
                                ...evCopy,
                                settings: { ...(evCopy.settings || {}), ...settingsToSave },
                              };
                              const updatedEvents = events.map((item) =>
                                item.id === mergedEvent.id ? mergedEvent : item
                              );
                              setCurrentEvent(mergedEvent);
                              setEvents(updatedEvents);
                              await native?.setEvents?.(updatedEvents, ctx);
                              await native?.setCurrentEventId?.(mergedEvent.id);
                              if (typeof onStartPhotobooth === "function") {
                                onStartPhotobooth(mergedEvent);
                              }
                            } catch (e) {
                              console.error("Start Photo booth failed:", e);
                            }
                          }}
                          className={BTN_PRIMARY}
                        >
                          <svg className="mr-1.5 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          Start Booth
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* DASHBOARD SUB-TABS */}
              {activeMain === "dashboard" && currentEvent && (
                <div className="mb-5 overflow-x-auto">
                  <div className="flex border-b border-slate-200 min-w-max">
                    {/* Three groups, not eight equal peers: the design surfaces,
                        then how the session behaves, then what it produced. The
                        gap flag marks where each group ends. */}
                    {[
                      ["branding", "Appearance"],
                      ["templates", "Templates"],
                      ["frames", "Frames"],
                      ["tones", "Tones"],
                      ["background color", "Colors", { gap: true }],
                      ["controls", "Session", { gap: true }],
                      ["analytics", "Analytics"],
                      ["sharing", "Preview"],
                    ].map(([tab, label, opts]) => (
                      // The divider is its own element rather than padding on the
                      // button — putting it on the button made Colors and Session
                      // wider than every other tab.
                      <React.Fragment key={tab}>
                        <button
                          id={`tab-${tab.replace(/\s+/g, "-")}`}
                          type="button"
                          onClick={() => setActiveSub(tab)}
                          className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                            activeSub === tab
                              ? "text-blue-600 border-blue-600"
                              : "text-gray-500 border-transparent hover:text-gray-900 hover:border-gray-300"
                          }`}
                        >
                          {label}
                        </button>
                        {opts?.gap && (
                          <span aria-hidden="true" className="self-center mx-1.5 h-4 w-px flex-shrink-0 bg-slate-200 dark:bg-slate-700" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              {/* ===== CONTENT AREA ===== */}

              {/* Account & Billing */}
              {activeMain === "account" && renderAccountBilling()}

              {activeMain === "subscription" && renderAccountBilling({ billingOnly: true })}

              {activeMain === "booths" && (
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-xl border border-white/20 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 px-6 py-6 text-white shadow-[0_24px_64px_rgba(37,99,235,0.25)]">
                    <WavePattern />
                    <div className="relative z-10">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">Remote</div>
                      <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>Remote Booths</h2>
                      <p className="mt-1.5 text-sm text-white/80">Monitor and control connected booth devices.</p>
                    </div>
                  </div>

                  {boothsLoading ? (
                    <div className="text-sm text-slate-500 px-1">Loading booths...</div>
                  ) : booths.length === 0 ? (
                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-8 text-center`}>
                      <div className="text-sm text-slate-400">No booths registered yet.</div>
                      <div className="mt-1 text-xs text-slate-400">Start your booth app to register it automatically.</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {booths.map(booth => (
                        <div key={booth.id} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-slate-900">{booth.name}</div>
                              <div className="text-xs text-slate-500 mt-0.5">{booth.platform} · v{booth.app_version}</div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${booth.is_online ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                              <span className={`text-xs font-medium ${booth.is_online ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {booth.is_online ? 'Online' : 'Offline'}
                              </span>
                            </div>
                          </div>

                          <div className="text-xs text-slate-400 mt-2">
                            Last seen: {booth.last_seen_at
                              ? new Date(booth.last_seen_at).toLocaleString()
                              : 'Never'}
                          </div>

                          {booth.is_online ? (
                            <div className="flex flex-wrap gap-2 mt-4">
                              <button
                                onClick={() => sendCommandToBooth(booth.id, 'ping')}
                                className={BTN_GHOST}
                                title="Check if the booth is alive and receiving commands"
                              >
                                Ping
                              </button>
                              <button
                                onClick={() => sendCommandToBooth(booth.id, 'restart-booth')}
                                className={BTN_GHOST}
                                title="Restart the booth app on that computer"
                              >
                                Restart
                              </button>
                              <button
                                onClick={() => sendCommandToBooth(booth.id, 'update-event', { event: currentEvent })}
                                disabled={!currentEvent}
                                className={BTN_SECONDARY}
                                title="Push the event you currently have open to this booth"
                              >
                                Push current event
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`Stop "${booth.name}"? This will close the booth app on that computer.`)) {
                                    sendCommandToBooth(booth.id, 'stop-booth');
                                  }
                                }}
                                className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-100 active:scale-[0.97]"
                                title="Close the booth app on that computer"
                              >
                                Stop booth
                              </button>
                            </div>
                          ) : (
                            <div className="mt-4">
                              <button
                                onClick={() => {
                                  if (window.confirm(`Remove "${booth.name}" from your booth list?`)) {
                                    deleteBooth(booth.id);
                                  }
                                }}
                                className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                              >
                                Remove offline booth
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeMain === "reports" && (
                <div className="space-y-5">

                  {/* ===== Header — gradient banner ===== */}
                  <div className="relative overflow-hidden rounded-xl border border-white/20 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 px-6 py-6 text-white shadow-[0_24px_64px_rgba(37,99,235,0.25)]">
                    <WavePattern />
                    <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">Analytics</div>
                        <h2 className="mt-3 text-2xl font-bold tracking-tight" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>Reports</h2>
                        <p className="mt-1.5 text-sm text-white/80">Session activity, revenue, and performance metrics.</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={reportEventId}
                          onChange={(e) => setReportEventId(e.target.value)}
                          className="rounded-lg border border-white/25 bg-white/15 px-4 py-2 text-sm text-white font-medium outline-none hover:bg-white/25 transition"
                        >
                          <option value="all" className="text-slate-900">All events</option>
                          {events.map(ev => (
                            <option key={ev.id} value={ev.id} className="text-slate-900">{ev.name}</option>
                          ))}
                        </select>
                        <button onClick={exportReportCSV} className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-2 text-sm font-semibold text-blue-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]">
                          Export CSV
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ===== Time-scoped KPI grid ===== */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: "Today", sessions: reportSessionsToday, revenue: reportRevenueToday },
                      { label: "This Week", sessions: reportSessionsThisWeek, revenue: reportRevenueThisWeek },
                      { label: "This Month", sessions: reportSessionsThisMonth, revenue: reportRevenueThisMonth },
                      { label: "All Time", sessions: reportSessions.length, revenue: reportGross },
                    ].map(({ label, sessions, revenue }) => (
                      <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                        <div className={EYEBROW}>{label}</div>
                        <div className="mt-2 text-xl font-bold tabular-nums text-slate-900">{sessions}</div>
                        <div className="text-xs text-slate-400">sessions</div>
                        <div className="mt-1 text-lg font-semibold tabular-nums text-blue-600">{fmtAmt(revenue, reportCurrency)}</div>
                        <div className="text-xs text-slate-400">revenue</div>
                      </div>
                    ))}
                  </div>

                  {/* ===== Summary stat pills ===== */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: "Total Photos", value: reportPhotos.toLocaleString(), color: "text-slate-900" },
                      { label: "Completion Rate", value: `${reportConversionRate}%`, color: reportConversionRate >= 80 ? "text-emerald-600" : reportConversionRate >= 50 ? "text-amber-600" : "text-red-500" },
                      { label: "Avg Sessions / Event", value: reportAvgSessionsPerEvent, color: "text-slate-900" },
                      { label: "Avg Photos / Session", value: reportAvgPhotosPerSession, color: "text-slate-900" },
                      { label: "Peak Hour", value: `${peakHour}:00`, color: "text-blue-600" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                        <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
                        <div className={`mt-1.5 text-xl font-bold tabular-nums ${color}`}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* ===== Extended analytics: mode, quality, revenue detail ===== */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Rental Sessions", value: reportRentalSessions, color: "text-amber-600", sub: "no revenue" },
                      { label: "Business Sessions", value: reportBusinessSessions, color: "text-blue-600", sub: "with payment" },
                      { label: "Offline Sessions", value: reportOfflineCount, color: "text-slate-700", sub: "saved locally" },
                      { label: "Avg Duration", value: reportAvgDurationMin != null ? `${reportAvgDurationMin} min` : "—", color: "text-slate-900", sub: "per session" },
                    ].map(({ label, value, color, sub }) => (
                      <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                        <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
                        <div className={`mt-1.5 text-xl font-bold tabular-nums ${color}`}>{value}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Revenue detail row (non-zero values only) */}
                  {(reportTotalAdditionalPrints > 0 || reportTotalTaxCollected > 0 || reportTotalAdditionalFee > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { label: "Additional Prints Sold", value: reportTotalAdditionalPrints.toString(), sub: "extra prints" },
                        { label: "Add-On Revenue", value: fmtAmt(reportTotalAdditionalFee, reportCurrency), sub: "from extra prints" },
                        { label: "Tax Collected", value: fmtAmt(reportTotalTaxCollected, reportCurrency), sub: "total tax" },
                      ].map(({ label, value, sub }) => (
                        <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
                          <div className="mt-1.5 text-xl font-bold tabular-nums text-blue-600">{value}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tone usage + Provider breakdown */}
                  {(Object.keys(reportToneUsage).length > 0 || Object.keys(reportProviderBreakdown).length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.keys(reportToneUsage).length > 0 && (
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-slate-800 mb-3">Tone / Filter Usage</div>
                          <div className="space-y-2">
                            {Object.entries(reportToneUsage).sort((a,b) => b[1]-a[1]).slice(0,6).map(([tone, count]) => {
                              const maxVal = Math.max(...Object.values(reportToneUsage));
                              return (
                                <div key={tone}>
                                  <div className="flex items-center justify-between text-xs mb-0.5">
                                    <span className="text-slate-700 capitalize font-medium">{tone}</span>
                                    <span className="text-slate-500 tabular-nums">{count}×</span>
                                  </div>
                                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(count/maxVal)*100}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {Object.keys(reportProviderBreakdown).length > 0 && (
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-slate-800 mb-3">Payment Provider Breakdown</div>
                          <div className="space-y-2">
                            {Object.entries(reportProviderBreakdown).sort((a,b) => b[1]-a[1]).map(([prov, count]) => {
                              const maxVal = Math.max(...Object.values(reportProviderBreakdown));
                              return (
                                <div key={prov}>
                                  <div className="flex items-center justify-between text-xs mb-0.5">
                                    <span className="text-slate-700 capitalize font-medium">{prov}</span>
                                    <span className="text-slate-500 tabular-nums">{count} sessions</span>
                                  </div>
                                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(count/maxVal)*100}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ===== 30-Day Trend — Sessions & Revenue LineChart ===== */}
                  <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">30-Day Trend</div>
                        <div className="text-xs text-slate-400 mt-0.5">Daily sessions and revenue</div>
                      </div>
                    </div>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={reportDailyTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} interval={4} />
                          <YAxis yAxisId="sessions" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                          <YAxis yAxisId="revenue" orientation="right" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtAmt(v, reportCurrency)} />
                          <Tooltip
                            contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", fontSize: 13 }}
                            formatter={(value, name) => [name === "revenue" ? fmtAmt(value, reportCurrency) : value, name === "revenue" ? "Revenue" : "Sessions"]}
                          />
                          <Legend verticalAlign="top" height={30} iconType="circle" wrapperStyle={{ fontSize: 12, color: "#64748b" }} />
                          <Line yAxisId="sessions" type="monotone" dataKey="sessions" stroke="#2563eb" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: "#2563eb" }} name="Sessions" />
                          <Line yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 3" activeDot={{ r: 4, fill: "#10b981" }} name="Revenue" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* ===== Two-column: Sessions per Hour + Day of Week ===== */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                    {/* Sessions per hour BarChart */}
                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                      <div className="text-sm font-semibold text-slate-800 mb-1">Sessions by Hour</div>
                      <div className="text-xs text-slate-400 mb-4">Distribution across 24 hours</div>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={reportSessionsPerHour.map((v, i) => ({ hour: `${i}`, sessions: v }))} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} interval={2} />
                            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} formatter={(v) => [v, "Sessions"]} labelFormatter={(h) => `${h}:00`} />
                            <Bar dataKey="sessions" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={20} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Day-of-week BarChart */}
                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                      <div className="text-sm font-semibold text-slate-800 mb-1">Sessions by Day of Week</div>
                      <div className="text-xs text-slate-400 mb-4">Which days are busiest</div>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={reportDayOfWeekData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} formatter={(v) => [v, "Sessions"]} />
                            <Bar dataKey="sessions" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={36} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* ===== 12-Week Trend BarChart ===== */}
                  <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Weekly Trend</div>
                        <div className="text-xs text-slate-400 mt-0.5">Sessions per week — last 12 weeks</div>
                      </div>
                    </div>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={reportWeeklyTrend} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} formatter={(v) => [v, "Sessions"]} />
                          <Bar dataKey="sessions" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={28} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* ===== Template Usage ===== */}
                  {reportTemplateUsage.length > 0 && (
                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                      <div className="text-sm font-semibold text-slate-800 mb-1">Top Templates</div>
                      <div className="text-xs text-slate-400 mb-4">Most-used templates across selected events</div>
                      <div className="space-y-2.5">
                        {reportTemplateUsage.map(([name, count], i) => (
                          <div key={name} className="flex items-center gap-3">
                            <div className="w-5 text-xs text-slate-400 text-right font-medium">{i + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-slate-700 font-medium truncate">{name}</span>
                                <span className="text-xs text-slate-500 font-medium tabular-nums ml-2">{count} uses</span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${(count / reportMaxTplUsage) * 100}%`,
                                    background: `linear-gradient(90deg, #2563eb, #3b82f6)`,
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ===== Event Breakdown Table ===== */}
                  {reportEventBreakdown.length > 0 && (
                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} overflow-hidden`}>
                      <div className="px-5 py-4 border-b border-slate-100">
                        <div className="text-sm font-semibold text-slate-800">Event Breakdown</div>
                        <div className="text-xs text-slate-400 mt-0.5">Per-event performance metrics</div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-50/80">
                              <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Event</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Mode</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sessions</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Completed</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Photos</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Revenue</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tax</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Extra Prints</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Rate</th>
                              <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Avg Photos</th>
                              <th className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Avg Duration</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {reportEventBreakdown.map((ev) => (
                              <tr key={ev.id} className="hover:bg-slate-50/60 transition-colors">
                                <td className="px-5 py-3">
                                  <div className="font-medium text-slate-800 truncate max-w-[160px]">{ev.name}</div>
                                  <div className="text-[11px] text-slate-400 mt-0.5">{ev.date}</div>
                                </td>
                                <td className="text-right px-4 py-3">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${ev.mode === "rental" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                                    {ev.mode}
                                  </span>
                                </td>
                                <td className="text-right px-4 py-3 font-medium tabular-nums text-slate-700">{ev.sessions}</td>
                                <td className="text-right px-4 py-3 tabular-nums text-slate-600">{ev.completed}</td>
                                <td className="text-right px-4 py-3 tabular-nums text-slate-600">{ev.photos.toLocaleString()}</td>
                                <td className="text-right px-4 py-3 font-medium tabular-nums text-blue-600">{ev.mode === "rental" ? <span className="text-slate-400">—</span> : fmtAmt(ev.revenue, ev.currency)}</td>
                                <td className="text-right px-4 py-3 tabular-nums text-slate-500">{ev.mode === "rental" ? <span className="text-slate-300">—</span> : ev.taxCollected > 0 ? fmtAmt(ev.taxCollected, ev.currency) : <span className="text-slate-300">—</span>}</td>
                                <td className="text-right px-4 py-3 tabular-nums text-slate-500">{ev.mode === "rental" ? <span className="text-slate-300">—</span> : ev.additionalPrints > 0 ? ev.additionalPrints : <span className="text-slate-300">—</span>}</td>
                                <td className="text-right px-4 py-3">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${ev.rate >= 80 ? "bg-emerald-50 text-emerald-700" :
                                      ev.rate >= 50 ? "bg-amber-50 text-amber-700" :
                                        "bg-red-50 text-red-600"
                                    }`}>
                                    {ev.rate}%
                                  </span>
                                </td>
                                <td className="text-right px-4 py-3 tabular-nums text-slate-600">{ev.avgPhotos}</td>
                                <td className="text-right px-5 py-3 tabular-nums text-slate-500">{ev.avgDurationMin}</td>
                              </tr>
                            ))}
                          </tbody>
                          {reportEventBreakdown.length > 1 && (
                            <tfoot>
                              <tr className="bg-slate-50/80 border-t border-slate-200">
                                <td className="px-5 py-3 font-semibold text-slate-700">Total</td>
                                <td className="px-4 py-3" />
                                <td className="text-right px-4 py-3 font-semibold tabular-nums text-slate-800">{reportSessions.length}</td>
                                <td className="text-right px-4 py-3 font-semibold tabular-nums text-slate-700">{reportTotalCompleted}</td>
                                <td className="text-right px-4 py-3 font-semibold tabular-nums text-slate-700">{reportPhotos.toLocaleString()}</td>
                                <td className="text-right px-4 py-3 font-semibold tabular-nums text-blue-600">{fmtAmt(reportGross, reportCurrency)}</td>
                                <td className="text-right px-4 py-3 font-semibold tabular-nums text-slate-600">{reportTotalTaxCollected > 0 ? fmtAmt(reportTotalTaxCollected, reportCurrency) : "—"}</td>
                                <td className="text-right px-4 py-3 font-semibold tabular-nums text-slate-600">{reportTotalAdditionalPrints > 0 ? reportTotalAdditionalPrints : "—"}</td>
                                <td className="text-right px-4 py-3">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${reportConversionRate >= 80 ? "bg-emerald-50 text-emerald-700" :
                                      reportConversionRate >= 50 ? "bg-amber-50 text-amber-700" :
                                        "bg-red-50 text-red-600"
                                    }`}>
                                    {reportConversionRate}%
                                  </span>
                                </td>
                                <td className="text-right px-4 py-3 font-semibold tabular-nums text-slate-700">{reportAvgPhotosPerSession}</td>
                                <td className="text-right px-5 py-3 font-semibold tabular-nums text-slate-600">{reportAvgDurationMin != null ? `${reportAvgDurationMin} min` : "—"}</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  )}

                </div>
              )}

              {activeMain === "settings" && (
                <div className="space-y-5">
                  {/* ================= Header ================= */}
                  {/* Same blue hero as the other top-level sections. The actions
                      stay in the header so Save is reachable from any tab. */}
                  <PageHero
                    eyebrow="Configuration"
                    title="Booth Settings"
                    description="Camera, printing, storage and system setup for this booth."
                    wave={<WavePattern />}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={resetSettingsToDefault}
                        className="rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                      >
                        Reset defaults
                      </button>
                      <button
                        type="button"
                        onClick={saveSettings}
                        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
                      >
                        Save settings
                      </button>
                    </div>
                  </PageHero>

                  {/* ================= Quick status ================= */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                      <div className={EYEBROW}>
                        Camera
                      </div>
                      <div className={`mt-2 text-lg font-semibold ${cameraOnline ? "text-emerald-600" : "text-amber-600"}`}>
                        {cameraOnline ? "Ready" : "Needs attention"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {cameraStatusText || "Camera status unknown"}
                      </div>
                    </div>

                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                      <div className={EYEBROW}>
                        Printer
                      </div>
                      <div className={`mt-2 text-lg font-semibold ${printerOnline ? "text-emerald-600" : "text-amber-600"}`}>
                        {printerOnline ? "Ready" : "Needs attention"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {printerStatusText || "Printer status unknown"}
                      </div>
                    </div>

                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                      <div className={EYEBROW}>
                        Storage
                      </div>
                      <div className="mt-2 text-lg font-semibold text-gray-900">
                        {getEffectiveStoragePath() ? "Configured" : "Missing"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {storageStatusText || "No storage folder selected"}
                      </div>
                    </div>

                    <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                      <div className={EYEBROW}>
                        Updates
                      </div>
                      <div className="mt-2 text-lg font-semibold text-gray-900">
                        {updateState === "downloading"
                          ? `${updatePercent}%`
                          : updateState === "ready"
                            ? "Ready"
                            : updateState === "checking"
                              ? "Checking"
                              : "Idle"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {updateStatusText || "No update check yet"}
                      </div>
                    </div>
                  </div>

                  {/* ================= Settings Tabs ================= */}
                  <div className="overflow-x-auto">
                    <div className="flex border-b border-slate-200 min-w-max">
                      {[
                        { id: "camera", label: "Camera" },
                        { id: "printing", label: "Printing" },
                        { id: "storage", label: "Storage" },
                        { id: "general", label: "General" },
                        { id: "logs", label: "Audit & Logs" },
                        { id: "system", label: "System" },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveSettingsTab(tab.id)}
                          className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                            activeSettingsTab === tab.id
                              ? "text-blue-600 border-blue-600"
                              : "text-gray-500 border-transparent hover:text-gray-900 hover:border-gray-300"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ================= Active tab content ================= */}
                  <div className="space-y-4">
                    {activeSettingsTab === "camera" && (
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
                                <span>Camera setup</span>
                                <span className={`inline-block h-2.5 w-2.5 rounded-full ${cameraOnline ? "bg-green-500" : "bg-red-500"}`} />
                              </div>
                              <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                Select the active camera and configure capture behavior.
                              </div>
                            </div>

                            <button
                              onClick={refreshCameras}
                              disabled={cameraLoading}
                              className={`${BTN_GHOST} text-sm px-4 py-2`}
                            >
                              {cameraLoading ? (<>
                                <svg className="mr-2 inline h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
                                Refreshing...
                              </>) : "Refresh cameras"}
                            </button>
                          </div>

                          {cameraError && (
                            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                              {cameraError}
                            </div>
                          )}

                          <div className="mt-2">
                            {/* Device list is dynamic and names are long — stays a select. */}
                            <SettingRow
                              label="Camera device"
                              description="Which connected camera the booth captures from."
                              htmlFor="set-camera-device"
                            >
                              <SettingSelect
                                id="set-camera-device"
                                value={asSelectValue(selectedCameraId)}
                                onChange={setSelectedCameraId}
                              >
                                {!cameraList.length && <option value="">{native ? "No cameras found" : "Open desktop app to access cameras"}</option>}
                                {cameraList.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.label || c.id}
                                  </option>
                                ))}
                              </SettingSelect>
                            </SettingRow>

                            <SettingRow
                              label="Resolution"
                              description="Higher resolutions look better but capture more slowly."
                              htmlFor="set-camera-resolution"
                            >
                              {CAMERA_RESOLUTION_OPTIONS.length <= 4 ? (
                                <SettingSegmented
                                  label="Resolution"
                                  value={cameraResolution}
                                  onChange={setCameraResolution}
                                  options={CAMERA_RESOLUTION_OPTIONS}
                                />
                              ) : (
                                <SettingSelect
                                  id="set-camera-resolution"
                                  value={cameraResolution}
                                  onChange={setCameraResolution}
                                >
                                  {CAMERA_RESOLUTION_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </SettingSelect>
                              )}
                            </SettingRow>

                            <SettingRow
                              label="Facing mode"
                              description="Only used when no camera device is selected above."
                              htmlFor="set-camera-facing"
                            >
                              {CAMERA_FACING_OPTIONS.length <= 4 ? (
                                <SettingSegmented
                                  label="Facing mode"
                                  value={facingMode}
                                  onChange={setFacingMode}
                                  options={CAMERA_FACING_OPTIONS}
                                />
                              ) : (
                                <SettingSelect
                                  id="set-camera-facing"
                                  value={facingMode}
                                  onChange={setFacingMode}
                                >
                                  {CAMERA_FACING_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </SettingSelect>
                              )}
                            </SettingRow>

                            <SettingRow
                              label="Output size"
                              description="Derived from the resolution above."
                            >
                              <SettingReadout>{cameraWidth} × {cameraHeight}</SettingReadout>
                            </SettingRow>

                            <SettingRow
                              label="Mirror camera preview"
                              description="Shows guests a mirrored image, which feels more natural."
                            >
                              <SettingToggle
                                label="Mirror camera preview"
                                checked={mirrorCamera}
                                onChange={setMirrorCamera}
                              />
                            </SettingRow>

                            <SettingRow
                              label="Enable flash"
                              description="Brightens the screen at the moment of capture."
                            >
                              <SettingToggle
                                label="Enable flash"
                                checked={flashEnabled}
                                onChange={setFlashEnabled}
                              />
                            </SettingRow>

                            <SettingRow
                              label="Play sound before capture"
                              description="Audible countdown cue so guests know when to pose."
                            >
                              <SettingToggle
                                label="Play sound before capture"
                                checked={soundEnabled}
                                onChange={setSoundEnabled}
                              />
                            </SettingRow>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
                            <span>Camera status</span>
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${cameraOnline ? "bg-green-500" : "bg-red-500"}`} />
                          </div>
                          <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            Current active device and capture preferences.
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-500 dark:text-slate-400">Connection</span>
                              <span className={cameraOnline ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                                {cameraOnline ? "Ready" : "Unavailable"}
                              </span>
                            </div>

                            <div className="text-xs text-gray-500 dark:text-slate-400">
                              {cameraStatusText}
                            </div>

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600 dark:text-slate-400">
                              <div className="flex justify-between gap-3">
                                <span>Selected camera</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right truncate">
                                  {cameraList.find((c) => c.id === selectedCameraId)?.label || selectedCameraId || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Resolution preset</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right">
                                  {cameraResolution || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Facing mode</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right capitalize">
                                  {facingMode || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Output size</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right">
                                  {cameraWidth} × {cameraHeight}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Mirror</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right">
                                  {mirrorCamera ? "Enabled" : "Disabled"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Detected cameras</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right">
                                  {cameraList.length}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "printing" && (
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
                                <span>Printer setup</span>
                                <span className={`inline-block h-2.5 w-2.5 rounded-full ${printerOnline ? "bg-green-500" : "bg-red-500"}`} />
                              </div>
                              <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                Configure the printer, paper size, output quality, and print behavior.
                              </div>
                            </div>

                            <button
                              onClick={refreshPrinters}
                              disabled={printerLoading}
                              className={`${BTN_GHOST} text-sm px-4 py-2`}
                            >
                              {printerLoading ? (<>
                                <svg className="mr-2 inline h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
                                Refreshing...
                              </>) : "Refresh printers"}
                            </button>
                          </div>

                          {printerError && (
                            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                              {printerError}
                            </div>
                          )}

                          {isIpadApp && (
                            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                              Printing on iPad uses AirPrint. Your printer must be on the same Wi-Fi network. The iOS printer picker appears automatically when a session finishes.
                            </div>
                          )}

                          <div className="mt-2">
                            {/* Printer list is dynamic — stays a select. */}
                            <SettingRow label="Printer" description="Which installed printer receives booth prints." htmlFor="set-printer">
                              <SettingSelect id="set-printer" value={selectedPrinter} onChange={setSelectedPrinter}>
                                {!printers.length && <option value="">{native ? "No printers found" : "Open desktop app to manage printers"}</option>}
                                {printers.map((p) => (
                                  <option key={p.name} value={p.name}>{p.displayName || p.name}</option>
                                ))}
                              </SettingSelect>
                            </SettingRow>

                            <SettingRow label="Use printer system defaults" description="Let the printer driver decide. Turning this on disables the options below.">
                              <SettingToggle label="Use printer system defaults" checked={usePrinterDefaults} onChange={setUsePrinterDefaults} />
                            </SettingRow>

                            <SettingRow label="Paper size" description={usePrinterDefaults ? (printerSystemLayout || "Using the printer's system default.") : "Media size prints are laid out for."} htmlFor="set-paper" disabled={usePrinterDefaults}>
                              <SettingSelect id="set-paper" value={usePrinterDefaults ? "" : paperSize} disabled={usePrinterDefaults} onChange={setPaperSize}>
                                {usePrinterDefaults ? (
                                  <option value="">{printerSystemLayout || "System default"}</option>
                                ) : (
                                  paperSizeOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}{opt.source === "app" ? " (Custom)" : ""}</option>
                                  ))
                                )}
                              </SettingSelect>
                            </SettingRow>

                            <SettingRow label="Orientation" description="Portrait suits strips; landscape suits wide prints." htmlFor="set-orientation" disabled={usePrinterDefaults}>
                              {PRINT_ORIENTATION_OPTIONS.length <= 4 ? (
                                <SettingSegmented label="Orientation" value={printOrientation} onChange={setPrintOrientation} options={PRINT_ORIENTATION_OPTIONS} disabled={usePrinterDefaults} />
                              ) : (
                                <SettingSelect id="set-orientation" value={printOrientation} disabled={usePrinterDefaults} onChange={setPrintOrientation}>
                                  {PRINT_ORIENTATION_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                </SettingSelect>
                              )}
                            </SettingRow>

                            <SettingRow label="Copies" description="Prints produced per session." htmlFor="set-copies" disabled={usePrinterDefaults}>
                              <SettingNumber id="set-copies" min={1} max={20} value={printCopies} disabled={usePrinterDefaults} onChange={(v) => setPrintCopies(clamp(v, 1, 20, 1))} />
                            </SettingRow>

                            <SettingRow label="Color mode" description="Grayscale saves ribbon on monochrome layouts." htmlFor="set-color" disabled={usePrinterDefaults}>
                              {PRINT_COLOR_OPTIONS.length <= 4 ? (
                                <SettingSegmented label="Color mode" value={printColorMode} onChange={setPrintColorMode} options={PRINT_COLOR_OPTIONS} disabled={usePrinterDefaults} />
                              ) : (
                                <SettingSelect id="set-color" value={printColorMode} disabled={usePrinterDefaults} onChange={setPrintColorMode}>
                                  {PRINT_COLOR_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                </SettingSelect>
                              )}
                            </SettingRow>

                            <SettingRow label="Print quality" description="Higher quality prints more slowly." htmlFor="set-quality" disabled={usePrinterDefaults}>
                              {PRINT_QUALITY_OPTIONS.length <= 4 ? (
                                <SettingSegmented label="Print quality" value={printQuality} onChange={setPrintQuality} options={PRINT_QUALITY_OPTIONS} disabled={usePrinterDefaults} />
                              ) : (
                                <SettingSelect id="set-quality" value={printQuality} disabled={usePrinterDefaults} onChange={setPrintQuality}>
                                  {PRINT_QUALITY_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                </SettingSelect>
                              )}
                            </SettingRow>

                            <SettingRow label="Print DPI" description="Dots per inch sent to the printer. 300 suits most dye-sub media." htmlFor="set-dpi" disabled={usePrinterDefaults}>
                              <SettingNumber id="set-dpi" min={72} max={1200} value={printDpi} disabled={usePrinterDefaults} onChange={(v) => setPrintDpi(clamp(v, 72, 1200, 300))} suffix="dpi" />
                            </SettingRow>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                              onClick={checkPrinterHealth}
                              disabled={!selectedPrinter || printerLoading}
                              className={`${BTN_GHOST} text-sm px-4 py-2`}
                            >
                              Check status
                            </button>
                            <button
                              onClick={testPrint}
                              disabled={!selectedPrinter}
                              className={`${BTN_PRIMARY} text-sm px-4 py-2`}
                            >
                              Test print
                            </button>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
                            <span>Printer status</span>
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${printerOnline ? "bg-green-500" : "bg-red-500"}`} />
                          </div>
                          <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            Quick health summary for the selected printer.
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-500 dark:text-slate-400">Connection</span>
                              <span className={printerOnline ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                                {printerOnline ? "Online" : "Offline"}
                              </span>
                            </div>

                            <div className="text-xs text-gray-500 dark:text-slate-400">
                              {printerStatusText}
                            </div>

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600 dark:text-slate-400">
                              <div className="flex justify-between gap-3">
                                <span>Selected printer</span>
                                <span className="text-gray-900 dark:text-slate-100 truncate text-right">
                                  {selectedPrinter || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Driver orientation</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right">
                                  {printerCapabilities?.orientation || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Current layout</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right">
                                  {paperSize || "—"}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Color</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right capitalize">
                                  {printColorMode}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Quality</span>
                                <span className="text-gray-900 dark:text-slate-100 text-right capitalize">
                                  {printQuality}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Auto-Cut Detection — DNP + HiTi */}
                        <div className={`xl:col-span-3 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900 dark:text-slate-100">Auto-Cut Detection</span>
                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">DNP · HiTi</span>
                              </div>
                              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                                Scans your Windows print queue for DNP and HiTi photo printers and reads their current cut-mode settings.
                                For 2×6 strip output, auto-cut must be enabled in the printer driver.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleCutScan}
                              disabled={cutScanning}
                              className={`${BTN_PRIMARY} flex-shrink-0 text-xs px-4 py-2`}
                            >
                              {cutScanning ? "Scanning…" : "Scan Printers"}
                            </button>
                          </div>

                          {cutScanError && (
                            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                              {cutScanError}
                            </div>
                          )}

                          {cutScanned && !cutScanError && cutPrinters.length === 0 && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 space-y-2">
                              <p className="font-semibold">No supported printer detected.</p>
                              <p>Checks for DNP and HiTi by name and model (DS620, DS820, DS-RX1, DS40, DS80, DP-S, P520L, P720L, etc.).</p>
                              {cutAllPrinters.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-amber-200">
                                  <p className="font-semibold text-amber-800 mb-1">Printers found in Windows ({cutAllPrinters.length}):</p>
                                  <ul className="space-y-0.5">
                                    {cutAllPrinters.map((p, i) => (
                                      <li key={i} className="text-amber-900 font-medium">{p.name}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {cutAllPrinters.length === 0 && (
                                <p>No printers found in Windows at all — check that the driver is installed.</p>
                              )}
                            </div>
                          )}

                          {cutPrinters.length > 0 && (
                            <div className="mt-4 space-y-3">
                              {cutPrinters.map((printer) => (
                                <div key={printer.name} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 p-4">
                                  <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className="text-sm font-semibold text-slate-900">{printer.name}</p>
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${printer.brand === "HiTi" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{printer.brand}</span>
                                      </div>
                                      {printer.driver && <p className="text-xs text-slate-400 mt-0.5 truncate">{printer.driver}</p>}
                                    </div>
                                    {printer.hasStripProfile ? (
                                      <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 flex-shrink-0">
                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                        {printer.stripProfileName} · Ready
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={cutCreating === printer.name}
                                        onClick={() => handleCreateStripProfile(printer.name)}
                                        className="flex-shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
                                      >
                                        {cutCreating === printer.name ? "Creating…" : "Create STRIP profile"}
                                      </button>
                                    )}
                                  </div>

                                  {printer.hasStripProfile ? (
                                    <div className="mt-3 space-y-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                          Strip routing active
                                        </span>
                                        {cutModeApplied[printer.name] ? (
                                          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700">
                                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                            2inch cut: Enable
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700">
                                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            2inch cut: setup needed
                                          </span>
                                        )}
                                      </div>
                                      {cutNeedsSave[printer.name] && !cutModeApplied[printer.name] && (
                                        <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-2">
                                          <p className="text-xs font-semibold text-orange-800">One-time setup — Printing Preferences has opened</p>
                                          <ol className="text-xs text-orange-700 list-decimal list-inside space-y-1">
                                            <li>In the window that opened, find <strong>2inch cut</strong> and set it to <strong>Enable</strong></li>
                                            <li>Click <strong>OK</strong> to save</li>
                                            <li>Click the button below — Photuna will remember this for all future STRIP profiles</li>
                                          </ol>
                                          <div className="flex gap-2 pt-1">
                                            <button
                                              onClick={() => handleSaveStripDevmode(printer.name, printer.stripProfileName)}
                                              className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
                                            >
                                              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                              I set 2inch cut — Save Setting
                                            </button>
                                            <button
                                              onClick={() => window.api?.openPrinterPrefs
                                                ? window.api.openPrinterPrefs(printer.stripProfileName)
                                                : safeInvoke("printer:openPrinterPrefs", { printerName: printer.stripProfileName })}
                                              className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100"
                                            >
                                              Reopen Printing Preferences
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                      {!cutNeedsSave[printer.name] && !cutModeApplied[printer.name] && (
                                        <p className="text-xs text-slate-500 mt-1">
                                          Delete <strong>{printer.stripProfileName}</strong> from Windows Printers and recreate it here to apply 2inch cut automatically.
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="mt-2 text-xs text-slate-500">
                                      No STRIP profile yet. Click <strong>Create STRIP profile</strong> — Photuna will add <strong>{printer.stripProfileName}</strong> to Windows and automatically configure 2inch cut.
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "storage" && (
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Storage setup</div>
                              <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                Choose where photos are stored and manage automatic cleanup.
                              </div>
                            </div>

                            <button
                              onClick={selectStoragePath}
                              className={`${BTN_PRIMARY} text-sm px-4 py-2`}
                            >
                              Choose folder
                            </button>
                          </div>

                          <div className="mt-2">
                            <SettingRow label="Storage path" description={storagePath || "No folder selected yet."}>
                              <SettingReadout>{storagePath ? "Set" : "—"}</SettingReadout>
                            </SettingRow>

                            <SettingRow label="Auto cleanup" description="Delete captured sessions older than this. Frees disk space between events." htmlFor="set-cleanup">
                              <SettingSegmented
                                label="Auto cleanup"
                                value={autoDeleteDays}
                                onChange={(v) => setAutoDeleteDays(Number(v))}
                                options={[
                                  { value: 0, short: "Never", label: "Never" },
                                  { value: 7, short: "7d", label: "7 days" },
                                  { value: 14, short: "14d", label: "14 days" },
                                  { value: 30, short: "30d", label: "30 days" },
                                  { value: 60, short: "60d", label: "60 days" },
                                ]}
                              />
                            </SettingRow>

                            <SettingRow label="Run cleanup now" description="Applies the rule above immediately.">
                              <button
                                onClick={typeof runStorageCleanup === "function" ? runStorageCleanup : undefined}
                                disabled={typeof runStorageCleanup !== "function" || !storagePath}
                                className={`${BTN_GHOST} text-sm px-4 py-2`}
                              >
                                Run cleanup
                              </button>
                            </SettingRow>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Storage status</div>
                          <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            Summary of the current save location and cleanup behavior.
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="flex justify-between gap-3 text-sm">
                              <span className="text-gray-500 dark:text-slate-400">Save location</span>
                              <span className="text-gray-900 dark:text-slate-100 text-right truncate">
                                {storagePath || "Not configured"}
                              </span>
                            </div>

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600 dark:text-slate-400">
                              <div className="flex justify-between gap-3">
                                <span>Auto cleanup</span>
                                <span className="text-gray-900 dark:text-slate-100">
                                  {Number(autoDeleteDays) === 0 ? "Disabled" : `${autoDeleteDays} days`}
                                </span>
                              </div>

                              <div className="flex justify-between gap-3">
                                <span>Folder selected</span>
                                <span className="text-gray-900 dark:text-slate-100">
                                  {storagePath ? "Yes" : "No"}
                                </span>
                              </div>

                              {typeof storageStatusText !== "undefined" && (
                                <div className="pt-2 border-t border-gray-100">
                                  <div className="text-xs text-gray-500 dark:text-slate-400">{storageStatusText}</div>
                                </div>
                              )}

                              {typeof storageInfo !== "undefined" && storageInfo && (
                                <div className="space-y-2 pt-2 border-t border-gray-100">
                                  {"writable" in storageInfo && (
                                    <div className="flex justify-between gap-3">
                                      <span>Writable</span>
                                      <span className="text-gray-900 dark:text-slate-100">
                                        {storageInfo.writable ? "Yes" : "No"}
                                      </span>
                                    </div>
                                  )}

                                  {"freeSpace" in storageInfo && (
                                    <div className="flex justify-between gap-3">
                                      <span>Free space</span>
                                      <span className="text-gray-900 dark:text-slate-100">{storageInfo.freeSpace}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                    )}

                    {activeSettingsTab === "general" && (
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        {/* Theme + dashboard alerts. Moved here from Account
                            Central: they configure the app, not the account. */}
                        {renderAppearanceAlerts()}

                        {/* Booth Identity */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Booth identity</div>
                          <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            Name and location information displayed on receipts and sessions.
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-3">
                            <label className="block text-xs text-gray-700 dark:text-slate-300">
                              Booth name
                              <input
                                type="text"
                                value={boothIdentityName}
                                onChange={(e) => setBoothIdentityName(e.target.value)}
                                placeholder="e.g. Wedding Photo Booth #1"
                                maxLength={100}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700 dark:text-slate-300">
                              Operator name
                              <input
                                type="text"
                                value={operatorName}
                                onChange={(e) => setOperatorName(e.target.value)}
                                placeholder="e.g. Santos Photography"
                                maxLength={100}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>

                            <label className="block text-xs text-gray-700 dark:text-slate-300">
                              Location / venue
                              <input
                                type="text"
                                value={boothLocation}
                                onChange={(e) => setBoothLocation(e.target.value)}
                                placeholder="e.g. Grand Ballroom, Hilton Manila"
                                maxLength={200}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              />
                            </label>
                          </div>
                        </div>

                        {/* Note: Session behavior (countdown, shots, retakes) is configured per-event in Dashboard > Controls */}

                        {/* Idle & display */}
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Idle & display</div>
                          <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            Configure screen dimming and kiosk display behavior.
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SettingRow label="Dim screen when idle" description="Saves the display between guests.">
                              <SettingToggle label="Dim screen when idle" checked={dimWhenIdle} onChange={setDimWhenIdle} />
                            </SettingRow>

                            <SettingRow label="Idle timeout" description="How long with no activity before the screen dims." htmlFor="set-idle" disabled={!dimWhenIdle}>
                              <SettingNumber id="set-idle" min={5} max={3600} value={idleTimeout} disabled={!dimWhenIdle} onChange={(v) => setIdleTimeout(Number(v) || 60)} suffix="sec" />
                            </SettingRow>

                            <label className="block text-xs text-gray-700 dark:text-slate-300">
                              Language
                              <select
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              >
                                <option value="en">English</option>
                                <option value="fil">Filipino</option>
                              </select>
                            </label>

                            <label className="block text-xs text-gray-700 dark:text-slate-300">
                              Currency
                              <select
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                              >
                                <optgroup label="Southeast Asia">
                                  <option value="PHP">PHP — Philippine Peso</option>
                                  <option value="SGD">SGD — Singapore Dollar</option>
                                  <option value="MYR">MYR — Malaysian Ringgit</option>
                                  <option value="THB">THB — Thai Baht</option>
                                  <option value="IDR">IDR — Indonesian Rupiah</option>
                                </optgroup>
                                <optgroup label="East Asia">
                                  <option value="JPY">JPY — Japanese Yen</option>
                                  <option value="KRW">KRW — South Korean Won</option>
                                  <option value="HKD">HKD — Hong Kong Dollar</option>
                                  <option value="TWD">TWD — New Taiwan Dollar</option>
                                  <option value="CNY">CNY — Chinese Yuan</option>
                                </optgroup>
                                <optgroup label="South Asia">
                                  <option value="INR">INR — Indian Rupee</option>
                                </optgroup>
                                <optgroup label="Americas">
                                  <option value="USD">USD — US Dollar</option>
                                  <option value="CAD">CAD — Canadian Dollar</option>
                                </optgroup>
                                <optgroup label="Europe">
                                  <option value="EUR">EUR — Euro</option>
                                  <option value="GBP">GBP — British Pound</option>
                                  <option value="CHF">CHF — Swiss Franc</option>
                                  <option value="SEK">SEK — Swedish Krona</option>
                                  <option value="NOK">NOK — Norwegian Krone</option>
                                  <option value="DKK">DKK — Danish Krone</option>
                                  <option value="PLN">PLN — Polish Zloty</option>
                                  <option value="CZK">CZK — Czech Koruna</option>
                                  <option value="HUF">HUF — Hungarian Forint</option>
                                  <option value="RON">RON — Romanian Leu</option>
                                  <option value="BGN">BGN — Bulgarian Lev</option>
                                  <option value="TRY">TRY — Turkish Lira</option>
                                </optgroup>
                                <optgroup label="Oceania">
                                  <option value="AUD">AUD — Australian Dollar</option>
                                  <option value="NZD">NZD — New Zealand Dollar</option>
                                </optgroup>
                              </select>
                            </label>
                          </div>
                        </div>

                        {/* Summary panel */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Current configuration</div>
                          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs text-gray-600 dark:text-slate-400">
                            <div className="flex justify-between gap-2 md:col-span-1">
                              <span className="text-gray-500 dark:text-slate-400">Booth name</span>
                              <span className="text-gray-900 dark:text-slate-100 truncate">{boothIdentityName || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Operator</span>
                              <span className="text-gray-900 dark:text-slate-100 truncate">{operatorName || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Location</span>
                              <span className="text-gray-900 dark:text-slate-100 truncate">{boothLocation || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Countdown</span>
                              <span className="text-gray-900 dark:text-slate-100">{countdown}s</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Shots</span>
                              <span className="text-gray-900 dark:text-slate-100">{numberOfShots}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Retakes</span>
                              <span className="text-gray-900 dark:text-slate-100">{retakeLimit === 0 ? "Unlimited" : retakeLimit}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Consent screen</span>
                              <span className="text-gray-900 dark:text-slate-100">{consentEnabled ? "On" : "Off"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Storage choice</span>
                              <span className="text-gray-900 dark:text-slate-100">{storageChoiceEnabled ? "Guest selects" : "Auto (gallery)"}</span>
                            </div>
                            {operatorStorageEnabled && (
                              <div className="flex justify-between gap-2">
                                <span className="text-gray-500 dark:text-slate-400">Operator storage</span>
                                <span className="text-gray-900 dark:text-slate-100 truncate max-w-[120px]">{operatorStorageLabel || "Configured"}</span>
                              </div>
                            )}
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Idle dimming</span>
                              <span className="text-gray-900 dark:text-slate-100">{dimWhenIdle ? `${idleTimeout}s` : "Off"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-500 dark:text-slate-400">Language</span>
                              <span className="text-gray-900 dark:text-slate-100">{language === "fil" ? "Filipino" : "English"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "logs" && (
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Audit & logs</div>
                            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                              Export diagnostic logs for troubleshooting and maintenance.
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                              onClick={exportLogs}
                              className={`${BTN_PRIMARY} text-sm px-4 py-2`}
                            >
                              Export audit logs
                            </button>
                            <button
                              onClick={typeof clearLogs === "function" ? clearLogs : undefined}
                              disabled={typeof clearLogs !== "function"}
                              className={`${BTN_GHOST} text-sm px-4 py-2`}
                            >
                              Clear logs
                            </button>
                          </div>
                        </div>

                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Log status</div>
                          <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            Recent export and maintenance activity.
                          </div>

                          <div className="mt-4 space-y-3">
                            {typeof logsStatusText !== "undefined" && (
                              <div className="text-xs text-gray-500 dark:text-slate-400">
                                {logsStatusText}
                              </div>
                            )}

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600 dark:text-slate-400">
                              <div className="flex justify-between gap-3">
                                <span>Export available</span>
                                <span className="text-gray-900 dark:text-slate-100">Yes</span>
                              </div>

                              {typeof lastExportedLogPath !== "undefined" && (
                                <div className="flex justify-between gap-3">
                                  <span>Last exported file</span>
                                  <span className="text-gray-900 dark:text-slate-100 text-right truncate">
                                    {lastExportedLogPath || "None yet"}
                                  </span>
                                </div>
                              )}

                              {typeof logsLoading !== "undefined" && (
                                <div className="flex justify-between gap-3">
                                  <span>Status</span>
                                  <span className="text-gray-900 dark:text-slate-100">
                                    {logsLoading ? "Working..." : "Idle"}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSettingsTab === "system" && (
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div className={`xl:col-span-2 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div>
                            <div className="text-sm font-medium text-gray-900">Startup & recovery</div>
                            <div className="text-xs text-gray-500 mt-1">
                              Control launch behavior, automatic recovery, and maintenance tools.
                            </div>
                          </div>

                          <div className="mt-2">
                            <SettingRow label="Launch on system startup" description="Brings the booth back up on its own after a restart or power cut.">
                              <SettingToggle label="Launch on system startup" checked={launchOnStartup} onChange={toggleLaunchOnStartup} />
                            </SettingRow>

                            <SettingRow label="Auto-restart on crash" description="Relaunches automatically if the app stops responding.">
                              <SettingToggle label="Auto-restart on crash" checked={autoRestart} onChange={setAutoRestart} />
                            </SettingRow>

                            {typeof autoUpdateEnabled !== "undefined" && typeof setAutoUpdateEnabled === "function" && (
                              <SettingRow label="Enable automatic updates" description="Downloads new versions in the background and installs them on quit.">
                                <SettingToggle
                                  label="Enable automatic updates"
                                  checked={autoUpdateEnabled}
                                  onChange={(next) => { setAutoUpdateEnabled(next); safeInvoke("app:setAutoUpdate", next); }}
                                />
                              </SettingRow>
                            )}

                            <div className="flex flex-wrap items-center gap-3 pt-2">
                              <button
                                onClick={checkForUpdates}
                                disabled={updateState === "checking" || updateState === "downloading"}
                                className={`${BTN_GHOST} text-sm px-4 py-2`}
                              >
                                {updateState === "checking" ? "Checking..." : "Check for updates"}
                              </button>
                              {updateState === "available" && (
                                <button
                                  onClick={downloadUpdate}
                                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
                                >
                                  Download update
                                </button>
                              )}
                              {updateState === "downloading" && (
                                <span className="text-sm text-blue-600 font-medium">Downloading {updatePercent}%</span>
                              )}
                              {(updateState === "ready" || updateState === "downloaded") && (
                                <button
                                  onClick={installUpdate}
                                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition"
                                >
                                  Install & restart
                                </button>
                              )}
                              <button
                                onClick={clearCache}
                                className={`${BTN_GHOST} text-sm px-4 py-2`}
                              >
                                Clear cache
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-4`}>
                          <div className="text-sm font-medium text-gray-900">System status</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Current startup, recovery, and maintenance preferences.
                          </div>

                          <div className="mt-4 space-y-3">
                            <div className="flex justify-between gap-3 text-sm">
                              <span className="text-gray-500">Launch on startup</span>
                              <span className="text-gray-900">
                                {launchOnStartup ? "Enabled" : "Disabled"}
                              </span>
                            </div>

                            <div className="flex justify-between gap-3 text-sm">
                              <span className="text-gray-500">Auto-restart</span>
                              <span className="text-gray-900">
                                {autoRestart ? "Enabled" : "Disabled"}
                              </span>
                            </div>

                            <div className="pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600">
                              {typeof autoUpdateEnabled !== "undefined" && (
                                <div className="flex justify-between gap-3">
                                  <span>Auto update</span>
                                  <span className="text-gray-900">
                                    {autoUpdateEnabled ? "Enabled" : "Disabled"}
                                  </span>
                                </div>
                              )}

                              {typeof updateStatusText !== "undefined" && (
                                <div className="pt-2 border-t border-gray-100">
                                  <div className="text-xs text-gray-500">{updateStatusText}</div>
                                </div>
                              )}

                              {typeof cacheStatusText !== "undefined" && (
                                <div className="text-xs text-gray-500">{cacheStatusText}</div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Full width at the bottom: health is a live readout,
                            not a setting, so it follows the controls above. */}
                        <div className="xl:col-span-3">
                          {renderSystemHealth()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeMain === "helpcenter" && (
                <div className="space-y-6">
                  {/* Step-by-step Setup Guide — collapsible */}
                  <div className={cardClass}>
                    <button
                      type="button"
                      onClick={() => setSetupGuideOpen((v) => !v)}
                      className="w-full flex items-center justify-between text-left"
                    >
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Setup Guide for New Operators</h3>
                        <p className="mt-1 text-xs text-slate-500">Follow these steps in order to get your photobooth ready for its first event.</p>
                      </div>
                      <svg className={`w-5 h-5 text-slate-400 transition-transform ${setupGuideOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {setupGuideOpen && <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0">
                      {[
                        {
                          step: 1,
                          title: "Configure your camera",
                          where: "Settings > Camera",
                          instructions: [
                            "Click the Camera tab in Settings.",
                            "Select your camera device from the dropdown (DSLR, webcam, or USB capture card).",
                            "Choose a resolution (1080p recommended for most printers).",
                            "Enable 'Mirror camera' if you want a selfie-style preview.",
                            "Click 'Save settings' at the bottom of the page.",
                          ],
                          action: () => { setActiveMain("settings"); setActiveSettingsTab("camera"); },
                        },
                        {
                          step: 2,
                          title: "Set up your printer",
                          where: "Settings > Printing",
                          instructions: [
                            "Go to the Printing tab in Settings.",
                            "Make sure your printer driver is installed and the printer is turned on.",
                            "Select the printer from the dropdown list.",
                            "Set paper size (4x6 is standard for photo booths).",
                            "Click 'Test print' to verify alignment before going live.",
                            "Click 'Save settings'.",
                          ],
                          action: () => { setActiveMain("settings"); setActiveSettingsTab("printing"); },
                        },
                        {
                          step: 3,
                          title: "Choose a storage folder",
                          where: "Settings > Storage",
                          instructions: [
                            "Go to the Storage tab in Settings.",
                            "Click 'Choose folder' and select where photos will be saved.",
                            "Set auto-cleanup days (e.g., 14 days) to avoid filling your disk.",
                            "Click 'Save settings'.",
                          ],
                          action: () => { setActiveMain("settings"); setActiveSettingsTab("storage"); },
                        },
                        {
                          step: 4,
                          title: "Create your first event",
                          where: "Events page",
                          instructions: [
                            "Go to the Events page from the sidebar.",
                            "Click 'New Event' and enter the event name, date, and location.",
                            "The event will be created with default settings that you can customize.",
                          ],
                          action: () => { setActiveMain("events"); },
                        },
                        {
                          step: 5,
                          title: "Set up branding",
                          where: "Dashboard > Branding",
                          instructions: [
                            "Open your event, then go to the Dashboard > Branding tab.",
                            "Upload your logo or set a booth name and tagline.",
                            "Add a background image, video, or select 'Live Camera' for a mirror effect.",
                            "Customize colors, fonts, and button styles to match your brand.",
                            "Check the Live Preview at the bottom to see how it looks.",
                          ],
                          action: currentEvent ? () => { setActiveMain("dashboard"); setActiveSub("branding"); } : null,
                        },
                        {
                          step: 6,
                          title: "Create a template",
                          where: "Dashboard > Templates",
                          instructions: [
                            "Open your event, then go to Dashboard > Templates.",
                            "Click 'New Template' to open the editor.",
                            "Drag and resize photo slots on the 4x6 canvas.",
                            "Save the template and apply it to your event.",
                          ],
                          action: currentEvent ? () => { setActiveMain("dashboard"); setActiveSub("templates"); } : null,
                        },
                        {
                          step: 7,
                          title: "Configure session controls",
                          where: "Dashboard > Controls",
                          instructions: [
                            "Open your event, then go to Dashboard > Controls.",
                            "Set countdown timer, number of shots per session, and retake limits.",
                            "Choose 'Rental' mode (free use) or 'Business' mode (paid per session).",
                            "For rental events, optionally set a rental timer and session usage limit.",
                          ],
                          action: currentEvent ? () => { setActiveMain("dashboard"); setActiveSub("controls"); } : null,
                        },
                        {
                          step: 8,
                          title: "Run a test session",
                          where: "Events page > Start Booth",
                          instructions: [
                            "Go to the Events page and select your event.",
                            "Click 'Start Booth' to launch the photobooth flow.",
                            "Walk through the full flow: welcome > template > photo > print.",
                            "Verify that photos capture correctly, print looks good, and the booth returns to welcome.",
                            "Press Esc to exit booth mode and return to the admin dashboard.",
                          ],
                          action: null,
                        },
                      ].map(({ step, title, where, instructions, action }) => (
                        <div key={step} className="flex gap-4 py-4 border-b border-slate-100 last:border-0">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                            {step}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800">{title}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{where}</span>
                            </div>
                            <ol className="mt-2 space-y-1">
                              {instructions.map((inst, i) => (
                                <li key={i} className="text-xs text-slate-500 leading-relaxed flex gap-2">
                                  <span className="text-slate-300 flex-shrink-0">{i + 1}.</span>
                                  <span>{inst}</span>
                                </li>
                              ))}
                            </ol>
                            {action && (
                              <button
                                type="button"
                                onClick={action}
                                className="mt-2 text-xs font-semibold text-blue-600 hover:underline"
                              >
                                Go to {where} &rarr;
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>}
                  </div>

                  {/* Quick Start Guides */}
                  <div className={cardClass}>
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Quick Start Guides</h3>
                        <p className="mt-1 text-xs text-slate-500">Step-by-step walkthroughs for common tasks.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {[
                        {
                          icon: "M13 10V3L4 14h7v7l9-11h-7z",
                          title: "Getting Started",
                          desc: "Create your first event, set up branding, configure camera and printer, and run a test session.",
                          action: openGettingStartedGuide,
                          actionLabel: "Read guide",
                          color: "text-blue-600",
                          bg: "bg-blue-50",
                        },
                        {
                          icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2zm8 0a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1h-6a1 1 0 01-1-1v-2z",
                          title: "Template Editor",
                          desc: "Drag, resize, rotate, and align photo slots on the print canvas to create custom layouts.",
                          action: openTemplateEditorGuide,
                          actionLabel: "Open editor",
                          color: "text-violet-600",
                          bg: "bg-violet-50",
                        },
                        {
                          icon: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
                          title: "Payments & GCash",
                          desc: "Enable payment collection per event, configure GCash or cash mode, and set session pricing.",
                          action: openPaymentsGuide,
                          actionLabel: "Configure",
                          color: "text-emerald-600",
                          bg: "bg-emerald-50",
                        },
                      ].map(({ icon, title, desc, action, actionLabel, color, bg }) => (
                        <div key={title} className={`${smallCardClass} flex flex-col justify-between`}>
                          <div>
                            <div className="flex items-center gap-2.5 mb-2">
                              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                                <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
                                </svg>
                              </div>
                              <span className="text-sm font-semibold text-slate-800">{title}</span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                          </div>
                          <button
                            className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${color} hover:underline`}
                            onClick={action}
                          >
                            {actionLabel} <span aria-hidden="true">&rarr;</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Common Tasks */}
                  <div className={cardClass}>
                    <h3 className="text-sm font-bold text-slate-900 mb-4">Common Tasks</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[
                        { q: "How do I set up my camera?", a: "Go to Settings > Camera, select your device, choose resolution, and click Save settings." },
                        { q: "How do I connect a printer?", a: "Go to Settings > Printing, select a printer from the list, set paper size and quality, then Save settings." },
                        { q: "Where are photos stored?", a: "Go to Settings > Storage, choose a folder, and set auto-cleanup days. Photos are saved per event and session." },
                        { q: "How do I change the booth background?", a: "Open an event > Dashboard > Branding > Background Media. Upload an image/video or select Live Camera." },
                        { q: "How do I upgrade my plan?", a: "Go to Account Center > Billing, choose a plan, and pay via GCash. Your plan activates after verification." },
                        { q: "How does idle dimming work?", a: "Go to Settings > General, enable idle dimming, and set the timeout. The booth screen dims after inactivity." },
                      ].map(({ q, a }) => (
                        <div key={q} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                          <div className="text-xs font-semibold text-slate-800">{q}</div>
                          <div className="mt-1 text-xs text-slate-500 leading-relaxed">{a}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Keyboard Shortcuts & Tips */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className={cardClass}>
                      <h3 className="text-sm font-bold text-slate-900 mb-3">Keyboard Shortcuts</h3>
                      <div className="space-y-2">
                        {[
                          { keys: "Ctrl + R", desc: "Refresh the app" },
                          { keys: "Ctrl + Shift + I", desc: "Open developer tools" },
                          { keys: "Esc", desc: "Exit booth mode / close modals" },
                          { keys: "Space", desc: "Trigger shutter during session" },
                        ].map(({ keys, desc }) => (
                          <div key={keys} className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">{desc}</span>
                            <kbd className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600">{keys}</kbd>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={cardClass}>
                      <h3 className="text-sm font-bold text-slate-900 mb-3">Tips</h3>
                      <div className="space-y-2.5">
                        {[
                          "Always save settings before starting a booth session.",
                          "Run a test print to verify layout and alignment before events.",
                          "Use the yearly plan to save PHP 10,200 compared to monthly billing.",
                          "Set auto-cleanup to avoid running out of disk space during events.",
                          "Use the live camera background for an engaging welcome screen.",
                        ].map((tip) => (
                          <div key={tip} className="flex items-start gap-2 text-xs text-slate-600">
                            <svg className="w-3.5 h-3.5 flex-shrink-0 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{tip}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Support Contact */}
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-blue-900">Need more help?</div>
                      <p className="mt-0.5 text-xs text-blue-700">Contact Studio Photuna support for assistance with setup, billing, or technical issues.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.system?.openExternal?.("mailto:support@studiophotuna.com")}
                      className="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition"
                    >
                      Contact support
                    </button>
                  </div>
                </div>
              )}

              {helpArticle && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
                  <div className={`w-full max-w-2xl ${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_CARD} p-5`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-base font-semibold text-gray-900">
                          {helpArticle.title}
                        </h4>
                        <p className="mt-1 text-xs text-gray-500">
                          In-app guide
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setHelpArticle(null)}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {(helpArticle.sections || []).map((section, index) => (
                        <p key={`${helpArticle.title}-${index}`} className="text-sm leading-relaxed text-gray-700">
                          {section}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* EVENTS */}
              {activeMain === "events" && (
                <div className="space-y-5">

                  <PageHero
                    eyebrow="Events"
                    title="Event Library"
                    description={`${events.length} event${events.length !== 1 ? "s" : ""} · create one, then configure it from the dashboard.`}
                    wave={<WavePattern />}
                  />

                  {/* Create event — compact card */}
                  <div id="create-event-section" className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-5`}>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">Create new event</h4>
                        <p className="text-xs text-gray-400 mt-0.5">Name your event, then configure it from the dashboard.</p>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2.5 py-1">Quick setup</span>
                    </div>

                    <form onSubmit={createEvent} className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          id="create-event-input"
                          value={newEventName}
                          onChange={(e) => setNewEventName(e.target.value)}
                          placeholder="e.g. Maria & John Wedding Booth"
                          className={`flex-1 ${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} ${FOCUS_RING_INDIGO} px-3 py-2.5 text-sm outline-none`}
                        />
                        <button
                          type="submit"
                          disabled={!ready || !newEventName.trim()}
                          className="flex-shrink-0 inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Create
                        </button>
                      </div>

                      {/* Quick name chips */}
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[11px] text-gray-400 self-center mr-1">Quick fill:</span>
                        {["Birthday Booth", "Wedding Booth", "Corporate Booth", "Debut Booth", "School Event"].map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => setNewEventName(name)}
                            className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition-all"
                          >
                            {name}
                          </button>
                        ))}
                      </div>

                      {/* Notes field */}
                      <div>
                        <input
                          value={newEventNotes}
                          onChange={(e) => setNewEventNotes(e.target.value)}
                          placeholder="Notes (optional)"
                          className={`w-full ${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-xs outline-none text-gray-600 placeholder-gray-400`}
                        />
                      </div>

                      {/* Copy design from an existing event */}
                      {events.length > 0 && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-gray-700">
                                Copy templates &amp; frames
                              </div>
                              <p className="mt-0.5 text-[10px] text-gray-400">
                                Reuse the applied templates, frames and tones from another event.
                                Branding and settings always start fresh.
                              </p>
                            </div>

                            {/* Toggle */}
                            <button
                              type="button"
                              role="switch"
                              aria-checked={copyDesignEnabled}
                              onClick={() => {
                                const next = !copyDesignEnabled;
                                setCopyDesignEnabled(next);
                                // Default to the most recent event so the toggle
                                // alone is enough for the common case.
                                setCopyDesignFromEventId(next ? String(events[0]?.id ?? "") : "");
                              }}
                              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${copyDesignEnabled ? "bg-blue-600" : "bg-slate-300"
                                }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${copyDesignEnabled ? "translate-x-[1.15rem]" : "translate-x-[0.15rem]"
                                  }`}
                              />
                            </button>
                          </div>

                          {copyDesignEnabled && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {events.map((ev) => {
                                const tplCount = ev.appliedTemplates?.length ?? 0;
                                const frmCount = ev.appliedFrames?.length ?? 0;
                                const selected = String(copyDesignFromEventId) === String(ev.id);
                                return (
                                  <button
                                    key={ev.id}
                                    type="button"
                                    onClick={() => setCopyDesignFromEventId(String(ev.id))}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${selected
                                      ? "border-blue-300 bg-blue-50 text-blue-700"
                                      : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                      }`}
                                  >
                                    {ev.name || "Untitled event"}
                                    <span className={selected ? "text-blue-400" : "text-gray-400"}>
                                      {" "}· {tplCount}T / {frmCount}F
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </form>
                  </div>

                  {/* Event library */}
                  <div id="event-library">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-700">Event library</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400">{events.length} event{events.length !== 1 ? "s" : ""}</span>
                        <button
                          title="Reload events"
                          onClick={async () => {
                            if (!identity?.userId) return;
                            try {
                              const evs = await native?.getEvents?.({ userId: identity.userId });
                              if (Array.isArray(evs) && evs.length > 0) setEvents(evs);
                            } catch { /* silent */ }
                          }}
                          className="rounded-full p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {!hydrated && events.length === 0 ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div key={`event-skeleton-${index}`} className="animate-pulse bg-slate-100 rounded-lg h-20 w-full" />
                        ))}
                      </div>
                    ) : events.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center">
                        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="text-sm font-medium text-gray-600">No events yet. Create your first event to get started.</div>
                        <p className="mt-1 text-xs text-gray-400">Use the create event form above to add your first event workspace.</p>
                        <button
                          type="button"
                          onClick={() => document.getElementById("create-event-input")?.focus()}
                          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                        >
                          Create event
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {events.map((ev) => {
                          const isActive = currentEvent?.id === ev.id;
                          const sessionPrice = isActive
                            ? pricePerSession
                            : (ev.settings?.business?.pricing?.pricePerSession ?? ev.settings?.price ?? 0);
                          const evCardCurrency = isActive
                            ? currency
                            : (ev.settings?.business?.pricing?.currency ?? "PHP");
                          const cardShots = isActive
                            ? numberOfShots
                            : (ev.settings?.numberOfShots ?? "—");
                          const totalSessions = ev.sessions?.length ?? 0;
                          const todaySessions = completedSessionsToday(ev);

                          return (
                            <div
                              key={ev.id}
                              className={`flex flex-col rounded-xl border bg-white p-4 shadow-sm transition-all ${isActive ? "border-blue-300 ring-2 ring-blue-100 shadow-[0_8px_30px_rgba(37,99,235,0.10)]" : "border-slate-200 hover:border-slate-300 hover:shadow-md"
                                }`}
                            >
                              {/* Card header */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                                    <div className="truncate text-sm font-semibold text-gray-900">
                                      {ev.name || "Untitled event"}
                                    </div>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-gray-400">
                                    {ev.created || "—"}
                                  </div>
                                </div>
                                <span className="flex-shrink-0 rounded-full bg-gray-50 border border-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                  {(isActive ? appMode : ev.settings?.appMode) ?? DEFAULT_APP_MODE}
                                </span>
                              </div>

                              {/* Stats strip */}
                              <div className="mt-3 grid grid-cols-4 gap-1.5">
                                {[
                                  { label: "Price", value: fmtAmt(sessionPrice, evCardCurrency) },
                                  { label: "Shots", value: cardShots },
                                  { label: "Today", value: todaySessions },
                                  { label: "Total", value: totalSessions },
                                ].map(({ label, value }) => (
                                  <div key={label} className="rounded-lg bg-gray-50 px-2 py-2 text-center">
                                    <div className="text-[10px] text-gray-400">{label}</div>
                                    <div className="text-xs font-bold text-gray-800 mt-0.5 tabular-nums truncate">{value}</div>
                                  </div>
                                ))}
                              </div>

                              {/* Asset tags */}
                              <div className="mt-2.5 flex flex-wrap gap-1">
                                {[
                                  { count: ev.appliedTemplates?.length ?? 0, label: "template" },
                                  { count: ev.appliedFrames?.length ?? 0, label: "frame" },
                                  { count: ev.appliedTones?.length ?? 0, label: "tone" },
                                ].map(({ count, label }) =>
                                  count > 0 ? (
                                    <span key={label} className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                                      {count} {label}{count !== 1 ? "s" : ""}
                                    </span>
                                  ) : null
                                )}
                                {totalSessions > 0 && (
                                  <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                                    {fmtAmt(totalSessions * sessionPrice, evCardCurrency)} gross
                                  </span>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="mt-4 flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setCurrentEvent(JSON.parse(JSON.stringify(ev)));
                                    setActiveMain("dashboard");
                                    setActiveSub("branding");
                                  }}
                                  data-tour="open-editor"
                                  className="flex-1 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
                                >
                                  Open editor
                                </button>

                                {/* QR Gallery button — requires gallery subscription */}
                                {/* Gallery Branding button — opens gallery admin with auto-login */}
                                <button
                                  title={galleryAddonEnabled ? "Customize gallery branding for this event" : "Gallery subscription required"}
                                  disabled={!galleryAddonEnabled}
                                  onClick={async () => {
                                    if (!galleryAddonEnabled) return;
                                    try {
                                      const { data: sessionData } = await supabase.auth.getSession();
                                      const session = sessionData?.session;
                                      if (!session?.access_token) {
                                        showToast?.("Please sign in to open Gallery Branding");
                                        return;
                                      }
                                      // Look up the existing event-level gallery slug
                                      const { data: galleryRow } = await supabase
                                        .from("galleries")
                                        .select("slug")
                                        .eq("event_id", ev.id)
                                        .is("session_id", null)
                                        .maybeSingle();
                                      const base = "https://gallery.studiophotuna.com/admin";
                                      const path = galleryRow?.slug
                                        ? `${base}/gallery/${galleryRow.slug}`
                                        : `${base}/event/${ev.id}`;
                                      // Append auth tokens in the hash so the gallery site auto-logs in
                                      const hash = `access_token=${session.access_token}&refresh_token=${session.refresh_token}&token_type=bearer&expires_in=${session.expires_in ?? 3600}`;
                                      window.system?.openExternal?.(`${path}#${hash}`);
                                    } catch (err) {
                                      showToast?.(err?.message || "Could not open gallery branding");
                                    }
                                  }}
                                  className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition active:scale-[0.98] ${
                                    galleryAddonEnabled
                                      ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                      : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                                  }`}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                  </svg>
                                </button>

                                <button
                                  title={galleryAddonEnabled ? "View QR gallery for this event" : "Gallery subscription required"}
                                  disabled={!galleryAddonEnabled}
                                  onClick={async () => {
                                    if (!galleryAddonEnabled) return;
                                    setGalleryQrModal({ ev, loading: true, eventQr: null, error: null });
                                    try {
                                      const tier = gating?.galleryTier || (gating?.galleryAddon ? 'plus' : 'free');
                                      const res = await licensingApi.getEventGallerySessions(ev.id);
                                      const eventQrEntry = (res?.sessions ?? []).find(s => !s.sessionId) || null;
                                      if (eventQrEntry) {
                                        setGalleryQrModal({ ev, loading: false, eventQr: eventQrEntry, error: null });
                                      } else {
                                        const createRes = await licensingApi.createEventGalleryQr(ev.id, tier);
                                        if (createRes?.ok) {
                                          setGalleryQrModal({ ev, loading: false, eventQr: { slug: createRes.slug, qrUrl: createRes.qrUrl, expiresAt: createRes.expiresAt }, error: null });
                                        } else {
                                          setGalleryQrModal({ ev, loading: false, eventQr: null, error: createRes?.error || "Failed to create gallery" });
                                        }
                                      }
                                    } catch (err) {
                                      setGalleryQrModal({ ev, loading: false, eventQr: null, error: err?.message || "Failed to load gallery" });
                                    }
                                  }}
                                  className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition active:scale-[0.98] ${
                                    galleryAddonEnabled
                                      ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
                                      : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                                  }`}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                                  </svg>
                                </button>

                                <button
                                  onClick={async () => {
                                    try {
                                      const evCopy = JSON.parse(JSON.stringify(ev));

                                      const hasTemplates = Array.isArray(evCopy.appliedTemplates) && evCopy.appliedTemplates.length > 0;
                                      if (!hasTemplates) {
                                        showToast?.("This event has no templates. Create and apply at least one template first.");
                                        setCurrentEvent(evCopy);
                                        setActiveMain("dashboard");
                                        setActiveSub("templates");
                                        return;
                                      }

                                      const mergedEvent = {
                                        ...evCopy,
                                        settings: { ...(evCopy.settings || {}), ...settingsToSave },
                                      };
                                      const updatedEvents = events.map((item) =>
                                        item.id === mergedEvent.id ? mergedEvent : item
                                      );
                                      setCurrentEvent(mergedEvent);
                                      setEvents(updatedEvents);
                                      await native?.setEvents?.(updatedEvents, ctx);
                                      await native?.setCurrentEventId?.(mergedEvent.id);
                                      if (typeof onStartPhotobooth === "function") {
                                        onStartPhotobooth(mergedEvent);
                                      } else {
                                        setActiveMain("dashboard");
                                      }
                                    } catch (e) {
                                      console.error("Start Photo booth failed:", e);
                                    }
                                  }}
                                  className="flex-1 inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700 active:scale-[0.98]"
                                >
                                  Start booth
                                </button>

                                <button
                                  onClick={() => setDeleteTarget({ type: "event", id: ev.id, name: ev.name })}
                                  className="rounded-full border border-slate-200 p-2 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all"
                                  title="Delete event"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ===== DASHBOARD CONTENT AREA ===== */}
              {activeMain === "dashboard" && currentEvent && (
                <div>
                  {/* ==== APPEARANCE (unchanged behavior, only visual polish) ==== */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "branding" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-1">

                      {/* Logo */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Logo</div>

                        <div className="mt-3">
                          {logoPath ? (
                            <div className="flex items-center gap-4">
                              <img
                                src={logoPath.previewUrl ?? logoPath.url}
                                alt="Logo preview"
                                className="w-40 h-24 object-contain rounded-md border bg-white"
                              />

                              <button
                                onClick={() => {
                                  setLogoPath(null);
                                  showToast("Logo removed");
                                }}
                                className={BTN_GHOST}
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <input
                              type="file"
                              accept="image/*"
                              className="text-xs text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-gray-300 file:bg-white hover:file:bg-gray-50 cursor-pointer"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                if (!file.type.startsWith('image/')) {
                                  showToast('Please select an image file.');
                                  return;
                                }
                                if (file.size > 20 * 1024 * 1024) { // 20 MB
                                  showToast('Image exceeds 20MB. Please upload a smaller file.');
                                  return;
                                }

                                const tempUrl = URL.createObjectURL(file);
                                setLogoPath({ url: tempUrl, name: file.name, previewUrl: tempUrl });
                                try {
                                  const res = (await native?.saveAppearanceLogoFromFile?.(file, currentEvent.id, identity.userId)) ?? {};
                                  // appUrl uses the registered app:// protocol (works in production where file:// is blocked by webSecurity)
                                  const localUrl = res?.appUrl || res?.fileUrl || null;
                                  // Upload to Supabase Storage for cross-device HTTPS access
                                  let httpsUrl = localUrl?.startsWith('https://') ? localUrl : null;
                                  if (!httpsUrl) {
                                    try {
                                      const uid = identity?.userId ?? 'anon';
                                      const ext = (file.name || '').split('.').pop() || 'png';
                                      const storagePath = `${uid}/appearance/logo.${ext}`;
                                      await supabase.storage.from('studiophotuna').upload(storagePath, file, { contentType: file.type || 'image/png', upsert: true });
                                      const { data: _logoSign } = await supabase.storage.from('studiophotuna').createSignedUrl(storagePath, 365 * 24 * 60 * 60);
                                      httpsUrl = _logoSign?.signedUrl ?? null;
                                    } catch (_) {}
                                  }
                                  // savedUrl is what gets persisted; previewUrl is local rendering
                                  const savedUrl = httpsUrl ?? localUrl;
                                  if (!savedUrl) { showToast('Failed to upload logo'); return; }
                                  setLogoPath({ url: savedUrl, name: file.name, previewUrl: localUrl ?? savedUrl });
                                  showToast('Logo saved');
                                } catch (err) {
                                  console.error(err);
                                  showToast('Failed to save logo');
                                } finally {
                                  URL.revokeObjectURL(tempUrl);
                                }
                              }}
                            />
                          )}
                        </div>

                        {logoPath && (
                          <div className="mt-4">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-slate-600 font-medium">Logo Size</span>
                              <span className="text-xs text-slate-500 tabular-nums">{logoSize}%</span>
                            </div>
                            <input
                              type="range"
                              min={40}
                              max={200}
                              step={5}
                              value={logoSize}
                              onChange={(e) => setLogoSize(Number(e.target.value))}
                              className="w-full accent-indigo-600"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                              <span>40%</span><span>100%</span><span>200%</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Background */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Background Media</div>

                        <div className="mt-3 flex items-center gap-2">
                          {["media", "camera"].map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setBackgroundType(type)}
                              className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition ${
                                backgroundType === type
                                  ? "bg-slate-900 text-white"
                                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              }`}
                            >
                              {type === "media" ? "Image / Video" : "Live Camera"}
                            </button>
                          ))}
                        </div>

                        {backgroundType === "camera" ? (
                          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
                            <p className="font-semibold">Live camera feed as background</p>
                            <p className="mt-1 text-blue-600">The booth welcome screen will display a mirrored live camera preview behind the branding overlay. The camera selected in Settings will be used.</p>
                          </div>
                        ) : (
                        <div className="mt-3">
                          {backgroundMediaPath ? (
                            <div className="flex items-center gap-4">
                              {/* Render images (jpg, png, webp, gif) as <img>, else <video> */}
                              {(() => {
                                const src = backgroundMediaPath.previewUrl ?? backgroundMediaPath.url;
                                const name = backgroundMediaPath.name?.toLowerCase() ?? '';
                                const isImageExt = /\.(gif|jpe?g|png|webp|bmp|tiff?)$/.test(name);
                                // Fallback to MIME when available
                                const isImageMime =
                                  backgroundMediaPath.mime?.startsWith('image/') ??
                                  name.endsWith('.gif'); // legacy fallback

                                const isImage = isImageExt || isImageMime;

                                return isImage ? (
                                  <img
                                    src={src}
                                    className="w-40 h-24 object-cover rounded-md border"
                                    alt="Background Image"
                                  />
                                ) : (
                                  <video
                                    src={src}
                                    className="w-40 h-24 object-cover rounded-md border"
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                  />
                                );
                              })()}

                              <button
                                onClick={() => {
                                  setBackgroundMediaPath(null);
                                  showToast('Background removed');
                                }}
                                className={BTN_GHOST}
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <input
                              type="file"
                              // Allow videos AND images (jpg, png, webp, gif, etc.)
                              accept="video/*,image/*"
                              className="text-xs text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-gray-300 file:bg-white hover:file:bg-gray-50 cursor-pointer"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;

                                const type = file.type || '';
                                const isVideo = type.startsWith('video/');
                                const isImage = type.startsWith('image/'); // includes gif, jpg, png, webp, etc.

                                if (!isVideo && !isImage) {
                                  showToast('Please select a video or image file.');
                                  return;
                                }

                                // 100MB limit (you can split limits if you want stricter images, e.g., 25MB)
                                if (file.size > 100 * 1024 * 1024) {
                                  showToast('File exceeds 100MB. Please upload a smaller file.');
                                  return;
                                }

                                // Optional: reject SVGs if you don't want vector uploads
                                if (type === 'image/svg+xml') {
                                  showToast('SVGs are not supported. Please upload a raster image like JPG/PNG/WEBP/GIF.');
                                  return;
                                }

                                const objectUrl = URL.createObjectURL(file);

                                // Optimistic preview
                                setBackgroundMediaPath({
                                  url: objectUrl,
                                  name: file.name,
                                  previewUrl: objectUrl,
                                  mime: file.type,
                                });

                                try {
                                  const res =
                                    (await native?.saveAppearanceBackgroundFromFile?.(
                                      file,
                                      currentEvent.id,
                                      identity.userId
                                    )) ?? {};

                                  const localUrl = res?.appUrl || res?.fileUrl || null;
                                  // Upload images to Supabase Storage for cross-device (iPad) HTTPS access
                                  let httpsUrl = localUrl?.startsWith('https://') ? localUrl : null;
                                  if (!httpsUrl && file.type?.startsWith('image/')) {
                                    try {
                                      const uid = identity?.userId ?? 'anon';
                                      const ext = (file.name || '').split('.').pop() || 'png';
                                      const storagePath = `${uid}/appearance/background.${ext}`;
                                      await supabase.storage.from('studiophotuna').upload(storagePath, file, { contentType: file.type, upsert: true });
                                      const { data: _bgSign } = await supabase.storage.from('studiophotuna').createSignedUrl(storagePath, 365 * 24 * 60 * 60);
                                      httpsUrl = _bgSign?.signedUrl ?? null;
                                    } catch (_) {}
                                  }
                                  const savedUrl = httpsUrl ?? localUrl;
                                  if (!savedUrl) { showToast('Failed to upload background'); return; }

                                  setBackgroundMediaPath({
                                    url: savedUrl,
                                    path: res.savedPath,
                                    name: file.name,
                                    previewUrl: localUrl ?? savedUrl,
                                    mime: file.type,
                                  });

                                  showToast('Background saved');
                                } catch (err) {
                                  console.error(err);
                                  showToast('Failed to save background');
                                } finally {
                                  URL.revokeObjectURL(objectUrl);
                                }
                              }}
                            />
                          )}
                        </div>
                        )}
                      </div>

                      {/* Identity: Colors · Texts · Fonts */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Identity</div>

                        <div className="grid grid-cols-3 gap-3 mt-3">
                          {[
                            ["Header", headerFontColor, setHeaderFontColor],
                            ["Body", generalFontColor, setGeneralFontColor],
                            ["Background", bgColor, setBgColor],
                          ].map(([label, value, setter]) => (
                            <label key={label} className="text-xs text-gray-700">
                              {label}
                              <input type="color" value={value} onChange={(e) => setter(e.target.value)} className="block mt-1 w-full h-7 rounded cursor-pointer" />
                            </label>
                          ))}
                        </div>

                        <div className="mt-3 border-t border-slate-100 pt-3 grid grid-cols-1 gap-2">
                          <input
                            value={boothName}
                            onChange={(e) => setBoothName(e.target.value)}
                            placeholder="Booth name"
                            className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-sm`}
                          />
                          <input
                            value={boothSlogan}
                            onChange={(e) => setBoothSlogan(e.target.value)}
                            placeholder="Booth slogan"
                            className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-sm`}
                          />
                          <input
                            type="email"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            placeholder="Support email (shown on consent screen)"
                            className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-sm`}
                          />
                        </div>

                        <div className="mt-3 border-t border-slate-100 pt-3 grid grid-cols-2 gap-3">
                          {[
                            ["Header font", headerFont, setHeaderFont],
                            ["Body font", generalFont, setGeneralFont],
                          ].map(([label, value, setter]) => (
                            <label key={label} className="text-xs font-medium text-slate-600">
                              {label}
                              <select value={value} onChange={(e) => setter(e.target.value)} className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-2 py-1.5 mt-1 w-full text-sm`}>
                                {GOOGLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Start Button */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Start Button</div>

                        <label className="inline-flex items-center gap-2 text-sm mt-4">
                          <input
                            type="checkbox"
                            checked={startButtonHidden}
                            onChange={(e) => setStartButtonHidden(e.target.checked)}
                          />
                          Hide button on Welcome Screen
                        </label>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          <input
                            value={startButtonText}
                            onChange={(e) => setStartButtonText(e.target.value)}
                            placeholder="Button label (e.g., Tap to Start)"
                            className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 text-sm transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed`}
                            disabled={startButtonHidden}
                          />
                          <label className="text-xs font-medium text-slate-600">
                            Font
                            <select
                              value={buttonFont}
                              onChange={(e) => setbuttonFont(e.target.value)}
                              disabled={startButtonHidden}
                              className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full text-sm transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                              {GOOGLE_FONTS.map((f) => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="grid grid-cols-3 gap-4 mt-3">
                          {[
                            ["BG Color", buttonBgColor, setButtonBgColor],
                            ["Hover Color", buttonHoverColor, setButtonHoverColor],
                            ["Text Color", buttonFontColor, setButtonFontColor],
                          ].map(([label, value, setter]) => (
                            <label key={label} className="text-xs text-gray-700">
                              {label}
                              <input
                                type="color"
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                disabled={startButtonHidden}
                                className="block mt-1 w-10 h-8 rounded disabled:opacity-40"
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Live Preview */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Live Preview</div>
                        <div
                          className="relative mt-3 h-[260px] rounded-md overflow-hidden border flex flex-col items-center justify-center text-center"
                          style={{
                            backgroundColor: bgColor,
                            '--btn-bg': buttonBgColor,
                            '--btn-hover': buttonHoverColor,
                            '--btn-font': `'${buttonFont}', ${FALLBACK_STACK}`,
                            '--btn-color': buttonFontColor,
                          }}
                        >
                          {backgroundType === "camera" ? (
                            <div className="absolute inset-0">
                              <video
                                ref={(el) => {
                                  if (!el) return;
                                  if (el.srcObject) return;
                                  (async () => {
                                    try {
                                      const constraints = selectedCameraId
                                        ? { video: { deviceId: { exact: selectedCameraId } }, audio: false }
                                        : { video: true, audio: false };
                                      const stream = await navigator.mediaDevices.getUserMedia(constraints);
                                      if (el) el.srcObject = stream;
                                    } catch (e) { console.warn("Preview camera failed:", e?.message); }
                                  })();
                                }}
                                autoPlay muted playsInline
                                className="w-full h-full object-cover -scale-x-100"
                              />
                              <div className="absolute inset-0 bg-black/30" />
                            </div>
                          ) : backgroundMediaPath ? (
                            <div className="absolute inset-0">
                              {(() => {
                                const src = backgroundMediaPath.previewUrl ?? backgroundMediaPath.url;
                                const name = backgroundMediaPath.name?.toLowerCase() ?? '';
                                const mime = backgroundMediaPath.mime ?? '';
                                const isImageMime = mime.startsWith('image/');
                                const isImageExt = /\.(gif|jpe?g|png|webp|bmp|tiff?)$/.test(name);
                                const isSvg = mime === 'image/svg+xml' || name.endsWith('.svg');
                                const isImage = (isImageMime || isImageExt) && !isSvg;

                                return isImage ? (
                                  <img
                                    src={src}
                                    className="w-full h-full object-cover"
                                    alt=""
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <video
                                    src={src}
                                    className="w-full h-full object-cover"
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                  />
                                );
                              })()}
                            </div>
                          ) : null}

                          <div className="relative z-10 flex flex-col items-center gap-1">
                            {logoPath ? (
                              <img
                                src={logoPath.previewUrl ?? logoPath.url}
                                className="object-contain"
                                style={{ height: `${Math.round(80 * logoSize / 100)}px`, maxWidth: '100%' }}
                                alt="Logo"
                              />
                            ) : (
                              <>
                                <div
                                  className="text-xl font-semibold"
                                  style={{
                                    color: headerFontColor,
                                    fontFamily: `'${headerFont}', ${FALLBACK_STACK}`,
                                  }}
                                >
                                  {boothName}
                                </div>
                                <div
                                  className="text-sm"
                                  style={{
                                    color: generalFontColor,
                                    fontFamily: `'${generalFont}', ${FALLBACK_STACK}`,
                                  }}
                                >
                                  {boothSlogan}
                                </div>
                              </>
                            )}
                            {!startButtonHidden && (
                              <button
                                className="mt-4 px-8 py-3 text-base font-semibold rounded-full shadow-md transition-colors bg-[var(--btn-bg)] hover:bg-[var(--btn-hover)] text-[var(--btn-color)]"
                                style={{ fontFamily: 'var(--btn-font)' }}
                              >
                                {startButtonText || "Tap to Start"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}


                  {/* ==== TEMPLATES — FULL EDITOR (unchanged behavior, reflowed into shell) ==== */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "templates" && (
                    <div className={cardClass}>
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Templates</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={reloadLibrary}
                            disabled={libraryReloading}
                            title="Reload templates and frames"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition disabled:opacity-40"
                          >
                            <svg className={`w-3.5 h-3.5 ${libraryReloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setEditingTemplate(null);
                              setTemplateName("");
                              setTemplateSlotsState([]);
                              setThumbnailUploadPreview(null);
                              setTemplateError("");
                              setSelectionIds([]);
                              setTemplateLayout("4x6"); // default
                              setTemplatePrintMode("single"); // default
                              setIsTemplateModalOpen(true);
                            }}
                            className={BTN_PRIMARY}
                          >
                            New Template
                          </button>
                        </div>
                      </div>

                      {/* Applied / Library filter — the template library is shared by
                          every event, so without this a brand-new event with nothing
                          applied still listed the whole library. */}
                      {(() => {
                        const appliedCount = currentEvent?.appliedTemplates?.length ?? 0;
                        return (
                          <div className="mt-3 flex items-center gap-1.5">
                            {[
                              { key: "applied", label: `Applied to this event · ${appliedCount}` },
                              { key: "all", label: `Library · ${templates.length}` },
                              { key: "samples", label: "Samples" },
                            ].map((opt) => (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => setTemplateViewMode(opt.key)}
                                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${templateViewMode === opt.key
                                  ? "bg-blue-600 text-white"
                                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                  }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}

                      {/* Empty state when nothing is applied yet */}
                      {hydrated && templateViewMode === "applied" &&
                        (currentEvent?.appliedTemplates?.length ?? 0) === 0 && (
                          <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-8 text-center">
                            <div className="text-sm font-medium text-gray-600">
                              No templates applied to {currentEvent.name || "this event"} yet
                            </div>
                            <p className="mt-1 text-xs text-gray-400">
                              Switch to Library to apply one, or create a new template.
                            </p>
                            <button
                              type="button"
                              onClick={() => setTemplateViewMode("all")}
                              className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                            >
                              Browse library
                            </button>
                          </div>
                        )}

                      {/* Built-in sample layouts, folded in from what used to be
                          its own Samples tab. */}
                      {templateViewMode === "samples" && (
                        <div className="mt-4">{renderSampleTemplates()}</div>
                      )}

                      {/* Template List */}
                      {templateViewMode !== "samples" && (
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {!hydrated ? Array.from({ length: 6 }).map((_, index) => (
                          <div key={`template-skeleton-${index}`} className="animate-pulse bg-slate-100 rounded-lg h-20 w-full" />
                        )) : templates.filter((tpl) => (
                          templateViewMode === "all" ||
                          (currentEvent?.appliedTemplates?.some((at) => at.id === tpl.id) ?? false)
                        )).map((tpl) => {
                          const layout = tpl.previewMeta?.layout ?? "4x6";
                          const aspectMap = {
                            "4x6": "aspect-[4/6]",
                            "2x6": "aspect-[2/6]",
                            "6x4": "aspect-[6/4]",
                            "6x2": "aspect-[6/2]",
                          };
                          const aspectClass = aspectMap[layout] ?? aspectMap["4x6"];
                          const thumbSrc =
                            tpl.previewMeta?.thumbnailDataUrl ?? tpl.previewMeta?.thumbnailPath;
                          const isTall = layout === "4x6" || layout === "2x6";
                          const alreadyApplied =
                            currentEvent?.appliedTemplates?.some((t) => t.id === tpl.id) ?? false;

                          return (
                            <div
                              key={tpl.id}
                              className="p-4 rounded-lg border border-slate-200 bg-white flex flex-col gap-3"
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium truncate">{tpl.name}</div>
                                  {tpl.isDefault && (
                                    <span className="flex-shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Default</span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex items-center flex-wrap gap-1 text-xs text-gray-500">
                                  <span>{getTemplateSlotCount(tpl)} slots</span>
                                  {tpl.previewMeta?.layout && (
                                    <span className="text-slate-400">· {tpl.previewMeta.layout.replace("x", "×")}</span>
                                  )}
                                  {(tpl.previewMeta?.layout === "4x6" || tpl.previewMeta?.layout === "6x4") && (
                                    tpl.previewMeta?.printMode === "dual"
                                      ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">2-Strip</span>
                                      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Single</span>
                                  )}
                                  {(tpl.previewMeta?.layout === "2x6" || tpl.previewMeta?.layout === "6x2") && (
                                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">Strip</span>
                                  )}
                                </div>
                              </div>

                              {thumbSrc ? (
                                <div className={`${isTall ? "" : "h-56"}`}>
                                  <div
                                    className={`flex justify-center ${aspectClass} ${isTall ? "h-56" : "w-56"
                                      } mx-auto border overflow-hidden`}
                                  >
                                    {/* Let the container control aspect; image fills without distortion */}
                                    <img
                                      src={thumbSrc}
                                      alt={`${tpl.name} thumbnail`}
                                      className="w-full h-full object-contain"
                                      loading="lazy"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className={`${aspectClass} ${isTall ? "h-56" : "w-56"
                                    } mx-auto flex items-center justify-center text-xs text-gray-400 border rounded-md`}
                                >
                                  No preview
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-2 pt-2">
                                <button
                                  onClick={() => {
                                    setEditingTemplate(tpl);
                                    setTemplateName(tpl.name);
                                    setTemplateLayout(tpl.previewMeta?.layout ?? "4x6");
                                    setTemplatePrintMode(tpl.previewMeta?.printMode ?? "single");

                                    const slots = (tpl.previewMeta?.slots ?? []).map((s) => ({
                                      ...JSON.parse(JSON.stringify(s)),
                                      rotation: s.rotation ?? 0,
                                    }));
                                    setTemplateSlotsState(ensureSlotNumbers(slots));

                                    setThumbnailUploadPreview(
                                      tpl.previewMeta?.thumbnailDataUrl ??
                                      tpl.previewMeta?.thumbnailPath ??
                                      null
                                    );

                                    setTemplateError("");
                                    setSelectionIds([]);
                                    setIsTemplateModalOpen(true);
                                  }}
                                  className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Edit
                                </button>

                                <button
                                  onClick={() =>
                                    setDeleteTarget({ type: "template", id: tpl.id, name: tpl.name })
                                  }
                                  className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Delete
                                </button>

                                <label className="ml-auto text-xs inline-flex items-center gap-2 text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={alreadyApplied}
                                    onChange={(e) => {
                                      const evCopy = JSON.parse(JSON.stringify(currentEvent));
                                      evCopy.appliedTemplates = evCopy.appliedTemplates ?? [];

                                      if (alreadyApplied) {
                                        // Remove the template
                                        evCopy.appliedTemplates = evCopy.appliedTemplates.filter(
                                          (t) => t.id !== tpl.id
                                        );
                                        showToast(`Removed "${tpl.name}" from ${evCopy.name}`);
                                      } else {
                                        // Add the template
                                        evCopy.appliedTemplates.push({
                                          id: tpl.id,
                                          name: tpl.name,
                                          previewMeta: tpl.previewMeta ?? null,
                                        });
                                        showToast(`Applied "${tpl.name}" to ${evCopy.name}`);
                                      }

                                      const updatedEvents = events.map((e) =>
                                        e.id === evCopy.id ? evCopy : e
                                      );

                                      setEvents(updatedEvents);
                                      setCurrentEvent(evCopy);
                                      native?.setEvents?.(updatedEvents, ctx).catch(() => { });
                                    }}
                                  />
                                  {alreadyApplied ? "Applied" : "Apply to event"}
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      )}

                      {/* Empty state — only shown when hydrated but nothing loaded */}
                      {hydrated && templates.length === 0 && (
                        <div className="mt-4 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                          <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                          </svg>
                          <div className="text-sm font-medium text-slate-500">No templates loaded</div>
                          <button
                            onClick={reloadLibrary}
                            disabled={libraryReloading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-40"
                          >
                            <svg className={`w-3 h-3 ${libraryReloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {libraryReloading ? "Reloading…" : "Reload templates"}
                          </button>
                        </div>
                      )}

                      {/* ================= MODAL ================= */}
                      {(() => {
                        // Compute editing template props once for the modal (multi-frame)
                        const layout = editingTemplate?.previewMeta?.layout ?? templateLayout;
                        const initialAttachedFrameIds = Array.isArray(editingTemplate?.previewMeta?.attachedFrameIds)
                          ? editingTemplate.previewMeta.attachedFrameIds
                          : [];
                        const initialActiveFrameId = editingTemplate?.previewMeta?.activeFrameId ?? null;
                        const lookupOverlay = (id) =>
                          frames.find(f => f.id === id)?.previews?.[layout]?.originalDataUrl ?? null;
                        const backgroundFromAttached =
                          (initialActiveFrameId && lookupOverlay(initialActiveFrameId)) ||
                          (initialAttachedFrameIds.length && lookupOverlay(initialAttachedFrameIds[0])) ||
                          null;
                        return (
                          <div className="relative z-[60]">
                            <TemplateEditor
                              open={isTemplateModalOpen}
                              onClose={() => {
                                setIsTemplateModalOpen(false);
                                setEditingTemplate(null);
                              }}
                              accentColor={ACCENT_COLOR}
                              editing={!!editingTemplate}
                              initialName={editingTemplate?.name ?? ""}
                              initialSlots={editingTemplate?.previewMeta?.slots ?? []}
                              initialThumb={
                                editingTemplate?.previewMeta?.thumbnailDataUrl ??
                                editingTemplate?.previewMeta?.thumbnailPath ??
                                null
                              }
                              initialLayout={layout}
                              onLayoutChange={(next) => setTemplateLayout(next)}
                              initialPrintMode={editingTemplate?.previewMeta?.printMode ?? templatePrintMode}
                              onPrintModeChange={(next) => setTemplatePrintMode(next)}
                              frames={frames}
                              initialAttachedFrameIds={initialAttachedFrameIds}
                              initialActiveFrameId={initialActiveFrameId}
                              backgroundUrl={backgroundFromAttached}
                              currentEventName={currentEvent?.name || null}
                              onSave={handleSaveTemplatePayload}
                            />
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Frames */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "frames" && (
                    <div className={cardClass}>
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Frames</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={reloadLibrary}
                            disabled={libraryReloading}
                            title="Reload templates and frames"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition disabled:opacity-40"
                          >
                            <svg className={`w-3.5 h-3.5 ${libraryReloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setIsCreateFrameOpen(true);
                              setCreateFrameName("");
                              setCreateDraft({ file: null, dataUrl: null, w: 0, h: 0, layout: "4x6", error: "" });
                            }}
                            className={BTN_PRIMARY}
                          >
                            Upload Frame
                          </button>
                        </div>
                      </div>

                      {/* Applied / Library filter — the frame library is shared by every
                          event, same as templates. */}
                      {(() => {
                        const appliedCount = currentEvent?.appliedFrames?.length ?? 0;
                        return (
                          <div className="mt-3 flex items-center gap-1.5">
                            {[
                              { key: "applied", label: `Applied to this event · ${appliedCount}` },
                              { key: "all", label: `Library · ${frames.length}` },
                            ].map((opt) => (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => setFrameViewMode(opt.key)}
                                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${frameViewMode === opt.key
                                  ? "bg-blue-600 text-white"
                                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                  }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}

                      {hydrated && frameViewMode === "applied" &&
                        (currentEvent?.appliedFrames?.length ?? 0) === 0 && (
                          <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-8 text-center">
                            <div className="text-sm font-medium text-gray-600">
                              No frames applied to {currentEvent.name || "this event"} yet
                            </div>
                            <p className="mt-1 text-xs text-gray-400">
                              Switch to Library to apply one, or upload a new frame.
                            </p>
                            <button
                              type="button"
                              onClick={() => setFrameViewMode("all")}
                              className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                            >
                              Browse library
                            </button>
                          </div>
                        )}

                      <div className="mt-4 grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-2">
                        {!hydrated ? Array.from({ length: 8 }).map((_, index) => (
                          <div key={`frame-skeleton-${index}`} className="animate-pulse bg-slate-100 rounded-lg h-20 w-full" />
                        )) : frames.filter((frame) => (
                          frameViewMode === "all" ||
                          (currentEvent?.appliedFrames?.some((af) => af.id === frame.id) ?? false)
                        )).map((frame) => {
                          const applied = currentEvent.appliedFrames?.some((f) => f.id === frame.id);
                          const appliedEntry = (currentEvent.appliedFrames ?? []).find(f => f.id === frame.id);
                          const appliedBgColors = currentEvent.appliedBgColors ?? [];
                          const hasAnyEventBgColors = appliedBgColors.length > 0;
                          const appliedF2 = !!(appliedEntry?.useBgColor && (appliedEntry?.palette?.colors?.length ?? 0) > 0);

                          // Pick the first available layout for the thumbnail & aspect label
                          const order = ["4x6", "2x6", "6x4", "6x2"];
                          const firstKey = order.find(k => frame.previews?.[k]?.originalDataUrl) ?? null;
                          const aspectLabel = firstKey ?? "—";
                          const thumbSrc = firstKey ? frame.previews[firstKey].originalDataUrl : null;

                          return (
                            <div key={frame.id} className="p-4 rounded-lg border border-slate-200 bg-white flex flex-col gap-3">
                              {/* Title: "<aspect> - <frame name>" */}
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium truncate">{aspectLabel} - {frame.name}</div>
                                {frame.isDefault && (
                                  <span className="flex-shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Default</span>
                                )}
                              </div>

                              {/* Single thumbnail */}
                              {thumbSrc ? (
                                <img
                                  src={thumbSrc}
                                  className="w-[260px] h-[200px] mx-auto rounded bg-white object-contain border"
                                  alt={`${aspectLabel} overlay`}
                                />
                              ) : (
                                <div className="w-[260px] h-[200px] mx-auto rounded border bg-gray-50 flex items-center justify-center text-xs text-gray-500">
                                  No image
                                </div>
                              )}

                              {/* Actions: Delete + Apply + Use event BG colors */}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setDeleteTarget({ type: "frame", id: frame.id, name: frame.name })}
                                  className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Delete
                                </button>

                                <label className="text-xs inline-flex items-center gap-2 text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={appliedF2}
                                    onChange={() => {
                                      const evCopy = JSON.parse(JSON.stringify(currentEvent));
                                      evCopy.appliedFrames = Array.isArray(evCopy.appliedFrames) ? evCopy.appliedFrames : [];

                                      // gather all event BG hexes (may be empty)
                                      const allEventHexes = (currentEvent.appliedBgColors ?? [])
                                        .flatMap(c => c?.colors ?? [])
                                        .filter(Boolean);

                                      if (applied) {
                                        // Frame is already applied → just toggle useBgColor
                                        evCopy.appliedFrames = evCopy.appliedFrames.map(f => {
                                          if (f.id !== frame.id) return f;
                                          if (appliedF2) {
                                            // was ON → turn OFF
                                            return { ...f, useBgColor: false, palette: null, selectedColor: null };
                                          } else {
                                            // was OFF → turn ON (attach all event colors if any)
                                            return {
                                              ...f,
                                              useBgColor: true,
                                              palette: allEventHexes.length > 0
                                                ? { id: 'event-all-bg', name: 'Event BG Colors', colors: allEventHexes }
                                                : null,
                                              selectedColor: null,
                                            };
                                          }
                                        });

                                        const updatedEvents = events.map(e => (e.id === evCopy.id ? evCopy : e));
                                        setEvents(updatedEvents);
                                        setCurrentEvent(evCopy);
                                        native?.setEvents?.(updatedEvents, ctx).catch(() => { });
                                        showToast && showToast(appliedF2
                                          ? `Removed event BG colors from "${frame.name}"`
                                          : (allEventHexes.length
                                            ? `All event BG colors attached to "${frame.name}"`
                                            : `No BG colors are applied to the event yet.`)
                                        );
                                      } else {
                                        // Frame is NOT applied yet → apply it now and set useBgColor
                                        const newEntry = {
                                          id: frame.id,
                                          name: frame.name,
                                          useBgColor: true,
                                          palette: allEventHexes.length > 0
                                            ? { id: 'event-all-bg', name: 'Event BG Colors', colors: allEventHexes }
                                            : null,
                                          selectedColor: null,
                                        };
                                        evCopy.appliedFrames.push(newEntry);

                                        const updatedEvents = events.map(e => (e.id === evCopy.id ? evCopy : e));
                                        setEvents(updatedEvents);
                                        setCurrentEvent(evCopy);
                                        native?.setEvents?.(updatedEvents, ctx).catch(() => { });

                                        showToast && showToast(
                                          allEventHexes.length
                                            ? `Applied "${frame.name}" and attached all event BG colors`
                                            : `Applied "${frame.name}". (No event BG colors found to attach.)`
                                        );
                                      }
                                    }}
                                  />
                                  Use event BG colors
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Empty state — only shown when hydrated but nothing loaded */}
                      {hydrated && frames.length === 0 && (
                        <div className="mt-4 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                          <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <div className="text-sm font-medium text-slate-500">No frames loaded</div>
                          <button
                            onClick={reloadLibrary}
                            disabled={libraryReloading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-40"
                          >
                            <svg className={`w-3 h-3 ${libraryReloading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {libraryReloading ? "Reloading…" : "Reload frames"}
                          </button>
                        </div>
                      )}

                      {/* New Frame Modal */}
                      {isCreateFrameOpen && (
                        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
                          <div className={`${cardClass} p-6 w-full max-w-md`}>
                            <div className="text-base font-semibold text-slate-800 mb-4">Upload Frame</div>

                            <label className="text-xs text-gray-700 block mb-2">
                              Frame name
                              <input
                                type="text"
                                value={createFrameName}
                                onChange={(e) => setCreateFrameName(e.target.value)}
                                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                                placeholder="e.g., Gold Floral"
                              />
                            </label>

                            <label className="block text-xs text-gray-700">
                              Image file (PNG/JPG/WEBP)
                              <input
                                type="file"
                                accept="image/*"
                                className="mt-1 block w-full text-xs file:mr-3 file:py-1 file:px-2 file:rounded file:border file:bg-gray-100 file:text-gray-700"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const err = validateImage(file);
                                  if (err) { setCreateDraft(d => ({ ...d, file: null, dataUrl: null, error: err })); return; }
                                  try {
                                    const { dataUrl, w, h } = await readImageWH(file);
                                    const suggested = suggestLayoutFromWH(w, h);
                                    setCreateDraft({ file, dataUrl, w, h, layout: suggested, error: "" });
                                  } catch {
                                    setCreateDraft(d => ({ ...d, file: null, dataUrl: null, error: "Failed to read image." }));
                                  }
                                }}
                              />
                            </label>

                            {createDraft.dataUrl && (
                              <div className="mt-3">
                                <div className="text-xs text-gray-600">Detected size: {createDraft.w}×{createDraft.h}</div>
                                <div className="mt-2">
                                  <img src={createDraft.dataUrl} alt="overlay preview" className="w-full max-h-56 object-contain border rounded" />
                                </div>

                                <label className="block mt-3 text-xs text-gray-700">
                                  Layout
                                  <select
                                    value={createDraft.layout}
                                    onChange={(e) => setCreateDraft(d => ({ ...d, layout: e.target.value }))}
                                    className={`${SURFACE_BG} ${SURFACE_BORDER} ${INPUT_RADIUS} px-3 py-2 mt-1 w-full`}
                                  >
                                    <option value="4x6">4×6 (portrait)</option>
                                    <option value="2x6">2×6 (portrait strip)</option>
                                    <option value="6x4">6×4 (landscape)</option>
                                    <option value="6x2">6×2 (landscape strip)</option>
                                  </select>
                                </label>
                              </div>
                            )}

                            {createDraft.error && (
                              <div className="mt-3 text-xs text-red-600">{createDraft.error}</div>
                            )}

                            <div className="flex justify-end gap-2 mt-4">
                              <button
                                onClick={() => {
                                  setIsCreateFrameOpen(false);
                                  setCreateFrameName("");
                                  setCreateDraft({ file: null, dataUrl: null, w: 0, h: 0, layout: "4x6", error: "" });
                                }}
                                className={BTN_GHOST}
                              >
                                Cancel
                              </button>
                              <button
                                disabled={!createFrameName.trim() || !createDraft.file}
                                onClick={async () => {
                                  await handleCreateFrameWithUpload({
                                    name: createFrameName,
                                    file: createDraft.file,
                                    layout: createDraft.layout,
                                  });
                                  setIsCreateFrameOpen(false);
                                  setCreateFrameName("");
                                  setCreateDraft({ file: null, dataUrl: null, w: 0, h: 0, layout: "4x6", error: "" });
                                }}
                                className={BTN_PRIMARY}
                              >
                                Create
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sample Layouts */}

                  {/* Tones */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "tones" && (
                    <div className={cardClass}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Tones</div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                        {allTones.map((tone) => {
                          const applied = currentEvent.appliedTones?.some((t) => t.id === tone.id);
                          const effectId = mapToneToEffectId(tone);
                          const filterCss = TONE_FILTER_CSS[effectId] ?? previewMetaToFilter(tone.previewMeta);

                          const toggleTone = () => {
                            const evCopy = JSON.parse(JSON.stringify(currentEvent));
                            evCopy.appliedTones = evCopy.appliedTones ?? [];
                            if (applied) {
                              evCopy.appliedTones = evCopy.appliedTones.filter((t) => t.id !== tone.id);
                              showToast(`Removed "${tone.name}" from ${evCopy.name}`);
                            } else {
                              evCopy.appliedTones.push({ id: tone.id, name: tone.name, effectId });
                              showToast(`Applied "${tone.name}" to ${evCopy.name}`);
                            }
                            const updatedEvents = events.map((e) => e.id === evCopy.id ? evCopy : e);
                            setEvents(updatedEvents);
                            setCurrentEvent(evCopy);
                            native?.setEvents?.(updatedEvents, ctx).catch(() => {});
                          };

                          return (
                            <button
                              key={tone.id}
                              onClick={toggleTone}
                              className={`relative rounded-xl overflow-hidden border-2 text-left transition-all active:scale-[0.97] ${
                                applied
                                  ? "border-indigo-500 shadow-md shadow-indigo-100"
                                  : "border-slate-200 hover:border-slate-300"
                              }`}
                            >
                              {/* 1:1 preview — sample photo with tone filter applied */}
                              <div className="w-full aspect-square overflow-hidden">
                                <img
                                  src={`${process.env.PUBLIC_URL}/tone-preview.jpg`}
                                  alt={tone.name}
                                  className="w-full h-full object-cover object-center"
                                  style={{ filter: filterCss }}
                                  draggable={false}
                                />
                              </div>
                              {/* Name + applied badge */}
                              <div className="px-3 py-2 bg-white flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-800 truncate">{tone.name}</span>
                                {applied && (
                                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                    On
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Background Color */}

                  {activeMain === "dashboard" && currentEvent && activeSub === "background color" && (
                    <div className={cardClass}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Background Colors</div>
                        <button
                          onClick={() => setIsNewBgColorOpen(true)}
                          className={BTN_PRIMARY}
                        >
                          Add Color
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
                        {allPalettes.map((p) => {
                          const colors = extractHexes(p);
                          if (!colors.length) return null;
                          const primary = colors[0];
                          const applied =
                            currentEvent.appliedBgColors?.some((c) => c.id === p.id) ?? false;
                          const isActiveForFrames = selectedBgColorId === p.id;

                          return (
                            <div key={p.id} className="p-4 rounded-lg border border-slate-200 bg-white flex flex-col gap-3">
                              <div>{paletteName(p)}</div>
                              {/* Swatch/Gradient */}
                              <div
                                className="w-full h-16 rounded border"
                                style={{
                                  background:
                                    colors.length > 1
                                      ? `linear-gradient(90deg, ${colors.join(", ")})`
                                      : primary,
                                }}
                                title={paletteName(p)}
                              />
                              <div className="text-xs text-gray-600 truncate">{colors.join(", ")}</div>

                              <div className="flex items-center gap-2 mt-2">
                                {/* Apply to event background */}
                                <label className="text-xs inline-flex items-center gap-2 text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={applied}
                                    onChange={() => {
                                      const evCopy = JSON.parse(JSON.stringify(currentEvent));
                                      evCopy.appliedBgColors = evCopy.appliedBgColors ?? [];

                                      if (applied) {
                                        evCopy.appliedBgColors = evCopy.appliedBgColors.filter(
                                          (c) => c.id !== p.id
                                        );
                                        showToast?.(`Removed background color from ${evCopy.name}`);
                                      } else {
                                        evCopy.appliedBgColors.push({
                                          id: p.id,
                                          name: paletteName(p),
                                          colors, // array
                                        });
                                        showToast?.(`Applied background color to ${evCopy.name}`);
                                      }

                                      const updatedEvents = events.map((e) =>
                                        e.id === evCopy.id ? evCopy : e
                                      );
                                      setEvents(updatedEvents);
                                      setCurrentEvent(evCopy);
                                      native?.setEvents?.(updatedEvents, ctx).catch(() => { });
                                    }}
                                  />
                                  {applied ? "Applied" : "Apply to event"}
                                </label>
                              </div>

                              {/* Delete color — hidden for built-in presets */}
                              <div className="flex items-center mt-2">
                                <button
                                  onClick={() =>
                                    setDeleteTarget({
                                      type: "bgColor",
                                      id: p.id,
                                      name: paletteName(p),
                                    })
                                  }
                                  disabled={p.id?.startsWith("preset-")}
                                  className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Add Color Modal */}
                      {isNewBgColorOpen && (
                        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
                          <div className={`${cardClass} p-6 w-full max-w-md`}>
                            <div className="text-base font-semibold text-slate-800 mb-4">Add Background Color</div>

                            <label className="text-xs text-gray-700 block mb-2">
                              Name (optional)
                              <input
                                type="text"
                                value={newBgName}
                                onChange={(e) => setNewBgName(e.target.value)}
                                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                                placeholder="e.g., Brand Blue"
                              />
                            </label>

                            <label className="text-xs text-gray-700 block">
                              Color
                              <div className="mt-2 flex items-center gap-3">
                                <input
                                  type="color"
                                  value={newBgHex}
                                  onChange={(e) => setNewBgHex(e.target.value)}
                                  className="w-14 h-10 rounded"
                                />
                                <input
                                  type="text"
                                  value={newBgHex}
                                  onChange={(e) => setNewBgHex(e.target.value)}
                                  className="border rounded px-2 py-1 text-sm w-28"
                                  placeholder="#000000"
                                />
                              </div>
                            </label>

                            <div className="flex justify-end gap-2 mt-4">
                              <button
                                onClick={() => {
                                  setIsNewBgColorOpen(false);
                                  setNewBgHex("#ffffff");
                                  setNewBgName("");
                                }}
                                className={BTN_GHOST}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  const entry = {
                                    id: makeId(),
                                    name: newBgName?.trim() || newBgHex.toUpperCase(),
                                    colors: [newBgHex], // single color palette
                                  };
                                  const next = [entry, ...(palettes ?? [])];
                                  setPalettes(next);
                                  native?.setPalettes?.(next, ctx).catch(() => { });
                                  setIsNewBgColorOpen(false);
                                  setNewBgHex("#ffffff");
                                  setNewBgName("");
                                  showToast?.("Background color added");
                                }}
                                className={BTN_PRIMARY}
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SETTINGS & ANALYTICS (unchanged behavior; minor visual polish) */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "controls" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Mode */}
                      <div className={cardClass}>
                        <div className="text-sm font-semibold text-slate-800">Mode</div>
                        <div className="mt-3 flex items-center gap-4">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="rental"
                              checked={appMode === "rental"}
                              onChange={() => setAppMode("rental")}
                            />
                            Rental (skip payment)
                          </label>
                          <label className={`inline-flex items-center gap-2 text-sm ${anyProviderConfigured ? "" : "opacity-50 cursor-not-allowed"}`}>
                            <input
                              type="radio"
                              name="business"
                              checked={appMode === "business"}
                              onChange={() => setAppMode("business")}
                              disabled={!anyProviderConfigured}
                            />
                            Business (payment available)
                            {!anyProviderConfigured && (
                              <span className="text-[10px] text-amber-700 ml-1">Set up a payment provider in Account → Business</span>
                            )}
                            {anyProviderConfigured && activeProviderIsTest && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ml-1">Test Mode</span>
                            )}
                          </label>
                        </div>

                        {/* Guest consent */}
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4">Guest Flow</div>
                        <div className="mt-1">
                          <SettingRow
                            label="Show consent screen before each session"
                            description="When off, guests go straight from welcome to template selection. Turn off only for private or pre-consented events."
                          >
                            <SettingToggle label="Show consent screen" checked={consentEnabled} onChange={setConsentEnabled} />
                          </SettingRow>
                        </div>

                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4">Photo Storage</div>
                        <div className="mt-1">
                          <SettingRow
                            label="Let guests choose where to save their photos"
                            description="Adds a choice screen after composition: studio gallery, your own storage, or print only."
                          >
                            <SettingToggle label="Let guests choose storage" checked={storageChoiceEnabled} onChange={setStorageChoiceEnabled} />
                          </SettingRow>

                          {storageChoiceEnabled && (
                            <div className="ml-5 border-l border-slate-100 dark:border-slate-700 pl-4">
                              <SettingRow
                                label="Hide QR gallery option from guests"
                                description="Removes the studio QR gallery from the choice screen."
                              >
                                <SettingToggle label="Hide QR gallery option" checked={galleryOptionDisabled} onChange={setGalleryOptionDisabled} />
                              </SettingRow>
                            </div>
                          )}
                        </div>
                        {/* Quick Connect: Google Drive & Dropbox */}
                        <div className="mt-4">
                          <div className="text-xs font-semibold text-slate-700 mb-2">Quick Connect</div>
                          <div className="flex flex-col gap-2">

                            {/* Google Drive */}
                            {cloudGoogleStatus.connected ? (
                              <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <svg viewBox="0 0 87.3 78" className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-green-800">Google Drive connected</div>
                                    <div className="text-[11px] text-green-700 truncate">{cloudGoogleStatus.email}</div>
                                  </div>
                                </div>
                                <button
                                  onClick={async () => {
                                    await native?.cloudGoogleDrive?.disconnect?.();
                                    setCloudGoogleStatus({ connected: false, email: null, loading: false });
                                  }}
                                  className="shrink-0 text-[11px] text-red-500 hover:text-red-700 font-medium ml-2"
                                >Disconnect</button>
                              </div>
                            ) : (
                              <button
                                disabled={cloudGoogleStatus.loading}
                                onClick={async () => {
                                  setCloudGoogleStatus((p) => ({ ...p, loading: true }));
                                  const res = await native?.cloudGoogleDrive?.connect?.();
                                  if (res?.ok) setCloudGoogleStatus({ connected: true, email: res.email, loading: false });
                                  else { alert(res?.error || "Google Drive connection failed."); setCloudGoogleStatus((p) => ({ ...p, loading: false })); }
                                }}
                                className="flex items-center gap-2.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                              >
                                <svg viewBox="0 0 87.3 78" className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
                                {cloudGoogleStatus.loading ? "Connecting…" : "Connect Google Drive"}
                              </button>
                            )}

                            {/* Dropbox */}
                            {cloudDropboxStatus.connected ? (
                              <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <svg viewBox="0 0 40 36" className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg"><path d="M10 0L0 6.5l10 6.5 10-6.5zM30 0L20 6.5l10 6.5 10-6.5zM0 19.5L10 26l10-6.5L10 13zM30 13l-10 6.5L30 26l10-6.5zM10 28.3L20 34.8l10-6.5-10-6.5z" fill="#0061FE"/></svg>
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-blue-800">Dropbox connected</div>
                                    <div className="text-[11px] text-blue-700 truncate">{cloudDropboxStatus.email}</div>
                                  </div>
                                </div>
                                <button
                                  onClick={async () => {
                                    await native?.cloudDropbox?.disconnect?.();
                                    setCloudDropboxStatus({ connected: false, email: null, loading: false });
                                  }}
                                  className="shrink-0 text-[11px] text-red-500 hover:text-red-700 font-medium ml-2"
                                >Disconnect</button>
                              </div>
                            ) : (
                              <button
                                disabled={cloudDropboxStatus.loading}
                                onClick={async () => {
                                  setCloudDropboxStatus((p) => ({ ...p, loading: true }));
                                  const res = await native?.cloudDropbox?.connect?.();
                                  if (res?.ok) setCloudDropboxStatus({ connected: true, email: res.email, loading: false });
                                  else { alert(res?.error || "Dropbox connection failed."); setCloudDropboxStatus((p) => ({ ...p, loading: false })); }
                                }}
                                className="flex items-center gap-2.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                              >
                                <svg viewBox="0 0 40 36" className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg"><path d="M10 0L0 6.5l10 6.5 10-6.5zM30 0L20 6.5l10 6.5 10-6.5zM0 19.5L10 26l10-6.5L10 13zM30 13l-10 6.5L30 26l10-6.5zM10 28.3L20 34.8l10-6.5-10-6.5z" fill="#0061FE"/></svg>
                                {cloudDropboxStatus.loading ? "Connecting…" : "Connect Dropbox"}
                              </button>
                            )}
                          </div>
                          {(cloudGoogleStatus.connected || cloudDropboxStatus.connected) && (
                            <p className="mt-2 text-[11px] text-slate-500">Photos save to <strong>Photuna Photos / {`<event name>`}</strong> in your connected account after each session.</p>
                          )}
                        </div>

                        <div className="mt-4 border-t border-slate-100 pt-4">
                          <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={operatorStorageEnabled}
                              onChange={(e) => setOperatorStorageEnabled(e.target.checked)}
                            />
                            Send via webhook (advanced)
                          </label>
                          <p className="mt-1 text-xs text-gray-500">
                            For custom servers, Make, or Zapier — photos sent via multipart POST.
                          </p>
                        </div>
                        {operatorStorageEnabled && (
                          <div className="mt-3 grid grid-cols-1 gap-3">
                            <label className="text-xs text-gray-700">
                              Label shown to guests
                              <input
                                type="text"
                                value={operatorStorageLabel}
                                onChange={(e) => setOperatorStorageLabel(e.target.value)}
                                placeholder="Our Gallery"
                                maxLength={60}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1`}
                              />
                            </label>
                            <label className="text-xs text-gray-700">
                              Webhook URL (HTTPS)
                              <input
                                type="url"
                                value={operatorStorageUrl}
                                onChange={(e) => setOperatorStorageUrl(e.target.value)}
                                placeholder="https://your-server.com/photobooth-upload"
                                className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1`}
                              />
                            </label>
                            <label className="text-xs text-gray-700">
                              API Key / Bearer token (optional)
                              <input
                                type="password"
                                value={operatorStorageApiKey}
                                onChange={(e) => setOperatorStorageApiKey(e.target.value)}
                                placeholder="sk-..."
                                className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1`}
                              />
                              <span className="text-[10px] text-gray-400">Sent as Authorization: Bearer &lt;key&gt;</span>
                            </label>
                          </div>
                        )}

                        {/* Session settings */}
                        <div className="text-sm font-semibold text-slate-800 mt-4">Session Settings</div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <label className="text-xs text-gray-700">
                            Countdown (s)
                            <input
                              type="number"
                              value={countdown}
                              onChange={(e) => setCountdown(Number(e.target.value))}
                              className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                            />
                          </label>
                          <label className="text-xs text-gray-700">
                            Shots per session
                            <input
                              type="number"
                              value={numberOfShots}
                              onChange={(e) => setNumberOfShots(Number(e.target.value))}
                              className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                            />
                          </label>
                        </div>
                        <div className="mt-3">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={timersEnabled}
                              onChange={(e) => setTimersEnabled(e.target.checked)}
                            />
                            Enable custom screen timers
                          </label>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() => {
                                setScreenTimers({ ...screenTimers });
                                setTimersEnabled(true);
                                showToast("Using current timers for this event");
                              }}
                              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                            >
                              Use timers
                            </button>
                            <button
                              onClick={() => {
                                setScreenTimers({ ...DEFAULT_SCREEN_TIMERS });
                                setTimersEnabled(true);
                                showToast("Reset to default timers");
                              }}
                              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                          {Object.keys(screenTimers).map((k) => (
                            <label key={k} className="text-xs text-gray-700">
                              {k}
                              <input
                                type="number"
                                value={screenTimers[k]}
                                disabled={!timersEnabled}
                                onChange={(e) =>
                                  setScreenTimers((prev) => ({ ...prev, [k]: Number(e.target.value) }))
                                }
                                className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                              />
                            </label>
                          ))}
                        </div>
                        <p className="text-xs text-gray-600 mt-2">
                          When enabled, these timer values are saved into the current event; otherwise
                          global defaults apply.
                        </p>
                      </div>

                      {/* Rental options */}
                      {appMode === "rental" && (
                        <>
                          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 p-4">
                            <div className="text-sm font-semibold text-slate-800">Rental timer</div>
                            <div className="mt-2">
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={rentalTimerEnabled}
                                  onChange={(e) => setRentalTimerEnabled(e.target.checked)}
                                />
                                Enable auto-close timer
                              </label>
                              <div className="mt-2">
                                <input
                                  type="number"
                                  value={rentalTimerHours}
                                  onChange={(e) => setRentalTimerHours(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-24 ${INPUT_RADIUS} px-2 py-2 text-sm outline-none`}
                                  disabled={!rentalTimerEnabled}
                                />{" "}
                                hours
                              </div>
                              <p className="text-xs text-gray-600 mt-2">
                                App will auto-close after the specified hours from start.
                              </p>
                            </div>

                            <div className="text-sm font-semibold text-slate-800 mt-4">Session usage limit</div>
                            <div className="mt-2">
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={rentalSessionLimitEnabled}
                                  onChange={(e) => setRentalSessionLimitEnabled(e.target.checked)}
                                />
                                Limit total sessions
                              </label>
                              <div className="mt-2">
                                <input
                                  type="number"
                                  value={rentalSessionLimit}
                                  onChange={(e) => setRentalSessionLimit(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-24 ${INPUT_RADIUS} px-2 py-2 text-sm outline-none`}
                                  disabled={!rentalSessionLimitEnabled}
                                />{" "}
                                sessions
                              </div>
                              <p className="text-xs text-gray-600 mt-2">
                                Photobooth will stop accepting sessions after this count.
                              </p>
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-200">
                              <div className="text-sm font-semibold text-slate-800">Offline &amp; saving</div>
                              {!storagePath && (
                                <p className="mt-1 text-xs text-amber-600">
                                  A storage path must be configured in Settings → Storage before offline mode can be enabled.
                                </p>
                              )}
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <label className={`inline-flex items-center gap-2 text-sm ${!storagePath ? "opacity-40 cursor-not-allowed" : ""}`}>
                                  <input
                                    type="checkbox"
                                    checked={offlineModeEnabled}
                                    disabled={!storagePath}
                                    onChange={(e) => setOfflineModeEnabled(e.target.checked)}
                                  />
                                  Offline mode
                                </label>
                                <label className={`text-xs text-gray-700 ${!offlineModeEnabled ? "opacity-40" : ""}`}>
                                  Auto-save target
                                  <select
                                    value={autoSaveTarget}
                                    disabled={!offlineModeEnabled}
                                    onChange={(e) => setAutoSaveTarget(e.target.value)}
                                    className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1`}
                                  >
                                    <option value="local">Local storage</option>
                                    <option value="usb">USB drive</option>
                                  </select>
                                </label>
                                <label className="inline-flex items-center gap-2 text-sm col-span-2">
                                  <input
                                    type="checkbox"
                                    checked={endSessionSummaryEnabled}
                                    onChange={(e) => setEndSessionSummaryEnabled(e.target.checked)}
                                  />
                                  Show end-of-session summary
                                </label>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Business options */}
                      {activeMain === "dashboard" && currentEvent && appMode === "business" && (
                        <>
                          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 p-4">
                            <div className="text-sm font-semibold text-slate-800">Payment</div>
                            <div className="mt-2">
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={paymentEnabled}
                                  onChange={(e) => setPaymentEnabled(e.target.checked)}
                                />
                                Enable payment
                              </label>
                              {/* Active gateway info */}
                              {!activeProvider ? (
                                <p className="mt-2 text-xs text-amber-600">
                                  {anyProviderConfigured
                                    ? "Provider connected but not selected as active — go to Account → Business and click your gateway card to activate it."
                                    : "No payment provider selected. Configure one in Account → Business."}
                                </p>
                              ) : (
                                <div className="mt-2 flex items-center gap-2">
                                  <span className="text-[11px] text-slate-500">Via:</span>
                                  <span className="text-[11px] font-semibold text-slate-700 capitalize">{activeProvider}</span>
                                  {activeProviderIsTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Test Mode</span>}
                                </div>
                              )}

                              {/* Cash */}
                              <div className="mt-3 border-t border-slate-100 pt-3">
                                <label className={`inline-flex items-center gap-2 text-sm ${!paymentEnabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                                  <input type="checkbox" checked={!!paymentProviders.cash} onChange={(e) => setPaymentProviders((prev) => ({ ...prev, cash: e.target.checked }))} disabled={!paymentEnabled} />
                                  Cash
                                </label>
                              </div>

                              {/* Cash mode sub-option */}
                              {paymentEnabled && paymentProviders.cash && (
                                <div className="mt-2 ml-1 border-l-2 border-slate-200 pl-3 space-y-2">
                                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Cash mode</p>
                                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input type="radio" name="cashMode" value="manual" checked={cashMode === "manual"} onChange={() => setCashMode("manual")} />
                                    <span>Manual — operator clicks confirm</span>
                                  </label>
                                  <label className={`flex items-center gap-2 text-xs ${!cashHardwareDetected ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                                    <input type="radio" name="cashMode" value="hardware" checked={cashMode === "hardware"} onChange={() => cashHardwareDetected && setCashMode("hardware")} disabled={!cashHardwareDetected} />
                                    <span>Hardware (bill / coin acceptor)</span>
                                    {cashHardwareDetected ? <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Detected</span> : <span className="ml-1 text-[10px] text-slate-400">not detected</span>}
                                  </label>
                                  {cashHardwareDetected && cashHardwareDevices.length > 0 && <p className="text-[10px] text-slate-500 italic">{cashHardwareDevices.join(", ")}</p>}
                                  <button type="button" disabled={cashHardwareDetecting} onClick={handleDetectCashHardware} className="text-[11px] text-blue-600 underline disabled:opacity-50">{cashHardwareDetecting ? "Scanning…" : "Scan for hardware"}</button>
                                </div>
                              )}
                            </div>


                            <div className="text-sm font-semibold text-slate-800 mt-4">Pricing</div>

                            {/* Pricing model fixed to per session; you can drop pricingModel altogether */}
                            <div className="mt-2 grid grid-cols-2 gap-3">
                              {/* Per session price */}
                              <label className="text-xs text-gray-700 col-span-2">
                                {currency} per session
                                <input
                                  type="number"
                                  value={pricePerSession}
                                  onChange={(e) => setPricePerSession(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                                  min={0}
                                  step="0.01"
                                  inputMode="decimal"
                                />
                              </label>

                              {/* Additional print price (new input) */}
                              <label className="text-xs text-gray-700 col-span-2">
                                {currency} additional print price
                                <input
                                  type="number"
                                  value={additionalPrintPrice}
                                  onChange={(e) => setAdditionalPrintPrice(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                                  min={0}
                                  step="0.01"
                                  inputMode="decimal"
                                />
                              </label>

                              {/* Apply tax */}
                              <label className="inline-flex items-center gap-2 text-sm col-span-1">
                                <input
                                  type="checkbox"
                                  checked={taxEnabled}
                                  onChange={(e) => setTaxEnabled(e.target.checked)}
                                />
                                Apply tax
                              </label>

                              {/* VAT/Tax */}
                              <label className="text-xs text-gray-700">
                                % VAT/Tax
                                <input
                                  type="number"
                                  value={taxRate}
                                  onChange={(e) => setTaxRate(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                                  disabled={!taxEnabled}
                                  min={0}
                                  step="0.01"
                                  inputMode="decimal"
                                />
                              </label>

                              {/* Retake limit */}
                              <label className="text-xs text-gray-700">
                                Retake limit
                                <input
                                  type="number"
                                  value={retakeLimit}
                                  onChange={(e) => setRetakeLimit(Number(e.target.value))}
                                  className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-2 py-2 text-sm outline-none mt-1`}
                                  min={0}
                                  step="1"
                                  inputMode="numeric"
                                />
                              </label>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Sharing & Delivery */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "sharing" && (
                    <div className="space-y-4">

                      {/* Sharing Methods */}
                      <div className={cardClass}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-800">Sharing Methods</div>
                            <div className="text-xs text-slate-500 mt-0.5">How guests receive their photos and videos after each session.</div>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">

                          {/* QR Code — powered by the online gallery (Plus & Business) */}
                          <div className={`flex items-start gap-3 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-3.5 transition ${galleryAddonEnabled ? "ring-1 ring-blue-200 border-blue-200" : ""}`}>
                            <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${galleryAddonEnabled ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"}`}>
                              <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 1v2h2V5H5zm-2 8a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4zm2 1v2h2v-2H5zm8-10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zm2 1v2h2V5h-2z" /></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-slate-800">QR Code</div>
                                {galleryAddonEnabled ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                                  </span>
                                ) : (
                                  <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-600">Plus &amp; Business</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                {galleryAddonEnabled
                                  ? "Guests scan a QR code on the final screen to view and download their photos and videos from their online gallery."
                                  : "Unlock QR sharing by upgrading to a Plus or Business gallery plan. The booth shows the gallery QR automatically once active."}
                              </div>
                              {!galleryAddonEnabled && (
                                <button
                                  type="button"
                                  // Was setAccountTab("gallery") — no such tab has
                                  // ever existed, so this landed on a blank page.
                                  onClick={() => setActiveMain("subscription")}
                                  className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-500"
                                >
                                  View gallery plans →
                                </button>
                              )}
                            </div>
                          </div>

                          {/* AirDrop — macOS only, planned */}
                          <div className={`flex items-start gap-3 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-3.5 opacity-80`}>
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                              <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" /></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-slate-600">AirDrop</div>
                                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Mac only</span>
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">AirDrop delivery is limited to macOS booths and isn't available yet. It's disabled for now.</div>
                            </div>
                            <label className="relative inline-flex items-center cursor-not-allowed" title="Mac only — coming soon">
                              <input type="checkbox" className="sr-only peer" checked={false} disabled readOnly />
                              <div className="w-9 h-5 bg-slate-200 rounded-full opacity-60 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4" />
                            </label>
                          </div>

                          {/* Email — planned, notify on release */}
                          <div className={`flex items-start gap-3 ${SURFACE_BG} ${SURFACE_BORDER} ${SMALL_CARD_RADIUS} p-3.5 opacity-80`}>
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                              <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-slate-600">Email</div>
                                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">Coming soon</span>
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">Email delivery isn't available yet. It's disabled for now — we'll notify you the moment it's enabled.</div>
                            </div>
                            <label className="relative inline-flex items-center cursor-not-allowed" title="Coming soon">
                              <input type="checkbox" className="sr-only peer" checked={false} disabled readOnly />
                              <div className="w-9 h-5 bg-slate-200 rounded-full opacity-60 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4" />
                            </label>
                          </div>

                        </div>
                        <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-500">
                          QR sharing is powered by your online gallery (included with Plus &amp; Business). AirDrop and Email are in development and will be enabled automatically when ready.
                        </div>
                      </div>

                      {/* Delivery Flow */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className={cardClass}>
                          <div className="text-sm font-semibold text-slate-800">Delivery Screen</div>
                          <div className="text-xs text-slate-500 mt-0.5">Configure the post-session delivery screen guests see.</div>
                          <div className="mt-4 space-y-3">
                            <label className="block text-xs text-gray-700">
                              Screen title
                              <input
                                type="text"
                                value={currentEvent?.sharing?.screenTitle ?? "Your photos are ready!"}
                                onChange={(e) => {
                                  const updated = { ...currentEvent, sharing: { ...(currentEvent.sharing || {}), screenTitle: e.target.value } };
                                  setCurrentEvent(updated);
                                }}
                                placeholder="Your photos are ready!"
                                className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Screen message
                              <textarea
                                value={currentEvent?.sharing?.screenMessage ?? "Scan the QR code or choose a delivery method below."}
                                onChange={(e) => {
                                  const updated = { ...currentEvent, sharing: { ...(currentEvent.sharing || {}), screenMessage: e.target.value } };
                                  setCurrentEvent(updated);
                                }}
                                placeholder="Scan the QR code or choose a delivery method below."
                                rows={2}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition resize-none`}
                              />
                            </label>
                            <label className="block text-xs text-gray-700">
                              Screen timeout (seconds)
                              <input
                                type="number"
                                min={5}
                                max={120}
                                value={currentEvent?.sharing?.screenTimeout ?? 30}
                                onChange={(e) => {
                                  const updated = { ...currentEvent, sharing: { ...(currentEvent.sharing || {}), screenTimeout: Number(e.target.value) } };
                                  setCurrentEvent(updated);
                                }}
                                className={`${SURFACE_BG} ${SURFACE_BORDER} w-full ${INPUT_RADIUS} px-3 py-2 text-sm outline-none mt-1 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition`}
                              />
                            </label>
                          </div>
                        </div>

                        <div className={cardClass}>
                          <div className="text-sm font-semibold text-slate-800">Guest Output</div>
                          <div className="text-xs text-slate-500 mt-0.5">Control what guests receive and output quality.</div>
                          <div className="mt-2">
                            <SettingRow label="Output format" description="JPEG keeps files small; PNG keeps every pixel.">
                              <SettingSegmented
                                label="Output format"
                                value={currentEvent?.sharing?.outputFormat ?? "jpg"}
                                onChange={(v) => setCurrentEvent({ ...currentEvent, sharing: { ...(currentEvent.sharing || {}), outputFormat: v } })}
                                options={[
                                  { value: "jpg", short: "JPEG", label: "JPEG (smaller file size)" },
                                  { value: "png", short: "PNG", label: "PNG (lossless quality)" },
                                ]}
                              />
                            </SettingRow>

                            <SettingRow label="Image quality" description="Lower quality delivers faster over patchy event wifi.">
                              <SettingSegmented
                                label="Image quality"
                                value={currentEvent?.sharing?.imageQuality ?? "high"}
                                onChange={(v) => setCurrentEvent({ ...currentEvent, sharing: { ...(currentEvent.sharing || {}), imageQuality: v } })}
                                options={[
                                  { value: "original", short: "Original", label: "Original (full resolution)" },
                                  { value: "high", short: "High", label: "High (optimized)" },
                                  { value: "medium", short: "Medium", label: "Medium (web-friendly)" },
                                ]}
                              />
                            </SettingRow>

                            <SettingRow label="Include video in delivery" description="Sends the motion clip alongside the photos.">
                              <SettingToggle label="Include video in delivery" checked={currentEvent?.sharing?.includeVideo ?? true} onChange={(v) => setCurrentEvent({ ...currentEvent, sharing: { ...(currentEvent.sharing || {}), includeVideo: v } })} />
                            </SettingRow>

                            <SettingRow label="Add watermark to shared photos" description="Applies to shared copies only, not to prints.">
                              <SettingToggle label="Add watermark" checked={currentEvent?.sharing?.watermark ?? false} onChange={(v) => setCurrentEvent({ ...currentEvent, sharing: { ...(currentEvent.sharing || {}), watermark: v } })} />
                            </SettingRow>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}

                  {/* Analytics */}
                  {activeMain === "dashboard" && currentEvent && activeSub === "analytics" && (
                    <div className="space-y-5">

                      {/* ── KPI Overview ── */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: "Today", count: evDayCount, revenue: evDayRevenue },
                          { label: "This Week", count: evWeekCount, revenue: evWeekRevenue },
                          { label: "This Month", count: evMonthCount, revenue: evMonthRevenue },
                          { label: "Year to Date", count: evYtdCount, revenue: evYtdRevenue },
                        ].map(({ label, count, revenue }) => (
                          <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                            <div className="text-xs font-medium text-gray-500 mb-2">{label}</div>
                            <div className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{count}</div>
                            <div className="text-[11px] text-gray-400 mt-0.5 mb-3">sessions</div>
                            <div className="h-px bg-slate-100 mb-3" />
                            <div className="text-base font-semibold text-blue-600 tabular-nums leading-none">{fmtAmt(revenue, evCurrency)}</div>
                            <div className="text-[11px] text-gray-400 mt-0.5">revenue</div>
                          </div>
                        ))}
                      </div>

                      {/* ── Row 3: Charts ── */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                        {/* Hourly — today */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800">Sessions / Hour</div>
                          <div className="text-xs text-gray-400 mb-3">Today</div>
                          <div className="h-24 flex items-end gap-px">
                            {evHourlyData.map((v, i) => (
                              <div
                                key={i}
                                className="flex-1 rounded-sm bg-blue-500/70 hover:bg-blue-600 transition-colors"
                                style={{ height: `${(v / evMaxHourly) * 100}%`, minHeight: v > 0 ? 3 : 1 }}
                                title={`${v} session${v !== 1 ? "s" : ""} at ${i}:00`}
                              />
                            ))}
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
                            <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                          </div>
                        </div>

                        {/* Daily — this week */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800">Sessions / Day</div>
                          <div className="text-xs text-gray-400 mb-3">This week</div>
                          <div className="h-24 flex items-end gap-1">
                            {evWeeklyData.map((v, i) => (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full flex flex-col justify-end" style={{ height: 72 }}>
                                  <div
                                    className={`w-full rounded-sm transition-colors ${i === _nowAn.getDay() ? "bg-blue-600" : "bg-blue-300/70"}`}
                                    style={{ height: `${(v / evMaxWeekly) * 100}%`, minHeight: v > 0 ? 3 : 1 }}
                                    title={`${EV_DAY_LABELS[i]}: ${v} session${v !== 1 ? "s" : ""}`}
                                  />
                                </div>
                                <div className={`text-[10px] ${i === _nowAn.getDay() ? "text-blue-600 font-semibold" : "text-gray-400"}`}>
                                  {EV_DAY_LABELS[i]}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Daily — last 30 days */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800">Sessions / Day</div>
                          <div className="text-xs text-gray-400 mb-3">Last 30 days</div>
                          <div className="h-24 flex items-end gap-px">
                            {evLast30Data.map((v, i) => (
                              <div
                                key={i}
                                className="flex-1 rounded-sm bg-emerald-500/70 hover:bg-emerald-600 transition-colors"
                                style={{ height: `${(v / evMax30) * 100}%`, minHeight: v > 0 ? 3 : 1 }}
                                title={`${29 - i} day${29 - i !== 1 ? "s" : ""} ago: ${v} session${v !== 1 ? "s" : ""}`}
                              />
                            ))}
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
                            <span>−30d</span><span>−15d</span><span>Today</span>
                          </div>
                        </div>
                      </div>

                      {/* ── Row 4: Performance + Template usage ── */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                        {/* All-time performance */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800 mb-3">All-Time Performance</div>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: "Total Sessions", value: evTotalCount },
                              { label: "Total Revenue", value: fmtAmt(evTotalRevenue, evCurrency) },
                              { label: "Total Photos Taken", value: evTotalPhotos },
                              { label: "Avg Rev / Session", value: fmtAmt(evAvgRevPerSession, evCurrency) },
                              { label: "Avg Photos / Session", value: evAvgPhotosPerSession },
                              { label: "Completion Rate", value: `${evCompletionRate}%` },
                            ].map(({ label, value }) => (
                              <div key={label} className={smallCardClass}>
                                <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
                                <div className="mt-1 text-lg font-bold text-gray-900 tabular-nums">{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Template usage */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800 mb-3">Top Templates Used</div>
                          {evTplEntries.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-xs gap-2">
                              <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                              </svg>
                              No template usage data yet
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              {evTplEntries.map(([name, count]) => (
                                <div key={name}>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-gray-700 font-medium truncate max-w-[75%]">{name}</span>
                                    <span className="text-gray-500 tabular-nums ml-2">{count}×</span>
                                  </div>
                                  <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all"
                                      style={{ width: `${(count / evMaxTpl) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Row 5: Session Quality ── */}
                      <div>
                        <div className={`${EYEBROW} mb-2`}>Session Quality</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: "Completed", value: evCompletedCount, sub: "sessions" },
                            { label: "Abandoned", value: evAbandonedCount, sub: "sessions" },
                            { label: "Completion Rate", value: `${evCompletionRate}%`, sub: "of all sessions" },
                            { label: "Avg Duration", value: evAvgDurationSec != null ? `${(evAvgDurationSec / 60).toFixed(1)} min` : "—", sub: "per session" },
                          ].map(({ label, value, sub }) => (
                            <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                              <div className="text-xs font-medium text-gray-500">{label}</div>
                              <div className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
                              <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── Row 6: Connectivity split ── */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800 mb-3">Online vs Offline</div>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: "Online Sessions", value: evOnlineCount, color: "text-emerald-600" },
                              { label: "Offline Sessions", value: evOfflineCount, color: "text-amber-600" },
                            ].map(({ label, value, color }) => (
                              <div key={label} className={smallCardClass}>
                                <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
                                <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
                              </div>
                            ))}
                          </div>
                          {evTotalCount > 0 && (
                            <div className="mt-3 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full transition-all"
                                style={{ width: `${Math.round((evOnlineCount / evTotalCount) * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>

                        {/* Tone/Filter usage */}
                        <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                          <div className="text-sm font-semibold text-gray-800 mb-3">Tone / Filter Usage</div>
                          {Object.keys(evToneUsage).length === 0 ? (
                            <div className="text-xs text-gray-400 flex items-center justify-center h-16">No tone data yet</div>
                          ) : (
                            <div className="space-y-2">
                              {Object.entries(evToneUsage).sort((a,b) => b[1]-a[1]).slice(0,5).map(([tone, count]) => {
                                const maxTone = Math.max(...Object.values(evToneUsage));
                                return (
                                  <div key={tone}>
                                    <div className="flex items-center justify-between text-xs mb-0.5">
                                      <span className="text-gray-700 capitalize font-medium">{tone}</span>
                                      <span className="text-gray-500 tabular-nums">{count}×</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(count/maxTone)*100}%` }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Row 7: Frame usage ── */}
                      <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                        <div className="text-sm font-semibold text-gray-800 mb-3">Frame Style Usage</div>
                        {Object.keys(evFrameUsage).length === 0 ? (
                          <div className="text-xs text-gray-400 flex items-center justify-center h-16">No frame data yet</div>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {Object.entries(evFrameUsage).sort((a,b) => b[1]-a[1]).map(([frame, count]) => (
                              <div key={frame} className={smallCardClass}>
                                <div className="text-[11px] text-gray-500 capitalize">{frame}</div>
                                <div className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{count}×</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* ── Row 8: Business revenue details (business mode only) ── */}
                      {!evIsRental && (
                        <div>
                          <div className={`${EYEBROW} mb-2`}>Revenue Details</div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[
                              { label: "Additional Prints", value: evTotalAdditionalPrints, sub: "total prints sold" },
                              { label: "Add-On Revenue", value: fmtAmt(evAdditionalPrintRevenue, evCurrency), sub: "from extra prints" },
                              { label: "Tax Collected", value: fmtAmt(evTotalTaxCollected, evCurrency), sub: "total tax" },
                              { label: "Avg Rev / Session", value: fmtAmt(evAvgRevPerSession, evCurrency), sub: "across all sessions" },
                            ].map(({ label, value, sub }) => (
                              <div key={label} className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                                <div className="text-xs font-medium text-gray-500">{label}</div>
                                <div className="mt-2 text-2xl font-bold text-blue-600 tabular-nums">{value}</div>
                                <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>
                              </div>
                            ))}
                          </div>

                          {/* Payment provider breakdown */}
                          {Object.keys(evProviderBreakdown).length > 0 && (
                            <div className={`mt-3 ${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} ${SHADOW_SOFT} p-4`}>
                              <div className="text-sm font-semibold text-gray-800 mb-3">Payment Provider Breakdown</div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {Object.entries(evProviderBreakdown).sort((a,b) => b[1]-a[1]).map(([provider, count]) => (
                                  <div key={provider} className={smallCardClass}>
                                    <div className="text-[11px] text-gray-500 capitalize">{provider}</div>
                                    <div className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{count} sessions</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* User Analytics Dashboard */}
                      <div className="mt-8 border-t pt-8">
                        <div className={`${EYEBROW} mb-4`}>Account Analytics</div>
                        <AnalyticsDashboard userId={identity.userId} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* QR Gallery modal */}
            {galleryQrModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">QR Gallery</div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">
                        {galleryQrModal.ev?.name || "Event"}
                      </div>
                    </div>
                    <button
                      onClick={() => setGalleryQrModal(null)}
                      className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Body */}
                  <div className="flex-1 overflow-y-auto px-5 py-5">
                    {galleryQrModal.loading && (
                      <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
                        <svg className="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        <span className="text-xs">Setting up gallery…</span>
                      </div>
                    )}

                    {!galleryQrModal.loading && galleryQrModal.error && (
                      <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">
                        {galleryQrModal.error}
                      </div>
                    )}

                    {!galleryQrModal.loading && galleryQrModal.eventQr && (
                      <div className="flex flex-col items-center gap-5">
                        {/* QR code */}
                        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                          <QRCodeSVG value={galleryQrModal.eventQr.qrUrl} size={160} />
                        </div>

                        {/* URL + actions */}
                        <div className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-3">
                          <div className="text-xs font-medium text-gray-800 break-all leading-relaxed text-center">
                            {galleryQrModal.eventQr.qrUrl}
                          </div>
                          {galleryQrModal.eventQr.expiresAt && (
                            <div className="text-[10px] text-gray-400 text-center">
                              Expires {new Date(galleryQrModal.eventQr.expiresAt).toLocaleDateString()}
                            </div>
                          )}
                          <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
                            <button
                              onClick={() => { navigator.clipboard?.writeText(galleryQrModal.eventQr.qrUrl); showToast?.("Gallery link copied!"); }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 transition"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              Copy link
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  const dataUrl = await QRCodeLib.toDataURL(galleryQrModal.eventQr.qrUrl, { width: 512, margin: 2 });
                                  const a = document.createElement("a");
                                  a.href = dataUrl;
                                  a.download = `gallery-qr-${galleryQrModal.eventQr.slug || "event"}.png`;
                                  a.click();
                                } catch { showToast?.("Failed to download QR"); }
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 transition"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                              Download QR
                            </button>
                            <button
                              onClick={() => { window.system?.openExternal?.(galleryQrModal.eventQr.qrUrl); }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 transition"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              Open
                            </button>
                          </div>
                        </div>

                        <div className="text-[10px] text-gray-400 text-center">
                          Share this QR with your guests — all session photos from this event will appear here.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end">
                    <button
                      onClick={() => setGalleryQrModal(null)}
                      className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Delete confirmation modal */}
            {deleteTarget && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className={`${SURFACE_BG} ${SURFACE_BORDER} ${CARD_RADIUS} shadow-xl p-6 w-full max-w-sm`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-50 flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Delete {deleteTarget.type}?</div>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        <span className="font-medium text-gray-700">{deleteTarget.name}</span> will be permanently removed. This cannot be undone.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-end gap-3">
                    <button
                      onClick={() => setDeleteTarget(null)}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>

                    <button
                      onClick={async () => {
                        if (!deleteTarget) return;

                        try {
                          if (deleteTarget.type === "event") {
                            const nextEvents = events.filter((e) => e.id !== deleteTarget.id);
                            await persistEvents(nextEvents);
                            // Push immediately so Supabase reflects the deletion before any
                            // restart. Without this the debounced push can be lost on exit,
                            // and the next pullSettings re-adds the event as "only in
                            // Supabase" — making the deleted event reappear.
                            pushSettingsNow({ events: nextEvents });

                            if (currentEvent?.id === deleteTarget.id) {
                              setCurrentEvent(null);
                              setActiveMain("events");
                            }

                            // Delete all Supabase storage objects and gallery rows for this event.
                            // Fire-and-forget — don't block the UI on a network call.
                            native?.cleanupEventStorage?.(deleteTarget.id)
                              ?.catch((err) => console.warn("[AdminDashboard] event storage cleanup failed:", err));

                            showToast("Event deleted");
                          }

                          else if (deleteTarget.type === "template") {
                            const nextTemplates = templates.filter((t) => t.id !== deleteTarget.id);

                            const nextEvents = events.map((ev) => {
                              const copy = JSON.parse(JSON.stringify(ev));
                              copy.appliedTemplates = (copy.appliedTemplates ?? []).filter(
                                (at) => at.id !== deleteTarget.id
                              );
                              return copy;
                            });

                            await persistTemplates(nextTemplates);
                            await persistEvents(nextEvents);
                            // Push immediately so Supabase reflects the deletion before any
                            // page refresh — prevents pullSettings from re-adding the item.
                            pushSettingsNow({ templates: nextTemplates, events: nextEvents });

                            showToast("Template deleted and removed from events");
                          }

                          else if (deleteTarget.type === "frame") {
                            const nextFrames = frames.filter((f) => f.id !== deleteTarget.id);

                            const nextEvents = events.map((ev) => {
                              const copy = JSON.parse(JSON.stringify(ev));
                              copy.appliedFrames = (copy.appliedFrames ?? []).filter(
                                (af) => af.id !== deleteTarget.id
                              );
                              return copy;
                            });

                            await persistFrames(nextFrames);
                            await persistEvents(nextEvents);
                            pushSettingsNow({ frames: nextFrames, events: nextEvents });

                            showToast("Frame deleted and removed from events");
                          }

                          else if (deleteTarget.type === "bgColor") {
                            const nextPalettes = (palettes ?? []).filter((p) => p.id !== deleteTarget.id);

                            const nextEvents = (events ?? []).map((ev) => {
                              const copy = JSON.parse(JSON.stringify(ev));
                              const before = copy.appliedBgColors ?? [];

                              copy.appliedBgColors = before.filter((c) => c.id !== deleteTarget.id);

                              if (before.length > 0 && copy.appliedBgColors.length === 0) {
                                copy.appliedFrames = (copy.appliedFrames ?? []).map((f) => {
                                  if (!f.useBgColor) return f;
                                  return {
                                    ...f,
                                    useBgColor: false,
                                    palette: null,
                                    selectedColor: null,
                                  };
                                });
                              }

                              return copy;
                            });

                            await persistPalettes(nextPalettes);
                            await persistEvents(nextEvents);

                            if (selectedBgColorId === deleteTarget.id) {
                              setSelectedBgColorId(null);
                              try {
                                await native?.setAppearance?.(
                                  {
                                    headerFont,
                                    generalFont,
                                    headerFontColor,
                                    generalFontColor,
                                    bgColor,
                                    logoPath: logoPath?.url ?? null,
                                    logoSize,
                                    backgroundMediaPath: backgroundMediaPath?.url ?? null,
                                    backgroundMediaName: backgroundMediaPath?.name ?? null,
                                    backgroundMediaMime: backgroundMediaPath?.mime ?? null,
                                    backgroundType,
                                    boothName,
                                    boothSlogan,
                                    buttonBgColor,
                                    buttonHoverColor,
                                    buttonFont,
                                    buttonFontColor,
                                    startButtonHidden,
                                    startButtonText,
                                    selectedBgColorId: null,
                                  },
                                  ctx
                                );
                              } catch { }
                            }

                            showToast("Background color deleted");
                          }
                        } finally {
                          setDeleteTarget(null);
                        }
                      }}
                      className="inline-flex items-center justify-center rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-200 transition hover:-translate-y-0.5 hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Toast */}
            {toast && (
              <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(15,23,42,0.25)]">
                <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                {toast}
              </div>
            )}

            <OnboardingTour
              run={runTour}
              eventsCount={events.length}
              currentSection={activeMain}
              onNavigate={setActiveMain}
              onFinish={() => {
                setRunTour(false);
                native?.setMetaFlag?.({ key: "onboarding-tour-v1", value: true }).catch(() => {});
              }}
            />
          </main>
        </div>
      </div>
    </div>
    </div>
  );
}