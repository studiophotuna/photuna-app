# Photuna Changelog

All notable changes to Photuna are listed here, newest first.

---

## v0.4.2 — Update Installer Fix
*Released September 7, 2026*

### Fixes
- Fixed the update banner freezing at "Downloading 0%" once an update had finished downloading. The download completed normally, but the banner reset itself to zero at the moment it should have moved on, so the "Install & restart" step was never reachable and the update could not be applied. Updating from the banner now proceeds to installation as expected. Updating from **Settings → Check for updates** was unaffected and continues to work as before.

---

## v0.4.1 — Event Isolation, Full Screen & Security Hardening
*Released September 7, 2026*

### New Features
- **Opens full screen** — The app now fills the display as soon as it launches, so a booth is ready without arranging the window first. Press **F11** at any time to leave or re-enter full screen.
- **Copy templates and frames to a new event** — When creating an event you can now switch on *Copy templates & frames* and pick an existing event to reuse its applied templates, frames, and tones. Each event is listed with its template and frame counts. Branding and settings always start fresh, and the event you copy from is never modified. Left off, new events start blank exactly as before.
- **Applied and Library views** — The Templates and Frames tabs now open on **Applied to this event**, showing only what that event actually uses, with a **Library** view for browsing everything available. Both views show counts. Previously these tabs always listed the entire shared library, which made a brand-new event look as though it had inherited the previous event's design.
- **Reload returns to Home** — Reloading the dashboard now closes the open event and returns to Home instead of restoring whichever screen was last open. This also gives operators a dependable way back to the dashboard from a running booth.

### Security
- **Event storage cleanup locked down** — The routine that deletes an event's stored photos and gallery records ran with elevated privileges but never checked who was calling it, and was reachable by any signed-in account. It was therefore possible for one operator to delete another operator's event photos and gallery records by referencing their event. The routine now verifies that the caller owns the event, and access has been restricted to signed-in accounts and trusted server processes. *(Requires database migration `020_secure_delete_event_storage.sql`.)*

### Fixes
- Fixed deleted events reappearing after a restart. The deletion was saved on the booth but could be lost before it reached the server, and the next sync restored the event as though it were new. Deletions are now sent to the server immediately.
- Fixed a new event opening with the previous event's branding and settings. Opening an unsaved event left the previous event's values on screen, and saving made the duplication permanent. Each event now loads its own stored configuration, and new events start from defaults.
- Fixed saving settings overwriting every event. Booth-level settings such as camera, printer, and storage still apply to all events, but event-level settings such as countdown, shot count, pricing, and payment now apply only to the event being edited.
- Fixed the template editor discarding in-progress work. Slots being drawn could be cleared while editing, and frames attached to a previously edited template carried over into a new one. Editor state is now set up once each time the editor opens.
- Fixed the booth reporting an incorrect app version in the Remote Booth list. Every build previously reported `0.3.0` regardless of what was installed. Booths now report their real version, which is the reliable way to confirm an update has been applied.
- Fixed a "Photuna account services are not configured on this build" error appearing every time an event was deleted. Remote storage cleanup is not available in the distributed app by design; it is now skipped quietly and handled by the scheduled server-side cleanup instead.

---

## v0.4.0 — Remote Booth Control & Kiosk Recovery
*Released September 5, 2026*

### New Features
- **Stop Booth** — A new remote command closes a running booth from the Remote Booth panel, alongside Ping, Restart, and Push Current Event. Because the booth shuts down before it can reply, the command is sent without waiting for confirmation.
- **Kiosk auto-resume** — A booth that was running an event when the machine restarted now reopens to that same event automatically, so an unattended booth recovers from a power cut or reboot without an operator present.
- **Launch on startup** — The app registers itself to start with Windows so a booth machine comes back up on its own after a restart. This follows the *Launch on startup* setting in **Settings → Startup & Recovery**, which now reflects the true system state rather than always displaying as enabled.

### Fixes
- Fixed remote commands not reaching a booth when the dashboard and the booth were on the same machine or network connection. Commands were being filtered out before delivery, so Stop Booth and other remote actions appeared to send but had no effect.
- Fixed **Ctrl+R** re-entering the booth instead of returning to the dashboard, which could leave an operator with no way back to admin. A reload now returns to the dashboard, while a genuine restart still resumes the booth.
- Fixed duplicate booth entries in the Remote Booth list, including booths that were offline and should have been removed. Offline booths older than 30 days are now filtered out and can be removed manually.

---

## v0.3.0 — Template Editor, Visual Tones & Guided Tour
*Released August 29, 2026*

### New Features
- **Template Editor overhaul** — The editor toolbar is now icon-based for a cleaner layout. Slider controls replace raw number inputs for opacity, border radius, and similar properties. Dark mode is fully supported throughout the editor. New slot actions include Clone (duplicate a slot in one click) and Toggle Fit (switch between fill and fit modes). Fullscreen editing mode is available for large-screen setups. Aspect ratio is now locked by default to prevent accidental distortion.
- **Visual tone preview** — The tone selection screen now shows real photo samples from your session instead of abstract swatches. A horizontal filter strip replaces the raw number display, making tones easier to compare at a glance. The preset library has been expanded with new styles.
- **Guided onboarding tour** — First-run tour walks new operators through Home, Events, the Template Editor, Settings, Reports, and Help Center. An interactive spotlight highlights each area as you go. The Create Event step is gated — you must create a real event before the tour advances. A "Take a tour" button in Settings replays the tour at any time.
- **Health monitor** — 24/7 booth health monitoring with background checks for disk space, memory usage, session folder count, and app uptime. Alerts surface in the dashboard before a problem affects guests.

### Fixes
- Fixed template workspace canvas rendering incorrectly after rapid slot edits.
- Fixed dark mode flash on initial load caused by a theme race condition.
- Fixed frames disappearing when switching between events quickly.
- Fixed portrait canvas not centering correctly in the editor.
- Fixed gallery upload using the service-role key instead of the operator's own JWT — uploads now authenticate with the operator's session.

---

## v0.2.9 — Security, Payments & Gallery Fixes
*Released August 21, 2026*

### Security
- **Secrets removed from installer** — PayMongo, Stripe, and Supabase service role keys are no longer bundled inside the distributed installer. All secret operations now run in Supabase Edge Functions on the server. The installer only contains three public `REACT_APP_*` variables that are safe to ship to every customer.

### New Features
- **Discount code support** — Operators can apply a discount code during PayMongo checkout. The original price is shown with a strikethrough and the discounted total is highlighted in the payment modal header and QR screen.
- **Gallery QR — no admin access required** — The QR Gallery modal now works in the distributed app. Gallery slug lookup and creation use the operator's own authenticated Supabase session instead of a server-side admin key.
- **Gallery Branding auto-login** — Clicking "Gallery Branding" on an event now opens the branding editor in the browser and logs the operator in automatically. No manual login on the gallery site is required.

### Fixes
- Fixed Windows installer build failing with `'CI' is not recognized` — build scripts now use `cross-env` for compatibility with Windows CMD and PowerShell.
- Fixed installer build attempting to recompile `better-sqlite3` native module without Python — native module rebuild is skipped since it is no longer used in the distributed app.
- Fixed "Photuna account services are not configured on this build" error when opening QR Gallery for events.
- Fixed "Access required" error when opening Gallery Branding from the dashboard.
- Embedded licensing server removed from Electron main process — all licensing and payment operations now go through Supabase Edge Functions or direct Supabase queries.

---

## v0.2.4 — UI Polish & Smart Printer Tools
*Released August 2026*

### New Features
- **Automatic update announcements** — Photuna now checks for updates on launch and every 4 hours. When a new version is available, a dismissible banner appears at the top of the dashboard with a direct "Update now" link that jumps to Settings and starts the download automatically.
- **Sample Layouts gallery** — A new "Samples" tab inside each event lets you browse all built-in templates and frames before committing to them. Nothing is added to your library unless you choose it. "Apply to event" applies the layout to the current event only; "Save to library" saves it for reuse across events.
- **DNP & HiTi auto-cut detection** — A new card in Settings → Printing scans your Windows print queue for connected DNP and HiTi photo printers, reads their current cut-mode driver properties, and tells you exactly whether 2×6 strip cut is active. Brand-specific setup instructions are shown for each detected printer.

### Improvements
- **Blue color theme** — The admin dashboard and auth screens now use a clean blue accent palette throughout, replacing the previous teal theme.
- **Default badges** — Template cards and frame cards now show a "Default" badge for built-in items, making it easy to distinguish your custom designs from the included samples.
- **Responsive photobooth screens** — All kiosk-facing screens (Welcome, Photo, Select/Retake, Template Selection, Frame & Filter, Print Preview, Thank You) now scale correctly on a wider range of display sizes. Font sizes and button padding use fluid `clamp()` values instead of fixed breakpoints.
- **Cleaner print screen** — Removed the redundant "Your photo is ready!" label from the print preview screen so the layout flows without crowding.
- **4×6 and 2×6 focus** — Removed the 4×4 square layout from templates and frames. Photuna now focuses on the two formats supported by real dye-sublimation printers: 4×6 classic and 2×6 strip.

---

## v0.2.3 — Auth Redesign
*Released May 17, 2026*

### Improvements
- **Redesigned login and registration screen** — Cleaner layout with better visual hierarchy, improved form spacing, and a more polished first-impression experience for new operators.

---

## v0.2.2 — Bug Fixes
*Released May 17, 2026*

### Fixes
- Fixed gallery add-on configuration not being read correctly in certain event setups.
- Fixed template limit enforcement allowing more templates than the active plan permits.

---

## v0.2.1 — Gallery Add-on & Entitlement Enforcement
*Released May 17, 2026*

### New Features
- **Gallery add-on gating** — The online gallery (QR code download link) is now a separate add-on. Operators can purchase it independently of the base plan. The print preview screen only generates a QR code when the add-on is active.
- **Hard entitlement limits** — Template count, event count, and gallery access are now enforced per plan at the application level. Attempting to exceed your plan limits shows a clear in-app prompt rather than silently failing.

### Improvements
- Subscription summary screen now reflects gallery add-on status.
- Photo booth flow skips gallery upload entirely when the add-on is not active, reducing unnecessary network calls.

---

## v0.2.0 — Licensing & Subscription System
*Released May 17, 2026*

### New Features
- **Plan-based licensing** — Photuna now supports Free, Trial, Pro, and Business subscription tiers. Each plan controls which features are accessible inside the app.
- **Trial watermark** — Sessions running on a trial license display a small watermark in the printed output, reminding booth operators to upgrade to a paid plan for clean prints.
- **License context** — The app reads and caches the active license on startup, so plan-gated features respond instantly without extra network round-trips.
- **Licensing API** — Internal licensing server for validating keys, upgrading accounts, and applying admin plan changes.

### Improvements
- Entitlement constants aligned across the Electron main process, the React renderer, and the licensing API to prevent plan-check inconsistencies.

---

## v0.1.0 — Initial Release
*Released May 2026*

### Included at launch

**Kiosk photobooth flow**
- Welcome screen with custom background video, image, or live camera preview
- Timed photo capture with countdown ring, flash animation, and configurable shot count
- Select/Retake screen — review captured photos and flag individual shots for a retake, with a configurable retake limit
- Template selection — assign captured photos to layout slots with drag-free tap-to-assign interaction and auto-fill on countdown
- Frame & filter screen — apply overlay frames and tone filters (Normal, B&W, Sepia, Vintage, Warm, Cool) before printing
- Print preview with live progress animation, optional gallery QR code, and auto-advance to Thank You
- Thank You screen with configurable countdown and "New Session" button

**Admin dashboard**
- Multi-event management — create, edit, and archive unlimited events
- Per-event branding — custom booth name, tagline, logo, background media, and color palette
- Template library — build custom slot layouts (4×6 and 2×6) with a visual drag-and-resize editor; apply multiple templates per event
- Frame library — upload PNG/WEBP overlay frames at any supported size; apply per event with optional background color integration
- Tone presets — enable or restrict which filters guests can choose
- Background color palettes — create named palettes and attach them to frames for dynamic background swapping
- Controls & modes — Rental mode (no payment), Business mode, retake limits, shot count, screen timers, gallery toggle, watermark toggle
- Analytics — session count, photos taken, prints delivered per event
- Sharing — remote QR link for event-specific public gallery pages

**Settings**
- Camera — device selection, resolution, mirror mode, live preview
- Printing — printer selection, paper size, color mode, quality, copies
- Storage — capture path, auto-cleanup schedule
- System — app version, update check, auto-update on quit toggle, log export

**Infrastructure**
- Electron desktop app with full offline capability
- Supabase backend for user accounts, event data sync, and gallery storage
- IPC bridge between the Electron main process and the React renderer for camera, printing, file storage, and licensing
- Settings sync across restarts with electron-store
- Google Font loader for per-event custom typography
- Portrait and landscape display detection with automatic layout switching
