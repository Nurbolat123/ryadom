import type { LngLat } from "@ryadom/db";

/** Точка внутри кольца (ray casting). Для зданий размером в десятки метров плоского приближения хватает. */
export const pointInRing = ([x, y]: LngLat, ring: readonly LngLat[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const M_PER_DEG_LAT = 111_320;

/** Приблизительная площадь кольца в м² (для выбора наименьшего здания). */
export const ringAreaM2 = (ring: readonly LngLat[]): number => {
  if (ring.length < 3) return 0;
  const lat0 = (ring.reduce((s, [, lat]) => s + lat, 0) / ring.length) * (Math.PI / 180);
  const kx = M_PER_DEG_LAT * Math.cos(lat0);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    sum += xj * kx * (yi * M_PER_DEG_LAT) - xi * kx * (yj * M_PER_DEG_LAT);
  }
  return Math.abs(sum / 2);
};

/** Приблизительное расстояние между точками в метрах. */
export const distanceM = ([x1, y1]: LngLat, [x2, y2]: LngLat): number => {
  const kx = M_PER_DEG_LAT * Math.cos(((y1 + y2) / 2) * (Math.PI / 180));
  return Math.hypot((x2 - x1) * kx, (y2 - y1) * M_PER_DEG_LAT);
};

export const isClosedRing = (ring: readonly LngLat[]): boolean => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return ring.length >= 4 && !!first && !!last && first[0] === last[0] && first[1] === last[1];
};
