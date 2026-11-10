import { fetchApiHealth } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const health = await fetchApiHealth();

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">BillSplit</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Photograph a receipt, tap who had what, settle up. Coming together one step at a time.
      </p>
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
          API status
        </h2>
        {health.ok ? (
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-zinc-500">status</dt>
            <dd className="font-mono text-emerald-600">{health.data.status}</dd>
            <dt className="text-zinc-500">version</dt>
            <dd className="font-mono">{health.data.version}</dd>
            <dt className="text-zinc-500">uptime</dt>
            <dd className="font-mono">{health.data.uptimeSeconds}s</dd>
          </dl>
        ) : (
          <p className="text-sm text-red-600">API unreachable: {health.error}</p>
        )}
      </section>
    </main>
  );
}
