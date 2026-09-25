import { TopBar } from "@/components/app/top-bar";
import { requireUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  return (
    <>
      <TopBar email={user.email ?? ""} />
      <main id="main" className="mx-auto max-w-[1200px] px-4 pt-10 pb-24 md:px-6">
        {children}
      </main>
    </>
  );
}
