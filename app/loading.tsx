export default function Loading() {
  return <div className="card max-w-4xl mx-auto p-8" role="status" aria-label="Loading page"><p className="muted mb-6">Getting everything ready…</p><div aria-hidden="true" className="space-y-4"><div className="skeleton h-8 w-2/3"/><div className="skeleton h-4 w-full"/><div className="skeleton h-4 w-4/5"/><div className="skeleton h-40 w-full"/></div></div>;
}
