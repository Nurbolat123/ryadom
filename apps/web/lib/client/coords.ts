/**
 * Координаты заведения из строки «43.2399, 76.9464» (так их копируют из OpenStreetMap,
 * 2ГИС и Google Карт). Только для админки: это точки заведений, а не людей.
 */
export const parseCoords = (s: string): { lat: number; lng: number } | null => {
  const m = s.trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]!.replace(",", "."));
  const lng = Number(m[2]!.replace(",", "."));
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
};

export const formatCoords = (lat: number, lng: number) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

/** Ссылка на точку в OpenStreetMap — проверить, где стоит заведение. */
export const osmLink = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=19/${lat}/${lng}`;

/** Поиск места по названию и адресу в OpenStreetMap. */
export const osmSearch = (q: string) =>
  `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
