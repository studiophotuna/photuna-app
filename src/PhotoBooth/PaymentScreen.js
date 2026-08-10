
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLayout } from "../utils/useLayout";
import { normalizeToFileUrl } from "../utils/mediaUrl";

/* ------------------------------- Helpers ------------------------------- */
function getBridge() {
  if (typeof window === "undefined") return null;
  return window.api ?? window.electron ?? null;
}

function loadGoogleFont(fontName) {
  if (!fontName || typeof document === "undefined") return;
  const id = `google-font-${fontName.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(
    /\s+/g,
    "+"
  )}:wght@300;400;600;700&display=swap`;
  document.head.appendChild(link);
}

/**
 * PaymentScreen (AdminDashboard-aligned)
 *
 * Props:
 * - event (preferred): object from AdminDashboard
 * - eventId (optional): ID to fetch event via window.api.getEvents()
 * - appearance (optional): external appearance override
 * - onCancel, onNext, onSuccess
 * - amountDue (fallback for legacy-only scenarios)
 */
export default function PaymentScreen({
  event = null,
  eventId = null,
  appearance = {},
  onCancel = () => { },
  onNext = () => { },
  onBack = () => { },
  onSuccess = null,
  amountDue = 150,
}) {
  const api = getBridge();
  const { isPortrait, isUnsupported } = useLayout();

  /* --------------------- Global fallbacks if no event prop --------------------- */
  const [globalAppearance, setGlobalAppearance] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);
  const [loadedEvent, setLoadedEvent] = useState(event ?? null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!api) return;

        // Fetch event by id when not supplied as prop
        if (!event && eventId && api.getEvents) {
          const all = await api.getEvents();
          const found = Array.isArray(all)
            ? all.find((e) => String(e.id) === String(eventId))
            : null;
          if (mounted && found) setLoadedEvent(found);
        }

        // Global appearance/settings fallbacks
        if (api.getAppearance) {
          const a = await api.getAppearance();
          if (mounted) setGlobalAppearance(a ?? null);
        }
        if (api.getSettings) {
          const s = await api.getSettings();
          if (mounted) setGlobalSettings(s ?? null);
        }
      } catch (err) {
        console.warn("PaymentScreen: load fallbacks failed", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [api, event, eventId]);

  const currentEvent = loadedEvent ?? event ?? null;

  /* ------------------------------- Appearance ------------------------------- */
  const evApp = currentEvent?.appearance ?? {};
  const gApp = globalAppearance ?? {};
  const mergedAppearance = {
    headerFont: evApp.headerFont ?? appearance.headerFont ?? gApp.headerFont ?? "Ramillas",
    generalFont: evApp.generalFont ?? appearance.generalFont ?? gApp.generalFont ?? "Interphases",
    headerFontColor: evApp.headerFontColor ?? appearance.headerFontColor ?? gApp.headerFontColor ?? "#000000",
    generalFontColor: evApp.generalFontColor ?? appearance.generalFontColor ?? gApp.generalFontColor ?? "#000000",
    bgColor: evApp.bgColor ?? appearance.bgColor ?? gApp.bgColor ?? "#ffffff",
    boothName: evApp.boothName ?? appearance.boothName ?? gApp.boothName ?? "",
    boothSlogan: evApp.boothSlogan ?? appearance.boothSlogan ?? gApp.boothSlogan ?? "",
    logoUrl: evApp.logoPath ?? appearance.logoPath ?? gApp.logoPath ?? null,
    logoSize: evApp.logoSize ?? appearance.logoSize ?? gApp.logoSize ?? 100,
    backgroundMediaUrl:
      evApp.backgroundMediaPath ?? appearance.backgroundMediaPath ?? gApp.backgroundMediaPath ?? null,
    buttonBgColor: evApp.buttonBgColor ?? appearance.buttonBgColor ?? gApp.buttonBgColor ?? "#2563eb",
    buttonHoverColor: evApp.buttonHoverColor ?? appearance.buttonHoverColor ?? gApp.buttonHoverColor ?? "#1e40af",
    buttonFont: evApp.buttonFont ?? appearance.buttonFont ?? gApp.buttonFont ?? "Interphases",
    buttonFontColor: evApp.buttonFontColor ?? appearance.buttonFontColor ?? gApp.buttonFontColor ?? "#ffffff",
  };

  const {
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    boothName,
    boothSlogan,
    logoUrl: rawLogoUrl,
    logoSize,
    backgroundMediaUrl: rawBackgroundUrl,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
  } = mergedAppearance;

  const logoScale = (logoSize ?? 100) / 100;
  // Normalize file/data URLs and load fonts
  const logoUrl = rawLogoUrl ? normalizeToFileUrl(rawLogoUrl) : null;
  const backgroundMediaUrl = rawBackgroundUrl ? normalizeToFileUrl(rawBackgroundUrl) : null;

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  /* ------------------------------- Settings ------------------------------- */
  const numberOfShots = currentEvent?.settings?.numberOfShots ?? 1;

  const appMode = currentEvent?.settings?.appMode ?? globalSettings?.appMode ?? "business";
  const business = currentEvent?.settings?.business ?? globalSettings?.business ?? {};
  const paymentEnabled = business?.paymentEnabled ?? (appMode === "business");
  const activeGateway = business?.activeProvider ?? null; // "paymongo" | "stripe" | "xendit" | "paypal" | null

  const gatewayLabel = {
    paymongo: "PayMongo",
    stripe:   "Stripe",
    xendit:   "Xendit",
    paypal:   "PayPal",
  }[activeGateway] ?? activeGateway ?? "";

  const currency = business?.pricing?.currency ?? globalSettings?.business?.pricing?.currency ?? "PHP";

  const gatewayCurrencyMatch = (() => {
    if (!activeGateway) return true;
    const map = {
      paymongo: ["PHP"],
      xendit:   ["PHP"],
      stripe:   ["USD", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "SGD", "MYR", "THB", "JPY", "KRW", "INR", "HKD", "TWD", "CNY", "AUD", "CAD", "NZD"],
      paypal:   ["USD", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "HUF", "CZK", "MYR", "PHP", "SGD", "THB", "TWD", "JPY", "AUD", "CAD", "NZD", "HKD"],
    };
    const supported = map[activeGateway];
    if (!supported) return true;
    return supported.includes(String(currency).toUpperCase());
  })();

  /* ------------------------------- Language ------------------------------- */
  const langRaw = currentEvent?.settings?.language ?? globalSettings?.language ?? "en";
  const isTagalog =
    ["tagalog", "tl", "filipino"].includes(String(langRaw).toLowerCase());

  const t = {
    titleChoose: isTagalog ? "Piliin ang" : "Choose",
    titlePaymentOption: isTagalog ? "Paraan ng Bayad" : "Payment",
    hintProceed: isTagalog
      ? "Kapag kumpleto na ang bayad, tutuloy ka sa photo section."
      : "Once your payment is complete, you'll move on to the photo section, where you'll have a set amount of time to capture your photos.",
    nonRefundable: isTagalog
      ? "Ang mga bayad ay hindi na maibabalik. Kapag matagumpay, kumpletuhin ang buong photobooth experience."
      : "Please note that payments are non-refundable. Once your payment is successful, we invite you to enjoy and complete the full photo booth experience.",
    backToTemplates: isTagalog ? "Bumalik sa Template Screen" : "Back to Template Screen",
    totalAmount: isTagalog ? "Kabuuang halaga" : "Total amount",
    cashTitle: isTagalog ? "Bayad" : "Payment",
    cashInstruction: isTagalog
      ? "Maghulog ng pera sa dispenser. Awtomatikong magpapatuloy kapag umabot sa kinakailangang halaga."
      : "Insert cash into the dispenser. The flow auto-continues once the required amount is reached.",
    back: isTagalog ? "← Balik" : "← Back",
    qrTitle: isTagalog ? "Bayad" : "Payment",
    qrInstruction: isTagalog
      ? "I-scan ang QR code gamit ang banking app para magbayad ng kabuuang halaga."
      : "Scan the QR code with your banking app to pay the total amount.",
    paymentConfirmed: isTagalog ? "Nakumpirma ang bayad" : "Payment confirmed",
    processingCash: isTagalog ? "Pinoproseso ang bayad sa cash..." : "Processing cash payment...",
    recorded: isTagalog ? "Naitala ang bayad" : "Payment recorded",
    completeNotPersisted: isTagalog ? "Kumpleto ang bayad (hindi naitala)" : "Payment complete (not persisted)",
    selectMethod: isTagalog ? "Pumili ng paraan ng bayad upang magpatuloy" : "Select a payment method to continue",
    externalConfirm: isTagalog ? "Kumpirmahin ang bayad" : "Confirm payment received",
    attendantConfirm: isTagalog
      ? "Dapat kumpirmahin ng operator ang bayad bago magsimula ang session."
      : "An operator should confirm the payment before starting the session.",
    tipQR: isTagalog
      ? "Gamitin ang merchant QR ng booth at kumpirmahin kapag natanggap na ang bayad."
      : "Use the booth's merchant QR and confirm only after the payment is received.",
    timeoutReturn: isTagalog ? "Natapos ang oras. Babalik sa main screen..." : "Time expired. Returning to main screen...",
    rentalSkip: isTagalog ? "Walang bayad sa Rental mode. Tutuloy tayo..." : "No payment required in Rental mode. Proceeding...",
    discountLabel: isTagalog ? "Discount code (opsyonal)" : "Discount code (optional)",
    discountApply: isTagalog ? "I-apply" : "Apply",
    discountInvalid: isTagalog ? "Hindi wasto ang discount code" : "Invalid discount code",
    discountApplied: isTagalog ? "Nailapat ang discount" : "Discount applied",
    proceed: isTagalog ? "Magpatuloy" : "Proceed",
    processing: isTagalog ? "Pinoproseso..." : "Processing...",
    amountDueLabel: isTagalog ? "Kabuuang babayaran: " : "Amount Due: ",
  };

  const providers = {
    gateway: !!(activeGateway && paymentEnabled && gatewayCurrencyMatch),
    cash:    !!business?.payment?.providers?.cash,
  };
  const cashMode = business?.payment?.cashMode ?? "manual"; // "manual" | "hardware"
  const noProviders = !providers.gateway && !providers.cash;

  // If payment is enabled but there's nothing to pick, auto-skip with a notice
  useEffect(() => {
    if (paymentEnabled && noProviders) {
      setMessage(isTagalog ? "Walang naka-enable na payment provider. Lalaktawan..." : "No payment providers are enabled. Skipping...");
      const tid = setTimeout(() => onNext(), 800);
      return () => clearTimeout(tid);
    }
  }, [paymentEnabled, noProviders, onNext, isTagalog]);

  const pricingModel =
    business?.pricing?.model ??
    (currentEvent?.settings?.price != null ? "perSession" : "perSession");
  const pricePerSession = business?.pricing?.pricePerSession ?? null;
  const pricePerPhoto = business?.pricing?.pricePerPhoto ?? null;
  const legacyPrice = currentEvent?.settings?.price ?? null;
  const taxEnabled = business?.pricing?.taxEnabled ?? false;
  const taxRate = business?.pricing?.taxRate ?? 0;
  const discountList = Array.isArray(business?.pricing?.discountCodes)
    ? business.pricing.discountCodes
    : [];

  // Timer: event → global → default (20s)
  const resolvedTimer =
    currentEvent?.settings?.screenTimers?.payment ??
    globalSettings?.screenTimers?.payment ??
    20;

  /* ------------------------------- Currency ------------------------------- */
  const currencySymbol = (cur) => {
    const s = { USD:"$", EUR:"€", GBP:"£", CHF:"Fr", SEK:"kr", NOK:"kr", DKK:"kr", PLN:"zł", CZK:"Kč", HUF:"Ft", RON:"lei", BGN:"лв", TRY:"₺", SGD:"S$", MYR:"RM", THB:"฿", IDR:"Rp", JPY:"¥", KRW:"₩", INR:"₹", HKD:"HK$", TWD:"NT$", CNY:"¥", AUD:"A$", CAD:"C$", NZD:"NZ$" };
    return s[cur] ?? "₱";
  };
  const fmt = (amt) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      }).format(amt);
    } catch {
      return `${currencySymbol(currency)} ${Number(amt).toFixed(2)}`;
    }
  };

  /* ----------------------- Price (subtotal → discount → tax) ----------------------- */
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState(null); // {code, percent? , amount?}

  const subtotal = useMemo(() => {
    // prefer business fields; fallback to legacy price or amountDue
    if (pricingModel === "perPhoto") {
      // If you price per print/photo, multiply by numberOfShots by default.
      // Adjust here if you count per-template slots instead.
      const unit =
        (pricePerPhoto != null ? Number(pricePerPhoto) : null) ??
        (legacyPrice != null ? Number(legacyPrice) : Number(amountDue));
      return Math.max(0, unit);
    }
    // perSession
    const unit =
      (pricePerSession != null ? Number(pricePerSession) : null) ??
      (legacyPrice != null ? Number(legacyPrice) : Number(amountDue));
    return Math.max(0, unit);
  }, [pricingModel, pricePerSession, pricePerPhoto, legacyPrice, numberOfShots, amountDue]);

  const discounted = useMemo(() => {
    if (!appliedDiscount) return subtotal;
    const { percent, amount } = appliedDiscount;
    if (percent != null) {
      return Math.max(0, subtotal * (1 - Number(percent) / 100));
    }
    if (amount != null) {
      return Math.max(0, subtotal - Number(amount));
    }
    return subtotal;
  }, [subtotal, appliedDiscount]);

  const total = useMemo(() => {
    if (!taxEnabled) return discounted;
    const rate = Math.max(0, Number(taxRate) || 0);
    return discounted * (1 + rate / 100);
  }, [discounted, taxEnabled, taxRate]);

  /* ------------------------------- Flow/UI state ------------------------------- */
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(resolvedTimer);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(null);

  // QR payment state (PayMongo / Stripe / Xendit / PayPal)
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrLoading, setQrLoading] = useState(() => providers.gateway);
  const [qrError, setQrError] = useState(null);
  const [qrSourceId, setQrSourceId] = useState(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const activeQrProvider = useRef(null);

  const paymentSlides = [
    providers.gateway && { key: "gateway-qr", label: `Pay via ${gatewayLabel}`, provider: "gateway" },
    providers.cash    && { key: "cash",        label: "Cash",                    provider: "cash"    },
  ].filter(Boolean);

  const [paymentIndex, setPaymentIndex] = useState(0);

  useEffect(() => {
    if (paymentIndex > paymentSlides.length - 1) {
      setPaymentIndex(0);
    }
  }, [paymentSlides.length, paymentIndex]);

  const activePayment = paymentSlides[paymentIndex]?.key ?? null;
  const isOnlinePaymentSlide = activePayment === "gateway-qr";

  // Start payment session whenever an online-payment slide becomes active
  useEffect(() => {
    if (!isOnlinePaymentSlide || paymentConfirmed) return;
    // Skip if we already have an active session for this exact slide
    if (activeQrProvider.current === activePayment && qrDataUrl && qrSourceId) return;

    let cancelled = false;
    activeQrProvider.current = activePayment;
    setQrLoading(true);
    setQrError(null);
    setQrDataUrl(null);
    setQrSourceId(null);

    (async () => {
      try {
        const bridge = getBridge();
        const currency = business?.pricing?.currency || "PHP";
        const eventId = event?.id || "default";
        const res = await bridge?.startGatewayPayment?.({ amount: total, currency, eventId });
        if (cancelled) return;
        if (res?.ok && res.qrDataUrl) {
          setQrDataUrl(res.qrDataUrl);
          setQrSourceId(res.sessionId ?? res.orderId ?? null);
        } else {
          setQrError(res?.error || "Failed to create payment session");
        }
      } catch (err) {
        if (!cancelled) setQrError(err?.message || "Payment error");
      } finally {
        if (!cancelled) setQrLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOnlinePaymentSlide, activePayment, activeGateway, paymentConfirmed, total, qrSourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for payment confirmation from main process
  useEffect(() => {
    const bridge = getBridge();
    const unsub = bridge?.onPaymentConfirmed?.((data) => {
      setPaymentConfirmed(true);
      setMessage(isTagalog ? "Bayad natanggap!" : "Payment confirmed!");
      bridge?.recordPayment?.({
        method: data.provider || "qr",
        amount: total,
        currency: business?.pricing?.currency || "PHP",
        paymentId: data.paymentId,
        sourceId: data.sourceId,
        eventId: event?.id || "default",
        confirmedAt: new Date().toISOString(),
      }).catch(() => {});
      setTimeout(() => onNext(), 1500);
    });
    const unsubFail = bridge?.onPaymentFailed?.((data) => {
      setQrError(data?.reason || "Payment failed or expired");
      setQrDataUrl(null);
      setQrSourceId(null);
      activeQrProvider.current = null;
    });
    return () => { unsub?.(); unsubFail?.(); };
  }, [total, onNext]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel active payment poll on unmount
  useEffect(() => {
    return () => {
      if (qrSourceId) getBridge()?.cancelPayment?.({ sourceId: qrSourceId, sessionId: qrSourceId });
    };
  }, [qrSourceId]);

  const goToPayment = (index) => {
    if (index < 0 || index >= paymentSlides.length) return;
    if (qrSourceId) {
      getBridge()?.cancelPayment?.({ sourceId: qrSourceId, sessionId: qrSourceId });
      setQrSourceId(null);
      setQrDataUrl(null);
      activeQrProvider.current = null;
    }
    setPaymentIndex(index);
    setMessage(null);
    setQrError(null);
  };

  const nextPayment = () => {
    if (!paymentSlides.length) return;
    setPaymentIndex((prev) => (prev + 1) % paymentSlides.length);
    setMessage(null);
  };

  const prevPayment = () => {
    if (!paymentSlides.length) return;
    setPaymentIndex((prev) => (prev - 1 + paymentSlides.length) % paymentSlides.length);
    setMessage(null);
  };

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setTimeLeft(resolvedTimer);
  }, [resolvedTimer]);

  const onTimeout = () => {
    setMessage(t.timeoutReturn);
    setTimeout(() => onCancel(), 700);
  };

  // Timer: only when payment is enabled (business mode)
  useEffect(() => {
    if (!paymentEnabled) return;
    if (timeLeft <= 0) {
      onTimeout();
      return;
    }
    const interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timeLeft, paymentEnabled]);

  // Rental or payment disabled → skip
  useEffect(() => {
    if (appMode !== "business" || !paymentEnabled) {
      setMessage(t.rentalSkip);
      const tid = setTimeout(() => onNext(), 600);
      return () => clearTimeout(tid);
    }
  }, [appMode, paymentEnabled, onNext]);

  const price = total;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = (timeLeft / Math.max(1, resolvedTimer)) * circumference;

  const persistPayment = async (paymentRecord) => {
    try {
      if (window.api?.recordPayment) {
        await window.api.recordPayment(paymentRecord);
        return true;
      }
      if (window.api?.getEvents && window.api?.setEvents) {
        const all = (await window.api.getEvents()) || [];
        const updated = all.map((e) => {
          if (e.id === currentEvent?.id) {
            e.analytics = e.analytics || {};
            e.analytics.sessionsToday = (e.analytics.sessionsToday || 0) + 1;
            e.analytics.revenueToday = (e.analytics.revenueToday || 0) + (paymentRecord.amount ?? 0);
            if (typeof e.analytics.sessionsWeekly === "number") e.analytics.sessionsWeekly += 1;
            if (typeof e.analytics.revenueWeekly === "number") e.analytics.revenueWeekly += paymentRecord.amount ?? 0;
            if (typeof e.analytics.sessionsMonthly === "number") e.analytics.sessionsMonthly += 1;
            if (typeof e.analytics.revenueMonthly === "number") e.analytics.revenueMonthly += paymentRecord.amount ?? 0;
            e.lastPayment = paymentRecord;
          }
          return e;
        });
        await window.api.setEvents(updated);
        return true;
      }
    } catch (err) {
      console.warn("persistPayment failed", err);
    }
    return false;
  };

  const basePaymentRecord = {
    amount: Number(price),
    currency,
    timestamp: Date.now(),
    eventId: currentEvent?.id ?? null,
    pricingModel,
    numberOfShots,
    discount: appliedDiscount ?? undefined,
    tax: taxEnabled ? Number(taxRate) : 0,
  };

  const confirmManualPayment = async (method) => {
    setProcessing(true);
    const paymentRecord = { method, ...basePaymentRecord };
    const persisted = await persistPayment(paymentRecord);
    setProcessing(false);
    setMessage(persisted ? t.recorded : t.completeNotPersisted);
    onSuccess?.(paymentRecord);
    setTimeout(() => onNext(), 600);
  };

  const handleCashProceed = async () => {
    setProcessing(true);
    setMessage(t.processingCash);

    const paymentRecord = { method: "cash", ...basePaymentRecord };

    try {
      if (window.electron?.finalizeCashPayment) {
        await window.electron.finalizeCashPayment({ amount: Number(price), currency });
      }
    } catch (err) {
      console.warn("finalizeCashPayment failed", err);
    }

    const persisted = await persistPayment(paymentRecord);
    setProcessing(false);
    setMessage(persisted ? t.recorded : t.completeNotPersisted);
    onSuccess?.(paymentRecord);
    setTimeout(() => onNext(), 600);
  };

  /* ------------------------------- Buttons ------------------------------- */
  const baseButtonStyle = useMemo(
    () => ({
      backgroundColor: buttonBgColor,
      color: buttonFontColor,
      fontFamily: buttonFont,
      borderRadius: 12,
      transition: "background-color 160ms ease",
      cursor: "pointer",
      border: "none",
    }),
    [buttonBgColor, buttonFontColor, buttonFont]
  );

  const applyHover = (e, hover = true) => {
    try {
      e.currentTarget.style.backgroundColor = hover ? buttonHoverColor : buttonBgColor;
    } catch { }
  };

  /* ------------------------------- Discounts ------------------------------- */
  const [discountMessage, setDiscountMessage] = useState(null);
  const tryApplyDiscount = () => {
    const found = discountList.find(
      (d) =>
        String(d?.code || "").trim().toLowerCase() ===
        String(discountCodeInput).trim().toLowerCase()
    );
    if (!found) {
      setAppliedDiscount(null);
      setDiscountMessage(t.discountInvalid);
      return;
    }
    const normalized = {
      code: found.code,
      percent: found.percent != null ? Number(found.percent) : undefined,
      amount: found.amount != null ? Number(found.amount) : undefined,
    };
    setAppliedDiscount(normalized);
    setDiscountMessage(t.discountApplied);
  };

  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  const onTouchStartCarousel = (e) => {
    const touch = e.changedTouches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  };

  const onTouchEndCarousel = (e) => {
    if (touchStartX.current == null || touchStartY.current == null) return;

    const touch = e.changedTouches[0];
    const diffX = touch.clientX - touchStartX.current;
    const diffY = touch.clientY - touchStartY.current;

    // only react to horizontal swipe
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 0) prevPayment();
      else nextPayment();
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  /* ------------------------------- Modal body ------------------------------- */
  const renderUnifiedPaymentPanel = () => {
    return (
      <div className="w-full max-w-[980px] mx-auto px-6 md:px-10 relative z-10">
        <div
          className="w-full px-4 py-4 touch-pan-y"
          onTouchStart={onTouchStartCarousel}
          onTouchEnd={onTouchEndCarousel}
        >
          <div className="flex flex-col items-center text-center">

            <div className="w-full bg-white shadow-xl border border-black/5 rounded-[20px] max-w-[650px] min-h-[470px] flex items-start justify-center">

              {/* ── Gateway QR slide ── */}
              {activePayment === "gateway-qr" && (
                <div className="w-full m-4 flex flex-col items-center text-center">
                  <h3
                    className="font-bold"
                    style={{ fontFamily: headerFont, color: headerFontColor, fontSize: "clamp(20px, 2.8vh, 42px)" }}
                  >
                    {isTagalog ? `Bayad gamit ang ${gatewayLabel}` : `Pay using ${gatewayLabel}`}
                  </h3>

                  <p
                    className="mt-3 max-w-[520px]"
                    style={{ fontFamily: generalFont, color: generalFontColor, fontSize: "clamp(12px, 1.6vh, 18px)" }}
                  >
                    {isTagalog
                      ? "I-scan ang QR code gamit ang iyong phone para kumpletuhin ang bayad. Awtomatikong magsisimula ang session."
                      : `Scan the QR code with your phone to complete payment. Your session starts automatically once confirmed.`}
                  </p>

                  <div
                    className="mt-6 rounded-[18px] shadow-inner flex items-center justify-center"
                    style={{ width: "clamp(160px, 22vh, 280px)", height: "clamp(160px, 22vh, 280px)", backgroundColor: "#ffffff", border: "1px solid rgba(0,0,0,0.08)" }}
                  >
                    {paymentConfirmed ? (
                      <div className="flex flex-col items-center gap-2">
                        <svg style={{ width: "clamp(36px, 5vh, 56px)", height: "clamp(36px, 5vh, 56px)" }} className="text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        <span className="text-green-600 font-bold" style={{ fontSize: "clamp(12px, 1.6vh, 18px)" }}>{isTagalog ? "Natanggap!" : "Confirmed!"}</span>
                      </div>
                    ) : qrLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin" />
                        <span className="text-gray-400 text-sm">{isTagalog ? "Ginagawa ang QR..." : "Generating QR..."}</span>
                      </div>
                    ) : qrError ? (
                      <div className="flex flex-col items-center gap-2 px-4">
                        <span className="text-red-500 text-sm font-medium">{qrError}</span>
                        <button
                          type="button"
                          onClick={() => { activeQrProvider.current = null; setQrError(null); }}
                          className="text-xs text-indigo-600 underline"
                        >
                          {isTagalog ? "Subukang muli" : "Try again"}
                        </button>
                      </div>
                    ) : qrDataUrl ? (
                      <img src={qrDataUrl} alt="Payment QR" style={{ width: "clamp(140px, 20vh, 260px)", height: "clamp(140px, 20vh, 260px)" }} />
                    ) : (
                      <span className="text-gray-400 text-sm">Initializing...</span>
                    )}
                  </div>

                  {!paymentConfirmed && qrDataUrl && qrSourceId && (
                    <div className="mt-4 flex items-center gap-2 text-sm" style={{ fontFamily: generalFont, color: "#6b7280" }}>
                      <div className="w-3 h-3 border-2 border-gray-400 border-t-indigo-600 rounded-full animate-spin" />
                      {isTagalog ? "Naghihintay ng bayad..." : "Waiting for payment..."}
                    </div>
                  )}

                  <div className="mt-3 text-sm" style={{ fontFamily: generalFont, color: "#6b7280" }}>
                    {fmt(price)}
                  </div>
                </div>
              )}

              {activePayment === "cash" && cashMode === "manual" && (
                <div className="w-full m-4 flex flex-col items-center text-center">
                  <h3
                    className="text-3xl md:text-5xl font-bold"
                    style={{ fontFamily: headerFont, color: headerFontColor }}
                  >
                    {isTagalog ? "Cash Payment" : "Cash Payment"}
                  </h3>

                  <p
                    className="mt-3 text-base md:text-xl max-w-[520px]"
                    style={{ fontFamily: generalFont, color: generalFontColor }}
                  >
                    {isTagalog
                      ? "Tanggapin ang cash at kumpirmahin lamang kapag kumpleto na ang bayad."
                      : "Accept cash and confirm only after the full amount is received."}
                  </p>

                  <div className="mt-6 grid grid-cols-1 gap-4 w-full max-w-[420px]">
                    <div className="text-center">
                      <div className="text-base mb-1" style={{ color: "#6b7280" }}>
                        {isTagalog ? "To Pay" : "To Pay"}
                      </div>
                      <div
                        className="text-3xl md:text-5xl font-bold"
                        style={{ fontFamily: generalFont, color: generalFontColor }}
                      >
                        {fmt(price)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 text-sm md:text-base" style={{ color: "#6b7280", fontFamily: generalFont }}>
                    {t.attendantConfirm}
                  </div>

                  <button
                    type="button"
                    onClick={handleCashProceed}
                    disabled={processing}
                    className="mt-6 px-8 py-3 text-xl md:text-2xl font-bold disabled:opacity-60"
                    style={baseButtonStyle}
                    onMouseEnter={(e) => applyHover(e, true)}
                    onMouseLeave={(e) => applyHover(e, false)}
                  >
                    {processing ? t.processing : t.externalConfirm}
                  </button>
                </div>
              )}

              {activePayment === "cash" && cashMode === "hardware" && (
                <div className="w-full m-4 flex flex-col items-center text-center">
                  <h3
                    className="text-3xl md:text-5xl font-bold"
                    style={{ fontFamily: headerFont, color: headerFontColor }}
                  >
                    {isTagalog ? "Cash Payment" : "Cash Payment"}
                  </h3>

                  <p
                    className="mt-3 text-base md:text-xl max-w-[520px]"
                    style={{ fontFamily: generalFont, color: generalFontColor }}
                  >
                    {isTagalog
                      ? "Ilagay ang bayad sa machine. Awtomatikong magpapatuloy kapag kumpleto na."
                      : "Insert cash into the acceptor. The session starts automatically once the full amount is received."}
                  </p>

                  {/* Pulsing waiting indicator */}
                  <div className="mt-8 flex flex-col items-center gap-3">
                    <div className="relative flex h-20 w-20 items-center justify-center">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-30" />
                      <span className="relative inline-flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100">
                        <svg className="h-7 w-7 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M17 9V7a5 5 0 00-10 0v2M5 9h14l1 12H4L5 9z" />
                        </svg>
                      </span>
                    </div>
                    <p className="text-sm font-medium" style={{ color: "#6b7280" }}>
                      {isTagalog ? "Naghihintay ng bayad…" : "Waiting for payment…"}
                    </p>
                    <div className="mt-1 text-2xl font-bold" style={{ fontFamily: generalFont, color: generalFontColor }}>
                      {fmt(price)}
                    </div>
                  </div>

                  {/* Operator override — use if hardware glitches */}
                  <button
                    type="button"
                    onClick={handleCashProceed}
                    disabled={processing}
                    className="mt-10 text-xs underline opacity-50 disabled:opacity-30"
                    style={{ color: "#6b7280", fontFamily: generalFont }}
                  >
                    {isTagalog ? "Override (operator)" : "Override (operator only)"}
                  </button>
                </div>
              )}

            </div>

            {paymentSlides.length > 1 && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={prevPayment}
                  className="w-10 h-10 rounded-full border border-black/10 text-lg"
                  style={{ color: generalFontColor, backgroundColor: "#fff" }}
                >
                  ‹
                </button>

                <div className="flex items-center gap-2">
                  {paymentSlides.map((item, i) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => goToPayment(i)}
                      className={`transition-all duration-300 rounded-full ${paymentIndex === i ? "w-8 h-2.5" : "w-2.5 h-2.5"
                        }`}
                      style={{
                        backgroundColor:
                          paymentIndex === i ? buttonBgColor : "rgba(0,0,0,0.18)",
                      }}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={nextPayment}
                  className="w-10 h-10 rounded-full border border-black/10 text-lg"
                  style={{ color: generalFontColor, backgroundColor: "#fff" }}
                >
                  ›
                </button>
              </div>
            )}

            {message && (
              <div
                className="mt-6 text-center text-sm md:text-base"
                style={{ color: generalFontColor, fontFamily: generalFont }}
              >
                {message}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const resetMessages = () => {
    setMessage(null);
    setDiscountMessage(null);
  };

  /* --------------------------------- Render --------------------------------- */
  if (isUnsupported) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-center gap-6" style={{ backgroundColor: bgColor }}>
        <p style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(22px, 3vw, 56px)', fontWeight: 'bold' }}>Display Not Supported</p>
        <p style={{ fontFamily: generalFont, color: generalFontColor, fontSize: 'clamp(14px, 1.8vw, 34px)' }}>Minimum resolution: 1080 × 1920 (Full HD portrait)</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={mounted ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="relative w-full h-screen text-black overflow-hidden flex flex-col"
      style={{ backgroundColor: bgColor }}
    >

      {/* Row 1: Title & amount left + hint & timer right */}
      <div className="shrink-0 grid grid-cols-2 gap-6 items-start relative z-10" style={{ padding: '2vh 4vw' }}>
        <div className="flex flex-col gap-2">
          <h1
            className="leading-tight"
            style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(44px, 5.5vw, 108px)', marginTop: '2vh' }}
          >
            {t.titleChoose} {isTagalog ? "iyong" : "your"}<br /><span className="italic font-bold">{t.titlePaymentOption}</span>
          </h1>
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full"
            style={{ background: "rgba(0,0,0,0.05)", fontFamily: generalFont, color: generalFontColor, width: 'fit-content' }}
          >
            <span style={{ fontSize: 'clamp(14px, 1.6vw, 30px)' }}>{t.amountDueLabel}</span>
            <span className="font-bold" style={{ fontSize: 'clamp(16px, 1.8vw, 34px)' }}>{fmt(price)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end text-right gap-2" style={{ paddingRight: '3vw', marginTop: '2vh' }}>
          <p
            style={{ fontFamily: generalFont, color: generalFontColor, fontSize: 'clamp(14px, 1.6vw, 30px)', opacity: 0.75 }}
          >
            {t.hintProceed}
          </p>
          {paymentEnabled && (
            <div
              className="px-5 py-2 rounded-full font-bold shadow-sm"
              style={{ backgroundColor: buttonBgColor, color: buttonFontColor, fontFamily: generalFont, fontSize: 'clamp(16px, 2vw, 38px)' }}
              aria-live="polite"
            >
              {Math.max(0, timeLeft)}s
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Payment panel centered */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-y-auto relative z-10" style={{ marginTop: '1vh' }}>
        {noProviders ? (
          <div className="text-center text-sm" style={{ color: "#6b7280", fontFamily: generalFont }}>
            {isTagalog ? "Walang naka-enable na payment provider." : "No payment providers are enabled."}
          </div>
        ) : (
          renderUnifiedPaymentPanel()
        )}
      </div>

      {/* Row 3: Logo */}
      {/* Row 3: Logo bottom-right */}
      <div className="shrink-0 flex items-center justify-end relative z-10" style={{ padding: '1vh 4vw 2vh' }}>
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ maxHeight: `${Math.round(50 * logoScale)}px` }} className="w-auto object-contain" />
          : <span className="font-bold" style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(14px, 1.6vw, 30px)' }}>{boothName}</span>
        }
      </div>
    </motion.div>
  );
}
