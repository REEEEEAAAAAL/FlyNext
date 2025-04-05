"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    async function logout() {
      try {
        // Call the logout API endpoint to clear the refresh token cookie
        const res = await fetch("/api/auth/logout", { method: "POST" });
        const data = await res.json();

        if (res.ok) {
          // Optionally remove the access token stored in localStorage
          localStorage.removeItem("accessToken");
          // Redirect the user to the login page after a successful logout
          router.push("/auth/login");
        } else {
          console.error("Logout failed:", data.error);
        }
      } catch (error) {
        console.error("Error during logout:", error);
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