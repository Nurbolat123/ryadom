import { toMinor, type VenueCategory } from "@ryadom/shared";
import type { LngLat } from "../src/geo";

/**
 * Тестовые партнёрские заведения Алматы.
 * Названия вымышленные, координаты — реальные точки в центре города,
 * чтобы проверять чек-ин (этап 4) с подменой геолокации в браузере.
 */
export type SeedMenuItem = {
  name: string;
  nameKk?: string;
  price: number;
  isAlcohol?: boolean;
  giftable?: boolean;
};

export type SeedVenue = {
  slug: string;
  name: string;
  category: VenueCategory;
  address: string;
  location: LngLat;
  /** Контур здания. Если не задан — круг 35 м вокруг точки. */
  polygon?: LngLat[];
  maxGiftAmount?: number;
  /** По умолчанию — партнёр. Не-партнёр без меню: чек-ин и люди работают, подарков нет. */
  isPartner?: boolean;
  menu: SeedMenuItem[];
};

const coffeeMenu: SeedMenuItem[] = [
  { name: "Американо", nameKk: "Американо", price: toMinor(900), giftable: true },
  { name: "Капучино", nameKk: "Капучино", price: toMinor(1200), giftable: true },
  { name: "Латте", nameKk: "Латте", price: toMinor(1300), giftable: true },
  { name: "Раф ванильный", nameKk: "Ванильді раф", price: toMinor(1500), giftable: true },
  { name: "Чай травяной", nameKk: "Шөп шайы", price: toMinor(800), giftable: true },
];

export const venues: SeedVenue[] = [
  {
    slug: "teplyi-ugol",
    name: "Тёплый угол",
    category: "coffee",
    address: "Алматы, пр. Абая, угол ул. Фурманова",
    location: [76.9467, 43.2399],
    menu: [
      ...coffeeMenu,
      { name: "Круассан", nameKk: "Круассан", price: toMinor(900), giftable: true },
      {
        name: "Чизкейк Сан-Себастьян",
        nameKk: "Сан-Себастьян чизкейгі",
        price: toMinor(1800),
        giftable: true,
      },
      { name: "Макарон, 3 шт.", nameKk: "Макарон, 3 дана", price: toMinor(1500), giftable: true },
    ],
  },
  {
    slug: "sad-na-panfilova",
    name: "Сад на Панфилова",
    category: "cafe",
    address: "Алматы, ул. Панфилова (пешеходная), у ул. Кабанбай батыра",
    location: [76.9443, 43.2565],
    maxGiftAmount: toMinor(4000),
    menu: [
      ...coffeeMenu,
      {
        name: "Лимонад облепиховый",
        nameKk: "Шырғанақ лимонады",
        price: toMinor(1400),
        giftable: true,
      },
      { name: "Медовик", nameKk: "Бал торты", price: toMinor(1600), giftable: true },
      {
        name: "Баурсаки с джемом",
        nameKk: "Джеммен бауырсақ",
        price: toMinor(1200),
        giftable: true,
      },
      // Алкоголь есть в меню, но подарить его нельзя (правило 8).
      {
        name: "Бокал белого вина",
        nameKk: "Бір бокал ақ шарап",
        price: toMinor(2800),
        isAlcohol: true,
      },
      {
        name: "Пиво разливное 0,5",
        nameKk: "Құйма сыра 0,5",
        price: toMinor(1800),
        isAlcohol: true,
      },
    ],
  },
  {
    slug: "kofe-kitap",
    name: "Kofe Kitap",
    category: "coworking",
    address: "Алматы, пр. Достык, у ул. Сатпаева",
    location: [76.9578, 43.2339],
    // Пример геозоны по контуру здания (примерно 60 × 40 м).
    polygon: [
      [76.95745, 43.2341],
      [76.95815, 43.2341],
      [76.95815, 43.23372],
      [76.95745, 43.23372],
    ],
    menu: [
      ...coffeeMenu,
      { name: "Флэт уайт", nameKk: "Флэт уайт", price: toMinor(1400), giftable: true },
      { name: "Брауни", nameKk: "Брауни", price: toMinor(1100), giftable: true },
      {
        name: "Сэндвич с курицей",
        nameKk: "Тауық етімен сэндвич",
        price: toMinor(2200),
        giftable: false,
      },
    ],
  },
  {
    // Сосед «Тёплого угла» в 25 м: геозоны пересекаются — проверка выбора из нескольких мест.
    slug: "bar-polka",
    name: "Бар «Полка»",
    category: "bar",
    address: "Алматы, пр. Абая, угол ул. Фурманова",
    location: [76.947008, 43.2399],
    isPartner: false,
    menu: [],
  },
];
