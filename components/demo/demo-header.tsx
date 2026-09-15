import type { DemoWebsite } from "@/lib/types";

export function DemoHeader({ demo, accent }: { demo: DemoWebsite; accent: string }) {
  const initials = demo.businessName
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent} text-sm font-bold text-white`}>
            {initials}
          </span>
          <span className="font-semibold tracking-tight">{demo.businessName}</span>
        </div>
        <nav className="hidden gap-6 text-sm text-zinc-600 sm:flex">
          <a href="#diensten" className="hover:text-zinc-900">Diensten</a>
          <a href="#over-ons" className="hover:text-zinc-900">Over ons</a>
          <a href="#contact" className="hover:text-zinc-900">Contact</a>
        </nav>
      </div>
    </header>
  );
}
