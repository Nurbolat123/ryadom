"use client";

import social from "./social.module.css";

type LngLat = [number, number];

const M_PER_DEG = 111_320;
const SIZE = 240;

/**
 * Схема геозоны в метрах вокруг точки заведения: текущая геозона (заливка)
 * и новый круг из формы (пунктир). Без карт и сторонних сервисов.
 */
export function GeofencePreview({
  ring,
  center,
  proposed,
  label,
  meters,
}: {
  ring: LngLat[];
  center: LngLat;
  proposed: { lng: number; lat: number; radiusM: number } | null;
  label: string;
  /** Подпись масштаба, например «25 м». */
  meters: (n: number) => string;
}) {
  const cos = Math.cos((center[1] * Math.PI) / 180);
  const toXY = ([lng, lat]: LngLat) => [
    (lng - center[0]) * cos * M_PER_DEG,
    -(lat - center[1]) * M_PER_DEG,
  ];
  const pts = ring.map(toXY);
  const p = proposed ? toXY([proposed.lng, proposed.lat]) : null;
  const extent = Math.max(
    20,
    ...pts.map(([x, y]) => Math.max(Math.abs(x!), Math.abs(y!))),
    p ? Math.max(Math.abs(p[0]!), Math.abs(p[1]!)) + proposed!.radiusM : 0,
  );
  const scale = (SIZE / 2 - 12) / extent;
  const s = (v: number) => SIZE / 2 + v * scale;
  // Сетка через 10, 25, 50 или 100 м — чтобы на схеме было видно масштаб.
  const step = [10, 25, 50, 100].find((m) => extent / m <= 4) ?? 100;

  return (
    <svg
      className={social.geoPreview}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={label}
    >
      {Array.from({ length: Math.floor(extent / step) }, (_, i) => (
        <circle
          key={i}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={(i + 1) * step * scale}
          className={social.geoGrid}
        />
      ))}
      <polygon
        className={social.geoFence}
        points={pts.map(([x, y]) => `${s(x!)},${s(y!)}`).join(" ")}
      />
      <circle cx={SIZE / 2} cy={SIZE / 2} r={4} className={social.geoPoint} />
      {p && proposed ? (
        <circle
          cx={s(p[0]!)}
          cy={s(p[1]!)}
          r={proposed.radiusM * scale}
          className={social.geoProposed}
        />
      ) : null}
      <text x={8} y={SIZE - 8} className={social.geoScale}>
        {meters(step)}
      </text>
    </svg>
  );
}
