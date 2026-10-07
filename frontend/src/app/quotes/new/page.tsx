import type { Metadata } from "next";
import { Suspense } from "react";

import { NewQuoteClient } from "./NewQuoteClient";

export const metadata: Metadata = { title: "New quote" };

export default function NewQuotePage() {
  // The builder reads ?from=<id> with useSearchParams, which needs a Suspense boundary.
  return (
    <main>
      <Suspense>
        <NewQuoteClient />
      </Suspense>
    </main>
  );
}
