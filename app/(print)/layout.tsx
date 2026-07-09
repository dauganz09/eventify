import { requireAuthContext } from "@/lib/auth/context";
import { PrintLightMode } from "./print-light-mode";
import "./print-report.css";

/** Print routes render outside the dashboard shell — full-page light "paper" canvas. */
export default async function PrintRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthContext();
  return (
    <PrintLightMode>
      <div className="rpt-page-root">{children}</div>
    </PrintLightMode>
  );
}
