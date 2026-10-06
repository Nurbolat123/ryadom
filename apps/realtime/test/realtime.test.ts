import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createPrismaClient } from "@ryadom/db";
import {
  endPresence,
  publishPresenceEvent,
  publishUserEvent,
  startPresence,
} from "@ryadom/presence";
import { presenceKeys, realtimeTicketKey } from "@ryadom/shared";
import { Redis } from "ioredis";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRealtime } from "../src/server";

const db = createPrismaClient();
const redis = new Redis(process.env.REDIS_URL!);
const rt = createRealtime({
  db,
  redis,
  sub: new Redis(process.env.REDIS_URL!),
  corsOrigin: "*",
  sweepIntervalMs: 60_000,
});
let url = "";

const users: string[] = [];
const sockets: Socket[] = [];

const mkUser = async () => {
  const u = await db.user.create({
    data: {
      phone: `+7704${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "male",
      displayName: "Тест",
    },
  });
  users.push(u.id);
  const token = randomBytes(24).toString("hex");
  await db.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId: u.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return { id: u.id, token };
};

const open = (token?: string, ticket?: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = connect(url, {
      transports: ["websocket"],
      extraHeaders: token ? { cookie: `ryadom_session=${token}` } : {},
      auth: ticket ? { ticket } : {},
      reconnection: false,
    });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });

const once = <T = void>(s: Socket, event: string, ms = 2000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`нет события ${event}`)), ms);
    s.once(event, (v: T) => {
      clearTimeout(t);
      resolve(v);
    });
  });

const silent = (s: Socket, event: string, ms = 300) =>
  new Promise<boolean>((resolve) => {
    const h = () => resolve(false);
    s.once(event, h);
    setTimeout(() => {
      s.off(event, h);
      resolve(true);
    }, ms);
  });

const heartbeat = (s: Socket) =>
  s.timeout(2000).emitWithAck("heartbeat") as Promise<{ present: boolean }>;

beforeAll(async () => {
  await new Promise<void>((r) => rt.http.listen(0, r));
  url = `http://localhost:${(rt.http.address() as AddressInfo).port}`;
  // Дать подписке на канал присутствия установиться.
  await new Promise((r) => setTimeout(r, 100));
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await rt.close();
  for (const id of users) await endPresence(redis, id);
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  redis.disconnect();
});

describe("realtime", () => {
  it("без сессии подключиться нельзя", async () => {
    await expect(open()).rejects.toThrow("unauthorized");
    await expect(open("bad-token")).rejects.toThrow("unauthorized");
  });

  it("вход по одноразовому билету (другой домен, без cookie)", async () => {
    const a = await mkUser();
    const ticket = randomBytes(24).toString("base64url");
    await redis.set(
      realtimeTicketKey(createHash("sha256").update(ticket).digest("hex")),
      a.id,
      "EX",
      60,
    );
    const s = await open(undefined, ticket);
    expect(await heartbeat(s)).toEqual({ present: false });
    // Второй раз тот же билет не пускает.
    await expect(open(undefined, ticket)).rejects.toThrow("unauthorized");
  });

  it("heartbeat отвечает, есть ли присутствие", async () => {
    const a = await mkUser();
    const s = await open(a.token);
    expect(await heartbeat(s)).toEqual({ present: false });
    await startPresence(redis, a.id, randomUUID(), randomUUID());
    expect(await heartbeat(s)).toEqual({ present: true });
  });

  it("сигнал people:changed получают только присутствующие в этом заведении, без данных", async () => {
    const venue = randomUUID();
    const [a, b, c] = await Promise.all([mkUser(), mkUser(), mkUser()]);
    await startPresence(redis, a.id, venue, randomUUID());
    await startPresence(redis, c.id, randomUUID(), randomUUID());
    const [sa, sc] = await Promise.all([open(a.token), open(c.token)]);
    await heartbeat(sa);

    // b пришёл и включил «Открыт(а)»: a получает сигнал, c (другое заведение) — нет.
    await startPresence(redis, b.id, venue, randomUUID());
    const got = once<unknown>(sa, "people:changed");
    const quiet = silent(sc, "people:changed");
    await publishPresenceEvent(redis, { type: "open", venueId: venue, userId: b.id });
    expect(await got).toBeUndefined();
    expect(await quiet).toBe(true);
  });

  it("пришёл в заведение — сокет попадает в комнату; ушёл — presence:ended и больше никаких сигналов", async () => {
    const venue = randomUUID();
    const [a, b] = await Promise.all([mkUser(), mkUser()]);
    const sa = await open(a.token);

    await startPresence(redis, a.id, venue, randomUUID());
    await publishPresenceEvent(redis, { type: "joined", venueId: venue, userId: a.id });
    await once(sa, "people:changed");

    await endPresence(redis, a.id);
    const ended = once(sa, "presence:ended");
    await publishPresenceEvent(redis, { type: "left", venueId: venue, userId: a.id });
    await ended;

    const quiet = silent(sa, "people:changed");
    await publishPresenceEvent(redis, { type: "open", venueId: venue, userId: b.id });
    expect(await quiet).toBe(true);
  });

  it("личные события уходят только адресату и без данных о людях", async () => {
    const [a, c] = await Promise.all([mkUser(), mkUser()]);
    const [sa, sc] = await Promise.all([open(a.token), open(c.token)]);
    const got = once<unknown>(sa, "match");
    const quiet = silent(sc, "match");
    await publishUserEvent(redis, { type: "match", userId: a.id, chatId: "chat1" });
    expect(await got).toEqual({ chatId: "chat1" });
    expect(await quiet).toBe(true);

    const inbox = once<unknown>(sc, "inbox:changed");
    await publishUserEvent(redis, { type: "inbox", userId: c.id });
    expect(await inbox).toBeUndefined();
  });

  it("истечение TTL: очистка завершает присутствие и обновляет список", async () => {
    const venue = randomUUID();
    const [a, b] = await Promise.all([mkUser(), mkUser()]);
    await startPresence(redis, a.id, venue, randomUUID());
    await startPresence(redis, b.id, venue, randomUUID());
    // Присутствие a истекло минуту назад; b ещё здесь.
    await redis.zadd(presenceKeys.venue(venue), Date.now() - 60_000, a.id);
    const sb = await open(b.token);
    await heartbeat(sb);
    const changed = once(sb, "people:changed");
    await rt.sweep();
    await changed;
  });
});
