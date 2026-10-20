import Link from "next/link";

export default function EmptyState({ title, description, href, action }: { title: string; description: string; href: string; action: string }) {
  return <div className="empty-state surface p-8 text-center">
    <svg className="mx-auto mb-4 h-10 w-10 text-blue-600 dark:text-blue-300" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="7" width="22" height="21" rx="4"/><path d="M11 4v6M21 4v6M5 14h22M12 21h8"/></svg>
    <h2 className="text-xl font-semibold heading">{title}</h2><p className="muted text-sm mt-3 mb-5">{description}</p><Link className="button-primary" href={href}>{action}</Link>
  </div>;
}
