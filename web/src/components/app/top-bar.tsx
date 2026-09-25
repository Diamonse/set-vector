"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/library", label: "Library" },
  { href: "/crates", label: "Crates" },
  { href: "/plans", label: "Plans" },
];

export function TopBar({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = NAV.map((item) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen(false)}
        className={cn(
          "inline-flex min-h-11 items-center rounded-[8px] px-3 text-ui no-underline",
          active ? "bg-surface-subtle text-ink" : "text-muted hover:text-ink",
        )}
      >
        {item.label}
      </Link>
    );
  });

  return (
    <header className="border-b border-divider bg-surface">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-2 md:px-6">
        <div className="flex items-center gap-6">
          <Link href="/library" className="text-[18px] font-semibold text-ink no-underline">
            SetVector
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {links}
          </nav>
        </div>
        <div className="hidden items-center gap-3 md:flex">
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
