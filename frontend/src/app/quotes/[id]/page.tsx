import type { Metadata } from "next";

import { QuoteReview } from "@/components/review/QuoteReview";

export async function generateMetadata(props: PageProps<"/quotes/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Review ${decodeURIComponent(id)}` };
}

export default async function QuoteReviewPage(props: PageProps<"/quotes/[id]">) {
  const { id } = await props.params;
  return <QuoteReview id={decodeURIComponent(id)} />;
}
