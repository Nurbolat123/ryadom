import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { jar } from "./cookies-mock";

const { prisma } = await import("@ryadom/db");
const { POST: requestCode } = await import("@/app/api/auth/code/route");
const { POST: verify } = await import("@/app/api/auth/verify/route");
const { POST: checkAge } = await import("@/app/api/onboarding/age/route");
const { POST: createProfile } = await import("@/app/api/onboarding/profile/route");
const { GET: me } = await import("@/app/api/me/route");
const { PUT: uploadPhoto, GET: getPhoto } = await import("@/app/api/me/photo/route");
const { PUT: setInterests } = await import("@/app/api/me/interests/route");
const { POST: selfie } = await import("@/app/api/me/selfie/route");
const { redis } = await import("@/lib/redis");
const { ConsoleSmsProvider, setSmsProvider } = await import("@/lib/server/sms");
const { LocalPhotoStorage, setPhotoStorage } = await import("@/lib/server/storage");
const { sha256 } = await import("@/lib/server/hash");

const sent: { phone: string; code: string }[] = [];
let photoDir = "";
const createdPhones: string[] = [];

const randomPhone = () => `+7701${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const ip = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...headers },
    body: JSON.stringify(body),
  });
const form = (field: string, data: Buffer, method = "POST") => {
  const fd = new FormData();
  fd.set(field, new Blob([new Uint8Array(data)], { type: "image/jpeg" }), "p.jpg");
  return new Request("http://localhost/x", { method, body: fd });
};

/** JPEG с EXIF: геометка в Астане и модель телефона. */
const jpegWithGps = () =>
  sharp({ create: { width: 900, height: 1200, channels: 3, background: "#C9441D" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "Apple", Model: "iPhone 15" },
      // IFD3 — это GPS-блок EXIF в sharp.
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "51/1 7/1 4200/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "71/1 25/1 4980/100",
      },
    })
    .toBuffer();

const login = async (phone: string) => {
  expect((await requestCode(json({ phone }))).status).toBe(200);
  const code = [...sent].reverse().find((s) => s.phone === phone)!.code;
  const res = await verify(json({ phone, code }));
  expect(res.status).toBe(200);
  return (await res.json()) as { next: string };
};

const register = async (phone: string, birthDate = "1996-03-14") => {
  createdPhones.push(phone);
  await login(phone);
  const res = await createProfile(json({ birthDate, gender: "female", displayName: "Айгерим" }));
  expect(res.status).toBe(201);
};

beforeAll(async () => {
  photoDir = await mkdtemp(join(tmpdir(), "ryadom-photos-"));
  setPhotoStorage(new LocalPhotoStorage(photoDir));
  setSmsProvider({ sendCode: async (phone, code) => void sent.push({ phone, code }) });
});

beforeEach(() => jar.clear());

afterAll(async () => {
  await prisma.user.deleteMany({ where: { phone: { in: createdPhones } } });
  await prisma.session.deleteMany({ where: { phone: { in: createdPhones } } });
  await rm(photoDir, { recursive: true, force: true });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("вход по телефону", () => {
  it("принимает номер в любом привычном формате и шлёт 6-значный код", async () => {
    const phone = randomPhone();
    createdPhones.push(phone);
    const pretty = `8 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8, 10)}-${phone.slice(10)}`;
    const res = await requestCode(json({ phone: pretty }));
    expect(res.status).toBe(200);
    expect(sent.at(-1)).toMatchObject({ phone });
    expect(sent.at(-1)!.code).toMatch(/^\d{6}$/);
  });

  it("неверный номер — 400", async () => {
    expect((await requestCode(json({ phone: "12345" }))).status).toBe(400);
  });

  it("повторно код не раньше чем через минуту", async () => {
    const phone = randomPhone();
    createdPhones.push(phone);
    await requestCode(json({ phone }));
    const again = await requestCode(json({ phone }));
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ error: "cooldown" });
  });

  it("после 5 неверных попыток код сгорает", async () => {
    const phone = randomPhone();
    createdPhones.push(phone);
    await requestCode(json({ phone }));
    const code = sent.at(-1)!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    const errors: string[] = [];
    for (let i = 0; i < 5; i++)
      errors.push(
        ((await (await verify(json({ phone, code: wrong }))).json()) as { error: string }).error,
      );
    expect(errors.slice(0, 4)).toEqual(["invalid", "invalid", "invalid", "invalid"]);
    expect(errors[4]).toBe("too_many_attempts");
    // даже верный код больше не подходит
    expect((await verify(json({ phone, code }))).status).toBe(410);
  });

  it("верный код создаёт сессию; в базе только хэш токена", async () => {
    const phone = randomPhone();
    createdPhones.push(phone);
    expect(await login(phone)).toEqual({ ok: true, next: "/onboarding/birth" });
    const token = jar.get("ryadom_session")!;
    expect(token.length).toBeGreaterThan(30);
    const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(session.tokenHash).not.toBe(token);
    expect(session.phone).toBe(phone);
  });

  it("код один раз: повторно тем же кодом не войти", async () => {
    const phone = randomPhone();
    createdPhones.push(phone);
    await requestCode(json({ phone }));
    const code = sent.at(-1)!.code;
    expect((await verify(json({ phone, code }))).status).toBe(200);
    expect((await verify(json({ phone, code }))).status).toBe(410);
  });

  it("заглушка SMS пишет код в лог, но не номер телефона", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await new ConsoleSmsProvider().sendCode("+77011234567", "123456");
    const line = spy.mock.calls.flat().join(" ");
    spy.mockRestore();
    expect(line).toContain("123456");
    expect(line).not.toContain("+77011234567");
    expect(line).not.toContain("1234567");
  });
});

describe("регистрация 18+ (правило 10)", () => {
  it("младше 18 — отказ, и номер блокируется даже при «исправленной» дате", async () => {
    const phone = randomPhone();
    createdPhones.push(phone);
    await login(phone);
    const young = new Date();
    young.setFullYear(young.getFullYear() - 17);
    const res = await checkAge(json({ birthDate: young.toISOString().slice(0, 10) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "underage" });

    expect((await checkAge(json({ birthDate: "1990-01-01" }))).status).toBe(403);
    expect(
      (await createProfile(json({ birthDate: "1990-01-01", gender: "male", displayName: "Арман" })))
        .status,
    ).toBe(403);
    expect(await prisma.user.count({ where: { phone } })).toBe(0);
  });

  it("сервер перепроверяет возраст при создании профиля", async () => {
    const phone = randomPhone();
    createdPhones.push(phone);
    await login(phone);
    const res = await createProfile(
      json({ birthDate: "2015-01-01", gender: "male", displayName: "Арман" }),
    );
    expect(res.status).toBe(403);
  });

  it("взрослый создаёт профиль; ответ /api/me без телефона", async () => {
    const phone = randomPhone();
    await register(phone);
    const body = await (await me()).json();
    expect(body.step).toBe("photo");
    expect(body.user.displayName).toBe("Айгерим");
    expect(JSON.stringify(body)).not.toContain(phone.slice(1));
  });

  it("имя с контактами не принимается", async () => {
    const phone = randomPhone();
    createdPhones.push(phone);
    await login(phone);
    const res = await createProfile(
      json({ birthDate: "1995-01-01", gender: "male", displayName: "t.me/arman" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("фото, интересы, селфи", () => {
  it("фото сохраняется сжатым в WebP и без EXIF/GPS", async () => {
    await register(randomPhone());
    const input = await jpegWithGps();
    const inputExif = (await sharp(input).metadata()).exif!;
    expect(inputExif.includes(Buffer.from("iPhone 15"))).toBe(true);
    expect(inputExif.length).toBeGreaterThan(250); // есть GPS-блок

    expect((await uploadPhoto(form("photo", input, "PUT"))).status).toBe(200);
    const stored = Buffer.from(await (await getPhoto()).arrayBuffer());
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1080);
    expect(stored.includes(Buffer.from("iPhone"))).toBe(false);
  });

  it("не картинка — 400", async () => {
    await register(randomPhone());
    const res = await uploadPhoto(form("photo", Buffer.from("not an image at all"), "PUT"));
    expect(res.status).toBe(400);
  });

  it("интересов от 1 до 10, только из справочника", async () => {
    await register(randomPhone());
    const ids = (await prisma.interest.findMany({ take: 11, select: { id: true } })).map(
      (i) => i.id,
    );
    const put = (interestIds: string[]) =>
      setInterests(
        new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ interestIds }) }),
      );
    expect((await put(ids)).status).toBe(400);
    expect((await put([])).status).toBe(400);
    expect((await put(["нет-такого"])).status).toBe(400);
    expect((await put(ids.slice(0, 10))).status).toBe(200);
  });

  it("селфи подтверждает профиль и не сохраняется; новое фото снимает подтверждение", async () => {
    const phone = randomPhone();
    await register(phone);
    await uploadPhoto(form("photo", await jpegWithGps(), "PUT"));
    const countFiles = async () =>
      (await readdir(photoDir, { recursive: true })).filter((f) => f.endsWith(".webp")).length;
    const before = await countFiles();

    expect((await selfie(form("selfie", await jpegWithGps()))).status).toBe(200);
    expect(await countFiles()).toBe(before);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(user.verifiedAt).not.toBeNull();

    await uploadPhoto(form("photo", await jpegWithGps(), "PUT"));
    expect((await prisma.user.findUniqueOrThrow({ where: { phone } })).verifiedAt).toBeNull();
    // старое фото удалено, хранится одно
    expect(await countFiles()).toBe(before);
  });

  it("без входа API профиля закрыто", async () => {
    expect((await me()).status).toBe(401);
    expect((await uploadPhoto(form("photo", await jpegWithGps(), "PUT"))).status).toBe(401);
    expect((await selfie(form("selfie", await jpegWithGps()))).status).toBe(401);
  });
});
