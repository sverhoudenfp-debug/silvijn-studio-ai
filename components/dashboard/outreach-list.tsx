import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { recentOutreach } from "@/lib/mock-data";

export function OutreachList() {
  return (
    <Card>
      <CardHeader
        title="Recent Outreach"
        subtitle="Mock data — er worden geen echte e-mails verstuurd"
      />
      <ul className="divide-y divide-zinc-800/50">
        {recentOutreach.map((item) => (
          <li key={item.business} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">{item.business}</p>
              <p className="truncate text-xs text-zinc-500">{item.email}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-zinc-500">{item.date}</span>
              <Badge variant={item.variant}>{item.status}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
