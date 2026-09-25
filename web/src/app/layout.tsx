import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SetVector", template: "%s · SetVector" },
  description: "Plan DJ sets and listening playlists from reviewed track evidence.",
};

export const viewport: Viewport = {
  themeColor: "#F7F6F2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only z-50 rounded-[8px] bg-action px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
