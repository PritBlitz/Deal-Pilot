"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Notice } from "@/components/ui";
import { signInApprover, signOutApprover, useApproverPasscode } from "@/lib/admin";
import { api, ApiError } from "@/lib/api";

import styles from "./admin.module.css";

/**
 * Renders `children` only for a signed-in approver; otherwise the sign-in form.
 *
 * Mounted once by the /admin layout, so moving between the queue and a quote
 * keeps the session. Leaving /admin unmounts it and signs out, so every visit
 * to Approvals asks for the passcode again.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const passcode = useApproverPasscode();
  useEffect(() => signOutApprover, []);
  if (passcode === undefined) return null; // server render: session unknown until the browser takes over
  if (passcode === null) return <SignIn />;
  return <>{children}</>;
}

function SignIn() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) {
      setError("Enter the approver passcode.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.adminSignIn(value.trim());
      signInApprover(value.trim());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Couldn't sign in. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className={styles.gate}>
      <div className={styles.gateInner}>
        <p className="eyebrow">Approvals · restricted</p>
        <h1 className={`display ${styles.gateTitle}`}>
          Approver <em>sign-in</em>
        </h1>
        <p className={styles.gateLead}>
          Reps build and submit quotes. Only the deal desk approves or rejects them, and the API checks it on
          every decision. You&rsquo;ll be asked for the passcode each time you open Approvals.
        </p>

        <form className={styles.gateForm} onSubmit={submit} noValidate>
          <label htmlFor="passcode" className={styles.gateLabel}>
            Approver passcode
          </label>
          <div className={styles.gateRow}>
            <input
              id="passcode"
              type="password"
              className="input"
              autoComplete="current-password"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={error !== null}
              aria-describedby="passcode-err"
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Checking…" : "Sign in"}
            </button>
          </div>
          <div id="passcode-err" aria-live="polite">
            {error && <p className="field-error">{error}</p>}
          </div>
        </form>

        <div className={styles.gateHint}>
          <Notice tone="info" title="Running locally?">
            The passcode is set with <code>DEAL_DESK_ADMIN_PASSCODE</code> on the backend. The default is{" "}
            <code>approver</code>.
          </Notice>
        </div>
      </div>
    </main>
  );
}
