// Private bucket — create a long-lived signed URL (365 days) instead of a public URL
const SIGNED_URL_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

async function getSafeUrl(supabase, bucket, path) {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch (_) {}
  // Fall back to public URL (works if bucket is made public later)
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

function normalizeImageContentType(blob, fallback = "image/png") {
  const type = String(blob?.type || "").toLowerCase();
  if (type.startsWith("image/")) return type;
  return fallback;
}

function detectVideoMeta(blob, index = 0, prefix = "slot") {
  const type = String(blob?.type || "").toLowerCase();

  if (type.includes("mp4")) {
    return {
      ext: "mp4",
      contentType: "video/mp4",
      fileName: `${prefix}-${index + 1}.mp4`,
    };
  }

  if (type.includes("ogg") || type.includes("ogv")) {
    return {
      ext: "ogg",
      contentType: "video/ogg",
      fileName: `${prefix}-${index + 1}.ogg`,
    };
  }

  return {
    ext: "webm",
    contentType: "video/webm",
    fileName: `${prefix}-${index + 1}.webm`,
  };
}

async function uploadSessionImages({
  supabase,
  eventId,
  sessionId,
  finalBlob,
  finalVideoBlob = null,
  photoBlobs = [],
  burstVideoBlobs = [],
}) {
  const bucket = "studiophotuna";

  if (!supabase) throw new Error("Missing Supabase client");
  if (!eventId) throw new Error("Missing eventId");
  if (!sessionId) throw new Error("Missing sessionId");
  if (!finalBlob) throw new Error("Missing finalBlob");

  const finalPath = `${eventId}/${sessionId}/final.png`;

  // Diagnostic: log the supabase project URL so we can confirm the right client is used
  const supabaseUrl = supabase?.supabaseUrl || String(supabase?.storageUrl?.href || "") || "(unknown)";
  console.log("[uploadSessionImages] start", {
    eventId,
    sessionId,
    photoCount: photoBlobs.length,
    burstCount: burstVideoBlobs.length,
    finalType: finalBlob?.type,
    finalSize: finalBlob?.size,
    finalVideoType: finalVideoBlob?.type,
    finalVideoSize: finalVideoBlob?.size,
    supabaseUrl,
    bucket,
    finalPath,
  });

  const finalRes = await supabase.storage
    .from(bucket)
    .upload(finalPath, finalBlob, {
      contentType: normalizeImageContentType(finalBlob, "image/png"),
      upsert: true,
    });

  if (finalRes.error) {
    console.error("[uploadSessionImages] final upload failed", {
      error: finalRes.error,
      status: finalRes.error?.status,
      statusCode: finalRes.error?.statusCode,
      message: finalRes.error?.message,
      supabaseUrl,
      bucket,
      finalPath,
    });
    throw finalRes.error;
  }

  const finalUrl = await getSafeUrl(supabase, bucket, finalPath);

  let finalVideoUrl = null;
  if (finalVideoBlob && finalVideoBlob.size) {
    const motionMeta = detectVideoMeta(finalVideoBlob, 0, "final-motion");
    const finalVideoPath = `${eventId}/${sessionId}/${motionMeta.fileName}`;

    const finalVideoRes = await supabase.storage
      .from(bucket)
      .upload(finalVideoPath, finalVideoBlob, {
        contentType: motionMeta.contentType,
        upsert: true,
      });

    if (finalVideoRes.error) {
      console.error("[uploadSessionImages] final video upload failed", finalVideoRes.error);
      throw finalVideoRes.error;
    }

    finalVideoUrl = await getSafeUrl(supabase, bucket, finalVideoPath);
  }

  const photoUrls = [];
  for (let i = 0; i < photoBlobs.length; i += 1) {
    const photoBlob = photoBlobs[i];
    if (!photoBlob || !photoBlob.size) {
      console.warn(`[uploadSessionImages] skipping empty photo blob at index ${i}`);
      continue;
    }

    const photoPath = `${eventId}/${sessionId}/photos/photo-${i + 1}.png`;

    const photoRes = await supabase.storage
      .from(bucket)
      .upload(photoPath, photoBlob, {
        contentType: normalizeImageContentType(photoBlob, "image/png"),
        upsert: true,
      });

    if (photoRes.error) {
      console.error(`[uploadSessionImages] photo upload failed at index ${i}`, photoRes.error);
      throw photoRes.error;
    }

    const url = await getSafeUrl(supabase, bucket, photoPath);
    if (url) photoUrls.push(url);
  }

  const burstVideoUrls = [];
  const burstUploadErrors = [];

  for (let i = 0; i < burstVideoBlobs.length; i += 1) {
    const videoBlob = burstVideoBlobs[i];

    if (!videoBlob || !videoBlob.size) {
      console.warn(`[uploadSessionImages] skipping empty burst blob at index ${i}`);
      continue;
    }

    const meta = detectVideoMeta(videoBlob, i);
    const videoPath = `${eventId}/${sessionId}/burst-video/${meta.fileName}`;

    try {
      const videoRes = await supabase.storage
        .from(bucket)
        .upload(videoPath, videoBlob, {
          contentType: meta.contentType,
          upsert: true,
        });

      if (videoRes.error) throw videoRes.error;

      const url = await getSafeUrl(supabase, bucket, videoPath);
      if (url) {
        burstVideoUrls.push(url);
      } else {
        burstUploadErrors.push(`No signed URL returned for burst index ${i}`);
      }
    } catch (err) {
      console.error(`[uploadSessionImages] burst upload failed at index ${i}`, err);
      burstUploadErrors.push(err?.message || `Burst upload failed at index ${i}`);
    }
  }

  console.log("[uploadSessionImages] done", {
    finalUrl,
    finalVideoUrl,
    photoUrls,
    burstVideoUrls,
    burstUploadErrors,
  });

  return {
    finalUrl,
    finalVideoUrl,
    photoUrls,
    burstVideoUrls,
    burstUploadErrors,
  };
}

module.exports = { uploadSessionImages };
