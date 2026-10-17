"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { recoverSession } from "@/app/lib/session";

export default function RefreshPage() {
  const router = useRouter();

  useEffect(() => {
    async function refreshToken() {
      try {
        // Send a POST request to the refresh API endpoint
        const token = await recoverSession(true);
        if (token) {
          // Store the new access token for subsequent requests, through the
          // helper so the notification badge learns the session is back and
          // resumes polling.
          // Return to the page that triggered the refresh.
          router.back();
        } else {
          // If refresh fails, navigate to the login page
          router.push("/auth/login");
        }
      } catch (error: any) {
        console.error("Error refreshing token:", error);
        router.push("/auth/login");
      }
    }

    refreshToken();
  }, [router]);

  return (
    <div className="text-center mt-8">
      <p>Refreshing token...</p>
    </div>
  );
}
