"use client";

import { Disc3, House, Library, ListMusic, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { signOut } from "@/app/actions/auth";
import { useThemeChoice } from "@/components/app/theme-toggle";
import { MagneticDock, type DockItemData } from "@/components/ui/magnetic-dock";
import { applyThemeChoice, type ThemeChoice } from "@/lib/theme";

const NAV = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/library", label: "Library", Icon: Library },
  { href: "/crates", label: "Crates", Icon: Disc3 },
  { href: "/plans", label: "Plans", Icon: ListMusic },
];

const THEMES: Record<ThemeChoice, { label: string; next: ThemeChoice; Icon: typeof Sun }> = {
  system: { label: "System", next: "light", Icon: Monitor },
  light: { label: "Light", next: "dark", Icon: Sun },
  dark: { label: "Dark", next: "system", Icon: Moon },
};

/**
 * The signed-in navigation on wider screens: a magnetic dock at the bottom of the window with
 * the main sections, a theme switch, and sign out. Phones use the top bar's menu instead.
 */
export function AppDock() {
  const pathname = usePathname();
  const theme = useThemeChoice();
  const [signingOut, startSignOut] = useTransition();
  const current = THEMES[theme];

  const items: DockItemData[] = [
    ...NAV.map(({ href, label, Icon }) => ({
      id: href,
      label,
      href,
      icon: <Icon />,
      isActive: pathname === href || pathname.startsWith(`${href}/`),
    })),
    {
      id: "theme",
      label: `${current.label} theme, switch to ${THEMES[current.next].label.toLowerCase()}`,
      legend: current.label,
      icon: <current.Icon />,
      onClick: () => applyThemeChoice(current.next),
      separated: true,
    },
    {
      id: "sign-out",
      label: signingOut ? "Signing out" : "Sign out",
      icon: <LogOut />,
      onClick: () => startSignOut(() => signOut()),
    },
  ];

  return (
    <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 hidden justify-center md:flex">
      <MagneticDock items={items} className="pointer-events-auto" />
    </nav>
  );
}
