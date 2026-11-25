// Shared by the server layout and the theme hooks; must not be a client module.
export const THEME_KEY = "tutor.theme";
/** The look (VS Code style): "minimal" (default) or "classic" — the busier code-editor look. */
export const UI_KEY = "tutor.ui";
/** Overall visual & layout design system. Defaults to "vscode" (original interface). */
export const STYLE_KEY = "tutor.style";

/**
 * Runs before the first paint (inlined in <head>) so a picked theme, look or
 * style never flashes the default one. Keep it tiny and dependency-free.
 */
export const THEME_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}"),s=localStorage.getItem("${STYLE_KEY}");if(t==="light"||t==="dark")d.setAttribute("data-theme",t);d.setAttribute("data-ui",localStorage.getItem("${UI_KEY}")==="classic"?"classic":"minimal");d.setAttribute("data-style",s==="obsidian"||s==="paper"||s==="catppuccin"||s==="gruvbox"||s==="linear"?s:"vscode")}catch(e){document.documentElement.setAttribute("data-ui","minimal");document.documentElement.setAttribute("data-style","vscode")}`;
