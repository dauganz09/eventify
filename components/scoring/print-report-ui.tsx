import { Fragment, type ReactNode } from "react";
import Image from "next/image";
import { EventLogo } from "@/components/events/event-logo";
import { APP_NAME, APP_TAGLINE } from "@/lib/branding";
import type { JudgeReport } from "@/lib/scoring/print-report-service";

/** Wrapper for printable results / scoresheet documents. */
export function PrintDocument({
  children,
  wide = false,
}: {
  children: ReactNode;
  /** Scoresheets need more horizontal room for criterion columns. */
  wide?: boolean;
}) {
  return (
    <article
      className={`rpt-document mx-auto w-full max-w-[8.5in] print:w-full print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none ${
        wide ? "max-w-[8.5in]" : ""
      }`}
    >
      {children}
    </article>
  );
}

/** Vertical rhythm wrapper for report sections below the header. */
export function PrintDocumentBody({ children }: { children: ReactNode }) {
  return <div className="rpt-doc-body">{children}</div>;
}

export function PrintDocumentHeader({
  eventName,
  eventLogoUrl,
  eyebrow,
  subtitle,
  meta,
}: {
  eventName: string;
  eventLogoUrl: string | null;
  eyebrow: string;
  subtitle: string;
  meta: ReactNode;
}) {
  return (
    <header className="rpt-doc-header">
      {/* Brand strip — Eventify mark + document type */}
      <div className="rpt-doc-brand-bar">
        <div className="rpt-doc-brand-mark">
          <Image
            src="/logo.png"
            alt={APP_NAME}
            width={22}
            height={22}
            className="rpt-doc-brand-logo"
          />
          <div className="rpt-doc-brand-text">
            <span className="rpt-doc-brand-name">{APP_NAME}</span>
            <span className="rpt-doc-brand-tagline">{APP_TAGLINE}</span>
          </div>
        </div>
        <div className="rpt-doc-brand-seal">
          <span className="rpt-doc-brand-seal-inner">{eyebrow}</span>
        </div>
      </div>

      <div className="rpt-doc-header-body">
        <div className="rpt-doc-header-ornament" aria-hidden />

        <div className="rpt-doc-logo-frame">
          {eventLogoUrl ? (
            <EventLogo
              src={eventLogoUrl}
              alt={eventName}
              className="rpt-doc-event-logo"
            />
          ) : (
            <div className="rpt-doc-logo-placeholder" aria-hidden>
              <span className="rpt-doc-logo-placeholder-star">★</span>
            </div>
          )}
        </div>

        <p className="rpt-doc-eyebrow rpt-doc-eyebrow-secondary">Certified Tabulation Document</p>
        <h1 className="rpt-doc-title">{eventName}</h1>
        <p className="rpt-doc-subtitle">{subtitle}</p>

        <div className="rpt-doc-meta-row">{meta}</div>

        <div className="rpt-doc-header-rule" aria-hidden />
      </div>
    </header>
  );
}

export function PrintRoundBanner({ label, title }: { label?: string; title: string }) {
  return (
    <div className="rpt-round-banner">
      {label && <p className="rpt-round-banner-label">{label}</p>}
      <h2 className="rpt-round-banner-title">{title}</h2>
    </div>
  );
}

export function PrintSectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="rpt-section-header">
      <h3 className="rpt-section-title">{title}</h3>
      {subtitle && <span className="rpt-section-subtitle">{subtitle}</span>}
    </div>
  );
}

export function PrintRankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="rpt-medal rpt-medal-gold" aria-label="1st place">
        1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="rpt-medal rpt-medal-silver" aria-label="2nd place">
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="rpt-medal rpt-medal-bronze" aria-label="3rd place">
        3
      </span>
    );
  }
  return <span className="rpt-rank-plain">{rank}</span>;
}

export function PrintTable({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <table className="rpt-table">
      {caption && <caption className="rpt-table-caption">{caption}</caption>}
      {children}
    </table>
  );
}

export function PrintTheadRow({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="rpt-thead-row">{children}</tr>
    </thead>
  );
}

export function PrintTh({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th className={`rpt-th rpt-th-${align} ${className}`.trim()}>{children}</th>
  );
}

export function PrintAdvanceBadge() {
  return <span className="rpt-advance-badge">Advances</span>;
}

export function PrintAdvanceCutoff({
  colSpan,
  count,
  roundName,
}: {
  colSpan: number;
  count: number;
  roundName: string;
}) {
  return (
    <tr aria-hidden className="rpt-break-avoid">
      <td colSpan={colSpan} className="p-0">
        <div className="rpt-advance-cutoff">
          <span className="rpt-advance-cutoff-line" />
          Top {count} advance to {roundName}
          <span className="rpt-advance-cutoff-line" />
        </div>
      </td>
    </tr>
  );
}

export function PrintSignatureBlock({
  judges,
  label = "Certified by the Panel of Judges",
}: {
  judges: JudgeReport[] | { id: string; name?: string; displayName?: string }[];
  label?: string;
}) {
  return (
    <footer className="rpt-signature-block">
      <p className="rpt-signature-label">{label}</p>
      {judges.length === 0 ? (
        <p className="rpt-signature-empty">No active judges to certify.</p>
      ) : (
        <div
          className={`rpt-signature-grid ${
            judges.length > 6 ? "rpt-signature-grid--4" : "rpt-signature-grid--3"
          }`}
        >
          {judges.map((judge) => {
            const name =
              "displayName" in judge && judge.displayName
                ? judge.displayName
                : "name" in judge && judge.name
                  ? judge.name
                  : "";
            return (
              <div key={judge.id} className="rpt-signature-slot">
                <p className="rpt-signature-name">{name}</p>
                <div className="rpt-signature-line" />
                <p className="rpt-signature-role">Judge</p>
              </div>
            );
          })}
        </div>
      )}
    </footer>
  );
}

export function PrintVerificationFooter({ code }: { code: string }) {
  return (
    <footer className="rpt-doc-footer">
      <div className="rpt-doc-footer-rule" aria-hidden />
      <p className="rpt-doc-footer-text">
        Document verification code{" "}
        <span className="rpt-doc-footer-code">{code}</span>
        {" — "}
        An authentic copy of this report reproduces the same code when regenerated against
        the recorded scores.
      </p>
    </footer>
  );
}

/** Renders ranking table rows with optional judge columns and advancement cutoff. */
export function PrintRankingRows({
  rows,
  showScoredCount,
  judgeCols,
  advancement,
  colCount,
}: {
  rows: {
    contestantId: string;
    rank: number;
    displayNumber: string | null;
    displayName: string;
    value: number;
    scoredCount?: number;
    scoresByJudge: Record<string, number>;
  }[];
  showScoredCount?: boolean;
  judgeCols: { id: string; displayName: string }[];
  advancement?: { count: number; roundName: string; contestantIds: string[] } | null;
  colCount: number;
}) {
  const advancingIds = new Set(advancement?.contestantIds ?? []);
  const lastAdvancingIndex = advancement
    ? rows.reduce(
        (last, row, i) => (advancingIds.has(row.contestantId) ? i : last),
        -1,
      )
    : -1;

  return (
    <tbody>
      {rows.map((row, index) => {
        const advances = advancingIds.has(row.contestantId);
        return (
          <Fragment key={row.contestantId}>
            <tr
              className={`rpt-tbody-row ${
                advances ? "rpt-tbody-row-advance" : index % 2 === 1 ? "rpt-tbody-row-alt" : ""
              }`}
            >
              <td className="rpt-td">
                <PrintRankBadge rank={row.rank} />
              </td>
              <td className="rpt-td rpt-td-mono">
                {row.displayNumber ? `#${row.displayNumber}` : "—"}
              </td>
              <td className="rpt-td rpt-td-name">
                <span className="inline-flex items-center gap-2">
                  {row.displayName}
                  {advances && <PrintAdvanceBadge />}
                </span>
              </td>
              {showScoredCount && (
                <td className="rpt-td rpt-td-muted rpt-td-right">
                  {row.scoredCount}
                </td>
              )}
              {judgeCols.map((judge) => {
                const score = row.scoresByJudge[judge.id];
                return (
                  <td key={judge.id} className="rpt-td rpt-td-muted rpt-td-right">
                    {score == null ? "—" : score.toFixed(2)}
                  </td>
                );
              })}
              <td className="rpt-td rpt-td-value">{row.value.toFixed(2)}</td>
            </tr>
            {advancement && index === lastAdvancingIndex && (
              <PrintAdvanceCutoff
                colSpan={colCount}
                count={advancement.count}
                roundName={advancement.roundName}
              />
            )}
          </Fragment>
        );
      })}
    </tbody>
  );
}
