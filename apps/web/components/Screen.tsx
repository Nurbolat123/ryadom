import type { ReactNode } from "react";
import { AppNav } from "./AppNav";
import { Logo } from "./Logo";
import styles from "./ui.module.css";

export function Screen({
  children,
  right,
  nav = false,
}: {
  children: ReactNode;
  right?: ReactNode;
  /** Нижняя навигация — на основных экранах после входа. */
  nav?: boolean;
}) {
  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Logo />
        {right}
      </header>
      {children}
      {nav ? <AppNav /> : null}
    </main>
  );
}

export function Progress({
  current,
  total,
  label,
}: {
  current: number;
  total: number;
  label: string;
}) {
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-valuenow={current}
      aria-valuemax={total}
      aria-label={label}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} data-done={i < current} />
      ))}
    </div>
  );
}
