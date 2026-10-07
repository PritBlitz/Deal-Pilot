import type { Metadata } from "next";

import { QuoteReview } from "@/components/review/QuoteReview";

export async function generateMetadata(props: PageProps<"/admin/quotes/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Decide ${decodeURIComponent(id)}` };
}

export default async function AdminQuotePage(props: PageProps<"/admin/quotes/[id]">) {
  const { id } = await props.params;
  return <QuoteReview id={decodeURIComponent(id)} mode="admin" />;
}
