"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Что включено на этом сервере. Читается из окружения при каждом запросе (в корневом layout),
 * а не при сборке: один и тот же образ работает и с оплатой, и без неё.
 */
type Features = { payments: boolean };

const FeaturesContext = createContext<Features>({ payments: true });

export function FeaturesProvider({ value, children }: { value: Features; children: ReactNode }) {
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

/** false — оплата выключена (PAYMENT_PROVIDER=none): «Плюс» и «Угостить» не показываются. */
export const usePaymentsEnabled = () => useContext(FeaturesContext).payments;
