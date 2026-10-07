"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "@/lib/client/realtime";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import { GiftsInbox, type ReceivedGift, type SentGift } from "./GiftsInbox";
import { SafetySheet } from "./SafetySheet";
import social from "./social.module.css";
import ui from "./ui.module.css";
import styles from "./checkin.module.css";

type Hello = {
  id: string;
  isSuper: boolean;
  message: string;
  from: { id: string; name: string; age: number; photoUrl: string };
};
type Notice = {
  id: string;
  kind: "sympathy_anonymous" | "plus_renewal_reminder" | "plus_renewed" | "plus_renewal_failed";
  venueName: string | null;
  canLook: boolean;
};

const PLUS_NOTICE = {
  plus_renewal_reminder: "plusReminder",
  plus_renewed: "plusRenewed",
  plus_renewal_failed: "plusRenewFailed",
} as const;
type ChatSummary = {
  id: string;
  other: { id: string; name: string; photoUrl: string };
  lastMessage: { body: string; mine: boolean } | null;
  unread: number;
};

/** Входящие: суперприветы сверху, приветы, анонимные уведомления, затем чаты. */
export function InboxView() {
  const t = useTranslations("inbox");
  const tSafety = useTranslations("safety");
  const tp = useTranslations("plus");
  const router = useRouter();
  const [hellos, setHellos] = useState<Hello[] | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [gifts, setGifts] = useState<{ received: ReceivedGift[]; sent: SentGift[] }>({
    received: [],
    sent: [],
  });
  const [replying, setReplying] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [safety, setSafety] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const [box, list, giftList] = await Promise.all([
      api<{ hellos: Hello[]; notices: Notice[] }>("/api/inbox"),
      api<{ chats: ChatSummary[] }>("/api/chats"),
      api<{ received: ReceivedGift[]; sent: SentGift[] }>("/api/gifts"),
    ]);
    if (giftList.ok) setGifts(giftList.data);
    if (box.ok) {
      setHellos(box.data.hellos);
      setNotices(box.data.notices);
    }
    if (list.ok) setChats(list.data.chats);
    // Уведомления прочитаны — обновить значок в навигации.
    void api("/api/inbox/read", { method: "POST" }).then(() =>
      window.dispatchEvent(new Event("ryadom:badges")),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime({ onInbox: load, onChat: load, onMatch: load });

  const reply = async (id: string) => {
    setError(null);
    const res = await api<{ chatId: string }>(`/api/hellos/${id}/reply`, {
      json: { message: text.trim() },
    });
    if (!res.ok) return setError(res.error);
    router.push(`/chats/${res.data.chatId}`);
  };

  const notNow = async (id: string) => {
    await api(`/api/hellos/${id}/dismiss`, { method: "POST" });
    setHellos((h) => h?.filter((x) => x.id !== id) ?? null);
  };

  return (
    <div className={ui.body}>
      <div className={social.titleRow}>
        <h1 className={ui.title}>{t("title")}</h1>
        <Link href="/plus" className={social.plusBadge}>
          {tp("title")}
        </Link>
      </div>

      {notices.map((n) =>
        n.kind !== "sympathy_anonymous" ? (
          <section key={n.id} className={social.notice}>
            <span>{t(PLUS_NOTICE[n.kind])}</span>
            <Link href="/plus" className={ui.link}>
              {t("managePlus")}
            </Link>
          </section>
        ) : (
          <section key={n.id} className={social.notice}>
            <span>{t("notice", { venue: n.venueName ?? "" })}</span>
            {n.canLook ? (
              <Link href="/home" className={`${ui.button} ${ui.primary} ${social.linkButton}`}>
                {t("noticeLook")}
              </Link>
            ) : (
              <span className={ui.note}>{t("noticeGone")}</span>
            )}
          </section>
        ),
      )}

      <GiftsInbox received={gifts.received} sent={gifts.sent} onChanged={() => void load()} />

      {hellos === null ? null : hellos.length === 0 &&
        notices.length === 0 &&
        gifts.received.length === 0 ? (
        <p className={ui.hint}>{t("empty")}</p>
      ) : (
        <ul className={`${styles.people} ${social.section}`}>
          {hellos.map((h) => (
            <li key={h.id} className={`${social.item} ${h.isSuper ? social.itemSuper : ""}`}>
              <div className={social.itemHead}>
                <img
                  className={styles.avatar}
                  src={h.from.photoUrl}
                  alt=""
                  width={64}
                  height={64}
                />
                <span className={social.itemText}>
                  <span className={social.itemName}>
                    {h.from.name}, {h.from.age}
                  </span>
                  {h.isSuper ? <span className={social.superLabel}>{t("superLabel")}</span> : null}
                </span>
              </div>
              <p className={social.message}>{h.message}</p>
              {replying === h.id ? (
                <>
                  <input
                    className={ui.input}
                    value={text}
                    maxLength={2000}
                    placeholder={t("replyPlaceholder")}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                  />
                  <ErrorText code={error} />
                  <button
                    className={`${ui.button} ${ui.primary}`}
                    disabled={!text.trim()}
                    onClick={() => reply(h.id)}
                  >
                    {t("send")}
                  </button>
                </>
              ) : (
                <div className={social.row}>
                  <button className={`${ui.button} ${ui.secondary}`} onClick={() => notNow(h.id)}>
                    {t("notNow")}
                  </button>
                  <button
                    className={`${ui.button} ${ui.primary}`}
                    onClick={() => {
                      setReplying(h.id);
                      setText("");
                    }}
                  >
                    {t("reply")}
                  </button>
                </div>
              )}
              <button
                type="button"
                className={social.safetyLink}
                onClick={() => setSafety({ id: h.from.id, name: h.from.name })}
              >
                {tSafety("open")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className={social.sectionTitle}>{t("chats")}</h2>
      {chats.length === 0 ? (
        <p className={ui.hint}>{t("noChats")}</p>
      ) : (
        <ul className={`${styles.people} ${social.section}`}>
          {chats.map((c) => (
            <li key={c.id}>
              <Link href={`/chats/${c.id}`} className={`${social.item} ${social.chatLink}`}>
                <img
                  className={styles.avatar}
                  src={c.other.photoUrl}
                  alt=""
                  width={64}
                  height={64}
                />
                <span className={social.itemText}>
                  <span className={social.itemName}>{c.other.name}</span>
                  {c.lastMessage ? (
                    <span className={social.itemPreview}>
                      {c.lastMessage.mine ? t("you") : ""}
                      {c.lastMessage.body}
                    </span>
                  ) : null}
                </span>
                {c.unread ? <span className={social.unread}>{c.unread}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {safety ? (
        <SafetySheet
          target={safety}
          onClose={() => setSafety(null)}
          onDone={() => {
            setSafety(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
