const QRCode = require("qrcode");

const PAYMONGO_BASE = "https://api.paymongo.com/v1";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const SOURCE_TYPES = {
  gcash: "gcash",
  maya: "paymaya",
  grabpay: "grab_pay",
};

function toCentavos(php) {
  return Math.round(Number(php) * 100);
}

function basicAuth(secretKey) {
  return "Basic " + Buffer.from(secretKey + ":").toString("base64");
}

async function paymongoFetch(path, secretKey, options = {}) {
  const url = `${PAYMONGO_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: basicAuth(secretKey),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const msg =
      body?.errors?.[0]?.detail ||
      body?.errors?.[0]?.code ||
      `PayMongo API error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.paymongoErrors = body?.errors;
    throw err;
  }

  return body;
}

class PayMongoService {
  constructor(secretKey) {
    this.secretKey = secretKey;
  }

  async validateKeys() {
    // Create a minimal payment intent (PHP 100 = 10000 centavos) to verify credentials.
    // PayMongo doesn't charge until a payment method is attached, so this is safe.
    const body = await paymongoFetch("/payment_intents", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: 10000,
            currency: "PHP",
            payment_method_allowed: ["card"],
            capture_type: "automatic",
            description: "Key validation test",
          },
        },
      }),
    });
    return !!body?.data?.id;
  }

  async createSource(type, amountPhp, currency = "PHP", description = "Photobooth session") {
    const sourceType = SOURCE_TYPES[type];
    if (!sourceType) throw new Error(`Unsupported source type: ${type}`);

    const body = await paymongoFetch("/sources", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: toCentavos(amountPhp),
            currency,
            type: sourceType,
            redirect: {
              success: "https://studiophotuna.com/payment/success",
              failed: "https://studiophotuna.com/payment/failed",
            },
            description,
          },
        },
      }),
    });

    const source = body?.data;
    return {
      id: source?.id,
      checkoutUrl: source?.attributes?.redirect?.checkout_url,
      status: source?.attributes?.status,
    };
  }

  async getSource(sourceId) {
    const body = await paymongoFetch(`/sources/${sourceId}`, this.secretKey);
    const attrs = body?.data?.attributes;
    return {
      id: body?.data?.id,
      status: attrs?.status,
      amount: attrs?.amount,
      currency: attrs?.currency,
      type: attrs?.type,
    };
  }

  async createCharge(sourceId, amountPhp, currency = "PHP", description = "Photobooth session") {
    const body = await paymongoFetch("/payments", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: toCentavos(amountPhp),
            currency,
            description,
            source: { id: sourceId, type: "source" },
          },
        },
      }),
    });

    const payment = body?.data;
    return {
      id: payment?.id,
      status: payment?.attributes?.status,
      amount: payment?.attributes?.amount,
      netAmount: payment?.attributes?.net_amount,
    };
  }

  async createPaymentLink(amountPhp, currency = "PHP", description = "Photobooth Session") {
    const body = await paymongoFetch("/links", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: toCentavos(amountPhp),
            currency,
            description,
            remarks: "",
          },
        },
      }),
    });
    const link = body?.data;
    return {
      id: link?.id,
      checkoutUrl: link?.attributes?.checkout_url,
      status: link?.attributes?.status,
    };
  }

  async getPaymentLink(linkId) {
    const body = await paymongoFetch(`/links/${linkId}`, this.secretKey);
    const link = body?.data;
    const payments = link?.attributes?.payments ?? [];
    const paid = payments.find((p) => p?.attributes?.status === "paid");
    return {
      id: link?.id,
      status: link?.attributes?.status,
      hasPaid: !!paid,
      paymentId: paid?.id ?? null,
    };
  }

  async archiveLink(linkId) {
    return paymongoFetch(`/links/${linkId}/archive`, this.secretKey, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  async createPaymentIntent(amountPhp, currency = "PHP", description = "Photobooth session") {
    const body = await paymongoFetch("/payment_intents", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: toCentavos(amountPhp),
            currency,
            description,
            payment_method_allowed: ["card"],
            capture_type: "automatic",
          },
        },
      }),
    });

    const intent = body?.data;
    return {
      id: intent?.id,
      clientKey: intent?.attributes?.client_key,
      status: intent?.attributes?.status,
    };
  }
}

// Manages active poll loops — one per sourceId.
// Calls onConfirmed/onFailed callbacks and auto-cleans up.
class PaymentPollManager {
  constructor() {
    this.activePolls = new Map();
  }

  start({ sourceId, amountPhp, currency, service, onConfirmed, onFailed }) {
    this.cancel(sourceId);

    const startTime = Date.now();
    const interval = setInterval(async () => {
      try {
        const source = await service.getSource(sourceId);

        if (source.status === "chargeable") {
          this.cancel(sourceId);
          try {
            const charge = await service.createCharge(sourceId, amountPhp, currency);
            onConfirmed({ sourceId, paymentId: charge.id, amount: charge.amount, status: charge.status });
          } catch (chargeErr) {
            onFailed({ sourceId, reason: chargeErr.message });
          }
          return;
        }

        if (source.status === "paid") {
          this.cancel(sourceId);
          onConfirmed({ sourceId, paymentId: null, amount: source.amount, status: "paid" });
          return;
        }

        if (source.status === "expired" || source.status === "cancelled") {
          this.cancel(sourceId);
          onFailed({ sourceId, reason: `Payment ${source.status}` });
          return;
        }

        if (Date.now() - startTime > POLL_TIMEOUT_MS) {
          this.cancel(sourceId);
          onFailed({ sourceId, reason: "Payment timed out after 5 minutes" });
        }
      } catch (err) {
        if (Date.now() - startTime > POLL_TIMEOUT_MS) {
          this.cancel(sourceId);
          onFailed({ sourceId, reason: err.message || "Poll failed" });
        }
      }
    }, POLL_INTERVAL_MS);

    this.activePolls.set(sourceId, interval);
  }

  cancel(sourceId) {
    const timer = this.activePolls.get(sourceId);
    if (timer) {
      clearInterval(timer);
      this.activePolls.delete(sourceId);
    }
  }

  cancelAll() {
    for (const [id] of this.activePolls) {
      this.cancel(id);
    }
  }
}

async function generateQrDataUrl(text) {
  return QRCode.toDataURL(text, { width: 400, margin: 2 });
}

function isTestMode(key) {
  return typeof key === "string" && key.includes("_test_");
}

// ── Xendit ──────────────────────────────────────────────────────────────────
const XENDIT_BASE = "https://api.xendit.co";

async function xenditFetch(path, apiKey, options = {}) {
  const res = await fetch(`${XENDIT_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64"),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    let message = body?.message || body?.error_code || `Xendit API error ${res.status}`;
    if (res.status === 403 || body?.error_code === 'REQUEST_FORBIDDEN_ERROR') {
      message = "Xendit key lacks permissions. In Xendit Dashboard → Settings → API Keys, enable Money-in → Invoice access for this key.";
    } else if (res.status === 401) {
      message = "Xendit API key is invalid or expired. Re-enter it in Admin → Business → Payment Gateway.";
    } else if (typeof message === 'string' && message.toLowerCase().includes('currency') && message.toLowerCase().includes('not configured')) {
      const cur = (body?.message?.match(/currency\s+(\w+)/i) || [])[1] ?? 'selected currency';
      message = `Xendit: ${cur} is not enabled on your account. Go to Admin → Controls → Business → Pricing and set Currency to PHP, or contact Xendit to enable ${cur}.`;
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return body;
}

class XenditService {
  constructor(apiKey) { this.apiKey = apiKey; }

  async createInvoice(amount, currency, description = "Photobooth Session") {
    const body = await xenditFetch("/v2/invoices", this.apiKey, {
      method: "POST",
      body: JSON.stringify({
        external_id: `photobooth-${Date.now()}`,
        amount: Number(amount),
        currency,
        description,
        invoice_duration: 300,
      }),
    });
    return { id: body.id, invoiceUrl: body.invoice_url };
  }

  async getInvoice(invoiceId) {
    return xenditFetch(`/v2/invoices/${invoiceId}`, this.apiKey);
  }

  async expireInvoice(invoiceId) {
    return xenditFetch(`/invoices/${invoiceId}/expire!`, this.apiKey, {
      method: "POST",
      body: "{}",
    }).catch(() => {});
  }
}

// ── PayPal ──────────────────────────────────────────────────────────────────
class PayPalService {
  constructor(clientId, clientSecret, sandbox = false) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.base = sandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";
    this._accessToken = null;
    this._tokenExpiry = 0;
  }

  async getAccessToken() {
    if (this._accessToken && Date.now() < this._tokenExpiry - 30000) {
      return this._accessToken;
    }
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error_description || `PayPal auth failed ${res.status}`);
    this._accessToken = body.access_token;
    this._tokenExpiry = Date.now() + body.expires_in * 1000;
    return this._accessToken;
  }

  async _fetch(path, options = {}) {
    const token = await this.getAccessToken();
    const res = await fetch(`${this.base}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(
        body?.details?.[0]?.description || body?.message || `PayPal API error ${res.status}`
      );
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async createOrder(amount, currency, description = "Photobooth Session") {
    const body = await this._fetch("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: { currency_code: currency, value: Number(amount).toFixed(2) },
          description,
        }],
        application_context: {
          return_url: "https://studiophotuna.com/payment/success",
          cancel_url: "https://studiophotuna.com/payment/cancel",
        },
      }),
    });
    const approveLink = body.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
    return { id: body.id, approvalUrl: approveLink?.href };
  }

  async getOrder(orderId) {
    return this._fetch(`/v2/checkout/orders/${orderId}`);
  }

  async captureOrder(orderId) {
    return this._fetch(`/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      body: "{}",
    });
  }
}

// ── Stripe ──────────────────────────────────────────────────────────────────
class StripeService {
  constructor(secretKey) {
    const Stripe = require("stripe");
    this.stripe = Stripe(secretKey);
  }

  async validate() {
    // Lightweight call to confirm the key is valid
    await this.stripe.balance.retrieve();
  }

  async createCheckoutSession(amount, currency, description = "Photobooth Session") {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: String(currency).toLowerCase(),
          product_data: { name: description },
          unit_amount: Math.round(Number(amount) * 100),
        },
        quantity: 1,
      }],
      success_url: "https://studiophotuna.com/payment/success",
      cancel_url:  "https://studiophotuna.com/payment/cancel",
    });
    return { id: session.id, checkoutUrl: session.url };
  }

  async getCheckoutSession(sessionId) {
    return this.stripe.checkout.sessions.retrieve(sessionId);
  }
}

// ── Generic poll manager (Stripe / Xendit / PayPal) ─────────────────────────
// poll() must return { confirmed, failed, reason, paymentId } or {}
class GenericPollManager {
  constructor() { this.activePolls = new Map(); }

  start({ sessionId, poll, onConfirmed, onFailed, timeoutMs = POLL_TIMEOUT_MS }) {
    this.cancel(sessionId);
    const startTime = Date.now();
    const interval = setInterval(async () => {
      try {
        if (Date.now() - startTime > timeoutMs) {
          this.cancel(sessionId);
          onFailed({ sessionId, reason: "Payment timed out after 5 minutes" });
          return;
        }
        const result = await poll();
        if (result.confirmed) {
          this.cancel(sessionId);
          onConfirmed({ sessionId, paymentId: result.paymentId ?? sessionId });
        } else if (result.failed) {
          this.cancel(sessionId);
          onFailed({ sessionId, reason: result.reason || "Payment failed or expired" });
        }
      } catch (err) {
        if (Date.now() - startTime > timeoutMs) {
          this.cancel(sessionId);
          onFailed({ sessionId, reason: err.message || "Poll error" });
        }
      }
    }, POLL_INTERVAL_MS);
    this.activePolls.set(sessionId, interval);
  }

  cancel(sessionId) {
    const timer = this.activePolls.get(sessionId);
    if (timer) { clearInterval(timer); this.activePolls.delete(sessionId); }
  }

  cancelAll() {
    for (const [id] of this.activePolls) this.cancel(id);
  }
}

module.exports = {
  PayMongoService,
  PaymentPollManager,
  GenericPollManager,
  StripeService,
  XenditService,
  PayPalService,
  generateQrDataUrl,
  toCentavos,
  isTestMode,
  SOURCE_TYPES,
};
