"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/capture", label: "Capture" },
  { href: "/timeline", label: "Timeline" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-white/10 bg-neutral-950/95 backdrop-blur sm:static sm:border-b sm:border-t-0">
      <div className="mx-auto flex max-w-xl">
        {LINKS.map((link) => {
          const active = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex-1 py-4 text-center text-base font-medium ${
                active ? "text-white" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
