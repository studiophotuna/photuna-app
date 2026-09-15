// src/utils/guestExperience.js
//
// Per-event settings for what guests meet around a session besides the camera:
// the operator's own disclaimer on the consent screen, an optional survey after
// printing, and emailing guests their gallery link. Shared by the dashboard,
// which edits and saves them, and the booth, which reads them, so both agree on
// the shape and the limits. Stored as event.settings.guestExperience.

export const MAX_DISCLAIMER_CHARS = 4000;
export const MAX_SURVEY_QUESTIONS = 5;
export const MAX_CHOICE_OPTIONS = 6;
export const MAX_TEXT_ANSWER_CHARS = 200;
export const MAX_EMAILS_PER_SESSION = 3;

export const SURVEY_QUESTION_TYPES = [
  { value: "rating", label: "Star rating (1–5)" },
  { value: "choice", label: "Multiple choice" },
  { value: "text", label: "Short answer" },
];

export const DEFAULT_GUEST_EXPERIENCE = Object.freeze({
  disclaimer: { enabled: false, title: "", text: "", requireAgreement: true, agreementLabel: "" },
  survey: { enabled: false, title: "", questions: [] },
  emailShare: { enabled: false },
  // Welcome and thank-you always show the logo; this covers the screens between.
  branding: { logoOnEveryScreen: true },
});

// Shown when the operator leaves a label empty.
export const GUEST_EXPERIENCE_FALLBACKS = {
  en: {
    disclaimerTitle: "Terms of participation",
    agreementLabel: "I have read and agree to the terms above.",
    surveyTitle: "How was your experience?",
  },
  tl: {
    disclaimerTitle: "Mga tuntunin ng paglahok",
    agreementLabel: "Nabasa ko at sumasang-ayon sa mga tuntunin sa itaas.",
    surveyTitle: "Paano ang iyong experience?",
  },
};

export function fallbackCopy(lang) {
  return String(lang || "en").toLowerCase().startsWith("tl") || String(lang || "").toLowerCase().startsWith("fil")
    ? GUEST_EXPERIENCE_FALLBACKS.tl
    : GUEST_EXPERIENCE_FALLBACKS.en;
}

// Never trims: this runs on every auto-save while the operator is still typing.
const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

function sanitizeQuestion(question, index) {
  if (!question || typeof question !== "object") return null;
  const type = SURVEY_QUESTION_TYPES.some((t) => t.value === question.type) ? question.type : "rating";
  const id = typeof question.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(question.id)
    ? question.id
    : `q${index + 1}`;
  const options = type === "choice"
    ? (Array.isArray(question.options) ? question.options : [])
      .filter((o) => typeof o === "string")
      .map((o) => o.slice(0, 60))
      .slice(0, MAX_CHOICE_OPTIONS)
    : [];
  return { id, type, prompt: text(question.prompt, 160), required: Boolean(question.required), options };
}

export function sanitizeGuestExperience(input) {
  const src = input && typeof input === "object" ? input : {};
  const disclaimer = src.disclaimer && typeof src.disclaimer === "object" ? src.disclaimer : {};
  const survey = src.survey && typeof src.survey === "object" ? src.survey : {};
  const emailShare = src.emailShare && typeof src.emailShare === "object" ? src.emailShare : {};
  const branding = src.branding && typeof src.branding === "object" ? src.branding : {};

  const seen = new Set();
  const questions = (Array.isArray(survey.questions) ? survey.questions : [])
    .slice(0, MAX_SURVEY_QUESTIONS)
    .map(sanitizeQuestion)
    .filter(Boolean)
    .map((q) => {
      let id = q.id;
      while (seen.has(id)) id = `${id}_`;
      seen.add(id);
      return { ...q, id };
    });

  return {
    disclaimer: {
      enabled: Boolean(disclaimer.enabled),
      title: text(disclaimer.title, 120),
      text: text(disclaimer.text, MAX_DISCLAIMER_CHARS),
      requireAgreement: disclaimer.requireAgreement !== false,
      agreementLabel: text(disclaimer.agreementLabel, 160),
    },
    survey: {
      enabled: Boolean(survey.enabled),
      title: text(survey.title, 120),
      questions,
    },
    emailShare: { enabled: Boolean(emailShare.enabled) },
    branding: { logoOnEveryScreen: branding.logoOnEveryScreen !== false },
  };
}

export function readGuestExperience(event) {
  return sanitizeGuestExperience(event?.settings?.guestExperience);
}

/** The disclaimer to show, or null when it is off or empty. */
export function activeDisclaimer(guestExperience, lang) {
  const d = guestExperience?.disclaimer;
  if (!d?.enabled || !d.text.trim()) return null;
  const copy = fallbackCopy(lang);
  return {
    title: d.title.trim() || copy.disclaimerTitle,
    text: d.text.trim(),
    requireAgreement: d.requireAgreement !== false,
    agreementLabel: d.agreementLabel.trim() || copy.agreementLabel,
  };
}

/** Questions complete enough to ask; the survey is skipped when there are none. */
export function askableQuestions(guestExperience) {
  const survey = guestExperience?.survey;
  if (!survey?.enabled) return [];
  return survey.questions
    .filter((q) => q.prompt.trim())
    .map((q) => (q.type === "choice" ? { ...q, options: q.options.map((o) => o.trim()).filter(Boolean) } : q))
    .filter((q) => q.type !== "choice" || q.options.length >= 2);
}

export function newSurveyQuestion(type = "rating") {
  return {
    id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type,
    prompt: "",
    required: false,
    options: type === "choice" ? ["", ""] : [],
  };
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Changes whenever the questions change, so answers can be grouped by survey version. */
export function surveyVersion(questions) {
  return fnv1a(JSON.stringify((questions || []).map((q) => [q.id, q.type, q.prompt, q.options])));
}

/** SHA-256 hex of the text, identifying exactly which disclaimer a guest agreed to. */
export async function sha256Hex(value) {
  const input = String(value ?? "");
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `fnv1a:${fnv1a(input)}`;
  }
}

// Same rule as the send-gallery-email function, so the booth rejects what the
// server would reject instead of queueing it.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

export function isValidEmail(value) {
  const v = String(value ?? "").trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

/** A job id the outbox accepts: letters, digits, _ and -, at most 120 characters. */
export function safeJobId(...parts) {
  return parts
    .map((p) => String(p ?? ""))
    .join("-")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 120);
}

export function slugFromGalleryUrl(url) {
  const match = String(url || "").match(/\/gallery\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/?(?:[?#].*)?$/);
  return match ? match[1] : null;
}
