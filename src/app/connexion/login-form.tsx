"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { loginAction } from "@/lib/auth/actions";
import type { LoginState } from "@/lib/auth/types";

const INITIAL_STATE: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, INITIAL_STATE);

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="text-[11px] font-medium text-muted">
          Adresse e-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="mt-1.5 w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm transition-colors outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor="password" className="text-[11px] font-medium text-muted">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1.5 w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm transition-colors outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        aria-label="Se connecter"
        title="Se connecter"
        className="grid w-full place-items-center rounded-md bg-brand px-3 py-2.5 text-canvas transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogIn className="size-4" aria-hidden="true" />
      </button>
    </form>
  );
}
