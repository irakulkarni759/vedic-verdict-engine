import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getPersonalizedLine } from "@/lib/personalize.functions";
import { PROFILE_QUESTIONS, loadProfile } from "@/lib/profile";

// The "FOR YOU" strip on a verdict hero: with no saved profile it's a quiet
// CTA to the questionnaire; with one, it fetches the personalized line
// client-side after first paint (same pattern as CommunityQuotes — never
// blocks the page, and keeps the SSR'd page identical for everyone).

type FetchState =
  | { status: "idle" }
  | { status: "no-profile" }
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "done"; line: string; basedOn: string[] };

export function PersonalizeCard({
  slug,
  from,
  context,
}: {
  slug: string;
  /** Path of the page we're on, so /profile can send the visitor back. */
  from: string;
  /** Trend fields the server prompt needs — used as a fallback when a
   *  freshly-generated trend hasn't been persisted yet. */
  context: {
    name: string;
    verdict: string;
    oneLiner: string;
    safetyNote: string;
    category: string;
  };
}) {
  const [state, setState] = useState<FetchState>({ status: "idle" });

  useEffect(() => {
    const profile = loadProfile();
    if (!profile) {
      setState({ status: "no-profile" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    getPersonalizedLine({ data: { slug, profile, context } })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Generation unavailable (no API key, lookup miss) — show nothing
          // rather than an error; the page is complete without this line.
          setState({ status: "hidden" });
          return;
        }
        setState({ status: "done", line: res.line, basedOn: res.basedOn });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "hidden" });
      });

    return () => {
      cancelled = true;
    };
    // context is derived from the same trend as slug — keying on slug alone
    // avoids refetching when the parent re-renders with a fresh object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (state.status === "idle" || state.status === "hidden") return null;

  if (state.status === "no-profile") {
    return (
      <div className="mt-3.5">
        <Link
          to="/profile"
          search={{ from }}
          className="font-label inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs transition hover:opacity-70"
          style={{
            color: "var(--sage)",
            borderColor: "color-mix(in oklab, var(--sage) 45%, transparent)",
            backgroundColor: "color-mix(in oklab, var(--sage) 8%, transparent)",
          }}
        >
          ✦ GET A PERSONALIZED TAKE — 10 QUICK QUESTIONS
        </Link>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <p className="font-mono mt-3.5 text-xs text-[var(--muted-ink)]">
        Personalizing this verdict for you…
      </p>
    );
  }

  // Which answers drove the line, e.g. "BASED ON YOUR CLIMATE, SKIN TYPE".
  const basedOnLabels = state.basedOn
    .map((id) => PROFILE_QUESTIONS.find((q) => q.id === id)?.label)
    .filter((l): l is string => !!l);

  if (!state.line) {
    return (
      <p className="font-mono mt-3.5 text-xs text-[var(--muted-ink)]">
        Nothing in your profile changes this verdict.{" "}
        <Link
          to="/profile"
          search={{ from }}
          className="underline transition hover:text-[var(--terracotta)]"
        >
          edit profile
        </Link>
      </p>
    );
  }

  return (
    <div
      className="mt-3.5 max-w-3xl rounded-[14px] px-4 py-3"
      style={{ backgroundColor: "color-mix(in oklab, var(--sage) 10%, transparent)" }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
          ✦ FOR YOU
        </span>
        {basedOnLabels.length > 0 && (
          <span className="font-label text-[9px] text-[var(--muted-ink)]">
            BASED ON YOUR {basedOnLabels.join(", ").toUpperCase()}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{state.line}</p>

      <p className="font-mono mt-1.5 text-[10px] text-[var(--muted-ink)]">
        A consideration, not medical advice ·{" "}
        <Link
          to="/profile"
          search={{ from }}
          className="underline transition hover:text-[var(--terracotta)]"
        >
          edit profile
        </Link>
      </p>
    </div>
  );
}
