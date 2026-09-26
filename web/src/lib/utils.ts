import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system's type roles are custom `text-*` utilities (see globals.css). Registering
// them as font sizes stops tailwind-merge from treating them as colours and dropping them
// when a colour class such as `text-ink` is also present.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "section", "card-title", "lead", "ui", "caption", "data"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
