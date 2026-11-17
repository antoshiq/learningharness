"use client";

import { useEffect, useState } from "react";

/** Code editor preferences, shared by lessons and the sandbox; stored per browser. */
export interface EditorPrefs {
  fontSize: number;
  wrap: boolean;
}

const KEY = "tutor.editor";
const EVENT = "tutor:editor";
const DEFAULTS: EditorPrefs = { fontSize: 13, wrap: false };
export const FONT_MIN = 11;
export const FONT_MAX = 22;

function read(): EditorPrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<EditorPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function useEditorPrefs(): [EditorPrefs, (patch: Partial<EditorPrefs>) => void] {
  const [prefs, setPrefs] = useState<EditorPrefs>(DEFAULTS);
  useEffect(() => {
    const update = () => setPrefs(read());
    update();
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  const set = (patch: Partial<EditorPrefs>) => {
    const next = { ...read(), ...patch };
    next.fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, next.fontSize));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  };
  return [prefs, set];
}
