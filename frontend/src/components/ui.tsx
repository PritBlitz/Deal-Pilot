import type { ReactNode } from "react";

import { REASON_LABEL, STATUS_LABEL } from "@/lib/format";
import type { ApprovalReason, QuoteStatus } from "@/lib/types";

import styles from "./ui.module.css";

export function StatusBadge({ status }: { status: QuoteStatus }) {
  return (
    <span className={styles.status} data-status={status}>
      <span className={styles.statusMark} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ApprovalVerdict({
  required,
  reasons,
  size = "regular",
  title,
}: {
  required: boolean;
  reasons: ApprovalReason[];
  size?: "regular" | "large";
  /** Overrides the default heading, e.g. once a reviewer has decided. */
  title?: string;
}) {
  return (
    <div className={styles.verdict} data-required={required} data-size={size} role="status">
      <p className={styles.verdictTitle}>{title ?? (required ? "Needs approval" : "Within policy")}</p>
      {required ? (
        <ul className={styles.reasons}>
          {reasons.map((reason) => (
            <li key={reason}>{REASON_LABEL[reason]}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.verdictBody}>No approval needed. Ready to send once submitted.</p>
      )}
    </div>
  );
}

/** Only for a hint or a problem the rep needs to act on. */
export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: "error" | "info" | "warning";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.notice} data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <div>
        <p className={styles.noticeTitle}>{title}</p>
        {children && <div className={styles.noticeBody}>{children}</div>}
      </div>
      {action && <div className={styles.noticeAction}>{action}</div>}
    </div>
  );
}
