import type { Metadata, Viewport } from "next";
import { Azeret_Mono, Big_Shoulders, Hanken_Grotesk } from "next/font/google";
import localFont from "next/font/local";
import { INTRO_INIT_SCRIPT } from "@/lib/intro";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Fonts are downloaded at build time and served from this origin; no request goes to Google at runtime.
// Big Shoulders is industrial signage lettering (its optical-size axis picks the display cut at
// large sizes), Hanken Grotesk carries the interface, and Azeret Mono the data. DSEG7 is a
// seven-segment face (SIL OFL, see fonts/DSEG-LICENSE.txt) used only for deck readouts: tempo, time, and counts.
const display = Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], variable: "--font-headline", display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = Azeret_Mono({ subsets: ["latin"], variable: "--font-data", display: "swap" });
const segment = localFont({ src: "./fonts/DSEG7Classic-Bold.woff2", weight: "700", variable: "--font-segment-face", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SetVector", template: "%s · SetVector" },
  description: "Plan DJ sets and listening playlists from reviewed track evidence.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F4EF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0D12" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The head scripts set attributes before hydration, so React must not warn about them.
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable} ${segment.variable}`}>
      <head>
        {/* data-js tells CSS that scripts run, so scroll-triggered reveals may wait for them. */}
        <script dangerouslySetInnerHTML={{ __html: 'document.documentElement.setAttribute("data-js","")' }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INTRO_INIT_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only z-50 rounded-control bg-action px-4 py-2 text-on-action focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
