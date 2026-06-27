import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { categoryBySlug, trendsByCategory } from "@/lib/trends";
import { TrendCard } from "@/components/TrendCard";

export const Route = createFileRoute("/category/$slug")({
  loader: ({ params }) => {
    const cat = categoryBySlug(params.slug);
    if (!cat) throw notFound();
    return { category: cat, trends: trendsByCategory(cat.slug) };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.category.label.toLowerCase()} — Veda` },
          {
            name: "description",
            content: `Evidence-backed verdicts on ${loaderData.category.label.toLowerCase()} ingredients, products, and rituals.`,
          },
        ]
      : [],
  }),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--parchment)" }}>
      <div className="text-center">
        <p className="font-label text-xs" style={{ color: "var(--muted-ink)" }}>NOT FOUND</p>
        <Link to="/" className="font-display text-2xl mt-2 inline-block" style={{ color: "var(--ink)" }}>
          ← back to veda
        </Link>
      </div>
    </div>
  ),
  component: CategoryPage,
});

function CategoryPage() {
  const { category, trends } = Route.useLoaderData();
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--parchment)" }}>
      <header className="mx-auto max-w-[1100px] px-6 pt-10 pb-6">
        <Link to="/" className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
          ← VEDA
        </Link>
        <p className="font-label text-[10px] mt-8" style={{ color: "var(--sage)" }}>
          {category.label}
        </p>
        <h1 className="font-display mt-2" style={{ color: "var(--ink)", fontSize: "clamp(40px, 6vw, 64px)", lineHeight: 1 }}>
          What actually works.
        </h1>
        <p className="mt-4 max-w-xl" style={{ color: "var(--muted-ink)", fontSize: 14, lineHeight: 1.6 }}>
          Every {category.label.toLowerCase()} verdict below cross-references the clinical literature
          and what real users report. Tap any card to see the evidence.
        </p>
      </header>

      <section className="mx-auto max-w-[1100px] px-6 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trends.map((t) => (
            <TrendCard key={t.slug} trend={t} />
          ))}
          {trends.length === 0 && (
            <p className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
              MORE COMING SOON
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
