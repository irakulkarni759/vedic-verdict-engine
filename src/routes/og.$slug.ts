import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { trendBySlug } from "@/lib/trends";
import { getGeneratedTrendBySlug } from "@/lib/generatedTrends.functions";
import { renderTrendOgPng } from "@/lib/og-image.server";

// Dynamic social-share image for a trend. trend.$slug.tsx and search.$query.tsx
// point og:image / twitter:image here so a shared link unfurls with the actual
// verdict card instead of favicon-only text. The route is intentionally
// extensionless — crawlers key off the image/png Content-Type below, and a
// literal ".png" suffix on the same segment as $slug gets folded into the
// param name by the router (so $slug would capture "…png").
export const Route = createFileRoute("/og/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        // Same resolution order as the trend page: curated trends first, then
        // the Supabase-backed generated ones.
        const trend =
          trendBySlug(params.slug) ??
          (await getGeneratedTrendBySlug({ data: { slug: params.slug } }));
        if (!trend) return new Response("Not found", { status: 404 });

        try {
          const png = await renderTrendOgPng(trend, new URL(request.url).origin);
          return new Response(png as BodyInit, {
            headers: {
              "Content-Type": "image/png",
              // Crawlers refetch rarely; a day of edge caching keeps render
              // cost near zero without pinning a stale verdict forever.
              "Cache-Control": "public, max-age=86400, s-maxage=86400",
            },
          });
        } catch (error) {
          console.error("OG image render failed", error);
          return new Response("Image render failed", { status: 500 });
        }
      },
    },
  },
});
