import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  PROFILE_QUESTIONS,
  loadProfile,
  saveProfile,
  clearProfile,
  sanitizeProfile,
  type Profile,
} from "@/lib/profile";
import { joinWaitlist } from "@/lib/waitlist.functions";

// The ~10-question wellness profile behind the "FOR YOU" line on verdict
// pages. Answers live in localStorage (the runtime source of truth every
// verdict page reads). Visitors can also drop their email to join the
// waitlist for personalized suggestions — no account, no login.

export const Route = createFileRoute("/profile")({
  // ?from=/trend/xyz sends the visitor back to the verdict they came from
  // after saving. Only same-site paths are honored.
  validateSearch: (search: Record<string, unknown>): { from?: string } => {
    const from = typeof search.from === "string" ? search.from : undefined;
    return from && from.startsWith("/") && !from.startsWith("//") ? { from } : {};
  },

  head: () => ({
    meta: [
      { title: "Your wellness profile — Veda" },
      {
        name: "description",
        content: "Answer 10 quick questions to get a personalized take on every verdict.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),

  component: ProfilePage,
});

function ProfilePage() {
  const { from } = Route.useSearch();
  const navigate = useNavigate();

  const [answers, setAnswers] = useState<Profile>({});
  const [hadProfile, setHadProfile] = useState(false);
  const [saved, setSaved] = useState(false);

  // localStorage isn't available during SSR — hydrate answers after mount.
  useEffect(() => {
    const existing = loadProfile();
    if (existing) {
      setAnswers(existing);
      setHadProfile(true);
    }
  }, []);

  const answeredCount = Object.keys(sanitizeProfile(answers)).length;

  function selectSingle(id: string, value: string) {
    setSaved(false);
    setAnswers((prev) => {
      // Tapping the selected chip again clears that answer — every question
      // stays skippable.
      if (prev[id] === value) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: value };
    });
  }

  function toggleMulti(id: string, value: string) {
    setSaved(false);
    setAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      let next: string[];
      if (current.includes(value)) {
        next = current.filter((v) => v !== value);
      } else if (value === "none") {
        next = ["none"]; // "None" is exclusive of the actual issues
      } else {
        next = [...current.filter((v) => v !== "none"), value];
      }
      if (next.length === 0) {
        const rest = { ...prev };
        delete rest[id];
        return rest;
      }
      return { ...prev, [id]: next };
    });
  }

  function save() {
    saveProfile(answers);
    setSaved(true);
    setHadProfile(true);
    if (from) {
      navigate({ to: from });
    }
  }

  function reset() {
    clearProfile();
    setAnswers({});
    setHadProfile(false);
    setSaved(false);
  }

  return (
    <main className="min-h-screen bg-[var(--parchment)] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-[760px]">
        <Link
          to={from ?? "/"}
          className="font-label mb-6 inline-block text-xs text-[var(--muted-ink)] transition hover:text-[var(--terracotta)]"
        >
          {from ? "← BACK TO VERDICT" : "← BACK TO VEDA"}
        </Link>

        <section className="rounded-[26px] border border-white/70 bg-[linear-gradient(135deg,#fff_0%,#fbf4e8_100%)] p-6 shadow-[0_22px_70px_rgba(27,52,72,0.08)] sm:p-8">
          <p className="font-label text-xs text-[var(--sage)]">YOUR WELLNESS PROFILE</p>

          <h1 className="font-display mt-2 text-4xl leading-[0.95] tracking-[-0.04em] text-[var(--ink)] sm:text-5xl">
            Make every verdict about you
          </h1>

          <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted-ink)]">
            Ten quick questions. Every one is optional — answer what you like and each verdict page
            gets a line on what it means for someone like you.
          </p>

          <p className="font-mono mt-3 text-xs text-[var(--muted-ink)]">
            Answers stay on this device — they're never stored on our servers unless you join the
            monthly suggestions list below.
          </p>
        </section>

        <div className="mt-6 space-y-4">
          {PROFILE_QUESTIONS.map((q, qi) => {
            const raw = answers[q.id];
            const selected = new Set(Array.isArray(raw) ? raw : raw ? [raw] : []);
            return (
              <section
                key={q.id}
                className="rounded-[22px] border border-white/75 bg-white/90 p-6 shadow-[0_12px_35px_rgba(27,52,72,0.04)] sm:p-7"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-sm text-[var(--sage)]">
                    {String(qi + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p className="text-lg leading-7 text-[var(--ink)]">{q.prompt}</p>
                    {q.multi && (
                      <p className="font-label mt-0.5 text-[10px] text-[var(--muted-ink)]">
                        PICK ALL THAT APPLY
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {q.options.map((o) => {
                    const isOn = selected.has(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={isOn}
                        onClick={() =>
                          q.multi ? toggleMulti(q.id, o.value) : selectSingle(q.id, o.value)
                        }
                        className="font-label rounded-full border px-4 py-2 text-xs transition"
                        style={
                          isOn
                            ? {
                                color: "var(--terracotta)",
                                borderColor:
                                  "color-mix(in oklab, var(--terracotta) 55%, transparent)",
                                backgroundColor:
                                  "color-mix(in oklab, var(--terracotta) 12%, transparent)",
                              }
                            : {
                                color: "var(--muted-ink)",
                                borderColor: "color-mix(in oklab, var(--ink) 15%, transparent)",
                                backgroundColor: "transparent",
                              }
                        }
                      >
                        {isOn ? "✓ " : ""}
                        {o.label.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={save}
            disabled={answeredCount === 0}
            className="font-label rounded-full border px-6 py-3 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: "var(--parchment)",
              backgroundColor: "var(--terracotta)",
              borderColor: "var(--terracotta)",
            }}
          >
            {saved ? "SAVED ✓" : from ? "SAVE & BACK TO VERDICT" : "SAVE MY PROFILE"}
          </button>

          <p className="font-mono text-xs text-[var(--muted-ink)]">
            {answeredCount} of {PROFILE_QUESTIONS.length} answered
          </p>

          {hadProfile && (
            <button
              type="button"
              onClick={reset}
              className="font-label text-xs text-[var(--muted-ink)] underline transition hover:text-[var(--verdict-debunked)]"
            >
              CLEAR MY ANSWERS
            </button>
          )}
        </div>

        <WaitlistCard profile={answers} />

        <p className="font-mono mt-6 max-w-xl text-xs leading-5 text-[var(--muted-ink)]">
          Personalized lines are general considerations based on your answers — not medical advice.
          For anything health-related, talk to a professional who actually knows you.
        </p>
      </div>
    </main>
  );
}

/**
 * Waitlist signup for monthly personalized product suggestions. Placed after
 * the questions: the visitor answers, then opts in with their email if they
 * want a tailored monthly pick. On submit we save the current answers locally
 * too (so this device is personalized) and send email + answers snapshot to
 * the server. No account, no login. The hidden `website` field is a honeypot.
 */
function WaitlistCard({ profile }: { profile: Profile }) {
  const [value, setValue] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "joined">("idle");
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setError(null);
    setState("sending");
    // Joining implies they want their answers used — persist locally too so
    // the FOR YOU line works on this device even if they didn't hit Save.
    saveProfile(profile);
    const res = await joinWaitlist({ data: { email: value, profile, website } });
    if (res.ok) {
      setState("joined");
    } else {
      setState("idle");
      setError(res.error ?? "Couldn't join right now. Try again.");
    }
  }

  return (
    <section className="mt-4 rounded-[22px] border border-white/75 bg-white/90 p-6 shadow-[0_12px_35px_rgba(27,52,72,0.04)]">
      <p className="font-label text-[10px] text-[var(--sage)]">
        MONTHLY PERSONALIZED PRODUCT SUGGESTIONS
      </p>
      <p className="mt-1.5 text-sm leading-6 text-[var(--ink)]">
        Want product picks matched to your answers? Join the waitlist and we'll email you a
        personalized set of suggestions once a month. No spam, unsubscribe anytime.
      </p>

      {state === "joined" ? (
        <p className="font-mono mt-3 text-xs text-[var(--sage)]">
          ✓ You're on the list — we'll email your monthly suggestions to {value}.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Honeypot: visually hidden, off the tab order. Real users never fill it. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
          />
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@email.com"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) join();
            }}
            className="font-mono min-w-[220px] flex-1 rounded-full border px-4 py-2.5 text-sm text-[var(--ink)] outline-none"
            style={{
              borderColor: "color-mix(in oklab, var(--ink) 15%, transparent)",
              backgroundColor: "var(--parchment)",
            }}
          />
          <button
            type="button"
            onClick={join}
            disabled={state === "sending" || !value.trim()}
            className="font-label rounded-full border px-5 py-2.5 text-xs transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: "var(--parchment)",
              backgroundColor: "var(--sage)",
              borderColor: "var(--sage)",
            }}
          >
            {state === "sending" ? "JOINING…" : "JOIN THE WAITLIST"}
          </button>
        </div>
      )}

      {error && <p className="font-mono mt-2 text-xs text-[var(--verdict-debunked)]">{error}</p>}
    </section>
  );
}
