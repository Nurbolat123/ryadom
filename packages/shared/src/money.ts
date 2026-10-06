/**
 * Все суммы в системе — целые числа в минимальных единицах валюты
 * (тиыны для KZT: 490 ₸ = 49000). Так нет ошибок округления.
 */
export type MinorUnits = number;

export const toMinor = (major: number): MinorUnits => Math.round(major * 100);
export const fromMinor = (minor: MinorUnits): number => minor / 100;

/** Комиссия платформы с суммы, в минимальных единицах (округление вниз в пользу заведения). */
export const commissionOf = (amount: MinorUnits, pct: number): MinorUnits =>
  Math.floor((amount * pct) / 100);
