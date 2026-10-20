"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { recoverSession } from "@/app/lib/session";

/** Protected page effects run only after cookie recovery has settled. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
	const [ready, setReady] = useState(false);
	const path = usePathname();
	useEffect(() => { let active = true; void recoverSession().finally(() => { if (active) setReady(true); }); return () => { active = false; }; }, []);
	const protectedPage = /^\/(profile|notifications|user|itineraries|checkout|invoice)(\/|$)/.test(path) ||
		/^\/hotels\/(owner|new)(\/|$)/.test(path) || /\/hotels\/.*\/(edit|new)$/.test(path);
	if (!ready && protectedPage) return <p role="status" className="p-8 text-center">Restoring your session…</p>;
	return children;
}
