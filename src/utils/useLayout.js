import { useState, useEffect } from "react";

function measure() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isPortrait = h > w;
  const short = Math.min(w, h);

  // Portrait resolution support:
  //   Min: 1080px wide (1080×1920 FHD portrait) for dedicated kiosk displays
  //   Tablets (iPad) in portrait are narrower but are valid — don't block them.
  const isUnsupported = isPortrait && short < 1080 && w < 768;

  // 2K tier: QHD (1440×2560) and 2K (1920×2880) — larger grids / fonts.
  const isPortrait2K = isPortrait && short >= 1440;

  // Landscape tablet: iPad-sized screens (4:3 / 3:2 ratio) in landscape.
  // Exclude 16:9 widescreen Windows monitors — their short side can also be < 1080
  // but ratio > 1.6 clearly identifies them as widescreen, not tablets.
  const ratio = Math.max(w, h) / Math.min(w, h);
  const isTablet = !isPortrait && short >= 550 && short < 1080 && ratio < 1.6;

  return {
    isPortrait,
    isLandscape: !isPortrait,
    isTablet,
    isUnsupported,
    isPortrait2K,
    vw: w,
    vh: h,
  };
}

export function useLayout() {
  const [state, setState] = useState(measure);
  useEffect(() => {
    const update = () => setState(measure());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return state;
}
