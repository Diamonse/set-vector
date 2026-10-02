/** First-load intro: the CDJ splash shown on the landing page once per browser tab session. */

export const INTRO_SEEN_KEY = "setvector-intro-seen";
export const INTRO_MS = 3000;
/** Reduced motion gets a short still frame instead of the full intro. */
export const INTRO_REDUCED_MS = 1200;
export const INTRO_FADE_MS = 400;

/**
 * Runs before first paint (inlined in <head>) and owns the intro's timing, so it does not
 * wait for the app to hydrate. Only the landing page plays it: sign-in, shared links, and app
 * pages open straight away. On the first landing load in a tab it sets html[data-intro="on"]
 * (CSS shows the splash), ends it after 3 seconds or on any click or key, fades it with
 * data-intro="leaving", then removes the attribute. Blocked storage skips the intro rather
 * than showing it on every load. `window.__setvectorIntroEnd` lets the Skip button end it.
 */
export const INTRO_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(INTRO_SEEN_KEY)},d=document.documentElement,w=window;if(w.location.pathname!=="/"||w.sessionStorage.getItem(k))return;w.sessionStorage.setItem(k,"1");d.setAttribute("data-intro","on");var r=!!(w.matchMedia&&w.matchMedia("(prefers-reduced-motion: reduce)").matches),e=false;function end(){if(e)return;e=true;w.removeEventListener("pointerdown",end,true);w.removeEventListener("keydown",end,true);d.setAttribute("data-intro","leaving");w.setTimeout(function(){if(d.getAttribute("data-intro")==="leaving")d.removeAttribute("data-intro");},r?0:${INTRO_FADE_MS});}w.__setvectorIntroEnd=end;w.addEventListener("pointerdown",end,true);w.addEventListener("keydown",end,true);w.setTimeout(end,r?${INTRO_REDUCED_MS}:${INTRO_MS});}catch(x){}})();`;
