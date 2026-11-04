import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/events", label: "Events and prices" },
  { href: "/admin/seasons", label: "Seasons" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/points", label: "Points" },
  { href: "/admin/venues", label: "Venue" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/people", label: "Staff and admins" },
  { href: "/admin/waivers", label: "Waivers" },
  { href: "/admin/activity", label: "Activity log" },
];

/** Admin pages share this menu. Each page checks the admin role itself. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav aria-label="Admin" className="print:hidden">
        <ul className="flex flex-wrap gap-x-3 gap-y-0 border-b-2 border-border pb-2 text-sm">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
