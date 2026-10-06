import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Хранилище фото. В проде — S3-совместимое хранилище в Казахстане (правило 12),
 * в разработке — папка на диске. Код работает только через этот интерфейс.
 */
export interface PhotoStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9/_-]+\.(webp|jpg)$/;

export class LocalPhotoStorage implements PhotoStorage {
  constructor(private readonly root: string) {}

  private path(key: string) {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Недопустимый ключ фото");
    return join(this.root, key);
  }

  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string) {
    return readFile(this.path(key)).catch(() => null);
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

let storage: PhotoStorage | null = null;

export const getPhotoStorage = (): PhotoStorage => {
  if (storage) return storage;
  const kind = process.env.PHOTO_STORAGE ?? "local";
  if (kind !== "local") throw new Error(`PHOTO_STORAGE=${kind} пока не реализовано`);
  // По умолчанию — .data/photos в корне монорепо.
  storage = new LocalPhotoStorage(
    resolve(/*turbopackIgnore: true*/ process.env.PHOTO_STORAGE_DIR || "../../.data/photos"),
  );
  return storage;
};

export const setPhotoStorage = (s: PhotoStorage | null) => {
  storage = s;
};
