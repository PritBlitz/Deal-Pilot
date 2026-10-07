import { AdminGate } from "@/components/admin/AdminGate";

// One gate for everything under /admin. Layouts stay mounted while navigating
// inside /admin, and unmount (signing out) when you leave it.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminGate>{children}</AdminGate>;
}
