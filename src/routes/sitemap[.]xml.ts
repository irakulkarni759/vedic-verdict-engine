import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CATEGORIES, TRENDS, SITE_URL } from "@/lib/trends";
import { getSupabaseServiceClient } from "@/lib/supabase.server";

const BASE_URL = SITE_URL;

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
        ];

        for (const c of CATEGORIES) {
          entries.push({ path: `/category/${c.slug}`, changefreq: "weekly", priority: "0.8" });
        }

        for (const t of TRENDS) {
          entries.push({ path: `/trend/${t.slug}`, changefreq: "monthly", priority: "0.7" });
        }

        try {
          const supabase = getSupabaseServiceClient();
          const { data } = await supabase
            .from("generated_trends")
            .select("id")
            .neq("verdict", "unmapped");
          for (const row of (data as { id: string }[]) ?? []) {
            entries.push({ path: `/trend/${row.id}`, changefreq: "monthly", priority: "0.6" });
          }
        } catch {
          // Non-fatal — curated entries still ship.
        }

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
