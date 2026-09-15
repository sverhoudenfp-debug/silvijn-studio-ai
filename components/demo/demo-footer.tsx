import type { DemoWebsite } from "@/lib/types";

export function DemoFooter({ demo }: { demo: DemoWebsite }) {
  return (
    <footer className="border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-zinc-500 sm:flex-row">
        <p>
          © {new Date().getFullYear()} {demo.businessName} · {demo.city}
        </p>
        <p>
          Demo website door <span className="font-medium text-zinc-800">Silvijn Studio</span>
        </p>
      </div>
    </footer>
  );
}
