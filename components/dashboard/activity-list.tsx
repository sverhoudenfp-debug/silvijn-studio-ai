import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { AIActivityRecord } from "@/lib/repositories/ai-activity-repository";

/**
 * Fase 12 §P — activity-feed met ECHTE ai_activities-records (audit-trail).
 * Geen mock entries meer.
 */

const activityColors: Record<string, string> = {
  search: "bg-sky-400",
  check: "bg-zinc-400",
  score: "bg-violet-400",
  demo: "bg-indigo-400",
  email: "bg-amber-400",
  send: "bg-emerald-400",
  reply: "bg-emerald-300",
  qualify: "bg-pink-400",
  blocked: "bg-red-400",
  automation_waiting_for_human: "bg-orange-400",
};

const statusVariants: Record<string, "success" | "danger" | "warning" | "neutral" | "info"> = {
  completed: "success",
  failed: "danger",
  blocked: "warning",
  started: "info",
};

export function ActivityList({ activities }: { activities: AIActivityRecord[] }) {
  return (
    <Card>
      <CardHeader
        title="AI Activity"
        subtitle="Wat het systeem recent heeft uitgevoerd (audit-trail)"
        action={<Badge variant={activities.length > 0 ? "success" : "neutral"}>{activities.length > 0 ? "Live" : "Leeg"}</Badge>}
      />
      {activities.length === 0 ? (
        <p className="py-6 text-sm text-zinc-500">Nog geen activiteit — zodra AI of automatisering draait, verschijnt dat hier.</p>
      ) : (
        <ol className="relative space-y-5 border-l border-zinc-800 pl-5">
          {activities.map((entry) => (
            <li key={entry.id ?? entry.message} className="relative">
              <span
                className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ${activityColors[entry.type] ?? "bg-zinc-400"}`}
              />
              <p className="text-xs font-mono text-zinc-500">{entry.createdAt ? new Date(entry.createdAt).toLocaleString("nl-NL") : "—"}</p>
              <p className="mt-0.5 text-sm text-zinc-300">{entry.message}</p>
              <Badge variant={statusVariants[entry.status] ?? "neutral"}>{entry.status}</Badge>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
