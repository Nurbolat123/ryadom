"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "@/lib/client/realtime";
import { api } from "./api";
import { MatchOverlay } from "./MatchOverlay";
import social from "./social.module.css";

const ICONS = {
  places: <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zM9 3v15M15 6v15" />,
  here: (
    <path d="M12 21s-7-6.3-7-11.5A7 7 0 0 1 19 9.5C19 14.7 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
  ),
  inbox: <path d="M4 5h16v11H8l-4 4V5z" />,
  profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />,
};

/** Нижняя навигация: Места · Здесь · Приветы · Профиль. Здесь же — экран взаимной симпатии. */
export function AppNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [match, setMatch] = useState<string | null>(null);
  const shown = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const res = await api<{ inbox: number; chats: number }>("/api/badges");
    if (res.ok) setCount(res.data.inbox + res.data.chats);
  }, []);

  const onMatch = useCallback(
    (chatId: string) => {
      void refresh();
      if (shown.current.has(chatId)) return;
      shown.current.add(chatId);
      setMatch(chatId);
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    const local = (e: Event) => onMatch((e as CustomEvent<string>).detail);
    window.addEventListener("ryadom:match", local);
    window.addEventListener("focus", refresh);
    window.addEventListener("ryadom:badges", refresh);
    return () => {
      window.removeEventListener("ryadom:badges", refresh);
      window.removeEventListener("ryadom:match", local);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, onMatch]);

  useRealtime({ onMatch, onInbox: refresh, onChat: refresh });

  const items = [
    { key: "places", href: "/places" },
    { key: "here", href: "/home" },
    { key: "inbox", href: "/inbox" },
    { key: "profile", href: "/profile" },
  ] as const;

  return (
    <>
      <nav className={social.nav} aria-label={t("label")}>
        {items.map((i) => (
          <Link
            key={i.key}
            href={i.href}
            className={social.navItem}
            aria-current={
              pathname.startsWith(i.href) || (i.key === "inbox" && pathname.startsWith("/chats"))
                ? "page"
                : undefined
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {ICONS[i.key]}
            </svg>
            {t(i.key)}
            {i.key === "inbox" && count > 0 ? (
              <span className={social.badge}>{count > 99 ? "99+" : count}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      {match ? <MatchOverlay chatId={match} onClose={() => setMatch(null)} /> : null}
    </>
  );
}
