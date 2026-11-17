// Shared by the server layout and the theme hooks; must not be a client module.
export const THEME_KEY = "tutor.theme";

/**
 * Runs before the first paint (inlined in <head>) so a picked theme never
 * flashes the other one. Keep it tiny and dependency-free.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

