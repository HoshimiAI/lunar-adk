import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <div className="max-w-3xl">
        <p className="mb-4 text-sm font-medium text-fd-muted-foreground">
          Agent Development Kit for Bun and TypeScript
        </p>
        <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
          Build reliable AI agents with Lunar ADK
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-fd-muted-foreground">
          A provider-neutral runtime for agents, tools, workflows, sessions,
          and durable runs.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground"
        >
          Read the docs
        </Link>
        <Link
          href="https://github.com/HoshimiAI/lunar-adk"
          className="rounded-lg border px-5 py-2.5 font-medium"
        >
          View on GitHub
        </Link>
      </div>
    </div>
  );
}
