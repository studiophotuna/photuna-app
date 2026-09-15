
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { normalizeToFileUrl } from "../utils/mediaUrl";
import { loadGoogleFont } from "../utils/fontLoader";
import { DEFAULT_APPEARANCE } from "../utils/appearance";
import { useLayout } from "../utils/useLayout";
import useUsbLiveView from "../hooks/useUsbLiveView";
import { isUsbLiveViewSupported } from "../services/usbLiveView";
import { boothTheme, BoothButton, BoothSpinner, TYPE, panelStyle } from "../components/booth/boothUi";

/**
 * WelcomeScreen
 */
export default function WelcomeScreen({ eventConfig = {}, event = null, onNext }) {
  const { isUnsupported } = useLayout();
  const videoRef = useRef(null);
  const liveCamRef = useRef(null);
  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cacheBuster, setCacheBuster] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const cfg = event?.config ?? eventConfig ?? {};
  const appearance = event?.appearance ?? {};
  const backgroundType = appearance?.backgroundType ?? "media";

  const rawVideoSrc = appearance?.backgroundMediaPath ?? "";
  const rawLogo = appearance?.logoPath ?? "";
  const rawPoster = appearance?.posterPath ?? "";

  // Photo source "usb": the live background shows the USB camera's live view, and the
  // webcam only if that live view is unavailable.
  const [globalCameraSource, setGlobalCameraSource] = useState(null);
  useEffect(() => {
    if (backgroundType !== "camera") return;
    (async () => {
      try {
        const s = await (window.api ?? window.electron)?.getSettings?.();
        if (mountedRef.current) setGlobalCameraSource(s?.cameraSource ?? null);
      } catch { }
    })();
  }, [backgroundType, event?.settings?.cameraSource]);

  const useUsbBackground = backgroundType === "camera"
    && isUsbLiveViewSupported()
    // This booth's own setting first; an event's copy can be older.
    && (globalCameraSource ?? event?.settings?.cameraSource) === "usb";
  const liveCanvasRef = useRef(null);
  const usbLive = useUsbLiveView(useUsbBackground, liveCanvasRef);
  const showUsbBackground = useUsbBackground && !usbLive.failed;

  useEffect(() => {
    if (backgroundType !== "camera" || showUsbBackground) return;
    let stream = null;
    (async () => {
      try {
        const settings = await window.electron?.invoke?.("store:getSettings", {});
        const constraints = { video: settings?.selectedCameraId ? { deviceId: { exact: settings.selectedCameraId } } : true, audio: false };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (liveCamRef.current) {
          liveCamRef.current.srcObject = stream;
        }
      } catch (e) {
        console.warn("[WelcomeScreen] live camera background failed:", e?.message);
      }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [backgroundType, showUsbBackground]);

  const videoSrc = useMemo(() => normalizeToFileUrl(rawVideoSrc), [rawVideoSrc]);
  const logo = useMemo(() => normalizeToFileUrl(rawLogo), [rawLogo]);
  const poster = useMemo(() => normalizeToFileUrl(rawPoster), [rawPoster]);

  const centerLogo = useMemo(
    () => normalizeToFileUrl(eventConfig?.centerLogo || ""),
    [eventConfig?.centerLogo]
  );

  const selectedLogo = logo || centerLogo || "";
  const logoScale = (appearance?.logoSize ?? 100) / 100;

  const eventName = appearance?.boothName ?? cfg?.eventName ?? "Studio Photuna";
  const tagline = appearance?.boothSlogan ?? cfg?.tagline ?? "Ahead of the moment.";

  const bgColor = appearance?.bgColor ?? "#000000";
  const headerFont = appearance?.headerFont ?? "Ramillas";
  const generalFont = appearance?.generalFont ?? "Interphases";

  const headerFontColor = appearance?.headerFontColor ?? "#ffffff";
  const generalFontColor = appearance?.generalFontColor ?? "#e5e5e5";

  const buttonBgColor = appearance?.buttonBgColor || "#ec4899";
  const buttonHoverColor = appearance?.buttonHoverColor || "#db2777";
  const buttonFont = appearance?.buttonFont || generalFont;
  const buttonFontColor = appearance?.buttonFontColor || "#ffffff";

  const theme = boothTheme({
    bgColor, headerFontColor, generalFontColor, buttonBgColor, buttonHoverColor, buttonFontColor,
    headerFont, generalFont, buttonFont,
  });

  const startButtonHidden = !!appearance?.startButtonHidden;
  const startButtonText = appearance?.startButtonText?.trim?.() || "Tap to Start";

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  const handleLoaded = useCallback(() => {
    if (!mountedRef.current) return;
    setLoading(false);
    setError(null);
    if (videoRef.current) {
      videoRef.current.muted = true;
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => { });
      }
    }
  }, []);

  const handleError = useCallback(() => {
    if (!mountedRef.current) return;
    setError("Failed to load video");
    setLoading(false);
  }, []);

  const handleBackgroundClick = () => {
    onNext?.();
  };

  // JSX variable — not a component function. Avoids React remounting on every parent re-render.
  const centeredContent = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.6 }}
      className="relative z-30 flex flex-col items-center max-w-5xl text-center mx-auto px-6"
    >
      {selectedLogo ? (
        <img
          src={selectedLogo}
          alt="Logo"
          className="object-contain mb-8"
          style={{ maxHeight: `${Math.round(250 * logoScale)}px`, maxWidth: '100%' }}
        />
      ) : (
        <>
          <h1
            className="font-bold leading-tight"
            style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(28px, 7vw, 100px)' }}
          >
            <span className="italic font-bold">{eventName}</span>
          </h1>
          {tagline && (
            <p className="mt-4 opacity-80" style={{ color: generalFontColor, fontSize: 'clamp(14px, 2.2vw, 32px)' }}>
              {tagline}
            </p>
          )}
        </>
      )}

      {!startButtonHidden && (
        <BoothButton
          theme={theme}
          size="lg"
          onClick={(e) => {
            e.stopPropagation();
            onNext?.();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: prefersReducedMotion ? 0 : 0.4 }}
          aria-label={startButtonText || "Tap to Start"}
          style={{
            marginTop: "clamp(28px, 5vh, 56px)",
            padding: "clamp(16px, 2.4vh, 32px) clamp(48px, 7vw, 96px)",
            fontSize: "clamp(20px, 2.8vh, 40px)",
            letterSpacing: "0.01em",
          }}
        >
          {startButtonText}
        </BoothButton>
      )}
    </motion.div>
  );

  const liveCameraBackground = backgroundType !== "camera" ? null : showUsbBackground ? (
    <canvas
      ref={liveCanvasRef}
      className="absolute inset-0 w-full h-full object-cover pointer-events-none -scale-x-100"
      aria-hidden="true"
    />
  ) : (
    <video
      ref={liveCamRef}
      autoPlay
      muted
      playsInline
      className="absolute inset-0 w-full h-full object-cover pointer-events-none -scale-x-100"
      aria-hidden="true"
    />
  );

  if (isUnsupported) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-center gap-6" style={{ backgroundColor: bgColor }}>
        <p style={{ fontFamily: headerFont, color: headerFontColor, fontSize: 'clamp(22px, 3vw, 56px)', fontWeight: 'bold' }}>Display Not Supported</p>
        <p style={{ fontFamily: generalFont, color: generalFontColor, fontSize: 'clamp(14px, 1.8vw, 34px)' }}>Minimum resolution: 1080 × 1920 (Full HD portrait)</p>
      </div>
    );
  }

  if (!videoSrc || backgroundType === "camera") {
    return (
      <div
        className="relative w-full h-screen flex items-center justify-center"
        style={{ backgroundColor: bgColor, fontFamily: generalFont, color: generalFontColor }}
        onClick={handleBackgroundClick}
        role="button"
        tabIndex={0}
      >
        {liveCameraBackground}
        {liveCameraBackground && <div className="absolute inset-0 bg-black/30 pointer-events-none" />}
        {centeredContent}
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-screen overflow-hidden flex items-center justify-center"
      style={{ backgroundColor: bgColor, fontFamily: generalFont, color: generalFontColor }}
      onClick={handleBackgroundClick}
      role="button"
      tabIndex={0}
      aria-label="Tap to Start"
    >

      {/* Background media (image or video) */}
      {(() => {
        const src = videoSrc; // string
        if (!src) return null;

        // Strip params/anchors to detect ext reliably
        const plain = src.split('#')[0].split('?')[0];
        const isImage = /\.(gif|jpe?g|png|webp|bmp|tiff?)$/i.test(plain);
        const isSvg = /\.svg$/i.test(plain);

        if (isImage && !isSvg) {
          const bustedSrc = cacheBuster > 0 ? `${src}?_cb=${cacheBuster}` : src;
          return (
            <img
              src={bustedSrc}
              onLoad={handleLoaded}
              onError={handleError}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              alt=""
              aria-hidden="true"
            />
          );
        }

        return (
          <video
            ref={videoRef}
            src={src}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
            onLoadedData={handleLoaded}
            onError={handleError}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            poster={poster || ''}
          />
        );
      })()}

      {/* Optional: readability gradient overlay (toggle on if desired) */}
      {/* <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" /> */}

      {/* Centered content (logo, CTA) */}
      {centeredContent}

      {/* Loading and error overlays */}
      <AnimatePresence>
        {loading && (
          <motion.div
            key="loading"
            className="absolute z-50 inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-live="polite"
          >
            <div
              className="flex flex-col items-center gap-3 px-6 py-4"
              style={{ backgroundColor: "rgba(0, 0, 0, 0.45)", border: "1px solid rgba(255, 255, 255, 0.2)", borderRadius: 16, backdropFilter: "blur(8px)" }}
            >
              <BoothSpinner theme={theme} size={30} color="#ffffff" />
              <span style={{ ...TYPE.caption, color: "#ffffff" }}>Loading…</span>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            key="error"
            className="absolute z-50 inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-live="assertive"
          >
            <div
              className="px-6 py-5 text-center max-w-sm"
              style={{ ...panelStyle(theme), backgroundColor: bgColor, color: theme.text }}
            >
              <p style={{ ...TYPE.title, fontFamily: headerFont, color: theme.text, marginBottom: 6 }}>Media unavailable</p>
              <p style={{ ...TYPE.caption, color: theme.muted, marginBottom: 16 }}>{error}</p>
              <div className="flex justify-center gap-3">
                <BoothButton
                  theme={theme}
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setError(null);
                    setLoading(true);
                    // Reload video if it's a <video>, otherwise re-trigger <img> by cache busting
                    if (videoRef?.current) {
                      videoRef.current.load();
                    } else {
                      setCacheBuster((x) => x + 1);
                    }
                  }}
                >
                  Retry
                </BoothButton>
                <BoothButton
                  theme={theme}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNext?.();
                  }}
                >
                  Continue
                </BoothButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}