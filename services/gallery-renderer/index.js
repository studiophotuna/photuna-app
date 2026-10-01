// Renders a session's motion clip off the booth.
//
// The booth uploads the raw burst clips and a small recipe; this service turns
// them into the final clip and fills in the gallery row. That exists so tablets
// can have motion clips at all (iPadOS will not run a bundled encoder) and so
// we stop shipping FFmpeg to customers.
//
// Two rules hold this together:
//
//   1. Nothing is trusted from the request but the slug. Every path is derived
//      from the claimed database row, so one operator's job can never read or
//      write another operator's files. This matters more than usual: the
//      service holds the service-role key, so RLS does not protect it.
//
//   2. A job is claimed before any work. The claim is a single conditional
//      UPDATE, so a duplicate webhook delivery cannot start a second encode,
//      and a job orphaned by a crash is reclaimed once its lease expires.
//
// A webhook is only a nudge. The sweeper is what makes this reliable: both of
// our payment integrations broke because they depended on a single delivery
// that could be missed or silently rejected, and nothing noticed for weeks.

const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createClient } = require("@supabase/supabase-js");

const { buildMotionCompositePlan, resolveSlotSourceIndices } = require("../../shared/motionComposite");

const run = promisify(execFile);

const PORT = Number(process.env.PORT || 8080);
const BUCKET = process.env.STORAGE_BUCKET || "studiophotuna";
const WEBHOOK_SECRET = process.env.RENDER_WEBHOOK_SECRET || "";
const SWEEP_MS = Number(process.env.SWEEP_INTERVAL_MS || 120000);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);
const SIGNED_URL_SECONDS = 365 * 24 * 60 * 60;
// Expired galleries are deleted on this cadence while the machine is awake, and
// once on every start. pg_cron wakes the machine every 10 minutes, so a gallery
// is gone within an hour or so of its link expiring.
const CLEANUP_MS = Number(process.env.CLEANUP_INTERVAL_MS || 60 * 60 * 1000);
const CLEANUP_BATCH = 25;

for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RENDER_WEBHOOK_SECRET"]) {
  if (!process.env[key]) {
    console.error(`[renderer] ${key} is not set; refusing to start`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let inFlight = 0;
const active = new Set();

function log(step, detail = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), step, ...detail }));
}

// ── Storage helpers ─────────────────────────────────────────────────────────

async function download(objectPath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
  if (error) throw new Error(`download ${objectPath}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function downloadIfPresent(objectPath) {
  try {
    return await download(objectPath);
  } catch {
    return null;
  }
}

// ── One job ─────────────────────────────────────────────────────────────────

async function renderJob(job) {
  // Every path below comes from the claimed row, never from the request.
  const prefix = `${job.event_id}/${job.session_id}`;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "photuna-"));

  try {
    // The recipe carries what the clips cannot: slot geometry, the frame
    // overlay, background colour and which clip belongs in which slot.
    const recipeRaw = await downloadIfPresent(`${prefix}/render.json`);
    if (!recipeRaw) throw new Error("no render.json for this session");
    const recipe = JSON.parse(recipeRaw.toString("utf8"));

    const layout = recipe.layout;
    if (!Array.isArray(layout?.slots) || !layout.slots.length) {
      throw new Error("recipe has no layout slots");
    }

    // Burst clips are uploaded as slot-1, slot-2 … in source order.
    const sourceIndices = resolveSlotSourceIndices(layout, recipe.slotVideoMap);
    const slotFiles = [];
    for (const sourceIndex of sourceIndices) {
      let resolved = null;
      for (const ext of ["mp4", "webm", "ogg"]) {
        const buf = await downloadIfPresent(`${prefix}/burst-video/slot-${sourceIndex + 1}.${ext}`);
        if (buf) {
          resolved = path.join(workDir, `slot-${sourceIndex + 1}.${ext}`);
          await fs.writeFile(resolved, buf);
          break;
        }
      }
      slotFiles.push(resolved);
    }

    if (!slotFiles.some(Boolean)) throw new Error("no burst clips found for this session");

    let overlayFile = null;
    const overlay = await downloadIfPresent(`${prefix}/overlay.png`);
    if (overlay) {
      overlayFile = path.join(workDir, "overlay.png");
      await fs.writeFile(overlayFile, overlay);
    }

    // The same graph the booth builds — one implementation, one result.
    const plan = buildMotionCompositePlan({
      layout,
      slotFiles,
      overlayFile,
      backgroundColor: recipe.backgroundColor,
      watermark: Boolean(recipe.watermark),
    });

    const outputFile = path.join(workDir, "final-motion-1.mp4");
    const args = [];
    for (const input of plan.inputs) {
      if (input.kind === "lavfi") args.push("-f", "lavfi", "-i", input.spec);
      else args.push("-i", input.path);
    }
    args.push("-filter_complex", plan.filters.join(";"), "-map", `[${plan.outputLabel}]`);
    for (const option of plan.outputOptions) args.push(...option.split(" "));
    args.push("-y", outputFile);

    const started = Date.now();
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });
    log("encoded", { slug: job.slug, ms: Date.now() - started });

    const objectPath = `${prefix}/final-motion-1.mp4`;
    const body = await fs.readFile(outputFile);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, body, { contentType: "video/mp4", upsert: true });
    if (uploadError) throw new Error(`upload: ${uploadError.message}`);

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new Error(`sign: ${signError?.message || "no url returned"}`);
    }

    const { error: markError } = await supabase.rpc("mark_gallery_video_ready", {
      p_slug: job.slug,
      p_url: signed.signedUrl,
      p_path: objectPath,
    });
    if (markError) throw new Error(`mark ready: ${markError.message}`);

    log("ready", { slug: job.slug, bytes: body.length });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function processSlug(slug) {
  if (active.has(slug)) return { skipped: "already running here" };
  active.add(slug);
  inFlight += 1;
  try {
    // Claim first. If another worker holds it, this returns nothing and we stop.
    const { data, error } = await supabase.rpc("claim_gallery_video_job", { p_slug: slug });
    if (error) throw new Error(`claim: ${error.message}`);
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return { skipped: "not claimable" };

    try {
      await renderJob(job);
      return { rendered: true };
    } catch (err) {
      // Releases the job for another attempt, or parks it after enough tries.
      log("failed", { slug, message: err.message });
      await supabase.rpc("mark_gallery_video_failed", { p_slug: slug, p_error: err.message });
      return { failed: err.message };
    }
  } finally {
    active.delete(slug);
    inFlight -= 1;
  }
}

// ── Sweeper ─────────────────────────────────────────────────────────────────

async function sweep() {
  if (inFlight >= MAX_CONCURRENT) return;
  try {
    const { data, error } = await supabase.rpc("claim_next_gallery_video_jobs", {
      p_limit: MAX_CONCURRENT - inFlight,
    });
    if (error) throw new Error(error.message);
    const jobs = Array.isArray(data) ? data : [];
    if (!jobs.length) return;

    log("swept", { jobs: jobs.length });
    for (const job of jobs) {
      // Already claimed by the sweep, so render directly.
      active.add(job.slug);
      inFlight += 1;
      renderJob(job)
        .catch(async (err) => {
          log("failed", { slug: job.slug, message: err.message });
          await supabase
            .rpc("mark_gallery_video_failed", { p_slug: job.slug, p_error: err.message })
            .catch(() => {});
        })
        .finally(() => {
          active.delete(job.slug);
          inFlight -= 1;
        });
    }
  } catch (err) {
    log("sweep-error", { message: err.message });
  }
}

// ── Expired gallery cleanup ────────────────────────────────────────────────
//
// Guests are told their photos are deleted when the gallery link expires. SQL
// cannot delete stored files, so the database leases expired galleries to us
// (claim_expired_galleries), we remove their files here through the Storage API,
// and only then is the row dropped (finish_gallery_deletion). A crash midway
// leaves the lease to lapse and the gallery is claimed again later.
//
// As with rendering, every path comes from the claimed row.

// Every object under a folder, however deep. Storage lists one level at a time;
// entries without an id are sub-folders.
async function listFolder(prefix) {
  const found = [];
  const pending = [prefix];
  while (pending.length) {
    const dir = pending.pop();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 1000, offset });
      if (error) throw new Error(`list ${dir}: ${error.message}`);
      for (const entry of data || []) {
        const full = `${dir}/${entry.name}`;
        if (entry.id) found.push(full);
        else pending.push(full);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return found;
}

async function deleteGallery(gallery) {
  const paths = new Set(gallery.object_paths || []);
  if (gallery.session_prefix) {
    for (const objectPath of await listFolder(gallery.session_prefix)) paths.add(objectPath);
  }

  const all = [...paths];
  for (let i = 0; i < all.length; i += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(all.slice(i, i + 100));
    if (error) throw new Error(`remove: ${error.message}`);
  }

  const { error } = await supabase.rpc("finish_gallery_deletion", { p_id: gallery.id });
  if (error) throw new Error(`finish: ${error.message}`);
  return all.length;
}

let cleaning = false;

async function cleanupExpiredGalleries() {
  if (cleaning) return;
  cleaning = true;
  let galleries = 0;
  let files = 0;
  try {
    // Keep going while full batches come back, so a backlog clears in one pass.
    for (;;) {
      const { data, error } = await supabase.rpc("claim_expired_galleries", { p_limit: CLEANUP_BATCH });
      if (error) throw new Error(`claim: ${error.message}`);
      const batch = Array.isArray(data) ? data : [];
      for (const gallery of batch) {
        try {
          files += await deleteGallery(gallery);
          galleries += 1;
        } catch (err) {
          log("cleanup-failed", { slug: gallery.slug, message: err.message });
        }
      }
      if (batch.length < CLEANUP_BATCH) break;
    }
    if (galleries) log("cleanup", { galleries, files });
  } catch (err) {
    log("cleanup-error", { message: err.message });
  } finally {
    cleaning = false;
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/health") {
    return send(200, { ok: true, inFlight, maxConcurrent: MAX_CONCURRENT });
  }

  if (req.method !== "POST" || !req.url.startsWith("/render")) {
    return send(404, { error: "not found" });
  }

  if (req.headers["x-render-secret"] !== WEBHOOK_SECRET) {
    return send(401, { error: "unauthorised" });
  }

  let payload;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return send(400, { error: "bad json" });
  }

  // A database webhook sends the whole row; only the slug is used, and even
  // that is re-read from the database by the claim.
  const slug = payload?.record?.slug || payload?.slug;
  if (!slug || typeof slug !== "string") return send(400, { error: "no slug" });

  // Answer immediately: the caller is a webhook, not someone waiting for a video.
  send(202, { accepted: true, slug });
  processSlug(slug).catch((err) => log("process-error", { slug, message: err.message }));
});

server.listen(PORT, () => {
  log("listening", { port: PORT, bucket: BUCKET, maxConcurrent: MAX_CONCURRENT, sweepMs: SWEEP_MS });
  setInterval(sweep, SWEEP_MS).unref();
  sweep();
  setInterval(cleanupExpiredGalleries, CLEANUP_MS).unref();
  cleanupExpiredGalleries();
});
