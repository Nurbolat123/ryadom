import { createHash, createHmac } from "node:crypto";
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

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();

export type S3Config = {
  /** Адрес хранилища, например https://s3.example.kz (path-style: адрес/бакет/ключ). */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Подпись запроса AWS Signature V4 — её понимают все S3-совместимые хранилища.
 * Своя реализация на node:crypto вместо AWS SDK: нужны только PUT, GET и DELETE одного объекта.
 */
export const signS3Request = (opts: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}): Record<string, string> => {
  const amzDate = opts.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: opts.url.host,
    "x-amz-content-sha256": opts.payloadHash,
    "x-amz-date": amzDate,
  };
  for (const [k, v] of Object.entries(opts.headers)) headers[k.toLowerCase()] = v.trim();
  const names = Object.keys(headers).sort();
  const canonical = [
    opts.method,
    opts.url.pathname,
    "",
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    names.join(";"),
    opts.payloadHash,
  ].join("\n");
  const scope = `${day}/${opts.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(
    hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, day), opts.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope},SignedHeaders=${names.join(";")},Signature=${signature}`,
  };
};

/** S3-совместимое хранилище (в проде — в Казахстане, правило 12). Объекты приватные. */
export class S3PhotoStorage implements PhotoStorage {
  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async send(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, type?: string) {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Недопустимый ключ фото");
    const base = this.config.endpoint.replace(/\/+$/, "");
    const url = new URL(`${base}/${this.config.bucket}/${key}`);
    const headers = signS3Request({
      method,
      url,
      headers: type ? { "content-type": type } : {},
      payloadHash: sha256(body ?? ""),
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      now: new Date(),
    });
    delete headers.host;
    return this.fetchImpl(url, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
    });
  }

  async put(key: string, data: Buffer, contentType: string) {
    const res = await this.send("PUT", key, data, contentType);
    if (!res.ok) throw new Error(`S3: не удалось сохранить фото (${res.status})`);
  }

  async get(key: string) {
    const res = await this.send("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3: не удалось прочитать фото (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string) {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404)
      throw new Error(`S3: не удалось удалить фото (${res.status})`);
  }
}

/** Настройки S3 из окружения или null, если чего-то не хватает. */
export const s3ConfigFromEnv = (
  env: Record<string, string | undefined> = process.env,
): S3Config | null => {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: S3_ENDPOINT,
    region: S3_REGION || "us-east-1",
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
};

let storage: PhotoStorage | null = null;

export const getPhotoStorage = (): PhotoStorage => {
  if (storage) return storage;
  const kind = process.env.PHOTO_STORAGE ?? "local";
  if (kind === "s3") {
    const config = s3ConfigFromEnv();
    if (!config)
      throw new Error("PHOTO_STORAGE=s3: задайте S3_ENDPOINT, S3_BUCKET и ключи доступа");
    storage = new S3PhotoStorage(config);
    return storage;
  }
  if (kind !== "local") throw new Error(`PHOTO_STORAGE=${kind} не поддерживается (local или s3)`);
  // По умолчанию — .data/photos в корне монорепо.
  storage = new LocalPhotoStorage(
    resolve(/*turbopackIgnore: true*/ process.env.PHOTO_STORAGE_DIR || "../../.data/photos"),
  );
  return storage;
};

export const setPhotoStorage = (s: PhotoStorage | null) => {
  storage = s;
};
