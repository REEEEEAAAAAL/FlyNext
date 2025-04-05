"use client";

import { usePathname } from "next/navigation";
import NavigationBar from "@/app/components/NavigationBar";

export default function NavigationWrapper() {
    // const pathname = usePathname();
    // const isHome = pathname === "/";

    return (
        <>
            {<NavigationBar />}
        </>
    );
}
