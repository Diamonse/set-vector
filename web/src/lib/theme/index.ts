export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "setvector-theme";

/**
 * Runs before first paint (inlined in <head>) so a saved choice never flashes the
 * other theme. "system" removes the attribute and lets prefers-color-scheme decide.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export function readThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage can be blocked; the choice still applies to this page.
  }
  window.dispatchEvent(new Event("setvector-theme"));
}
