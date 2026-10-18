"use client";
import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="card max-w-xl mx-auto p-8 text-center" role="alert"><p className="eyebrow mb-4">LET’S TRY THAT AGAIN</p><h1 className="text-3xl font-bold mb-4">Something interrupted your journey.</h1><p className="muted mb-6">We couldn’t load this page. Try again, or return home to continue exploring. If a booking was in progress, check your booking history before starting another.</p><div className="flex flex-wrap justify-center gap-3"><button className="button-primary" onClick={reset}>Try again</button><Link className="button-secondary" href="/">Back to home</Link></div></div>;
}
