"use client";

import dynamic from "next/dynamic";

// The builder restores an unsaved draft from localStorage on first render, so it
// is rendered in the browser only. There is nothing useful to server-render for a form.
const QuoteBuilder = dynamic(() => import("@/components/builder/QuoteBuilder").then((m) => m.QuoteBuilder), {
  ssr: false,
  loading: () => <p style={{ padding: "64px var(--gutter)", color: "var(--ink-2)" }}>Loading builder…</p>,
});

export function NewQuoteClient() {
  return <QuoteBuilder />;
}
