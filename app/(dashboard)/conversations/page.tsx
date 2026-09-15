import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { conversationMessages, leads } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export default function ConversationsPage() {
  const conversations = leads.filter(
    (lead) => lead.leadStatus === "interested" || lead.outreachStatus === "replied"
  );
  const active = conversations[0];

  if (!active) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-zinc-200">Nog geen gesprekken</p>
        <p className="mt-1 text-xs text-zinc-500">Zodra leads reageren verschijnen ze hier.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader title="Gesprekken" subtitle={`${conversations.length} actief`} />
        <div className="space-y-2">
          {conversations.map((lead) => (
            <button
              key={lead.id}
              type="button"
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                lead.id === active.id
                  ? "border-zinc-600 bg-zinc-800/60"
                  : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-100">{lead.businessName}</span>
                <Badge variant="success">Actief</Badge>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {lead.city} · {lead.industry}
              </p>
            </button>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col lg:col-span-2">
        <CardHeader
          title={active.businessName}
          subtitle="AI status: Geïnteresseerd — wil een prijsindicatie en heeft foto's van klussen beschikbaar"
          action={<Badge variant="success">AI voert gesprek</Badge>}
        />
        <div className="flex-1 space-y-4">
          {conversationMessages.map((message, index) => (
            <div key={index} className={cn("flex", message.sender === "ai" ? "justify-start" : "justify-end")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-xl px-4 py-2.5 text-sm",
                  message.sender === "ai" ? "bg-zinc-800 text-zinc-200" : "bg-indigo-600 text-white"
                )}
              >
                <p>{message.body}</p>
                <p className={cn("mt-1 text-[10px]", message.sender === "ai" ? "text-zinc-500" : "text-indigo-200")}>
                  {message.time}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-3">
          <p className="text-xs text-zinc-500">
            AI-suggestie: {active.businessName} wil een 1-pagina website met contactformulier en foto-galerij.
            Projectintake kan worden gestart; prijsindicatie ~750-1500 euro. Wacht op menselijke bevestiging.
          </p>
        </div>
      </Card>
    </div>
  );
}
