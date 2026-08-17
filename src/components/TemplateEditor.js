import React, {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";

/** ========= PRINT & UI CONSTANTS (NEW) ========= */
const DEFAULT_SNAP_PX = 6;
const makeId = () => Math.random().toString(36).slice(2, 10);

// Paper specs (inches)
const PAPER_SPECS = {
    "4x6": { wIn: 4, hIn: 6 },
    "2x6": { wIn: 2, hIn: 6 },
    "6x4": { wIn: 6, hIn: 4 },
    "6x2": { wIn: 6, hIn: 2 },

};
// Default print/production conventions
const DEFAULT_DPI = 300;             // print resolution reference
const DEFAULT_SAFE_MM = 5;           // inner safe margin for text/photos
const DEFAULT_TRIM_MM = 0;           // inner trim indicator (no bleed on dye-sub)
const DEFAULT_GRID_STEP_PCT = 0.02;  // 2% grid lines
const DEFAULT_SNAP_THRESHOLD_PCT = 0.008;
const MAX_THUMBNAIL_SIZE_MB = 5;
const VALID_THUMB_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Camera aspect presets (unchanged, used for slot lock) */
const CAMERA_ASPECTS = {
    "2x3": 2 / 3,
    "3x2": 3 / 2,
    "1x1": 1,
    "4x6": 4 / 6,
    "6x4": 6 / 4,
    "9x16": 9 / 16,
    "16x9": 16 / 9,
};

// Utilities
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const toPct = (n) => (n === "" ? "" : Math.round(n * 1000) / 10);
const simpleClone = (obj) => JSON.parse(JSON.stringify(obj));

function nearestWithin(arr, eps) {
    let best = 0, bestAbs = eps + 1;
    for (const v of arr) {
        const a = Math.abs(v);
        if (a < bestAbs && a <= eps) { best = v; bestAbs = a; }
    }
    return best;
}

const handlePosition = {
    nw: { left: 0, top: 0 },
    n: { left: "50%", top: 0 },
    ne: { left: "100%", top: 0 },
    e: { left: "100%", top: "50%" },
    se: { left: "100%", top: "100%" },
    s: { left: "50%", top: "100%" },
    sw: { left: 0, top: "100%" },
    w: { left: 0, top: "50%" },
};

// ========== ICON BUTTON HELPERS ==========
function IcoBtn({ onClick, title, children, className = "" }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all ${className}`}
        >
            {children}
        </button>
    );
}

function TogIcoBtn({ active, onClick, title, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={`inline-flex items-center justify-center w-9 h-9 rounded-lg transition-all active:scale-95 ${
                active
                    ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-700"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            }`}
        >
            {children}
        </button>
    );
}

// ========== COMPONENT ==========
export default function TemplateEditor({
    open,
    onClose,
    accentColor,
    editing,
    initialName = "",
    initialSlots = [],
    initialThumb = null,
    initialLayout = "4x6",     // accepted by AdminDashboard already
    onLayoutChange,            // optional: AdminDashboard listens and updates
    initialPrintMode = "single",  // 'single' | 'dual' (dual = two strips on one sheet)
    onPrintModeChange,
    onSave,
    backgroundUrl,
    frames = [],
    initialAttachedFrameIds = [],     // NEW: multi-attach
    initialActiveFrameId = null,      // NEW: highlighted frame
}) {
    /** ---------- Core State ---------- */
    const [name, setName] = useState(initialName);
    const [slots, setSlots] = useState(() => ensureSlotNumbers(initialSlots || []));
    const [selection, setSelection] = useState([]);
    const [thumb, setThumbnail] = useState(initialThumb);
    const [error, setError] = useState("");
    const [layout, setLayout] = useState(initialLayout ?? "4x6");
    const [printMode, setPrintMode] = useState(initialPrintMode ?? "single");
    const [isSaving, setIsSaving] = useState(false);

    // NEW: Multi-frame selection + highlight
    const [attachedFrameIds, setAttachedFrameIds] = useState(
        Array.isArray(initialAttachedFrameIds) ? initialAttachedFrameIds.slice() : []
    );
    const [activeFrameId, setActiveFrameId] = useState(initialActiveFrameId ?? null);

    // Keep local state in sync when a different template is opened
    useEffect(() => {
        setAttachedFrameIds(Array.isArray(initialAttachedFrameIds) ? initialAttachedFrameIds.slice() : []);
        setActiveFrameId(initialActiveFrameId ?? null);
    }, [initialAttachedFrameIds, initialActiveFrameId]);

    // Frames that actually have an overlay for this layout
    const framesForLayout = useMemo(
        () => frames.filter(f => f?.previews?.[layout]?.originalDataUrl),
        [frames, layout]
    );

    // If layout changes, drop attachments that don't have this layout; adjust active if needed
    useEffect(() => {
        const hasForLayout = (id) =>
            frames.some(f => f.id === id && f?.previews?.[layout]?.originalDataUrl);
        setAttachedFrameIds(prev => prev.filter(hasForLayout));
        setActiveFrameId(prev => (prev && hasForLayout(prev) ? prev : null));
    }, [layout, frames]);

    // Background priority: active → first attached → fallback prop
    const computedBgUrl = useMemo(() => {
        const lookup = (id) =>
            frames.find(f => f.id === id)?.previews?.[layout]?.originalDataUrl;
        return (
            (activeFrameId && lookup(activeFrameId)) ||
            (attachedFrameIds.length && lookup(attachedFrameIds[0])) ||
            backgroundUrl ||
            null
        );
    }, [activeFrameId, attachedFrameIds, frames, layout, backgroundUrl]);

    useEffect(() => {
        setName(initialName);
        setSlots(ensureSlotNumbers(initialSlots || []));
        setThumbnail(initialThumb);
        setLayout(initialLayout ?? "4x6");
        setPrintMode(initialPrintMode ?? "single");
        setSelection([]);
        setError("");
        setApplyToCurrentEvent(false);
        setGuides({ x: [], y: [] });
        setMarquee(null);
        setDragState(null);
        setIsPanning(false);
        setSpacePressed(false);
        historyRef.current = { past: [], future: [] };
    }, [initialName, initialSlots, initialThumb, initialLayout, initialPrintMode, open]);

    // View/UI
    const [showGrid, setShowGrid] = useState(true);
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [snapPx, setSnapPx] = useState(DEFAULT_SNAP_PX);

    // NEW: adjustable grid step (percent in unit space)
    const [gridStepPct, setGridStepPct] = useState(DEFAULT_GRID_STEP_PCT);

    // NEW: print rulers & margins
    const [showRulers, setShowRulers] = useState(true);
    const [rulerUnit, setRulerUnit] = useState("mm");       // "mm" | "in"
    const [safeMm, setSafeMm] = useState(DEFAULT_SAFE_MM);
    const [trimMm, setTrimMm] = useState(DEFAULT_TRIM_MM);

    // NEW: fit-to-canvas + scale readout
    const [fitToCanvas, setFitToCanvas] = useState(true);

    // Grid/snap (keep % based)
    const GRID_SIZE = DEFAULT_GRID_STEP_PCT;            // 2% grid
    const SNAP_THRESHOLD = DEFAULT_SNAP_THRESHOLD_PCT;  // snap tolerance
    const [applyToCurrentEvent, setApplyToCurrentEvent] = useState(false);

    /** ---------- Zoom & Pan ---------- */
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });

    const minW = 0.02;
    const minH = 0.02;

    // Canvas refs
    const outerRef = useRef(null);
    const canvasRef = useRef(null);
    const [canvasRect, setCanvasRect] = useState(null);

    // Interaction
    const [isPanning, setIsPanning] = useState(false);
    const [spacePressed, setSpacePressed] = useState(false);
    const [marquee, setMarquee] = useState(null);
    const [dragState, setDragState] = useState(null);

    // Guides
    const [guides, setGuides] = useState({ x: [], y: [] });

    // History
    const historyRef = useRef({ past: [], future: [] });
    const slotsRef = useRef(slots);
    const selectionRef = useRef(selection);
    const commitHistory = (snapshot = slotsRef.current) => {
        historyRef.current.past.push(simpleClone(snapshot));
        historyRef.current.future = [];
    };
    const undo = () => {
        const past = historyRef.current.past;
        if (!past.length) return;
        const prevState = past.pop();
        historyRef.current.future.push(slotsRef.current);
        setSlots(prevState);
    };
    const redo = () => {
        const fut = historyRef.current.future;
        if (!fut.length) return;
        const next = fut.pop();
        historyRef.current.past.push(slotsRef.current);
        setSlots(next);
    };

    /** ---------- Derived ---------- */
    const selectedSlots = useMemo(
        () => selection.map(id => slots.find(s => s.id === id)).filter(Boolean),
        [selection, slots]
    );


    useEffect(() => {
        slotsRef.current = slots;
    }, [slots]);

    useEffect(() => {
        selectionRef.current = selection;
    }, [selection]);

    /** ---------- Helpers: Print Units (NEW) ---------- */
    const spec = PAPER_SPECS[layout] || PAPER_SPECS["4x6"];
    const mmPerW = spec.wIn * 25.4;
    const mmPerH = spec.hIn * 25.4;
    const mmXToUnit = (mm) => clamp01(mm / mmPerW);
    const mmYToUnit = (mm) => clamp01(mm / mmPerH);

    // Safe/trim rectangles in unit space
    const safeUx = mmXToUnit(safeMm);
    const safeUy = mmYToUnit(safeMm);
    const trimUx = mmXToUnit(trimMm);
    const trimUy = mmYToUnit(trimMm);

    /** ---------- Unit transforms ---------- */
    const viewToCanvas = (vx, vy) => {
        if (!canvasRect) return { x: 0, y: 0 };
        const nx = clamp01((vx - pan.x) / (canvasRect.width * zoom));
        const ny = clamp01((vy - pan.y) / (canvasRect.height * zoom));
        return { x: nx, y: ny };
    };
    const pxToNorm = (px) => (!canvasRect ? 0 : px / (canvasRect.width * zoom));
    const normSnapThreshold = () => pxToNorm(snapPx);

    /** ---------- Snap helpers ---------- */
    function snapValue(value, step = gridStepPct) {
        return Math.round(value / step) * step;
    }

    function snapIfClose(value, targets, threshold = SNAP_THRESHOLD) {
        for (let t of targets) {
            if (Math.abs(value - t) < threshold) return t;
        }
        return value;
    }

    /** ---------- Rotation helpers ---------- */
    const degToRad = (deg) => (deg * Math.PI) / 180;
    function rotatedBBoxHalfExtents(w, h, deg) {
        const t = degToRad(deg || 0);
        const c = Math.abs(Math.cos(t));
        const s = Math.abs(Math.sin(t));
        return { hx: (w * c + h * s) / 2, hy: (w * s + h * c) / 2 };
    }
    function clampSlotByRotation(slot) {
        const { w, h, rotation } = slot;
        const { hx, hy } = rotatedBBoxHalfExtents(w, h, rotation || 0);
        const cx0 = slot.x + w / 2;
        const cy0 = slot.y + h / 2;
        const cx = clamp(cx0, hx, 1 - hx);
        const cy = clamp(cy0, hy, 1 - hy);
        return { ...slot, x: cx - w / 2, y: cy - h / 2 };
    }
    function toLocalAxes(dx, dy, deg) {
        const t = degToRad(deg || 0);
        const localX = dx * Math.cos(t) + dy * Math.sin(t);
        const localY = -dx * Math.sin(t) + dy * Math.cos(t);
        return { localX, localY };
    }
    function clampSizeByRotation(w, h, deg) {
        const { hx, hy } = rotatedBBoxHalfExtents(w, h, deg || 0);
        const maxHalf = 0.5;
        if (hx <= maxHalf && hy <= maxHalf) return { w, h };
        const sx = maxHalf / hx;
        const sy = maxHalf / hy;
        const s = Math.min(sx, sy);
        return { w: w * s, h: h * s };
    }
    function slotEdges(s) {
        const { hx, hy } = rotatedBBoxHalfExtents(s.w, s.h, s.rotation || 0);
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        return { left: cx - hx, right: cx + hx, top: cy - hy, bottom: cy + hy, cx, cy };
    }

    /** ---------- Smart guides ---------- */
    function computeGuidesAndSnapRotated(movingIds, next, snap) {
        if (!snap || movingIds.size === 0) return { next, guides: { x: [], y: [] } };
        const eps = normSnapThreshold();
        const others = next.filter(s => !movingIds.has(s.id) && !s.hidden);

        // Candidates include canvas edges, centers, and safe/trim lines
        const candidatesX = [0, 0.5, 1, safeUx, 1 - safeUx, trimUx, 1 - trimUx];
        const candidatesY = [0, 0.5, 1, safeUy, 1 - safeUy, trimUy, 1 - trimUy];
        for (const s of others) {
            const e = slotEdges(s);
            candidatesX.push(e.left, e.cx, e.right);
            candidatesY.push(e.top, e.cy, e.bottom);
        }

        const lineX = new Set();
        const lineY = new Set();
        const snapValueWithin = (v, cands, collect) => {
            let best = v, bestDist = eps + 1;
            for (const c of cands) {
                const d = Math.abs(c - v);
                if (d < bestDist && d <= eps) { best = c; bestDist = d; }
            }
            if (best !== v) collect.add(best);
            return best;
        };

        const updated = next.map(s => {
            if (!movingIds.has(s.id) || s.locked) return s;
            const e = slotEdges(s);
            const left = snapValueWithin(e.left, candidatesX, lineX);
            const cx = snapValueWithin(e.cx, candidatesX, lineX);
            const right = snapValueWithin(e.right, candidatesX, lineX);
            const top = snapValueWithin(e.top, candidatesY, lineY);
            const cy = snapValueWithin(e.cy, candidatesY, lineY);
            const bottom = snapValueWithin(e.bottom, candidatesY, lineY);

            const dxOpts = [left - e.left, cx - e.cx, right - e.right];
            const dyOpts = [top - e.top, cy - e.cy, bottom - e.bottom];
            const dx = nearestWithin(dxOpts, eps);
            const dy = nearestWithin(dyOpts, eps);

            if (dx !== 0 || dy !== 0) {
                const cxNew = e.cx + dx;
                const cyNew = e.cy + dy;
                const { w, h, rotation } = s;
                const { hx, hy } = rotatedBBoxHalfExtents(w, h, rotation || 0);
                const cxClamped = clamp(cxNew, hx, 1 - hx);
                const cyClamped = clamp(cyNew, hy, 1 - hy);
                const x = cxClamped - w / 2;
                const y = cyClamped - h / 2;
                return { ...s, x, y };
            }
            return s;
        });

        return { next: updated, guides: { x: Array.from(lineX), y: Array.from(lineY) } };
    }

    /** ---------- Effects ---------- */
    useLayoutEffect(() => {
        if (!open) return;
        const updateRect = () => {
            if (canvasRef.current) setCanvasRect(canvasRef.current.getBoundingClientRect());
        };
        updateRect();

        let ro;
        if (window.ResizeObserver) {
            ro = new ResizeObserver(updateRect);
            if (canvasRef.current) ro.observe(canvasRef.current);
        } else {
            window.addEventListener("resize", updateRect);
        }
        return () => {
            window.removeEventListener("resize", updateRect);
            if (ro) ro.disconnect();
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const isEditableTarget = (el) => {
            if (!el || !(el instanceof HTMLElement)) return false;
            if (el.isContentEditable) return true;
            const tag = el.tagName;
            if (!tag) return false;
            if (tag === "INPUT" || tag === "TEXTAREA") return true;
            // Also treat selects and contenteditable descendants as editable:
            if (tag === "SELECT") return true;
            // If the element lives inside a contentEditable container:
            const editableAncestor = el.closest("[contenteditable='true']");
            return !!editableAncestor;
        };

        const onKeyDown = (e) => {

            // ⛔️ Do not hijack keys while typing in inputs / textareas / contentEditable
            if (isEditableTarget(e.target)) return;

            if (e.code === "Space") { setSpacePressed(true); e.preventDefault(); }
            if (e.key === "?") {
                // little helper tip
                const tip = document.getElementById("kb-help-tip");
                if (tip) { tip.style.opacity = "1"; setTimeout(() => (tip.style.opacity = "0"), 1500); }
            }
            if (e.metaKey || e.ctrlKey) {
                const k = e.key.toLowerCase();
                if (k === "a") { e.preventDefault(); setSelection(slotsRef.current.filter(s => !s.hidden).map(s => s.id)); }
                else if (k === "d") { e.preventDefault(); duplicateSelection(); }
                else if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
                else if (k === "y") { e.preventDefault(); redo(); }
            }
            if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); }
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && selectionRef.current.length) {
                e.preventDefault();
                const delta = e.shiftKey ? 0.01 : 0.001;
                commitHistory();
                setSlots(prev =>
                    prev.map(s => {
                        if (!selectionRef.current.includes(s.id) || s.locked) return s;
                        if (e.key === "ArrowUp") return { ...s, y: clamp01(s.y - delta) };
                        if (e.key === "ArrowDown") return { ...s, y: clamp01(s.y + delta) };
                        if (e.key === "ArrowLeft") return { ...s, x: clamp01(s.x - delta) };
                        if (e.key === "ArrowRight") return { ...s, x: clamp01(s.x + delta) };
                        return s;
                    })
                );
            }
        };
        const onKeyUp = (e) => {
            // Ignore while typing
            if (isEditableTarget(e.target)) return;
            if (e.code === "Space") setSpacePressed(false);
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [open]);

    /** ---------- Actions ---------- */
    const addSlot = () => {
        const id = makeId();
        const count = slots.length;
        const offset = 0.06 * (count % 6);

        const baseH = 0.20;
        const baseW = (baseH * 16) / 9;

        const newSlot = {
            id,
            x: Math.min(0.85, 0.1 + offset),
            y: Math.min(0.85, 0.1 + Math.floor(count / 6) * 0.06),
            w: baseW,
            h: baseH,
            rotation: 0,
            slotNumber: count + 1,
            // NEW: aesthetics
            borderWidth: 0.005,         // ~0.5% of canvas width
            borderColor: "#9ca3af",
            cornerRadius: 0.01,
            shadow: 0,                  // 0..1 intensity
            aspectLock: null,           // one of CAMERA_ASPECTS keys
            overlayColor: "rgba(0,0,0,0)", // transparent
            overlayBlend: "normal",
            overlayOpacity: 0,          // 0..1
            filter: "none",             // css filter token: 'none'|'bw'|'sepia'|'warm'|'cool'
            fit: "cover",               // cover|contain
        };

        commitHistory();
        setSlots(prev => [...prev, newSlot]);
        setSelection([id]);
    };

    function reorder(arr, ids, dir) {
        const set = new Set(ids);
        const res = [...arr];
        for (let i = 0; i < res.length; i++) {
            if (!set.has(res[i].id)) continue;
            const j = i + dir;
            if (j < 0 || j >= res.length) continue;
            [res[i], res[j]] = [res[j], res[i]];
        }
        return res;
    }
    const deleteSelection = () => {
        if (!selection.length) return;
        commitHistory();
        setSlots(prev => {
            const toDelete = new Set(selection);
            const surviving = prev.filter(s => !toDelete.has(s.id));
            // Also remove clone slots whose source was deleted
            const cleaned = surviving.filter(s => !s.sourceSlotId || !toDelete.has(s.sourceSlotId));
            return ensureSlotNumbers(cleaned);
        });
        setSelection([]);
    };
    const duplicateSelection = () => {
        if (!selection.length) return;
        commitHistory();
        const clones = [];
        for (const id of selection) {
            const s = slots.find(x => x.id === id);
            if (!s) continue;
            clones.push({
                ...s,
                id: makeId(),
                x: clamp01(s.x + 0.02),
                y: clamp01(s.y + 0.02),
                slotNumber: 0,
            });
        }
        setSlots(prev => ensureSlotNumbers([...prev, ...clones]));
        setSelection(clones.map(c => c.id));
    };

    const cloneSelection = () => {
        if (!selection.length) return;
        commitHistory();
        const clones = [];
        for (const id of selection) {
            const s = slots.find(x => x.id === id);
            if (!s) continue;
            // Point to root source — don't chain clones from clones
            const sourceSlotId = s.sourceSlotId || s.id;
            clones.push({
                ...s,
                id: makeId(),
                x: clamp01(s.x + 0.02),
                y: clamp01(s.y + 0.02),
                sourceSlotId,
            });
        }
        setSlots(prev => ensureSlotNumbers([...prev, ...clones]));
        setSelection(clones.map(c => c.id));
    };
    const bringForward = () => {
        if (!selection.length) return;
        commitHistory();
        setSlots(prev => reorder(prev, selection, +1));
    };
    const sendBackward = () => {
        if (!selection.length) return;
        commitHistory();
        setSlots(prev => reorder(prev, selection, -1));
    };

    /** ---------- Pointer helpers & handlers (unchanged flow, improved) ---------- */
    const getPointerNorm = (ev) => {
        if (!canvasRect) return { x: 0, y: 0 };
        const vx = ev.clientX - canvasRect.left;
        const vy = ev.clientY - canvasRect.top;
        return viewToCanvas(vx, vy);
    };

    const onCanvasPointerDown = (ev) => {
        if (!open) return;
        // Fit-to-canvas disables accidental zoom/pan until space, keeps single-screen clarity
        if (spacePressed) {
            setIsPanning(true);
            ev.currentTarget.setPointerCapture && ev.currentTarget.setPointerCapture(ev.pointerId);
            return;
        }

        // NEW: use closest(...) so clicks on inner children still resolve to the slot or handle
        const targetEl = ev.target instanceof Element ? ev.target : null;
        const handleEl = targetEl ? targetEl.closest('[data-handle="true"]') : null;
        const slotEl = targetEl ? targetEl.closest("[data-slot-id]") : null;
        const isHandle = Boolean(handleEl);
        const slotId = slotEl?.getAttribute("data-slot-id") || undefined;
        const handleType = handleEl?.getAttribute("data-handle-type") || undefined; // "resize" | "rotate"
        const anchor = handleEl?.getAttribute("data-anchor") || undefined;


        if (isHandle && slotId && handleType) {
            ev.currentTarget.setPointerCapture && ev.currentTarget.setPointerCapture(ev.pointerId);
            commitHistory(slotsRef.current);
            setDragState({
                type: handleType,
                slotIds: selection.includes(slotId) ? selection : [slotId],
                anchor,
                startNorm: getPointerNorm(ev),
                startSlots: simpleClone(slots),
            });
            return;
        }

        if (slotId) {
            ev.currentTarget.setPointerCapture && ev.currentTarget.setPointerCapture(ev.pointerId);
            commitHistory(slotsRef.current);
            if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
                setSelection(prev => (prev.includes(slotId) ? prev.filter(id => id !== slotId) : [...prev, slotId]));
            } else if (!selection.includes(slotId)) {
                setSelection([slotId]);
            }
            setDragState({
                type: "move",
                slotIds: selection.includes(slotId) ? selection : [slotId],
                startNorm: getPointerNorm(ev),
                startSlots: simpleClone(slots),
            });
            return;
        }

        // Empty canvas => marquee select
        ev.currentTarget.setPointerCapture && ev.currentTarget.setPointerCapture(ev.pointerId);
        const start = getPointerNorm(ev);
        setMarquee({ x: start.x, y: start.y, w: 0, h: 0 });
    };

    const onCanvasPointerMove = (ev) => {
        if (!open || !canvasRect) return;

        if (isPanning) {
            setPan(p => ({ x: p.x + ev.movementX, y: p.y + ev.movementY }));
            return;
        }
        if (marquee) {
            const cur = getPointerNorm(ev);
            const x = Math.min(marquee.x, cur.x);
            const y = Math.min(marquee.y, cur.y);
            const w = Math.abs(cur.x - marquee.x);
            const h = Math.abs(cur.y - marquee.y);
            setMarquee({ x, y, w, h });
            return;
        }

        if (dragState) {
            const cur = getPointerNorm(ev);
            const dx = cur.x - dragState.startNorm.x;
            const dy = cur.y - dragState.startNorm.y;
            const ids = new Set(dragState.slotIds);

            if (dragState.type === "move") {
                let next = dragState.startSlots.map(s => {
                    if (!ids.has(s.id) || s.locked) return { ...s };
                    let nx = s.x + dx;
                    let ny = s.y + dy;
                    if (snapEnabled) { nx = snapValue(nx); ny = snapValue(ny); }
                    let moved = { ...s, x: nx, y: ny };
                    moved = clampSlotByRotation(moved);
                    return moved;
                });
                const res = computeGuidesAndSnapRotated(ids, next, snapEnabled);
                setGuides(res.guides);
                setSlots(res.next);
                return;
            }

            if (dragState.type === "resize" && dragState.anchor) {
                const a = dragState.anchor;
                let next = dragState.startSlots.map(s => {
                    if (!ids.has(s.id) || s.locked) return { ...s };

                    const rot = s.rotation || 0;
                    const { localX, localY } = toLocalAxes(dx, dy, rot);
                    const baseCx = s.x + s.w / 2;
                    const baseCy = s.y + s.h / 2;

                    let left = -s.w / 2;
                    let right = s.w / 2;
                    let top = -s.h / 2;
                    let bottom = s.h / 2;

                    if (a.includes("e")) right += localX;
                    if (a.includes("w")) left += localX;
                    if (a.includes("s")) bottom += localY;
                    if (a.includes("n")) top += localY;

                    if (right - left < minW) {
                        if (a.includes("w") && !a.includes("e")) left = right - minW;
                        else right = left + minW;
                    }
                    if (bottom - top < minH) {
                        if (a.includes("n") && !a.includes("s")) top = bottom - minH;
                        else bottom = top + minH;
                    }

                    let w = right - left;
                    let h = bottom - top;
                    let localCenterX = (left + right) / 2;
                    let localCenterY = (top + bottom) / 2;

                    if (s.aspectLock && CAMERA_ASPECTS[s.aspectLock]) {
                        const aspect = CAMERA_ASPECTS[s.aspectLock];
                        const widthFromHeight = h * aspect;
                        const heightFromWidth = w / aspect;

                        if ((a.includes("e") || a.includes("w")) && !(a.includes("n") || a.includes("s"))) {
                            h = widthFromHeight ? (w / aspect) : h;
                            if (a.includes("n")) top = bottom - h;
                            else if (a.includes("s")) bottom = top + h;
                            else {
                                top = localCenterY - h / 2;
                                bottom = localCenterY + h / 2;
                            }
                        } else if ((a.includes("n") || a.includes("s")) && !(a.includes("e") || a.includes("w"))) {
                            w = heightFromWidth ? (h * aspect) : w;
                            if (a.includes("w")) left = right - w;
                            else if (a.includes("e")) right = left + w;
                            else {
                                left = localCenterX - w / 2;
                                right = localCenterX + w / 2;
                            }
                        } else {
                            const startAspect = s.w / s.h;
                            if (Math.abs((w / h) - startAspect) >= Math.abs((heightFromWidth / h) - startAspect)) {
                                h = w / aspect;
                                if (a.includes("n")) top = bottom - h;
                                else bottom = top + h;
                            } else {
                                w = h * aspect;
                                if (a.includes("w")) left = right - w;
                                else right = left + w;
                            }
                        }
                        w = right - left;
                        h = bottom - top;
                        localCenterX = (left + right) / 2;
                        localCenterY = (top + bottom) / 2;
                    }

                    const cos = Math.cos(degToRad(rot));
                    const sin = Math.sin(degToRad(rot));
                    let cx = baseCx + (localCenterX * cos - localCenterY * sin);
                    let cy = baseCy + (localCenterX * sin + localCenterY * cos);

                    const sizeClamped = clampSizeByRotation(w, h, rot);
                    w = sizeClamped.w;
                    h = sizeClamped.h;

                    if (snapEnabled) {
                        w = snapValue(w);
                        h = snapValue(h);
                    }

                    const { hx, hy } = rotatedBBoxHalfExtents(w, h, rot);
                    cx = clamp(cx, hx, 1 - hx);
                    cy = clamp(cy, hy, 1 - hy);

                    return { ...s, x: cx - w / 2, y: cy - h / 2, w, h };
                });
                const res = computeGuidesAndSnapRotated(ids, next, snapEnabled);
                setGuides(res.guides);
                setSlots(res.next);
                return;
            }

            if (dragState.type === "rotate") {
                const next = dragState.startSlots.map(s => {
                    if (!ids.has(s.id) || s.locked) return s;
                    const base = s.rotation || 0;
                    return { ...s, rotation: Math.round((base + (dx - dy) * 360) % 360) };
                });
                setSlots(next);
                return;
            }
        }
    };

    const onCanvasPointerUp = () => {
        if (!open) return;
        setIsPanning(false);
        setGuides({ x: [], y: [] });

        if (marquee) {
            const rect = marquee;
            const box = { x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h };
            const ids = slots
                .filter(s => !s.hidden)
                .filter(s =>
                    s.x >= box.x1 && (s.x + s.w) <= box.x2 &&
                    s.y >= box.y1 && (s.y + s.h) <= box.y2
                )
                .map(s => s.id);
            setSelection(ids);
            setMarquee(null);
        }

        if (dragState) {
            setDragState(null);
        }
    };

    const onWheel = (e) => {
        if (fitToCanvas) return; // NEW: disable wheel zoom if fit-to-canvas is ON (keeps everything in view)
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.001);
        const newZoom = clamp(zoom * factor, 0.25, 4);

        if (!canvasRect) return;
        const vx = e.clientX - canvasRect.left;
        const vy = e.clientY - canvasRect.top;
        const before = { x: (vx - pan.x) / zoom, y: (vy - pan.y) / zoom };
        const after = { x: before.x * newZoom + pan.x, y: before.y * newZoom + pan.y };
        const newPan = { x: pan.x - (after.x - vx), y: pan.y - (after.y - vy) };

        setZoom(newZoom);
        setPan(newPan);
    };

    // NEW: Fit canvas always fully visible
    useEffect(() => {
        if (!fitToCanvas) return;

        const updateFit = () => {
            if (!canvasRef.current || !outerRef.current) return;
            const outer = outerRef.current.getBoundingClientRect();
            const pad = 28;

            const layoutSizes = {
                "4x6": { w: 600, h: 900 },
                "2x6": { w: 300, h: 900 },
                "6x4": { w: 900, h: 600 },
                "6x2": { w: 900, h: 300 },
            };

            const { w: baseW, h: baseH } = layoutSizes[layout] || layoutSizes["4x6"];
            const scaleX = (outer.width - pad * 2) / baseW;
            const scaleY = (outer.height - pad * 2) / baseH;
            const s = Math.max(0.1, Math.min(scaleX, scaleY));

            setZoom(s);
            setPan({ x: 0, y: 0 });
        };

        updateFit();
        window.addEventListener("resize", updateFit);
        return () => window.removeEventListener("resize", updateFit);
    }, [fitToCanvas, layout, showRulers, open]);

    /** ---------- UI ---------- */
    if (!open) return null;

    /** ---------- Render ---------- */
    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            <div className="w-full h-full overflow-hidden flex flex-col bg-[#f8fafc] dark:bg-slate-950">
                {/* Header */}
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-700/60 bg-white/95 dark:bg-slate-900/95 px-5 py-3 backdrop-blur">
                    <div className="flex flex-1 flex-wrap items-center gap-3">
                        <div className="flex flex-col mr-1">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Workspace</span>
                            <h5 className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-tight">
                                {initialSlots && initialSlots.length ? "Edit template" : "New template"}
                            </h5>
                        </div>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Template name"
                            className="h-9 min-w-[180px] rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition focus:border-indigo-400 focus:bg-white dark:focus:bg-slate-700 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900"
                        />
                        {/* Layout */}
                        <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Layout</div>
                        <div className="flex gap-1 items-center rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 p-1">
                            {editing ? (
                                <span className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                    {layout.replace("x", "×")} (locked)
                                </span>
                            ) : (
                                ["4x6", "2x6", "6x4", "6x2"].map(opt => (
                                    <label key={opt} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium cursor-pointer transition ${layout === opt ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}>
                                        <input type="radio" checked={layout === opt} className="sr-only" onChange={() => {
                                            setLayout(opt); onLayoutChange?.(opt);
                                            if (opt === "2x6" || opt === "6x2") { setPrintMode("single"); onPrintModeChange?.("single"); }
                                        }} />
                                        {opt.replace("x", "×")}
                                    </label>
                                ))
                            )}
                        </div>
                        {/* Print Mode */}
                        {(layout === "4x6" || layout === "6x4") && (
                            <>
                                <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Print</div>
                                <div className="flex gap-1 items-center rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 p-1">
                                    {[{ value: "single", label: "Single" }, { value: "dual", label: "2-Strip" }].map(({ value, label }) => (
                                        <label key={value} className={`inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium cursor-pointer transition ${printMode === value ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}>
                                            <input type="radio" name="printMode" checked={printMode === value} className="sr-only" onChange={() => { setPrintMode(value); onPrintModeChange?.(value); }} />
                                            {label}
                                        </label>
                                    ))}
                                </div>
                                {printMode === "dual" && (
                                    <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-lg px-2.5 py-1.5">
                                        Two strips on one sheet — cut down the middle.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-medium text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-700">
                            Close
                        </button>
                        <button
                            disabled={isSaving}
                            onClick={async () => {
                                const trimmedName = name.trim();
                                if (!trimmedName) { setError("Please enter a template name."); return; }
                                if (typeof onSave !== "function") { setError("Save handler missing: onSave is not a function."); return; }
                                try {
                                    setError(""); setIsSaving(true);
                                    await Promise.resolve(onSave({
                                        name: trimmedName,
                                        previewMeta: { slots: ensureSlotNumbers(slots).map(validateSlotForSave), thumbnailDataUrl: thumb || null, layout, printMode, attachedFrameIds, activeFrameId },
                                        applyToCurrentEvent,
                                    }));
                                } catch (saveError) {
                                    console.error("Template save failed", saveError);
                                    setError(saveError?.message || "Failed to save template. Please try again.");
                                } finally { setIsSaving(false); }
                            }}
                            className="inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(79,70,229,0.25)] transition hover:translate-y-[-1px] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
                            style={{ backgroundColor: accentColor }}
                        >
                            {isSaving ? "Saving…" : editing ? "Save" : "Create"}
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="grid flex-1 grid-cols-12 gap-4 overflow-hidden p-4 md:p-5">
                    {/* LEFT: Layers & Tools */}
                    <div className="col-span-12 lg:col-span-3 grid grid-cols-1 gap-3 overflow-auto pr-1">
                        {/* Toolbar */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500 mb-3">Slot actions</p>

                            {/* Row 1: Add / Edit actions */}
                            <div className="flex items-center gap-0.5 mb-1">
                                <IcoBtn onClick={addSlot} title="Add photo slot">
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="1.5" y="1.5" width="13" height="13" rx="2.5"/>
                                        <path d="M8 5v6M5 8h6"/>
                                    </svg>
                                </IcoBtn>
                                <IcoBtn onClick={duplicateSelection} title="Duplicate selection (Ctrl+D)">
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="5.5" y="1.5" width="9" height="9" rx="1.5"/>
                                        <rect x="1.5" y="5.5" width="9" height="9" rx="1.5"/>
                                    </svg>
                                </IcoBtn>
                                <IcoBtn onClick={cloneSelection} title="Clone — linked copy (shares same photo as source)" className="text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30">
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="1.5" y="1.5" width="7" height="7" rx="1.2"/>
                                        <rect x="7.5" y="7.5" width="7" height="7" rx="1.2"/>
                                        <path d="M8.5 4.5h2.5v2.5"/>
                                    </svg>
                                </IcoBtn>
                                <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                                <IcoBtn onClick={bringForward} title="Bring forward (higher layer)">
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="5" y="5" width="9" height="9" rx="1.5" className="opacity-30" fill="currentColor" stroke="currentColor"/>
                                        <rect x="2" y="2" width="9" height="9" rx="1.5"/>
                                        <path d="M5.5 2.5V1M5.5 1l-1.5 1.5M5.5 1l1.5 1.5"/>
                                    </svg>
                                </IcoBtn>
                                <IcoBtn onClick={sendBackward} title="Send backward (lower layer)">
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="2" y="2" width="9" height="9" rx="1.5" className="opacity-30" fill="currentColor" stroke="currentColor"/>
                                        <rect x="5" y="5" width="9" height="9" rx="1.5"/>
                                        <path d="M5.5 13.5V15M5.5 15l-1.5-1.5M5.5 15l1.5-1.5"/>
                                    </svg>
                                </IcoBtn>
                                <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                                <IcoBtn onClick={deleteSelection} title="Delete selected (Del / Backspace)" className="text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30">
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M2 4h12M5 4V2.5h6V4M4 4l.75 9.5h6.5L12 4"/>
                                        <path d="M6.5 7v4M9.5 7v4"/>
                                    </svg>
                                </IcoBtn>
                            </div>

                            {/* Row 2: Undo / Redo */}
                            <div className="flex items-center gap-0.5 mb-4">
                                <IcoBtn onClick={undo} title="Undo (Ctrl+Z)">
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3.5 6.5A5 5 0 1 1 5 11"/>
                                        <path d="M3.5 3.5v3h3"/>
                                    </svg>
                                </IcoBtn>
                                <IcoBtn onClick={redo} title="Redo (Ctrl+Y / Ctrl+Shift+Z)">
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12.5 6.5A5 5 0 1 0 11 11"/>
                                        <path d="M12.5 3.5v3h-3"/>
                                    </svg>
                                </IcoBtn>
                            </div>

                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500 mb-2">View</p>
                            {/* Row 3: View toggles */}
                            <div className="flex items-center gap-0.5 mb-4">
                                <TogIcoBtn active={showGrid} onClick={() => setShowGrid(v => !v)} title={showGrid ? "Hide grid" : "Show grid"}>
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                        <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="0.8"/>
                                        <rect x="9" y="1.5" width="5.5" height="5.5" rx="0.8"/>
                                        <rect x="1.5" y="9" width="5.5" height="5.5" rx="0.8"/>
                                        <rect x="9" y="9" width="5.5" height="5.5" rx="0.8"/>
                                    </svg>
                                </TogIcoBtn>
                                <TogIcoBtn active={snapEnabled} onClick={() => setSnapEnabled(v => !v)} title={snapEnabled ? "Disable snap" : "Enable snap"}>
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                        <path d="M5 2C3.34 2 2 3.34 2 5v4c0 .55.45 1 1 1h4c.55 0 1-.45 1-1V5c0-1.66-1.34-3-3-3z"/>
                                        <path d="M8 5h2.5M8 8h2.5M11 2v12M11 14l-1.5-1.5M11 14l1.5-1.5"/>
                                    </svg>
                                </TogIcoBtn>
                                <TogIcoBtn active={showRulers} onClick={() => setShowRulers(v => !v)} title={showRulers ? "Hide rulers" : "Show rulers"}>
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                        <rect x="1.5" y="5" width="13" height="6" rx="1.2"/>
                                        <path d="M4 5v3.5M6.5 5v2M9 5v3.5M11.5 5v2M14 5v3.5"/>
                                    </svg>
                                </TogIcoBtn>
                                <TogIcoBtn active={fitToCanvas} onClick={() => setFitToCanvas(v => !v)} title={fitToCanvas ? "Disable fit-to-canvas" : "Fit to canvas"}>
                                    <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1.5 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/>
                                    </svg>
                                </TogIcoBtn>
                            </div>

                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500 mb-2">Settings</p>
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                                    <span className="w-[68px] shrink-0">Grid step</span>
                                    <input type="range" min={0.005} max={0.10} step={0.005} value={gridStepPct}
                                        onChange={e => setGridStepPct(Number(e.target.value))}
                                        className="flex-1 h-1.5 accent-indigo-500 cursor-pointer" />
                                    <span className="w-9 text-right tabular-nums text-slate-500 dark:text-slate-400 shrink-0">{(gridStepPct * 100).toFixed(1)}%</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                                    <span className="w-[68px] shrink-0">Snap</span>
                                    <input type="range" min={0} max={20} step={1} value={snapPx}
                                        onChange={e => setSnapPx(Number(e.target.value))}
                                        className="flex-1 h-1.5 accent-indigo-500 cursor-pointer" />
                                    <span className="w-9 text-right tabular-nums text-slate-500 dark:text-slate-400 shrink-0">{snapPx}px</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                                    <span className="w-[68px] shrink-0">Safe zone</span>
                                    <input type="range" min={0} max={20} step={0.5} value={safeMm}
                                        onChange={e => setSafeMm(Number(e.target.value))}
                                        className="flex-1 h-1.5 accent-indigo-500 cursor-pointer" />
                                    <span className="w-9 text-right tabular-nums text-slate-500 dark:text-slate-400 shrink-0">{safeMm}mm</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                                    <span className="w-[68px] shrink-0">Ruler unit</span>
                                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/60 p-0.5 gap-0.5">
                                        {["mm", "in"].map(u => (
                                            <button key={u} type="button" onClick={() => setRulerUnit(u)}
                                                className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-all ${rulerUnit === u ? "bg-white dark:bg-slate-600 text-slate-800 dark:text-slate-100 shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}>
                                                {u}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div id="kb-help-tip" className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400 opacity-0 transition-opacity">
                                <kbd className="bg-slate-200 dark:bg-slate-600 px-1 rounded text-[10px]">?</kbd> shortcuts •{" "}
                                <kbd className="bg-slate-200 dark:bg-slate-600 px-1 rounded text-[10px]">Space</kbd>+drag pan •{" "}
                                <kbd className="bg-slate-200 dark:bg-slate-600 px-1 rounded text-[10px]">Del</kbd> delete •{" "}
                                <kbd className="bg-slate-200 dark:bg-slate-600 px-1 rounded text-[10px]">↑↓←→</kbd> nudge
                            </div>
                        </div>

                        {/* Layers */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500 mb-2">Layers</p>
                            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                                {slots.length === 0 && (
                                    <p className="text-xs text-slate-400 dark:text-slate-500 py-2">No slots yet — click + to add one.</p>
                                )}
                                {slots.map(s => (
                                    <div
                                        key={s.id}
                                        className={`flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-xs transition ${selection.includes(s.id) ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"}`}
                                        onClick={() => setSelection([s.id])}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={!s.hidden}
                                            onChange={() => setSlots(prev => prev.map(x => x.id === s.id ? { ...x, hidden: !x.hidden } : x))}
                                            title={s.hidden ? "Show slot" : "Hide slot"}
                                            className="accent-indigo-500 shrink-0"
                                        />
                                        <button
                                            type="button"
                                            className="text-[11px] leading-none shrink-0"
                                            onClick={e => { e.stopPropagation(); setSlots(prev => prev.map(x => x.id === s.id ? { ...x, locked: !x.locked } : x)); }}
                                            title={s.locked ? "Unlock" : "Lock"}
                                        >
                                            {s.locked ? "🔒" : "🔓"}
                                        </button>
                                        <span className="flex-1 truncate font-medium">
                                            {s.name || (s.sourceSlotId ? `Slot #${s.slotNumber} (clone)` : `Slot #${s.slotNumber}`)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>

                    {/* CENTER: Canvas with rulers */}
                    <div
                        className="col-span-12 lg:col-span-6 relative overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shadow-[0_16px_40px_rgba(15,23,42,0.06)] rounded-2xl"
                        ref={outerRef}
                        onWheel={onWheel}
                    >
                        {showRulers && <Rulers zoom={zoom} pan={pan} canvasRect={canvasRect} unit={rulerUnit} spec={spec} />}

                        {/* Aspect-ratio canvas */}
                        <div
                            ref={canvasRef}
                            className={
                                layout === "2x6"
                                    ? "m-8 w-[300px] h-[900px] border border-slate-200 bg-white relative overflow-hidden origin-top-left shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
                                    : layout === "6x4"
                                        ? "m-8 w-[900px] h-[600px] border border-slate-200 bg-white relative overflow-hidden origin-top-left shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
                                        : layout === "6x2"
                                            ? "m-8 w-[900px] h-[300px] border border-slate-200 bg-white relative overflow-hidden origin-top-left shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
                                            : "m-8 w-[600px] h-[900px] border border-slate-200 bg-white relative overflow-hidden origin-top-left shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
                            }
                            style={{
                                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0",
                                backgroundImage: computedBgUrl ? `url(${computedBgUrl})` : "none",
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                            onPointerDown={onCanvasPointerDown}
                            onPointerMove={onCanvasPointerMove}
                            onPointerUp={onCanvasPointerUp}
                        >
                            {/* Grid */}
                            {showGrid && <Grid step={gridStepPct} />}

                            {/* Safe & Trim (NEW) */}
                            <CanvasMargins safeUx={safeUx} safeUy={safeUy} trimUx={trimUx} trimUy={trimUy} />

                            {/* Guides */}
                            {guides.x.map((gx, i) => <GuideX key={`gx-${i}`} value={gx} />)}
                            {guides.y.map((gy, i) => <GuideY key={`gy-${i}`} value={gy} />)}

                            {/* Slots */}
                            {slots.map(s => {
                                if (s.hidden) return null;
                                const isSel = selection.includes(s.id);
                                const borderCssPx = `${Math.max(1, Math.round((s.borderWidth || 0) * 100))}px`;
                                const radiusPct = `${(s.cornerRadius || 0) * 100}%`;
                                const shadowCss = s.shadow ? `0 2px 10px rgba(0,0,0,${s.shadow})` : "none";
                                const filterCss = toFilterCss(s.filter);
                                const bgOverlay = s.overlayColor || "transparent";
                                const blendMode = s.overlayBlend || "normal";
                                const overlayOpacity = clamp01(s.overlayOpacity || 0);

                                return (
                                    <div
                                        key={s.id}
                                        data-slot-id={s.id}
                                        className="group"
                                        style={{
                                            position: "absolute",
                                            left: `${s.x * 100}%`,
                                            top: `${s.y * 100}%`,
                                            width: `${s.w * 100}%`,
                                            height: `${s.h * 100}%`,
                                            border: isSel ? "2px solid #635bff" : `${borderCssPx} solid ${s.borderColor || "rgba(0,0,0,0.15)"}`,
                                            borderRadius: radiusPct,
                                            background: "rgba(0,0,0,0.02)",
                                            transform: `rotate(${s.rotation || 0}deg)`,
                                            transformOrigin: "center",
                                            userSelect: "none",
                                            touchAction: "none",
                                            cursor: "move",
                                            boxShadow: shadowCss,
                                            overflow: "hidden",
                                            filter: filterCss,
                                        }}
                                    >
                                        {/* Visual index */}
                                        <div className="absolute left-1 top-1 text-[11px] text-gray-700 pointer-events-none">
                                            #{s.slotNumber}{s.sourceSlotId ? " ↗" : ""}
                                        </div>

                                        {/* Simulated image container (fit) - now won't intercept pointer */}
                                        <div
                                            className="absolute inset-0 bg-[rgba(0,0,0,0.06)] pointer-events-none"
                                            style={{ objectFit: s.fit || "cover" }}
                                        />

                                        {/* Overlay tint */}
                                        <div
                                            className="absolute inset-0 pointer-events-none"
                                            style={{
                                                background: bgOverlay,
                                                mixBlendMode: blendMode,
                                                opacity: overlayOpacity,
                                            }}
                                        />

                                        {isSel && !s.locked && (
                                            <>
                                                {/* Rotate handle */}
                                                <div
                                                    data-handle="true"
                                                    data-handle-type="rotate"
                                                    data-slot-id={s.id}
                                                    className="absolute left-1/2 -top-5 -translate-x-1/2 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center cursor-grab shadow-sm"
                                                    title="Rotate"
                                                >
                                                    ↻
                                                </div>
                                                {/* Resize handles */}
                                                {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(h => (
                                                    <div
                                                        key={h}
                                                        data-handle="true"
                                                        data-handle-type="resize"
                                                        data-anchor={h}
                                                        data-slot-id={s.id}
                                                        className="absolute w-3 h-3 bg-white border border-indigo-500 rounded-sm -translate-x-1/2 -translate-y-1/2 cursor-pointer shadow-sm"
                                                        style={handlePosition[h]}
                                                        title={`Resize ${h.toUpperCase()}`}
                                                    />
                                                ))}
                                                {/* Crosshair for precision */}
                                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-indigo-500/40 pointer-events-none" />
                                                <div className="absolute top-1/2 left-0 right-0 h-px bg-indigo-500/40 pointer-events-none" />
                                            </>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Marquee */}
                            {marquee && (
                                <div
                                    className="absolute border border-indigo-400/70 bg-indigo-400/10"
                                    style={{
                                        left: `${marquee.x * 100}%`,
                                        top: `${marquee.y * 100}%`,
                                        width: `${marquee.w * 100}%`,
                                        height: `${marquee.h * 100}%`,
                                    }}
                                />
                            )}
                        </div>

                        {spacePressed && (
                            <div className="absolute bottom-3 left-8 rounded-full bg-slate-950/80 px-3 py-1.5 text-[11px] font-medium text-white">
                                Drag to pan
                            </div>
                        )}
                        <div className="absolute bottom-3 right-3 rounded-full border border-slate-200 dark:border-slate-600 bg-white/90 dark:bg-slate-900/90 px-3 py-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 shadow-sm backdrop-blur">
                            {Math.round(zoom * 100)}% · {spec.wIn}" × {spec.hIn}" @ {DEFAULT_DPI} dpi
                        </div>
                    </div>

                    {/* RIGHT: Thumbnail & Properties */}
                    <div className="col-span-12 lg:col-span-3 grid grid-cols-1 gap-3 overflow-auto pr-1">
                        {/* Thumbnail */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500 mb-1">Thumbnail</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-4">Preview image shown in the template library.</p>
                            {thumb ? (
                                <img
                                    src={thumb}
                                    alt="thumb"
                                    className={`mx-auto rounded-xl border border-slate-200 dark:border-slate-600 object-contain bg-slate-50 dark:bg-slate-700 p-1.5 ${layout === "4x6" || layout === "2x6" ? "h-[220px]" : "w-full max-w-[220px]"}`}
                                />
                            ) : (
                                <div className="h-20 rounded-xl border border-dashed border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                                    No thumbnail
                                </div>
                            )}
                            <label className="mt-3 inline-flex items-center gap-2 text-xs font-medium cursor-pointer text-slate-700 dark:text-slate-300">
                                {!thumb && (
                                    <>
                                        <input type="file" accept="image/*" onChange={(e) => handleThumbFile(e.target.files && e.target.files[0], setThumbnail, setError)} className="hidden" />
                                        <span className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 transition hover:bg-slate-50 dark:hover:bg-slate-600">
                                            Upload thumbnail
                                        </span>
                                    </>
                                )}
                                {thumb && (
                                    <span onClick={e => { e.preventDefault(); setThumbnail(null); }}
                                        className="cursor-pointer rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-800 dark:hover:bg-red-900/30 dark:hover:text-red-400">
                                        Remove thumbnail
                                    </span>
                                )}
                            </label>
                            <p className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 px-3 py-2 text-[11px] leading-4 text-slate-400 dark:text-slate-500">Re-apply the template after changing its thumbnail for it to take effect.</p>
                        </div>

                        {/* Properties */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500 mb-1">Slot properties</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-4">Position, size, styling, overlays, and tone for the selected slot.</p>
                            {selection.length ? (
                                <PropertiesPanel
                                    slots={slots}
                                    selection={selection}
                                    onChange={(patch) => {
                                        commitHistory();
                                        setSlots(prev => prev.map(s => selection.includes(s.id) ? { ...s, ...patch } : s));
                                    }}
                                />
                            ) : (
                                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 px-3 py-4 text-xs text-slate-400 dark:text-slate-500">
                                    Select a slot on the canvas to edit its properties.
                                </div>
                            )}
                        </div>

                        {/* Frame Selector */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500 mb-1">Frames for {layout.replace("x", "×")}</p>
                            <p className="mb-3 text-xs leading-4 text-slate-500 dark:text-slate-400">Attach overlays and click to preview on canvas.</p>

                            {/* (Optional) Layout select here if you prefer it on the right side:
  <label className="block text-xs text-gray-700 mb-2">
    Layout / Aspect
    <select
      value={layout}
      onChange={(e) => { setLayout(e.target.value); onLayoutChange?.(e.target.value); }}
      className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
    >
      <option value="4x6">4×6 (portrait)</option>
      <option value="2x6">2×6 (portrait strip)</option>
      <option value="6x4">6×4 (landscape)</option>
      <option value="6x2">6×2 (landscape strip)</option>
    </select>
  </label>
  */}

                            {framesForLayout.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 px-3 py-4 text-xs text-slate-400 dark:text-slate-500">
                                    No frames for this layout. Upload one in the Frames tab.
                                </div>
                            ) : (
                                <div className="space-y-1.5 max-h-56 overflow-auto pr-0.5">
                                    {framesForLayout.map((f) => {
                                        const src = f.previews?.[layout]?.originalDataUrl;
                                        const isAttached = attachedFrameIds.includes(f.id);
                                        const isActive = activeFrameId === f.id;
                                        return (
                                            <button
                                                key={f.id}
                                                type="button"
                                                onClick={() => {
                                                    setActiveFrameId(f.id);
                                                    if (!isAttached) setAttachedFrameIds(prev => [...prev, f.id]);
                                                }}
                                                className={`w-full rounded-xl border p-2 text-left transition flex items-center gap-2.5 ${isActive ? "border-indigo-500 ring-1 ring-indigo-200 dark:ring-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/30" : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700"}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="accent-indigo-500 shrink-0"
                                                    checked={isAttached}
                                                    onChange={(e) => {
                                                        const checked = e.target.checked;
                                                        setAttachedFrameIds(prev => {
                                                            if (checked) { if (prev.includes(f.id)) return prev; return [...prev, f.id]; }
                                                            else { const next = prev.filter(id => id !== f.id); if (activeFrameId === f.id) setActiveFrameId(null); return next; }
                                                        });
                                                    }}
                                                    onClick={e => e.stopPropagation()}
                                                    title={isAttached ? "Detach" : "Attach"}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{f.name}</div>
                                                    <div className="text-[10px] text-slate-400 dark:text-slate-500">{isAttached ? "Attached" : "Not attached"}{isActive ? " · Active" : ""}</div>
                                                </div>
                                                <img src={src} alt={f.name} className="h-10 w-14 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 object-contain p-0.5 shrink-0" />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            <label className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                                <input type="checkbox" checked={applyToCurrentEvent} onChange={e => setApplyToCurrentEvent(e.target.checked)} className="accent-indigo-500" />
                                Apply to current event on save
                            </label>
                        </div>

                        {/* Help & Errors */}
                        <p className="text-[11px] leading-4 text-slate-400 dark:text-slate-500 px-1">
                            {spec.wIn}"×{spec.hIn}" canvas · <kbd className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-[10px]">Space</kbd>+drag pan · drag empty area to marquee select · snap shows red guides
                        </p>
                        {error && <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-3 text-xs font-medium text-red-600 dark:text-red-400">{error}</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** ---------- Subcomponents ---------- */
function PropertiesPanel({ slots, selection, onChange }) {
    const selected = selection.map(id => slots.find(s => s.id === id)).filter(Boolean);

    const mixed = (getter) => {
        const first = getter(selected[0]);
        for (const s of selected) { if (getter(s) !== first) return ""; }
        return first;
    };

    const inputCls = "w-24 px-2 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs outline-none focus:border-indigo-400 dark:focus:border-indigo-500";
    const labelCls = "text-slate-500 dark:text-slate-400";

    const field = (label, val, onVal, min, max, step) => (
        <label className="flex items-center justify-between gap-2 text-xs">
            <span className={labelCls}>{label}</span>
            <input type="number" value={val} placeholder={val === "" ? "—" : undefined}
                onChange={(e) => onVal(Number(e.target.value))}
                className={inputCls} min={min} max={max} step={step} />
        </label>
    );

    const selectField = (label, val, onVal, options) => (
        <label className="flex items-center justify-between gap-2 text-xs">
            <span className={labelCls}>{label}</span>
            <select value={val ?? ""} onChange={(e) => onVal(e.target.value || null)}
                className={inputCls}>
                <option value="">—</option>
                {options.map(([key, lbl]) => <option key={key} value={key}>{lbl}</option>)}
            </select>
        </label>
    );

    const colorField = (label, val, onVal) => (
        <label className="flex items-center justify-between gap-2 text-xs">
            <span className={labelCls}>{label}</span>
            <input type="color" value={val ?? "#9ca3af"} onChange={(e) => onVal(e.target.value)}
                className="w-10 h-7 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 cursor-pointer" />
        </label>
    );

    const divider = <div className="border-t border-slate-100 dark:border-slate-700 my-1" />;
    const sectionLabel = (txt) => <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500 pt-1">{txt}</p>;

    return (
        <div className="space-y-1.5">
            {sectionLabel("Position & size")}
            {field("X (%)", toPct(mixed(s => s.x)), n => onChange({ x: clamp01(n / 100) }), 0, 100, 0.1)}
            {field("Y (%)", toPct(mixed(s => s.y)), n => onChange({ y: clamp01(n / 100) }), 0, 100, 0.1)}
            {field("W (%)", toPct(mixed(s => s.w)), n => onChange({ w: clamp01(n / 100) }), 1, 100, 0.1)}
            {field("H (%)", toPct(mixed(s => s.h)), n => onChange({ h: clamp01(n / 100) }), 1, 100, 0.1)}
            {field("Rotation °", mixed(s => s.rotation || 0), n => onChange({ rotation: n }), -180, 180, 1)}
            {selectField("Aspect lock", mixed(s => s.aspectLock || ""), k => onChange({ aspectLock: k || null }), Object.keys(CAMERA_ASPECTS).map(k => [k, k]))}
            {divider}
            {sectionLabel("Border & shape")}
            {field("Border %", toPct(mixed(s => s.borderWidth || 0)), n => onChange({ borderWidth: clamp01(n / 100) }), 0, 10, 0.1)}
            {colorField("Border color", mixed(s => s.borderColor || "#9ca3af"), v => onChange({ borderColor: v }))}
            {field("Corner %", toPct(mixed(s => s.cornerRadius || 0)), n => onChange({ cornerRadius: clamp01(n / 100) }), 0, 20, 0.1)}
            {field("Shadow", mixed(s => s.shadow || 0), n => onChange({ shadow: clamp01(n) }), 0, 1, 0.05)}
            {divider}
            {sectionLabel("Overlay")}
            {colorField("Tint color", mixed(s => s.overlayColor || "#000000"), v => onChange({ overlayColor: v }))}
            {selectField("Blend mode", mixed(s => s.overlayBlend || "normal"), v => onChange({ overlayBlend: v }),
                [["normal", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["soft-light", "Soft light"], ["hard-light", "Hard light"]])}
            {field("Opacity", mixed(s => s.overlayOpacity || 0), n => onChange({ overlayOpacity: clamp01(n) }), 0, 1, 0.05)}
            {divider}
            {sectionLabel("Tone & fit")}
            {selectField("Tone filter", mixed(s => s.filter || "none"), v => onChange({ filter: v }),
                [["none", "None"], ["bw", "B&W"], ["sepia", "Sepia"], ["warm", "Warm"], ["cool", "Cool"]])}
            {selectField("Image fit", mixed(s => s.fit || "cover"), v => onChange({ fit: v }),
                [["cover", "Cover"], ["contain", "Contain"]])}
        </div>
    );
}

function Rulers({ zoom, pan, canvasRect, unit, spec }) {
    if (!canvasRect) return null;
    const pxPerUnit =
        unit === "mm" ? (canvasRect.width * zoom) / (spec.wIn * 25.4) : (canvasRect.width * zoom) / spec.wIn;

    const step = unit === "mm" ? 10 : 0.5;
    const stepPx = step * pxPerUnit;

    const xticks = [];
    for (let x = (pan.x % stepPx); x < canvasRect.width; x += stepPx) xticks.push(x);
    const yticks = [];
    for (let y = (pan.y % stepPx); y < canvasRect.height; y += stepPx) yticks.push(y);

    return (
        <>
            <div className="absolute left-0 right-0 top-0 h-6 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-600 select-none overflow-hidden z-10">
                {xticks.map((t, i) => (
                    <div key={i} className="absolute top-0 h-full border-r border-slate-200 dark:border-slate-600" style={{ left: t, width: 0 }}>
                        <div className="absolute bottom-0 translate-x-1/2 text-[10px] text-slate-400 dark:text-slate-500">
                            {formatTick((t - pan.x) / pxPerUnit, unit)}
                        </div>
                    </div>
                ))}
            </div>
            <div className="absolute left-0 top-0 bottom-0 w-6 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-600 select-none overflow-hidden z-10">
                {yticks.map((t, i) => (
                    <div key={i} className="absolute left-0 w-full border-b border-slate-200 dark:border-slate-600" style={{ top: t, height: 0 }}>
                        <div className="absolute right-0 -rotate-90 origin-right text-[10px] text-slate-400 dark:text-slate-500 translate-y-1/2">
                            {formatTick((t - pan.y) / ((canvasRect.height * zoom) / (unit === "mm" ? spec.hIn * 25.4 : spec.hIn)), unit)}
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
}

function formatTick(v, unit) {
    return unit === "mm" ? Math.round(v) : (Math.round(v * 10) / 10).toFixed(1);
}

function Grid({ step = 0.02 }) {
    // Number of interval lines (excluding the outer border)
    // Clamp to avoid excessive DOM nodes at very fine steps.
    const count = Math.max(1, Math.min(200, Math.floor(1 / step)));

    // We draw lines at i * step for i=1..count-1 (skip 0 and 1 which are canvas edges).
    const positions = Array.from({ length: count - 1 }, (_, i) => (i + 1) * step * 100);

    return (
        <div className="absolute inset-0 pointer-events-none">
            {/* Vertical lines */}
            {positions.map((p, i) => (
                <div
                    key={"v" + i}
                    className="absolute top-0 bottom-0 border-l border-black/5"
                    style={{ left: `${p}%` }}
                />
            ))}
            {/* Horizontal lines */}
            {positions.map((p, i) => (
                <div
                    key={"h" + i}
                    className="absolute left-0 right-0 border-t border-black/5"
                    style={{ top: `${p}%` }}
                />
            ))}
        </div>
    );
}
function CanvasMargins({ safeUx, safeUy, trimUx, trimUy }) {
    // Draw inner rectangles for trim and safe zones
    return (
        <div className="absolute inset-0 pointer-events-none">
            {/* Trim */}
            {trimUx > 0 || trimUy > 0 ? (
                <div
                    className="absolute border border-yellow-400/70"
                    style={{
                        left: `${trimUx * 100}%`,
                        top: `${trimUy * 100}%`,
                        width: `${(1 - trimUx * 2) * 100}%`,
                        height: `${(1 - trimUy * 2) * 100}%`,
                    }}
                />
            ) : null}
            {/* Safe */}
            {safeUx > 0 || safeUy > 0 ? (
                <div
                    className="absolute border border-green-500/70"
                    style={{
                        left: `${safeUx * 100}%`,
                        top: `${safeUy * 100}%`,
                        width: `${(1 - safeUx * 2) * 100}%`,
                        height: `${(1 - safeUy * 2) * 100}%`,
                    }}
                />
            ) : null}
        </div>
    );
}

function GuideX({ value }) {
    return <div className="absolute top-0 bottom-0 border-r border-red-400" style={{ left: `calc(${value * 100}% )` }} />;
}
function GuideY({ value }) {
    return <div className="absolute left-0 right-0 border-b border-red-400" style={{ top: `calc(${value * 100}% )` }} />;
}

/** ---------- Utilities ---------- */
function ensureSlotNumbers(slots) {
    // First pass: number primary (non-clone) slots sequentially
    let count = 0;
    const idToNumber = {};
    const withPrimary = slots.map(s => {
        if (!s.sourceSlotId) {
            count++;
            idToNumber[s.id] = count;
            return { ...s, slotNumber: count };
        }
        return s;
    });
    // Second pass: give clone slots the same slotNumber as their source
    return withPrimary.map(s => {
        if (!s.sourceSlotId) return s;
        return { ...s, slotNumber: idToNumber[s.sourceSlotId] ?? 0 };
    });
}

function validateSlotForSave(slot) {
    return {
        ...slot,
        x: clamp01(Number.isFinite(slot?.x) ? slot.x : 0),
        y: clamp01(Number.isFinite(slot?.y) ? slot.y : 0),
        w: clamp01(Number.isFinite(slot?.w) ? slot.w : 0.2),
        h: clamp01(Number.isFinite(slot?.h) ? slot.h : 0.2),
        rotation: Number.isFinite(slot?.rotation) ? slot.rotation : 0,
        borderWidth: clamp01(Number.isFinite(slot?.borderWidth) ? slot.borderWidth : 0.005),
        cornerRadius: clamp01(Number.isFinite(slot?.cornerRadius) ? slot.cornerRadius : 0.01),
        shadow: clamp01(Number.isFinite(slot?.shadow) ? slot.shadow : 0),
        overlayOpacity: clamp01(Number.isFinite(slot?.overlayOpacity) ? slot.overlayOpacity : 0),
    };
}

function handleThumbFile(file, setThumbnail, setError) {
    if (!file) return;

    if (!VALID_THUMB_TYPES.includes(file.type)) {
        setError?.("Unsupported thumbnail file type. Please use PNG, JPG, WEBP, or GIF.");
        return;
    }

    if (file.size > MAX_THUMBNAIL_SIZE_MB * 1024 * 1024) {
        setError?.(`Thumbnail is too large. Maximum size is ${MAX_THUMBNAIL_SIZE_MB}MB.`);
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        setError?.("");
        setThumbnail(String(reader.result));
    };
    reader.onerror = () => {
        setError?.("Failed to read thumbnail file. Please try a different image.");
    };
    reader.readAsDataURL(file);
}
function toFilterCss(key) {
    switch (key) {
        case "bw": return "grayscale(1) contrast(1.1)";
        case "sepia": return "sepia(0.7) contrast(1.05)";
        case "warm": return "sepia(0.3) saturate(1.1)";
        case "cool": return "hue-rotate(20deg) saturate(1.0)";
        default: return "none";
    }
}

/** ---------- Preset generator (unchanged) ---------- */
function applyPreset(c, r) {
    // This function is replaced at call site above
    // but we can keep a local version if needed
}