"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRealtime } from "@/lib/client/realtime";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import { SafetySheet } from "./SafetySheet";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Chat = {
  id: string;
  other: { id: string; name: string; photoUrl: string };
  fromMatch: boolean;
  messages: { id: string; body: string; mine: boolean; createdAt: string }[];
  contacts: { iConfirmed: boolean; phone: string | null };
};

/** Чат: сообщения в реальном времени и «Обменяться контактами» (только по взаимному согласию). */
export function ChatScreen({ id }: { id: string }) {
  const t = useTranslations("chat");
  const tSafety = useTranslations("safety");
  const router = useRouter();
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await api<{ chat: Chat }>(`/api/chats/${id}`);
    if (res.ok) setChat(res.data.chat);
    else setMissing(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [chat?.messages.length]);
  useRealtime({ onChat: (chatId) => (chatId === id || chatId === "*") && void load() });
  // Открытый чат отмечает сообщения прочитанными — обновить значок.
  useEffect(() => {
    window.dispatchEvent(new Event("ryadom:badges"));
  }, [chat?.messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const res = await api<{ message: Chat["messages"][number] }>(`/api/chats/${id}/messages`, {
      json: { body: text.trim() },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setText("");
    setChat((c) => (c ? { ...c, messages: [...c.messages, res.data.message] } : c));
  };

  const exchange = async () => {
    const res = await api<{ chat: Chat }>(`/api/chats/${id}/contacts`, { method: "POST" });
    if (res.ok) setChat(res.data.chat);
  };

  if (missing) {
    return (
      <div className={ui.body}>
        <ErrorText code="not_found" />
        <Link href="/inbox" className={ui.link}>
          {t("back")}
        </Link>
      </div>
    );
  }
  if (!chat) return null;

  return (
    <div className={ui.body}>
      <header className={social.chatHeader}>
        <Link href="/inbox" className={social.back} aria-label={t("back")}>
          ←
        </Link>
        <img className={styles.avatar} src={chat.other.photoUrl} alt="" width={48} height={48} />
        <h1 className={social.itemName}>{chat.other.name}</h1>
      </header>
      <button type="button" className={social.safetyLink} onClick={() => setSafetyOpen(true)}>
        {tSafety("open")}
      </button>
      {safetyOpen ? (
        <SafetySheet
          target={{ id: chat.other.id, name: chat.other.name }}
          onClose={() => setSafetyOpen(false)}
          onDone={(blocked) => (blocked ? router.replace("/inbox") : setSafetyOpen(false))}
        />
      ) : null}

      {chat.fromMatch ? <p className={styles.count}>{t("matchHint")}</p> : null}

      <section className={social.contactCard}>
        {chat.contacts.phone ? (
          <>
            <p className={social.message}>
              {t("phone", { name: chat.other.name, phone: chat.contacts.phone })}
            </p>
            <a
              className={`${ui.button} ${ui.primary} ${social.linkButton}`}
              href={`tel:${chat.contacts.phone}`}
            >
              {t("call")}
            </a>
          </>
        ) : chat.contacts.iConfirmed ? (
          <p className={ui.note}>{t("waiting")}</p>
        ) : (
          <>
            <button className={`${ui.button} ${ui.secondary}`} onClick={exchange}>
              {t("exchange")}
            </button>
            <p className={ui.note}>{t("exchangeHint")}</p>
          </>
        )}
      </section>

      <div className={social.messages} aria-live="polite">
        {chat.messages.map((m) => (
          <p key={m.id} className={`${social.bubble} ${m.mine ? social.bubbleMine : ""}`}>
            {m.body}
          </p>
        ))}
        <div ref={bottom} />
      </div>

      <ErrorText code={error} />
      <form className={social.composer} onSubmit={send}>
        <input
          className={ui.input}
          value={text}
          maxLength={2000}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          onChange={(e) => setText(e.target.value)}
        />
        <button className={social.sendButton} disabled={busy || !text.trim()}>
          {t("send")}
        </button>
      </form>
    </div>
  );
}
