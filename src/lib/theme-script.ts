// Shared by the server layout and the theme hooks; must not be a client module.
export const THEME_KEY = "tutor.theme";
/** The look: "minimal" (default) or "classic" — the busier code-editor look. */
export const UI_KEY = "tutor.ui";

/**
 * Runs before the first paint (inlined in <head>) so a picked theme or look
 * never flashes the other one. Keep it tiny and dependency-free.
 */
export const THEME_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")d.setAttribute("data-theme",t);d.setAttribute("data-ui",localStorage.getItem("${UI_KEY}")==="classic"?"classic":"minimal")}catch(e){document.documentElement.setAttribute("data-ui","minimal")}`;
