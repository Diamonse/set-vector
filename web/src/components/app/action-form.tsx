"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";

/**
 * A form for a server action run through useActionState. React resets every uncontrolled field
 * once a form action completes, even when the action only returned an error, which would wipe
 * what the user typed. This takes a snapshot on submit and puts it back when the new state is
 * not ok. Success still resets as before, and the form still submits without scripts.
 */
export function ActionForm({ state, onSubmit, ...props }: ComponentProps<"form"> & { state: { ok: boolean } }) {
  const formRef = useRef<HTMLFormElement>(null);
  const snapshot = useRef<FormData | null>(null);

  // Layout effects run after the commit that applies React's reset, and before paint.
  useLayoutEffect(() => {
    const form = formRef.current;
    const data = snapshot.current;
    snapshot.current = null;
    if (!form || !data || state.ok) return;
    for (const el of Array.from(form.elements)) {
      if (el instanceof HTMLInputElement) {
        if (!el.name || el.type === "file" || el.type === "hidden") continue;
        if (el.type === "checkbox" || el.type === "radio") el.checked = data.getAll(el.name).includes(el.value);
        else el.value = String(data.get(el.name) ?? "");
      } else if (el instanceof HTMLTextAreaElement && el.name) {
        el.value = String(data.get(el.name) ?? "");
      } else if (el instanceof HTMLSelectElement && el.name) {
        const values = data.getAll(el.name).map(String);
        for (const option of Array.from(el.options)) option.selected = values.includes(option.value);
      }
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        snapshot.current = new FormData(e.currentTarget);
        onSubmit?.(e);
      }}
      {...props}
    />
  );
}
