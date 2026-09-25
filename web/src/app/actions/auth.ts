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

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/library";
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: error.message };
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
  if (error) return { ok: false, message: error.message };
  if (data.session) redirect("/library");
  return { ok: true, message: "Check your email for a confirmation link, then sign in." };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
