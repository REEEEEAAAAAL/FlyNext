"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFeedback } from "@/app/context/FeedbackContext";

/**
 * Mirrors `MIN_PASSWORD_LENGTH` in `app/api/auth/register/route.ts`.
 *
 * It is duplicated rather than imported because that module is server-only —
 * importing it into a client component would pull the Prisma client and the
 * password hasher into the browser bundle. The check below is a courtesy that
 * keeps an obviously invalid password from spending one of the ten hourly
 * registration attempts; the API remains the authority on the rule.
 */
const MIN_PASSWORD_LENGTH = 6;

export default function RegisterPage() {
  const router = useRouter();
  const { success, error: toastError, warning } = useFeedback();

  /*
   * Initialize state for form data and the error message.
   *
   * There is no `profilePic` field: the form has no avatar control, and the API
   * reads an empty string as "not supplied", so sending one only made it look
   * as though registration could set an avatar.
   */
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Handle input field changes by updating the formData state
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); // Prevent default form submission behavior
    /*
     * Registration has the strictest budget on the API — ten attempts per hour per
     * address — so an impatient double-click can lock a new user out of signing
     * up at all. The button is disabled while a request is in flight and this
     * guard covers the keyboard path.
     */
    if (submitting) {
      return;
    }
    /*
     * Same budget, checked locally: the API's `400` is authoritative, but it
     * costs one of the ten attempts to ask. `minLength` on the input catches the
     * ordinary path; this covers a submit that reaches the handler anyway.
     */
    if (formData.password.length < MIN_PASSWORD_LENGTH) {
      const failure = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
      setError(failure);
      warning("Password too short", { description: failure });
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      // Send a POST request to the registration API endpoint
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      /*
       * Parsed before the status is inspected, and tolerantly: a `201` whose
       * body cannot be read (an empty body, an intercepting proxy) would
       * otherwise throw its way into the `catch` below and report a failed
       * registration for an account that was in fact created — the user's retry
       * then answers "Email already in use".
       */
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;

      if (!res.ok) {
        // If the response is not OK, display the error message
        const failure = data?.error || "Error occurred during registration";
        setError(failure);
        toastError("Could not create your account", { description: failure });
      } else {
        // The toast survives the redirect, so the new user is told the account
        // exists on the sign-in page rather than on a page that is going away.
        success("Account created", {
          description:
            data?.message || "Sign in with your new email and password.",
        });
        // Navigate to the login page
        router.push("/auth/login");
      }
    } catch {
      // Handle any unexpected errors during the fetch operation
      const failure = "An error occurred while registering the user";
      setError(failure);
      toastError("Could not create your account", { description: failure });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle the click event of the "Back to Login" button
  const handleReturnLogin = () => {
    router.push("/auth/login");
  };

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-12">
      <div className="max-w-md mx-auto p-8 card text-[var(--text)]">
        <h1 className="text-2xl font-bold mb-6 heading">Register</h1>
        <form onSubmit={handleSubmit}>
          {/* Email Input Field */}
          <div className="mb-4">
            <label htmlFor="register-email" className="label mb-1">
              Email:
            </label>
            <input
              id="register-email"
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
            <label htmlFor="register-password" className="label mb-1">
              Password:
            </label>
            <input
              id="register-password"
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="field"
            />
          </div>
          {/* First Name Input Field */}
          <div className="mb-4">
            <label htmlFor="register-first-name" className="label mb-1">
              First Name:
            </label>
            <input
              id="register-first-name"
              type="text"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              required
              autoComplete="given-name"
              className="field"
            />
          </div>
          {/* Last Name Input Field */}
          <div className="mb-4">
            <label htmlFor="register-last-name" className="label mb-1">
              Last Name:
            </label>
            <input
              id="register-last-name"
              type="text"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              required
              autoComplete="family-name"
              className="field"
            />
          </div>
          {/* Phone Input Field (Optional) */}
          <div className="mb-4">
            <label htmlFor="register-phone" className="label mb-1">
              Phone:
            </label>
            <input
              id="register-phone"
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="Optional"
              autoComplete="tel"
              className="field"
            />
          </div>
          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {submitting ? "Registering..." : "Register"}
          </button>
        </form>
        {/* Display error message if exists */}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30"
          >
            {error}
          </p>
        )}
        {/* Back to Login button */}
        <button
          onClick={handleReturnLogin}
          className="mt-6 w-full py-2 bg-gray-500 text-white rounded hover:bg-gray-600 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-100"
        >
          Back to Login
        </button>
      </div>
    </div>
  );
}
