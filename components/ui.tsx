import { Circle, CircleCheck, CircleMinus, CircleX, LoaderCircle, TriangleExclamationPoint } from "lucide-react";
import type { Decision, StepStatus } from "@/lib/types";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-white ${className}`}>{children}</div>;
}

const DECISION_STYLE: Record<string, string> = {
  APPROVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  HOLD: "bg-amber-50 text-amber-700 ring-amber-200",
  REJECT: "bg-rose-50 text-rose-700 ring-rose-200",
  RUNNING: "bg-blue-50 text-blue-700 ring-blue-200",
};
const DECISION_LABEL: Record<string, string> = { APPROVE: "Approved", HOLD: "On hold", REJECT: "Rejected", RUNNING: "Processing" };

export function DecisionBadge({ decision, review, status, size = "sm" }: { decision: Decision | null; review?: "APPROVE" | "REJECT" | null; status?: string; size?: "sm" | "lg" }) {
  const key = status === "running" ? "RUNNING" : review ?? decision ?? "RUNNING";
  const pad = size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset ${pad} ${DECISION_STYLE[key]}`}>
      {key === "RUNNING" && <LoaderCircle size={12} className="animate-spin" />}
      {DECISION_LABEL[key]}
      {review && <span className="opacity-70">· reviewed</span>}
    </span>
  );
}

export function StepIcon({ status, size = 20 }: { status: StepStatus; size?: number }) {
  switch (status) {
    case "running": return <LoaderCircle size={size} className="animate-spin text-brand" />;
    case "done": return <CircleCheck size={size} className="text-emerald-600" />;
    case "warn": return <TriangleExclamationPoint size={size} className="text-amber-500" />;
    case "failed": return <CircleX size={size} className="text-rose-600" />;
    case "skipped": return <CircleMinus size={size} className="text-slate-300" />;
    default: return <Circle size={size} className="text-slate-300" />;
  }
}

export const SEVERITY_STYLE: Record<string, string> = {
  reject: "border-rose-200 bg-rose-50 text-rose-800",
  hold: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  pass: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export const usd = (n: number | string | null | undefined) =>
  n == null || n === "" ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
