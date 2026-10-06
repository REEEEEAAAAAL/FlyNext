"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearAccessToken } from "@/app/lib/session";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    async function logout() {
      /*
       * The local session is dropped and the user is sent to the login page no
       * matter what the server answers. Gating that on `res.ok` would leave a
       * failed call holding the access token in `localStorage`, the httpOnly
       * refresh cookie unrevoked, and the page stuck on "Logging out..." with no
       * way forward. The endpoint only revokes the refresh cookie, so a
       * server-side failure must not hold the client in a signed-in state it
       * cannot leave.
       */
      try {
        const res = await fetch("/api/auth/logout", { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          console.error("Logout failed:", data?.error ?? res.status);
        }
      } catch (error) {
        console.error("Error during logout:", error);
      } finally {
        // Through the helper, so anything subscribed to the token is told.
        clearAccessToken();
        router.push("/auth/login");
      }
    }

    logout();
  }, [router]);

  return (
    <div className="text-center mt-8">
      <p>Logging out...</p>
    </div>
  );
}