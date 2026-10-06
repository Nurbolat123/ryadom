"use client";

/**
 * Геолокация браузера (высокая точность). В режиме разработки можно подменить точку
 * через панель «Тестовая геолокация» — подмена хранится в localStorage и в продакшене не работает.
 */
export type GeoPosition = { lat: number; lng: number; accuracy: number };
export type GeoError = "denied" | "unavailable" | "timeout" | "unsupported";

export const DEV_GEO_KEY = "ryadom:devGeo";
export const DEV_GEO_ENABLED = process.env.NODE_ENV !== "production";

export const readDevGeo = (): GeoPosition | null => {
  if (!DEV_GEO_ENABLED) return null;
  try {
    const raw = localStorage.getItem(DEV_GEO_KEY);
    return raw ? (JSON.parse(raw) as GeoPosition) : null;
  } catch {
    return null;
  }
};

export const getPosition = (): Promise<GeoPosition> => {
  const dev = readDevGeo();
  if (dev) return Promise.resolve(dev);
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject("unsupported" satisfies GeoError);
    // Опция timeout браузера не считает время, пока висит запрос разрешения, —
    // поэтому общий предел, чтобы кнопка не застряла в «Ищем…».
    const guard = setTimeout(() => reject("timeout" satisfies GeoError), 25_000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(guard);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (e) => {
        clearTimeout(guard);
        reject(
          (e.code === e.PERMISSION_DENIED
            ? "denied"
            : e.code === e.TIMEOUT
              ? "timeout"
              : "unavailable") satisfies GeoError,
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
};
