import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { detectLocale } from "../lib/server/locale";
import { loginCodeText } from "../lib/server/sms";

type Tree = { [k: string]: string | string[] | Tree };

const flat = (t: Tree, prefix = ""): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else if (Array.isArray(v)) v.forEach((s, i) => out.set(`${key}[${i}]`, s));
    else for (const [kk2, vv] of flat(v, key)) out.set(kk2, vv);
  }
  return out;
};
const RU = flat(ru as Tree);
const KK = flat(kk as Tree);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

/** Совпадают по смыслу и написанию в обоих языках (название, числа, заимствования). */
const SAME_IN_BOTH = new Set([
  "meta.title",
  "brand.name",
  "language.ru",
  "language.kk",
  "login.phonePlaceholder",
  "places.distance",
  "places.distanceM",
  "places.codeTitle",
  "places.weekdays[2]",
  "places.weekdays[5]",
  "checkin.category.cafe",
  "checkin.category.bar",
  "checkin.category.coworking",
  "suggest.cities.astana",
  "suggest.cities.almaty",
  "nav.label",
  "nav.profile",
  "profile.title",
  "profile.plus",
  "plus.title",
  "admin.title",
  "admin.col.commission",
  "admin.funnelLink",
  "admin.funnelTitle",
  "admin.offerType.promo",
  "adminVenues.meters",
  "adminVenues.alcohol",
  "adminVenues.item.isAlcohol",
  "adminVenues.source.dgis",
]);

const ROOT = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(join(ROOT, p)).isDirectory()) return files(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
const UI_FILES = [...files("app"), ...files("components"), ...files("lib/client")].filter(
  (f) => !f.startsWith("app/api/"),
);
const withoutComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("переводы ru/kk", () => {
  it("одинаковые ключи и списки одинаковой длины", () => {
    expect([...KK.keys()].sort()).toEqual([...RU.keys()].sort());
  });

  it("ни одной пустой строки", () => {
    for (const [k, v] of [...RU, ...KK]) expect(v.trim(), k).not.toBe("");
  });

  it("одинаковые подстановки {…} в обоих языках", () => {
    for (const [k, v] of RU) expect(placeholders(KK.get(k)!), k).toEqual(placeholders(v));
  });

  it("казахский текст переведён, а не скопирован", () => {
    const copied = [...RU].filter(
      ([k, v]) => KK.get(k) === v && /[а-яё]/i.test(v) && !SAME_IN_BOTH.has(k),
    );
    expect(copied.map(([k]) => k)).toEqual([]);
  });

  it("в интерфейсе нет текста мимо переводов", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      // Панель тестовой геолокации есть только в режиме разработки.
      if (f.endsWith("DevGeoPanel.tsx")) continue;
      const src = withoutComments(readFileSync(join(ROOT, f), "utf8"));
      src.split("\n").forEach((line, i) => {
        if (/[Ѐ-ӿ]/.test(line)) offenders.push(`${relative(ROOT, join(ROOT, f))}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("каждый ключ, который вызывает интерфейс, есть в переводах", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const f of UI_FILES) {
      const src = readFileSync(join(ROOT, f), "utf8");
      const ns = new Map<string, string>();
      for (const m of src.matchAll(
        /const (\w+) = (?:await )?(?:useTranslations|getTranslations)\(\s*(?:"([\w.]*)")?\s*\)/g,
      ))
        ns.set(m[1]!, m[2] ?? "");
      for (const [fn, space] of ns) {
        for (const m of src.matchAll(
          new RegExp(`\\b${fn}(?:\\.(?:rich|raw|has))?\\("([\\w.-]+)"`, "g"),
        )) {
          const key = space ? `${space}.${m[1]}` : m[1]!;
          const exists =
            RU.has(key) ||
            [...RU.keys()].some((k) => k.startsWith(`${key}.`) || k.startsWith(`${key}[`));
          checked++;
          if (!exists && !src.includes(`${fn}.has(`)) missing.push(`${f}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // Проверка действительно что-то проверяет.
    expect(checked).toBeGreaterThan(300);
  });
});

describe("язык по умолчанию", () => {
  it("выбранный в приложении важнее браузера", () => {
    expect(detectLocale("kk", "ru-RU,ru;q=0.9")).toBe("kk");
    expect(detectLocale("ru", "kk-KZ")).toBe("ru");
  });

  it("без выбора — первый из ru/kk в настройках браузера", () => {
    expect(detectLocale(undefined, "kk-KZ,kk;q=0.9,ru;q=0.8,en;q=0.7")).toBe("kk");
    expect(detectLocale(undefined, "en-US,ru;q=0.5,kk;q=0.9")).toBe("kk");
    expect(detectLocale(undefined, "ru-KZ,kk;q=0.5")).toBe("ru");
    expect(detectLocale(undefined, "en-US,en;q=0.9")).toBe("ru");
    expect(detectLocale(undefined, null)).toBe("ru");
    expect(detectLocale("de", "de-DE")).toBe("ru");
  });

  it("SMS с кодом — на языке человека, код внутри", () => {
    expect(loginCodeText("123456", "kk")).toContain("кіру коды 123456");
    expect(loginCodeText("123456", "ru")).toContain("код входа 123456");
  });
});
