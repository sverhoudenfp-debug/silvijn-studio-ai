import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { workflowSteps } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export default function AutomationPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Workflow"
          subtitle="De volledige pipeline van ontdekking tot oplevering"
          action={<Badge variant="success">Alles actief</Badge>}
        />
        <ol className="relative space-y-3 border-l border-zinc-800 pl-6">
          {workflowSteps.map((step, index) => (
            <li key={step.label} className="relative">
              <span
                className={cn(
                  "absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                  step.enabled
                    ? "border-emerald-800 bg-emerald-950 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500"
                )}
              >
                {index + 1}
              </span>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{step.label}</p>
                  <p className="text-xs text-zinc-500">{step.detail}</p>
                </div>
                <span className={cn("text-xs", step.enabled ? "text-emerald-400" : "text-zinc-500")}>
                  {step.enabled ? "ON" : "OFF"}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Noodstop" subtitle="Direct alle automatisering stoppen" />
          <button
            type="button"
            className="w-full rounded-lg border border-red-900 bg-red-950 px-4 py-2.5 text-sm font-semibold text-red-300 transition-colors hover:bg-red-900"
          >
            PAUSE ALL AUTOMATIONS
          </button>
          <p className="mt-3 text-xs text-zinc-500">
            Human approval staat altijd aan en kan niet worden uitgeschakeld.
          </p>
        </Card>

        <Card>
          <CardHeader title="Limieten" subtitle="Veiligheidswaarden per dag" />
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-400">Dagelijkse lead limit</dt><dd className="font-medium text-zinc-100">50</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-400">Dagelijkse e-mail limit</dt><dd className="font-medium text-zinc-100">25</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-400">Minimale lead score</dt><dd className="font-medium text-zinc-100">60</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-400">Follow-up timing</dt><dd className="font-medium text-zinc-100">3 dagen</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
