"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  // Initialize state for form data, error message, and success message
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    profilePic: "",
    phone: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Handle input field changes by updating the formData state
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); // Prevent default form submission behavior
    setError("");
    setMessage("");

    try {
      // Send a POST request to the registration API endpoint
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        // If the response is not OK, display the error message
        setError(data.error || "Error occurred during registration");
      } else {
        // If the registration is successful, display the success message
        setMessage(data.message || "Registration successful!");
        // Navigate to the login page
        router.push("/auth/login");
      }
    } catch (err: any) {
      // Handle any unexpected errors during the fetch operation
      setError("An error occurred while registering the user");
    }
  };

  // Handle the click event of the "Back to Login" button
  const handleReturnLogin = () => {
    router.push("/auth/login");
  };

  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Register</h1>
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
        {/* First Name Input Field */}
        <div className="mb-4">
          <label className="block mb-1">First Name:</label>
          <input
            type="text"
            name="firstName"
            value={formData.firstName}
            onChange={handleChange}
            required
            className="w-full border border-gray-300 p-2 rounded"
          />
        </div>
        {/* Last Name Input Field */}
        <div className="mb-4">
          <label className="block mb-1">Last Name:</label>
          <input
            type="text"
            name="lastName"
            value={formData.lastName}
            onChange={handleChange}
            required
            className="w-full border border-gray-300 p-2 rounded"
          />
        </div>
        {/* Phone Input Field (Optional) */}
        <div className="mb-4">
          <label className="block mb-1">Phone:</label>
          <input
            type="tel"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            placeholder="Optional"
            className="w-full border border-gray-300 p-2 rounded"
          />
        </div>
        {/* Submit Button */}
        <button type="submit" className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          Register
        </button>
      </form>
      {/* Display error message if exists */}
      {error && <p className="text-red-500 mt-4">{error}</p>}
      {/* Display success message if exists */}
      {message && <p className="text-green-500 mt-4">{message}</p>}
      {/* Back  to Login button*/}
      <button
        onClick={handleReturnLogin}
        className="mt-6 w-full py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
      >
        Back to Login
      </button>
    </div>
  );
}
