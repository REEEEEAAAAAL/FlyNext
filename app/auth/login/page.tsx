"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAccessToken } from "@/app/lib/session";
import { useFeedback } from "@/app/context/FeedbackContext";

export default function LoginPage() {
  // Initialize state for form data and error message
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const { success, error: toastError, warning } = useFeedback();

  // Handle input field changes by updating the formData state
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle form submission for login
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Each attempt costs one of the endpoint's rate-limit budget, so a
    // double-click must not spend two.
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      // Send a POST request to the login API endpoint
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        /*
         * The login endpoint is the tightest-rate-limited route on the API, so a
         * refused attempt is reported as its own kind of failure: the user has to
         * know that waiting will help, rather than changing their password. The
         * warning tone is what distinguishes "slow down" from "wrong password" at
         * a glance, since both are otherwise red text on the same form.
         */
        if (res.status === 429) {
          const failure =
            data.error ||
            "Too many login attempts. Please wait a moment and try again.";
          setError(failure);
          warning("Too many attempts", { description: failure });
        } else {
          const failure = data.error || "Error occurred during login";
          setError(failure);
          toastError("Could not sign you in", { description: failure });
        }
      } else {
        // If login is successful, confirm it and store the access token. The
        // toast host lives in the root layout, so the confirmation is still on
        // screen after the redirect to the home page.
        success("Signed in", {
          description: data.message || "Welcome back to FlyNext.",
          duration: 3000,
        });
        // Store the access token for subsequent requests. Going through the
        // helper (rather than `localStorage.setItem`) is what tells the mounted
        // notification badge that a session exists, so it resumes polling.
        setAccessToken(data.accessToken);
        // Navigate to the home page
        router.push("/");
      }
    } catch {
      // Handle unexpected errors during the fetch operation
      const failure = "An error occurred while logging in";
      setError(failure);
      toastError("Could not sign you in", { description: failure });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle the click event of the register button
  const handleRegister = () => {
    router.push("/auth/register");
  };
  // Handle the click event of the back to home page button
  const handleReturnHome = () => {
    router.push("/");
  };
  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-12">
      <div className="max-w-md mx-auto p-8 card text-[var(--text)]">
        <h1 className="text-2xl font-bold mb-6 heading">Login</h1>
        <form onSubmit={handleSubmit}>
          {/* Email Input Field */}
          <div className="mb-4">
            <label htmlFor="login-email" className="label mb-1">
              Email:
            </label>
            <input
              id="login-email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              autoComplete="email"
              className="field"
            />
          </div>
          {/* Password Input Field */}
          <div className="mb-4">
            <label htmlFor="login-password" className="label mb-1">
              Password:
            </label>
            <input
              id="login-password"
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              autoComplete="current-password"
              className="field"
            />
          </div>
          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {submitting ? "Logging in..." : "Login"}
          </button>
        </form>
        {/* Display error message if exists */}
        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30">
            {error}
          </p>
        )}
        {/* register button */}
        <button
          onClick={handleRegister}
          className="mt-4 w-full py-2 bg-green-500 text-white rounded hover:bg-green-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          Register
        </button>
        {/* back to home page button */}
        <button
          onClick={handleReturnHome}
          className="mt-6 w-full py-2 bg-gray-500 text-white rounded hover:bg-gray-600 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-100"
        >
          Back to the Home Page
        </button>
      </div>
    </div>
  );
}
