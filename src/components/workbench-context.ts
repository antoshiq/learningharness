"use client";

import { createContext, useContext } from "react";
import type { TopicCard } from "@/server/sessions";

/** Shared state of the window chrome: what the side bar, palette and status bar show. */
export interface WorkbenchState {
  topics: TopicCard[] | null;
  /** Model that runs lessons, e.g. "claude-opus-5-5"; null until settings load. */
  model: string | null;
  mock: boolean;
  openPalette: () => void;
}

export const WorkbenchContext = createContext<WorkbenchState>({ topics: null, model: null, mock: false, openPalette: () => {} });
export const useWorkbench = () => useContext(WorkbenchContext);

/** Pages call this after they change data, so the side bar and status bar refresh. */
export const CHANGED_EVENT = "tutor:changed";
export const NEW_TOPIC_EVENT = "tutor:new-topic";
export const notifyChanged = () => window.dispatchEvent(new Event(CHANGED_EVENT));
