"use client";

import { Disc3, Library, ListMusic, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
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

  const links = NAV.map((item) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen(false)}
        className={cn(
          "relative inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 text-ui no-underline transition-colors",
          active ? "bg-surface-subtle text-ink hover:text-ink" : "text-muted hover:bg-surface-subtle/60 hover:text-ink",
        )}
      >
        <item.Icon className={cn("size-4", active ? "text-action" : "")} aria-hidden />
        {item.label}
      </Link>
    );
  });

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-divider bg-[var(--header-bg)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-8">
          <Link href="/library" className="no-underline" aria-label="SetVector library">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {links}
          </nav>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <span className="max-w-[24ch] truncate text-caption text-muted" title={email}>
            {email}
          </span>
          <form action={signOut}>
            <Button variant="secondary" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
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
          <nav aria-label="Main" className="flex flex-col py-2">
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
