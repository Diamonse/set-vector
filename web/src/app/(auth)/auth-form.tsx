"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormField } from "@/components/app/form-field";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { initialActionState, type ActionState } from "@/lib/validation/schemas";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "login" | "signup";
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  next?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const signup = mode === "signup";
  return (
    <Card>
      <h1 className="text-card-title">{signup ? "Create your account" : "Sign in"}</h1>
      <form action={formAction} className="mt-6 flex flex-col gap-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {signup ? (
          <FormField id="display_name" label="Display name" helper="Optional.">
            <Input name="display_name" autoComplete="nickname" maxLength={80} />
          </FormField>
        ) : null}
        <FormField id="email" label="Email" error={state.fieldErrors?.email}>
          <Input name="email" type="email" autoComplete="email" required />
        </FormField>
        <FormField
          id="password"
          label="Password"
          error={state.fieldErrors?.password}
          helper={signup ? "At least 8 characters." : undefined}
        >
          <Input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={8} />
        </FormField>
        <FormMessage state={state} />
        <SubmitButton pendingLabel={signup ? "Creating account" : "Signing in"}>{signup ? "Create account" : "Sign in"}</SubmitButton>
      </form>
      <p className="mt-6 text-caption text-muted">
        {signup ? (
          <>
            Already have an account? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New to SetVector? <Link href="/signup">Create an account</Link>
          </>
        )}
      </p>
    </Card>
  );
}
