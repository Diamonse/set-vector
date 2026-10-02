"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, type ActionState } from "@/lib/validation/schemas";

const credentials = z.object({
  email: z.email("Enter a valid email address.").max(320),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

/**
 * Supabase reports an unreachable auth server as a bare "fetch failed" (status 0) and server
 * failures as "HTTP 502" and the like. Say what happened and what to do instead; other auth
 * errors, such as wrong credentials, are already written for people.
 */
function authErrorMessage(error: { message: string; status?: number }): string {
  if (!error.status) return "Could not reach the sign-in service. Check your connection and try again.";
  if (error.status >= 500) return "The sign-in service is not responding right now. Try again in a moment.";
  return error.message;
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/home";
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: authErrorMessage(error) };
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials
    .extend({ display_name: z.string().trim().max(80) })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      display_name: formData.get("display_name") ?? "",
    });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/confirm`,
      data: { display_name: parsed.data.display_name },
    },
  });
  if (error) return { ok: false, message: authErrorMessage(error) };
  if (data.session) redirect("/home");
  return { ok: true, message: "Check your email for a confirmation link, then sign in." };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
