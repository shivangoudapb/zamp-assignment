"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, LayoutDashboard, Plus, Receipt, SlidersHorizontal } from "lucide-react";

const LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/data", label: "Vendors & POs", icon: Database },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-white"><Receipt size={16} /></span>
          Invoice Agent
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${active ? "bg-brand-soft text-brand font-medium" : "text-muted hover:text-ink"}`}>
                <Icon size={15} /> {label}
              </Link>
            );
          })}
        </nav>
        <Link href="/new" className="ml-auto flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          <Plus size={15} /> Process invoice
        </Link>
      </div>
    </header>
  );
}
