import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const projects = [
  { name: "Jansen Dakwerken", status: "Klaar voor goedkeuring", variant: "warning" as const, price: "€ 1.250", pages: "3 pagina's", deadline: "Over 1 week" },
  { name: "Groen & Co Hoveniers", status: "In ontwikkeling", variant: "info" as const, price: "€ 950", pages: "2 pagina's", deadline: "Over 2 weken" },
  { name: "Kapsalon Mirage", status: "Wacht op informatie", variant: "neutral" as const, price: "€ 750", pages: "1 pagina", deadline: "In planning" },
  { name: "Beauty by Lisa", status: "Opgeleverd", variant: "success" as const, price: "€ 1.100", pages: "4 pagina's", deadline: "Afgerond" },
];

export default function ProjectsPage() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {projects.map((project) => (
        <Card key={project.name} className="transition-colors hover:border-zinc-700">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-100">{project.name}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{project.pages} · {project.deadline}</p>
            </div>
            <Badge variant={project.variant}>{project.status}</Badge>
          </div>
          <p className="mt-4 text-lg font-semibold text-zinc-50">{project.price}</p>
        </Card>
      ))}
    </div>
  );
}
