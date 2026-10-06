"use client";

import { useEffect, useState } from "react";
import { DEV_GEO_ENABLED, DEV_GEO_KEY, readDevGeo, type GeoPosition } from "@/lib/client/geo";
import styles from "./checkin.module.css";

/**
 * Только для разработки: подмена геолокации, чтобы проверить чек-ин на компьютере.
 * Точки — заведения из сида (Алматы). В продакшен-сборке панель не отображается.
 * Текст панели — служебный, для разработчика, поэтому не через i18n.
 */
const PRESETS: { label: string; pos: GeoPosition | null }[] = [
  { label: "Настоящий GPS", pos: null },
  { label: "Тёплый угол", pos: { lat: 43.2399, lng: 76.9464, accuracy: 15 } },
  {
    label: "Тёплый угол + Бар «Полка» (два места)",
    pos: { lat: 43.2399, lng: 76.94685, accuracy: 15 },
  },
  { label: "Сад на Панфилова", pos: { lat: 43.2565, lng: 76.9443, accuracy: 20 } },
  { label: "Kofe Kitap (контур здания)", pos: { lat: 43.2339, lng: 76.9578, accuracy: 10 } },
  { label: "Вне заведений", pos: { lat: 43.245, lng: 76.93, accuracy: 10 } },
  { label: "Плохая точность (120 м)", pos: { lat: 43.2399, lng: 76.9467, accuracy: 120 } },
];

export function DevGeoPanel() {
  const [current, setCurrent] = useState<string>("");
  useEffect(() => setCurrent(JSON.stringify(readDevGeo())), []);
  if (!DEV_GEO_ENABLED) return null;
  const pick = (pos: GeoPosition | null) => {
    if (pos) localStorage.setItem(DEV_GEO_KEY, JSON.stringify(pos));
    else localStorage.removeItem(DEV_GEO_KEY);
    setCurrent(JSON.stringify(pos));
  };
  return (
    <details className={styles.dev}>
      <summary>Тестовая геолокация (только dev)</summary>
      <div className={styles.devList}>
        {PRESETS.map((p) => (
          <label key={p.label}>
            <input
              type="radio"
              name="devgeo"
              checked={current === JSON.stringify(p.pos)}
              onChange={() => pick(p.pos)}
            />
            {p.label}
          </label>
        ))}
      </div>
    </details>
  );
}
