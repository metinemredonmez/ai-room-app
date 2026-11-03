"use client";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class ImageInputError extends Error {
  constructor(public code: "unsupported" | "too_large") {
    super(code);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Downscales to max 2048px JPEG in the browser; falls back to the original bytes (e.g. HEIC). */
export async function fileToUpload(file: File): Promise<{ data: string; mimeType: string }> {
  const type = file.type === "image/heif" ? "image/heic" : file.type;
  if (!ALLOWED.includes(file.type)) throw new ImageInputError("unsupported");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("encode failed");
    if (blob.size > MAX_UPLOAD_BYTES) throw new ImageInputError("too_large");
    return { data: await blobToBase64(blob), mimeType: "image/jpeg" };
  } catch (e) {
    if (e instanceof ImageInputError) throw e;
    if (file.size > MAX_UPLOAD_BYTES) throw new ImageInputError("too_large");
    return { data: await blobToBase64(file), mimeType: type };
  }
}
