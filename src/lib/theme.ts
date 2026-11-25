"use client";

import { useEffect, useState } from "react";
import { STYLE_KEY, THEME_KEY as KEY, UI_KEY } from "./theme-script";

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

/** The look of the default VS Code style: calm and roomy, or the busier code-editor look. */
export type UiStyle = "minimal" | "classic";
const UI_EVENT = "tutor:ui";

export function getUiStyle(): UiStyle {
  try {
    return localStorage.getItem(UI_KEY) === "classic" ? "classic" : "minimal";
  } catch {
    return "minimal";
  }
}

export function setUiStyle(style: UiStyle) {
  try {
    localStorage.setItem(UI_KEY, style);
  } catch {}
  document.documentElement.setAttribute("data-ui", style);
  window.dispatchEvent(new Event(UI_EVENT));
}

export function useUiStyle(): [UiStyle, (s: UiStyle) => void] {
  const [style, setStyle] = useState<UiStyle>("minimal");
  useEffect(() => {
    const update = () => setStyle(getUiStyle());
    update();
    window.addEventListener(UI_EVENT, update);
    return () => window.removeEventListener(UI_EVENT, update);
  }, []);
  return [style, setStyle];
}

export const UI_LABEL: Record<UiStyle, string> = { minimal: "Минималистичный", classic: "Подробный" };

// ---------------------------------------------------------------------------
// Design styles (complete visual + layout personalities)
// ---------------------------------------------------------------------------

export type DesignStyle = "vscode" | "obsidian" | "paper" | "catppuccin" | "gruvbox" | "linear";
export const DESIGN_STYLES: DesignStyle[] = ["vscode", "obsidian", "paper", "catppuccin", "gruvbox", "linear"];
const STYLE_EVENT = "tutor:style";

export interface StyleMeta {
  id: DesignStyle;
  name: string;
  tagline: string;
  layout: string;
  swatches: [string, string, string]; // [bg, surface, accent] preview
}

export const STYLE_META: Record<DesignStyle, StyleMeta> = {
  vscode: {
    id: "vscode",
    name: "VS Code",
    tagline: "Исходный интерфейс по умолчанию",
    layout: "Левая панель иконок, проводник, компактные блоки",
    swatches: ["#121314", "#191a1c", "#4daafc"],
  },
  obsidian: {
    id: "obsidian",
    name: "Obsidian",
    tagline: "Графит и фиолетовый неон в тон Obsidian",
    layout: "Ribbon-лента с полосой активности, хранилище и callout-карточки",
    swatches: ["#1e1e1e", "#161616", "#a882ff"],
  },
  paper: {
    id: "paper",
    name: "Книга",
    tagline: "Тёплая бумага и книжная типографика (serif)",
    layout: "Верхняя журнальная шапка без бокового бара, оглавление-шторка",
    swatches: ["#f8f5ee", "#efe9dc", "#a63a28"],
  },
  catppuccin: {
    id: "catppuccin",
    name: "Catppuccin",
    tagline: "Уютная пастель Mocha / Latte для ночной учёбы",
    layout: "Плавающий стеклянный док снизу и мягкие скруглённые карточки",
    swatches: ["#1e1e2e", "#181825", "#cba6f7"],
  },
  gruvbox: {
    id: "gruvbox",
    name: "Gruvbox TUI",
    tagline: "Терминал и Neovim: строгие углы и моношрифт",
    layout: "Верхняя строка вкладок Tmux/Vim и нижний Powerline-статусбар",
    swatches: ["#282828", "#1d2021", "#fe8019"],
  },
  linear: {
    id: "linear",
    name: "Linear",
    tagline: "Воздушный современный SaaS с парящими карточками",
    layout: "Широкий левый сайдбар с подписями, поиском и списком тем",
    swatches: ["#0b0c10", "#13151b", "#7c86ff"],
  },
};

export function getDesignStyle(): DesignStyle {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    return DESIGN_STYLES.includes(v as DesignStyle) ? (v as DesignStyle) : "vscode";
  } catch {
    return "vscode";
  }
}

export function setDesignStyle(style: DesignStyle) {
  try {
    if (style === "vscode") localStorage.removeItem(STYLE_KEY);
    else localStorage.setItem(STYLE_KEY, style);
  } catch {}
  document.documentElement.setAttribute("data-style", style);
  window.dispatchEvent(new Event(STYLE_EVENT));
}

export function useDesignStyle(): [DesignStyle, (s: DesignStyle) => void] {
  const [style, setStyle] = useState<DesignStyle>("vscode");
  useEffect(() => {
    const update = () => setStyle(getDesignStyle());
    update();
    window.addEventListener(STYLE_EVENT, update);
    return () => window.removeEventListener(STYLE_EVENT, update);
  }, []);
  return [style, setDesignStyle];
}
