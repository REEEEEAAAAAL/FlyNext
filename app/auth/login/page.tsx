"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  // Initialize state for form data, error message, and success message
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();

  // Handle input field changes by updating the formData state
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle form submission for login
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setMessage("");

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
        // If login fails, display the error message from the response
        setError(data.error || "Error occurred during login");
      } else {
        // If login is successful, display a success message and store the access token
        setMessage(data.message || "Login successful!");
        // For example, you might store the access token in localStorage
        localStorage.setItem("accessToken", data.accessToken);
        // Navigate to the home page
        router.push("/");
      }
    } catch (err: any) {
      // Handle unexpected errors during the fetch operation
      setError("An error occurred while logging in");
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
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Login</h1>
      <form onSubmit={handleSubmit}>
        {/* Email Input Field */}
        <div className="mb-4">
          <label className="block mb-1">Email:</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            className="w-full border border-gray-300 p-2 rounded"
          />
        </div>
        {/* Password Input Field */}
        <div className="mb-4">
          <label className="block mb-1">Password:</label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            className="w-full border border-gray-300 p-2 rounded"
          />
        </div>
        {/* Submit Button */}
        <button
          type="submit"
          className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Login
        </button>
      </form>
      {/* Display error message if exists */}
      {error && <p className="text-red-500 mt-4">{error}</p>}
      {/* Display success message if exists */}
      {message && <p className="text-green-500 mt-4">{message}</p>}
      {/* register button */}
      <button
        onClick={handleRegister}
        className="mt-4 w-full py-2 bg-green-500 text-white rounded hover:bg-green-600"
      >
        Register
      </button>
      {/* back to home page button */}
      <button
        onClick={handleReturnHome}
        className="mt-6 w-full py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
      >
        Back to the Home Page
      </button>
    </div>
  );
}
