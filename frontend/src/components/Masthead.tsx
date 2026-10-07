"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useApproverPasscode } from "@/lib/admin";

import styles from "./Masthead.module.css";

const NAV = [
  { href: "/", label: "Overview", match: (p: string) => p === "/" },
  { href: "/quotes", label: "Quotes", match: (p: string) => p === "/quotes" || /^\/quotes\/(?!new)/.test(p) },
  { href: "/admin", label: "Approvals", match: (p: string) => p.startsWith("/admin") },
];

export function Masthead() {
  const pathname = usePathname();
  const approver = useApproverPasscode();

  return (
    <header className={styles.masthead}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="Deal Desk: overview">
          <span className={`display ${styles.wordmark}`}>
            Deal <em>Desk</em>
          </span>
          <span className={`eyebrow ${styles.tag}`}>Quote simulator</span>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.link}
              aria-current={item.match(pathname) ? "page" : undefined}
            >
              {item.label}
              {item.href === "/admin" && approver && (
                <span className={styles.approver} title="Signed in as approver">
                  <span className="visually-hidden"> (signed in)</span>
                </span>
              )}
            </Link>
          ))}
          {pathname !== "/quotes/new" && (
            <Link href="/quotes/new" className={`btn btn-primary ${styles.cta}`}>
              New quote
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
