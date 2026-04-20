import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md bg-card rounded-[14px] border border-border-subtle shadow-sm px-8 py-10 text-center">
        <h1 className="font-display text-3xl font-black text-charcoal">
          Not authorized
        </h1>
        <p className="text-sm text-slate mt-3">
          Your account doesn&rsquo;t have access to that area.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center h-11 px-5 mt-6 rounded-[8px] bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
