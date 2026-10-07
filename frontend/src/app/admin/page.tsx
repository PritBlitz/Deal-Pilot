import type { Metadata } from "next";

import { ApprovalQueue } from "@/components/admin/ApprovalQueue";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return <ApprovalQueue />;
}
