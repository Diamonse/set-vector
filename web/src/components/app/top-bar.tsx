"use client";

import { Disc3, House, Library, ListMusic, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/library", label: "Library", Icon: Library },
  { href: "/crates", label: "Crates", Icon: Disc3 },
  { href: "/plans", label: "Plans", Icon: ListMusic },
];

export function TopBar({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // The mobile menu closes on Escape (returning focus to its button) or a tap outside the header.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // The phone menu's strip puts the indicator LED at the row's right end.
  const links = NAV.map((item) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen(false)}
        className="key-select flex min-h-11 items-center gap-2 rounded-control px-3.5 text-ui no-underline before:top-1/2 before:right-3 before:left-auto before:-mt-1.5 before:ml-0 before:h-3 before:w-[3px]"
      >
        <item.Icon className="size-4" aria-hidden />
        {item.label}
      </Link>
    );
  });

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-divider bg-[var(--header-bg)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-2.5 md:px-6">
        <Link href="/home" className="no-underline" aria-label="SetVector home">
          <Logo cascade />
        </Link>
        {/* On wider screens the sections, theme, and sign out live in the dock (AppDock). */}
        <span className="hidden max-w-[32ch] truncate text-caption text-muted md:inline" title={email}>
          {email}
        </span>
        <Button
          ref={toggleRef}
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </Button>
      </div>
      {open ? (
        <div id="mobile-menu" className="border-t border-divider px-4 pb-4 md:hidden">
          <nav aria-label="Main" className="key-well my-3 flex flex-col gap-1 rounded-[14px] p-1">
            {links}
          </nav>
          <div className="flex items-center justify-between gap-3 border-t border-divider py-3">
            <span className="text-caption text-muted">Theme</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-divider pt-3">
            <span className="truncate text-caption text-muted">{email}</span>
            <form action={signOut}>
              <Button variant="secondary" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </header>
  );
}
