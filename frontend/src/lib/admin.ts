"use client";

import { useSyncExternalStore } from "react";

/**
 * Approver session, held in memory only.
 *
 * Nothing is written to storage, so a refresh or a new tab always asks for the
 * passcode again. The admin layout also signs out when you leave /admin, so
 * every visit to Approvals starts at the sign-in screen.
 *
 * This is a demo gate around a shared passcode, not real authentication. The
 * API checks the passcode on every approve/reject, so the browser can't fake it.
 */
let passcode: string | null = null;
const listeners = new Set<() => void>();

function set(value: string | null) {
  passcode = value;
  listeners.forEach((listener) => listener());
}

export const signInApprover = (value: string) => set(value);
export const signOutApprover = () => set(null);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * `undefined` while rendering on the server (unknown), `null` when signed out,
 * otherwise the passcode to send with approver requests.
 */
export function useApproverPasscode(): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => passcode,
    () => undefined,
  );
}
