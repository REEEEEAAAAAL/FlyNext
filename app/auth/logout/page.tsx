"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logoutLocally, sessionFetch } from "@/app/lib/session";

export default function LogoutPage() {
  const router = useRouter();
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    logoutLocally();
    setFailure("");
    void sessionFetch("/api/auth/logout", { method: "POST" }).then(response => {
      if (!active) return;
      if (response.ok) router.replace("/auth/login");
      else setFailure("Your local session is cleared, but server sign-out failed. Retry before leaving this device.");
    }).catch(() => {
      if (active) setFailure("Could not reach the server to sign out. Check your connection and retry.");
    });
    return () => { active = false; };
  }, [router, attempt]);
  return <div className="text-center mt-8">
    {failure ? <><p role="alert">{failure}</p><button className="btn-primary mt-4" onClick={() => setAttempt(value => value + 1)}>Retry sign out</button></> : <p role="status">Logging out...</p>}
  </div>;
}
