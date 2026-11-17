"use client";

import { useEffect, useState } from "react";
import { THEME_KEY as KEY } from "./theme-script";

/** Light or dark: as in the system, or picked by the learner. Stored per browser. */
export type ThemePref = "system" | "light" | "dark";

const EVENT = "tutor:theme";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {}
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  window.dispatchEvent(new Event(EVENT));
}

function resolveDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The learner's preference, kept in sync across components. */
export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    const update = () => setPref(getThemePref());
    update();
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return [pref, setThemePref];
}

/** Whether the page is dark right now, whichever way that was decided. */
export function useDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(resolveDark());
    update();
    mq.addEventListener("change", update);
    window.addEventListener(EVENT, update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return dark;
}

export const THEME_LABEL: Record<ThemePref, string> = { system: "Как в системе", light: "Светлая", dark: "Тёмная" };
