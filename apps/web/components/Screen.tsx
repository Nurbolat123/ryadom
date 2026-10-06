import type { ReactNode } from "react";
import { Logo } from "./Logo";
import styles from "./ui.module.css";

export function Screen({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Logo />
        {right}
      </header>
      {children}
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
