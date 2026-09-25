import type { Metadata } from "next";
import { signIn } from "@/app/actions/auth";
import { Alert } from "@/components/ui/alert";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">The confirmation link was invalid or has expired. Sign in or request a new link.</Alert> : null}
      <AuthForm mode="login" action={signIn} next={next} />
    </div>
  );
}
