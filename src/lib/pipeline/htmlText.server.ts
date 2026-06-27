import { parseHTML } from "linkedom";

// Replaces the notebook's `scrape_page_text()` (requests + BeautifulSoup).
//
// KNOWN LIMITATION vs. the original pipeline: this only sees the HTML the
// server sends, not what JavaScript renders client-side. The notebook's
// Playwright step caught ingredient lists hidden in collapsed accordions/tabs
// that only populate after JS runs — that fidelity is genuinely lost here.
// Headless Chrome doesn't run in this deploy environment. Static-HTML sites
// (most ingredient databases, many brand pages) work fine; heavily
// JS-rendered storefronts may come back thin or empty.

const STRIP_TAGS = ["script", "style", "noscript", "svg", "header", "footer", "nav"];

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Fetch a page and return cleaned visible text. Returns "" on any failure. */
export async function scrapePageText(
  url: string,
  maxChars = 20000,
  timeoutMs = 20000,
): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return "";

    const html = await res.text();
    const { document } = parseHTML(html);

    for (const tag of STRIP_TAGS) {
      document.querySelectorAll(tag).forEach((el) => el.remove());
    }

    const text = (document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}
