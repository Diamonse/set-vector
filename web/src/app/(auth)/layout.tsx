import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-[440px] flex-col justify-center px-4 py-16">
      <Link href="/" className="mb-8 text-[18px] font-semibold text-ink no-underline">
        SetVector
      </Link>
      {children}
    </main>
  );
}
