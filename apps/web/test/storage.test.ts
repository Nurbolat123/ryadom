import { describe, expect, it } from "vitest";
import { S3PhotoStorage, s3ConfigFromEnv, signS3Request } from "@/lib/server/storage";

describe("S3: подпись AWS Signature V4", () => {
  it("совпадает с примером из документации AWS (GET Object)", () => {
    const headers = signS3Request({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { Range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request," +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date," +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

describe("S3PhotoStorage", () => {
  const config = {
    endpoint: "https://s3.example.kz/",
    region: "kz-1",
    bucket: "photos",
    accessKeyId: "key",
    secretAccessKey: "secret",
  };

  const fake = () => {
    const objects = new Map<string, Buffer>();
    const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, headers: init?.headers as Record<string, string> });
      if (method === "PUT") {
        objects.set(url, Buffer.from(init?.body as Uint8Array));
        return new Response(null, { status: 200 });
      }
      if (method === "DELETE") {
        objects.delete(url);
        return new Response(null, { status: 204 });
      }
      const data = objects.get(url);
      return data ? new Response(new Uint8Array(data)) : new Response(null, { status: 404 });
    }) as typeof fetch;
    return { objects, calls, fetchImpl };
  };

  it("кладёт, читает и удаляет фото по адресу бакета, с подписью", async () => {
    const { calls, fetchImpl } = fake();
    const s3 = new S3PhotoStorage(config, fetchImpl);
    await s3.put("u/abc.webp", Buffer.from("photo"), "image/webp");
    expect((await s3.get("u/abc.webp"))?.toString()).toBe("photo");
    await s3.delete("u/abc.webp");
    expect(await s3.get("u/abc.webp")).toBeNull();

    expect(calls[0]?.url).toBe("https://s3.example.kz/photos/u/abc.webp");
    expect(calls[0]?.headers["content-type"]).toBe("image/webp");
    expect(calls[0]?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/kz-1\/s3/,
    );
    expect(calls[0]?.headers.host).toBeUndefined();
  });

  it("не принимает опасные ключи", async () => {
    const s3 = new S3PhotoStorage(config, fake().fetchImpl);
    await expect(s3.get("../etc/passwd.jpg")).rejects.toThrow();
  });

  it("ошибка хранилища не превращается в «фото нет»", async () => {
    const s3 = new S3PhotoStorage(
      config,
      (async () => new Response(null, { status: 403 })) as typeof fetch,
    );
    await expect(s3.get("u/abc.webp")).rejects.toThrow("403");
    await expect(s3.put("u/abc.webp", Buffer.from("x"), "image/webp")).rejects.toThrow("403");
  });

  it("настройки из окружения: без ключей — null", () => {
    expect(s3ConfigFromEnv({ S3_ENDPOINT: "https://s3.example.kz" })).toBeNull();
    expect(
      s3ConfigFromEnv({
        S3_ENDPOINT: "https://s3.example.kz",
        S3_BUCKET: "b",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
      })?.region,
    ).toBe("us-east-1");
  });
});
