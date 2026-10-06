import sharp, { type Metadata } from "sharp";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif"]);

export class PhotoError extends Error {
  constructor(public readonly code: "too_large" | "not_image" | "too_small") {
    super(code);
  }
}

/**
 * Подготовить фото к хранению:
 * - поворачиваем по EXIF-ориентации, затем все метаданные (EXIF с GPS, модель телефона, XMP, ICC) отбрасываются —
 *   sharp не переносит их в результат, если не вызвать withMetadata;
 * - уменьшаем до 1080 px по длинной стороне и сжимаем в WebP.
 */
export const processPhoto = async (input: Buffer): Promise<Buffer> => {
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new PhotoError("too_large");
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new PhotoError("not_image");
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new PhotoError("not_image");
  if ((meta.width ?? 0) < 200 || (meta.height ?? 0) < 200) throw new PhotoError("too_small");

  return sharp(input, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize(1080, 1080, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
};
