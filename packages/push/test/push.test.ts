import { createECDH, randomBytes } from "node:crypto";
import { createPrismaClient } from "@ryadom/db";
import { Redis } from "ioredis";
import webpush from "web-push";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildPayload,
  PUSH_KINDS,
  PUSH_TEXT,
  sendPush,
  WebPushSender,
  type PushPayload,
  type PushSender,
} from "../src";

const db = createPrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const users: string[] = [];

const mkUser = async (data: { locale?: "ru" | "kk"; bannedAt?: Date } = {}) => {
  const u = await db.user.create({
    data: {
      phone: `+7703${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: "Алия Секретова",
      ...data,
    },
  });
  users.push(u.id);
  return u.id;
};
const subscribe = (userId: string) =>
  db.pushSubscription.create({
    data: {
      userId,
      endpoint: `https://push.example/${randomBytes(8).toString("hex")}`,
      p256dh: "k",
      auth: "a",
    },
  });

const recorder = (result: Awaited<ReturnType<PushSender["send"]>> = { ok: true }) => {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const sender: PushSender = {
    send: async (t, payload) => {
      sent.push({ endpoint: t.endpoint, payload });
      return result;
    },
  };
  return { sent, sender };
};

beforeEach(async () => {
  for (const k of await redis.keys("push-throttle:*")) await redis.del(k);
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  redis.disconnect();
});

describe("тексты уведомлений", () => {
  it("есть для всех видов на ru и kk; без имён и подстановок", () => {
    for (const locale of ["ru", "kk"] as const)
      for (const kind of PUSH_KINDS) {
        const p = buildPayload(kind, locale);
        expect(p.body.length).toBeGreaterThan(0);
        expect(p.url.startsWith("/")).toBe(true);
        expect(p.body).not.toMatch(/[{}]/);
      }
    expect(PUSH_TEXT.ru.sympathy.body).toBe("Кому-то здесь ты понравился(лась)");
  });
});

describe("sendPush", () => {
  it("на все устройства, на языке человека, без имени и id", async () => {
    const u = await mkUser({ locale: "kk" });
    await subscribe(u);
    await subscribe(u);
    const { sent, sender } = recorder();
    expect(await sendPush({ db, redis, sender, userId: u, kind: "hello" })).toBe(2);
    expect(sent.map((s) => s.payload)).toEqual([
      buildPayload("hello", "kk"),
      buildPayload("hello", "kk"),
    ]);
    const text = JSON.stringify(sent);
    expect(text).not.toContain("Алия");
    expect(text).not.toContain(u);
    expect(
      (await db.pushSubscription.findMany({ where: { userId: u } })).every((s) => s.lastSentAt),
    ).toBe(true);
  });

  it("не чаще раза в минуту на один вид", async () => {
    const u = await mkUser();
    await subscribe(u);
    const { sent, sender } = recorder();
    await sendPush({ db, redis, sender, userId: u, kind: "message" });
    await sendPush({ db, redis, sender, userId: u, kind: "message" });
    await sendPush({ db, redis, sender, userId: u, kind: "match" });
    expect(sent.map((s) => s.payload.tag)).toEqual(["message", "match"]);
  });

  it("подписка больше не действует (404/410) — удаляется", async () => {
    const u = await mkUser();
    await subscribe(u);
    const { sender } = recorder({ ok: false, gone: true });
    expect(await sendPush({ db, redis, sender, userId: u, kind: "gift" })).toBe(0);
    expect(await db.pushSubscription.count({ where: { userId: u } })).toBe(0);
  });

  it("закрытому модератором аккаунту — ничего", async () => {
    const u = await mkUser({ bannedAt: new Date() });
    await subscribe(u);
    const { sent, sender } = recorder();
    await sendPush({ db, redis, sender, userId: u, kind: "hello" });
    expect(sent).toEqual([]);
  });
});

describe("WebPushSender", () => {
  const vapid = { ...webpush.generateVAPIDKeys(), subject: "mailto:test@ryadom.kz" };
  // Ключи браузера.
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const target = {
    endpoint: "https://push.example/abc",
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  const payload = buildPayload("hello", "ru");

  it("шифрует уведомление и подписывает VAPID", () => {
    const sender = new WebPushSender(vapid);
    const req = webpush.generateRequestDetails(
      target,
      JSON.stringify(payload),
      sender.options(payload),
    );
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(req.headers.TTL).toBe(3600);
    expect(req.headers.Topic).toBe("hello");
    expect(String(req.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    // Текст зашифрован: в теле запроса его нет.
    expect(Buffer.from(req.body!).toString("utf8")).not.toContain("привет");
  });

  it("410/404 — подписка больше не действует; другие ошибки — нет", async () => {
    const failWith = (statusCode?: number) =>
      new WebPushSender(vapid, async () => {
        throw Object.assign(new Error("x"), { statusCode });
      });
    expect(await failWith(410).send(target, payload)).toEqual({ ok: false, gone: true });
    expect(await failWith(404).send(target, payload)).toEqual({ ok: false, gone: true });
    expect(await failWith(500).send(target, payload)).toEqual({ ok: false, gone: false });
    expect(await failWith().send(target, payload)).toEqual({ ok: false, gone: false });
    const ok = new WebPushSender(vapid, async () => ({ statusCode: 201, body: "", headers: {} }));
    expect(await ok.send(target, payload)).toEqual({ ok: true });
  });
});
