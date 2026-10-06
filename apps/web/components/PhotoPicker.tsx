"use client";

import { useEffect, useRef, useState } from "react";
import ui from "./ui.module.css";

/** Выбор фото с предпросмотром. capture="user" открывает фронтальную камеру на телефоне. */
export function PhotoPicker({
  file,
  onChange,
  chooseLabel,
  changeLabel,
  initialUrl,
  selfie = false,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  chooseLabel: string;
  changeLabel: string;
  initialUrl?: string | null;
  selfie?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(initialUrl ?? null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <>
      <div className={`${ui.photo} ${selfie ? ui.photoRound : ""}`}>
        {preview ? <img src={preview} alt="" /> : null}
      </div>
      <input
        ref={input}
        className={ui.visuallyHidden}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture={selfie ? "user" : undefined}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        tabIndex={-1}
        aria-hidden
      />
      <button
        type="button"
        className={`${ui.button} ${ui.secondary}`}
        onClick={() => input.current?.click()}
      >
        {preview ? changeLabel : chooseLabel}
      </button>
    </>
  );
}
