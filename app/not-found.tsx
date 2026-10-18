import Link from "next/link";

export default function NotFound() {
  return <div className="card max-w-xl mx-auto p-8 text-center"><p className="eyebrow mb-4">OFF THE BEATEN PATH</p><h1 className="text-3xl font-bold mb-4">This page isn’t on the map.</h1><p className="muted mb-6">The link may have changed. Your next destination is still within reach.</p><div className="flex flex-wrap justify-center gap-3"><Link className="button-primary" href="/">Back to home</Link><Link className="button-secondary" href="/itineraries">My trips</Link></div></div>;
}
