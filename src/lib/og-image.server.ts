import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { Trend, Verdict } from "./trends";

// 1200x630 is the size Twitter/Slack/iMessage/Facebook expect for a
// summary_large_image card. Anything else gets letterboxed or cropped.
const WIDTH = 1200;
const HEIGHT = 630;

const PARCHMENT = "#F5DDE0";
const CARD_TOP = "#ffffff";
const CARD_BOTTOM = "#fbf4e8";
const INK = "#1B3448";
const MUTED_INK = "#8A7060";

// Same values as --verdict-* in styles.css — keep in sync.
const VERDICT_COLOR: Record<Verdict, string> = {
  BACKED: "#3D6045",
  MIXED: "#B5861A",
  DEBUNKED: "#9B2A1A",
};

// resvg's wasm and the two font buffers are all fetched once and reused across
// requests — the module lives for the lifetime of the worker isolate, so the
// second and later OG requests skip every network round-trip below.
let wasmReady: Promise<void> | undefined;
function ensureWasm(origin: string): Promise<void> {
  // The .wasm ships as a public asset (see public/resvg.wasm); fetching it by
  // URL works the same in Node dev and on the Cloudflare Workers runtime,
  // which is why this doesn't `import` the binary directly.
  if (!wasmReady) {
    wasmReady = initWasm(fetch(new URL("/resvg.wasm", origin))).catch((err: unknown) => {
      // resvg keeps a module-global "initialized" flag that our `wasmReady`
      // promise can't see across a dev hot-reload — the module re-evaluates
      // (resetting wasmReady) while the wasm stays live, so the next init
      // throws "Already initialized". That state is fine; only rethrow real
      // failures.
      if (err instanceof Error && err.message.includes("Already initialized")) return;
      wasmReady = undefined; // let a genuine failure be retried on the next request
      throw err;
    });
  }
  return wasmReady;
}

type FontBuf = ArrayBuffer;
let fontsPromise: Promise<{ display: FontBuf; label: FontBuf }> | undefined;

// Google Fonts serves plain woff (which satori can read) instead of woff2 when
// the requesting UA looks old enough not to support woff2. That's the whole
// reason for the fake User-Agent — with a modern UA this returns woff2, which
// satori cannot parse.
const LEGACY_UA =
  "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/40.0 Safari/537.36";

async function fetchGoogleFont(cssUrl: string): Promise<ArrayBuffer> {
  const css = await fetch(cssUrl, { headers: { "User-Agent": LEGACY_UA } }).then((r) => r.text());
  // The response has one @font-face per unicode subset (latin, latin-ext,
  // cyrillic…). We only need the base "latin" block — it covers ASCII, which
  // is all the card text uses — so grab the woff url that follows the /* latin */
  // marker, falling back to the first woff url if the markers ever change.
  const url =
    css.match(/\/\*\s*latin\s*\*\/[\s\S]*?src:\s*url\(([^)]+)\)\s*format\('woff'\)/)?.[1] ??
    css.match(/src:\s*url\(([^)]+)\)\s*format\('woff'\)/)?.[1];
  if (!url) throw new Error(`No woff source found in Google Fonts CSS: ${cssUrl}`);
  return fetch(url).then((r) => r.arrayBuffer());
}

function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      // Cormorant Garamond is the display face (--font-display); the headline
      // uses its semibold weight to match the site.
      fetchGoogleFont("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600"),
      fetchGoogleFont("https://fonts.googleapis.com/css2?family=DM+Sans:wght@500"),
    ]).then(([display, label]) => ({ display, label }));
  }
  return fontsPromise;
}

type Node = {
  type: string;
  props: { style?: Record<string, unknown>; children?: unknown; [k: string]: unknown };
};
const el = (type: string, props: Node["props"]): Node => ({ type, props });

function cardTree(trend: Trend): Node {
  const verdictColor = VERDICT_COLOR[trend.verdict] ?? MUTED_INK;
  const category = trend.category.replace(/-/g, " ").toUpperCase();

  return el("div", {
    style: {
      width: WIDTH,
      height: HEIGHT,
      display: "flex",
      padding: 56,
      backgroundColor: PARCHMENT,
      fontFamily: "DM Sans",
    },
    children: el("div", {
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        borderRadius: 32,
        padding: "56px 60px",
        backgroundImage: `linear-gradient(135deg, ${CARD_TOP} 0%, ${CARD_BOTTOM} 100%)`,
        border: "1px solid rgba(255,255,255,0.7)",
      },
      children: [
        el("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 28,
          },
          children: [
            el("div", {
              style: {
                fontFamily: "DM Sans",
                fontSize: 22,
                letterSpacing: 3,
                color: MUTED_INK,
              },
              children: category,
            }),
            el("div", {
              style: {
                display: "flex",
                fontFamily: "DM Sans",
                fontSize: 26,
                color: verdictColor,
                border: `2px solid ${verdictColor}55`,
                backgroundColor: `${verdictColor}1a`,
                borderRadius: 999,
                padding: "10px 28px",
              },
              children: `• ${trend.verdict}`,
            }),
          ],
        }),
        el("div", {
          style: {
            display: "flex",
            fontFamily: "Cormorant Garamond",
            fontSize: 92,
            lineHeight: 1,
            letterSpacing: -2,
            color: INK,
            marginBottom: 28,
          },
          children: trend.name,
        }),
        el("div", {
          style: {
            display: "flex",
            fontFamily: "DM Sans",
            fontSize: 30,
            lineHeight: 1.4,
            color: "#5f5245",
          },
          children: trend.oneLiner,
        }),
        el("div", { style: { display: "flex", flex: 1 }, children: "" }),
        el("div", {
          style: {
            display: "flex",
            fontFamily: "DM Sans",
            fontSize: 24,
            letterSpacing: 1,
            color: MUTED_INK,
          },
          children: "veda — evidence over hype",
        }),
      ],
    }),
  });
}

/** Renders a trend's verdict card to a PNG buffer for use as an OG image.
 *  `origin` is the request origin (e.g. https://…lovable.app) — used to fetch
 *  the bundled resvg wasm asset. */
export async function renderTrendOgPng(trend: Trend, origin: string): Promise<Uint8Array> {
  const [{ display, label }] = await Promise.all([loadFonts(), ensureWasm(origin)]);

  const svg = await satori(cardTree(trend) as never, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: "Cormorant Garamond", data: display, weight: 600, style: "normal" },
      { name: "DM Sans", data: label, weight: 500, style: "normal" },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } });
  return resvg.render().asPng();
}
