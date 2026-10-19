import Link from "next/link";

const links = [
  { href: "/", label: "Store" },
  { href: "/new", label: "Add app" },
  { href: "/settings", label: "Settings" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#07080d]" />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(900px_circle_at_12%_-10%,rgba(120,140,255,0.22),transparent_55%),radial-gradient(700px_circle_at_100%_0%,rgba(80,180,255,0.12),transparent_45%),radial-gradient(800px_circle_at_50%_120%,rgba(90,70,160,0.18),transparent_50%)]" />
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07080d]/55 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <svg viewBox="0 0 256 256" className="size-7" aria-hidden>
                <path fill="#d5defe" d="M142 38 74 142h52l-22 76 92-112h-56z">
                  <animate attributeName="opacity" values="0.55;1;0.55" dur="1.6s" repeatCount="indefinite" />
                </path>
              </svg>
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-tight">HeilSS</span>
              <span className="block text-xs text-white/55">Heil Store Studio</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-sm backdrop-blur-xl">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-full px-3 py-1.5 text-white/80 hover:bg-white/10 hover:text-white">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

export function Glass({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-white/10 bg-white/[0.045] shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl ${className}`}>
      {children}
    </section>
  );
}
