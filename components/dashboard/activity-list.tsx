import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { activities } from "@/lib/mock-data";

const activityColors: Record<string, string> = {
  search: "bg-sky-400",
  check: "bg-zinc-400",
  score: "bg-violet-400",
  demo: "bg-indigo-400",
  email: "bg-amber-400",
  send: "bg-emerald-400",
  reply: "bg-emerald-300",
  qualify: "bg-pink-400",
};

export function ActivityList() {
  return (
    <Card>
      <CardHeader
        title="AI Activity"
        subtitle="Wat het systeem de afgelopen uren heeft uitgevoerd"
        action={<Badge variant="success">Live</Badge>}
      />
      <ol className="relative space-y-5 border-l border-zinc-800 pl-5">
        {activities.map((entry, index) => (
          <li key={index} className="relative">
            <span
              className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ${activityColors[entry.type] ?? "bg-zinc-400"}`}
            />
            <p className="text-xs font-mono text-zinc-500">{entry.time}</p>
            <p className="mt-0.5 text-sm text-zinc-300">{entry.message}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
