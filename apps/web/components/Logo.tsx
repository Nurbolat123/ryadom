import { useTranslations } from "next-intl";
import styles from "./ui.module.css";

/** Знак 30 px + слово «рядом» (Unbounded 800, −0.8px). onDark — светлый коралл для тёмного фона. */
export function Logo({ onDark = false, size = 30 }: { onDark?: boolean; size?: number }) {
  const t = useTranslations("brand");
  return (
    <span className={styles.logo}>
      <img
        src={onDark ? "/brand/logo-mark-light.svg" : "/brand/logo-mark.svg"}
        width={size}
        height={size}
        alt=""
      />
      <span className={styles.logoWord}>{t("name")}</span>
    </span>
  );
}
