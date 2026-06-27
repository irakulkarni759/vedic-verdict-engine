import { tavilySearch, type SearchResult } from "./tavilySearch.server";
import { scrapePageText } from "./htmlText.server";
import { askClaude, parseClaudeJson } from "./anthropic.server";

// Ported from find_product_pages() / extract_product_info_from_text() /
// auto_extract_product_info() in the notebook.
//
// DROPPED vs. the original: the vision fallback (extract_product_info_from_image)
// and the screenshot step entirely — both depended on Playwright. If static
// text scraping comes back thin, this version just works with what it has
// rather than falling back to a screenshot + vision call.

const SKIP_DOMAINS = [
  "amazon.",
  "reddit.",
  "youtube.",
  "instagram.",
  "facebook.",
  "pinterest.",
  "tiktok.",
  "wikipedia.",
];

const INGREDIENT_DBS = ["incidecoder.com", "skincarisma.com", "cosdna.com"];

export type SubjectType = "product" | "device" | "practice" | "unknown";

export interface QueryClass {
  subject_type: SubjectType;
  modality: string; // for devices: the physical modality in scientific terms
}

// Cheap query-only classification BEFORE we search. This decides what we even
// search for: a device needs literature on its modality (microcurrent, LED,
// etc.) acting on skin — searching "<device> ingredients" first would drag the
// whole pipeline toward the ingredients of whatever serum it uses instead.
export async function classifyQuery(userQuery: string): Promise<QueryClass> {
  const prompt = `Classify this wellness/skincare query for an evidence pipeline. Return JSON only, no preamble:
{"subject_type":"product|device|practice","modality":"for a device only: its physical modality in scientific terms (e.g. 'microcurrent','iontophoresis','galvanic current','LED photobiomodulation','radiofrequency','ultrasound'); otherwise empty string"}

Query: ${userQuery}

- "device": a powered or physical skincare TOOL — microcurrent, EMS, a galvanic/ionic "booster"/"infuser"/"wand", LED/red-light, radiofrequency, ultrasonic, dermaroller. These work by a physical action on skin, not by a leave-on formulation.
- "product": a leave-on or rinse-off FORMULATION (serum, cream, mask, sunscreen, toner).
- "practice": a behaviour or routine (fasting, cold plunge, sauna, breathwork).
No explanation.`;

  const raw = await askClaude(prompt, 200);
  const parsed = parseClaudeJson<{ subject_type?: string; modality?: string }>(raw);
  const subject_type = (parsed?.subject_type as SubjectType) ?? "unknown";
  return {
    subject_type: ["product", "device", "practice"].includes(subject_type) ? subject_type : "product",
    modality: parsed?.modality ?? "",
  };
}

export async function findProductPages(
  userQuery: string,
  cls: QueryClass,
  maxResults = 6,
): Promise<SearchResult[]> {
  // Search strategy depends on what this actually is.
  const searchQueries =
    cls.subject_type === "device"
      ? [
          `${userQuery} how it works technology`,
          cls.modality ? `${cls.modality} skin clinical study` : `${userQuery} mechanism skin`,
          `${userQuery} ingredients`, // still capture any paired serum's actives
        ]
      : cls.subject_type === "practice"
        ? [`${userQuery} how it works`, `${userQuery} effects study`]
        : [`${userQuery} ingredients`, `${userQuery} INCI ingredients list`];

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const q of searchQueries) {
    const found = await tavilySearch(q, maxResults);
    for (const r of found) {
      if (!r.url || seen.has(r.url)) continue;
      if (SKIP_DOMAINS.some((d) => r.url.includes(d))) continue;
      seen.add(r.url);
      results.push(r);
    }
  }

  // Only float ingredient databases to the front for actual formulations —
  // for a device those pages would crowd out the how-it-works sources.
  if (cls.subject_type === "product") {
    results.sort((a, b) => {
      const aScore = INGREDIENT_DBS.some((d) => a.url.includes(d)) ? 0 : 1;
      const bScore = INGREDIENT_DBS.some((d) => b.url.includes(d)) ? 0 : 1;
      return aScore - bScore;
    });
  }

  return results.slice(0, 8);
}

export interface ProductInfo {
  subject_type: SubjectType;
  subject: string;
  claim: string;
  ingredients: string[];
  ingredient_benefits: Record<string, string>;
  mechanisms: string[];
  confidence: "high" | "medium" | "low";
  notes: string;
  source_urls: string[];
}

interface RawProductInfo {
  subject_type?: string;
  subject?: string;
  claim?: string;
  ingredients?: string[];
  ingredient_benefits?: Record<string, string>;
  mechanisms?: string[];
  confidence?: string;
  notes?: string;
}

export async function extractProductInfoFromText(
  userQuery: string,
  scrapedTexts: string[],
  cls?: QueryClass,
): Promise<ProductInfo> {
  const combinedText = scrapedTexts.join("\n\n").slice(0, 45000);
  const classHint = cls
    ? `\nPreliminary classification (trust this unless the text clearly contradicts it): subject_type=${cls.subject_type}${cls.modality ? `, modality=${cls.modality}` : ""}\n`
    : "";
  const prompt = `You are extracting product evidence information for Veda.
User query:
${userQuery}${classHint}
Website text:
${combinedText}
Return valid JSON only:
{
  "subject_type": "product, device, or practice",
  "subject": "the product name OR the practice name (e.g. 'cold water immersion')",
  "claim": "the effect being evaluated, phrased neutrally (e.g. 'lowers cortisol / reduces stress')",
  "ingredients": [],
  "ingredient_benefits": {},
  "mechanisms": [],
  "confidence": "high/medium/low",
  "notes": ""
}
Rules:
- subject_type is "device" when the subject is a powered or physical skincare TOOL — microcurrent, EMS, galvanic/ionic infuser, LED / red-light, radiofrequency, ultrasonic, dermaroller, etc. A "booster", "infuser", or "wand" that drives serum into skin via current or light is a DEVICE, not a serum.
- subject_type is "product" for a leave-on / rinse-off FORMULATION with an ingredient list and no device action. Use "practice" only when there is NO product and NO device (cold plunging, fasting, sauna, breathwork, etc.).
- For a DEVICE, the mechanisms MUST name the physical modality and how it acts on skin — e.g. "microcurrent stimulation", "galvanic / iontophoretic current enhancing transdermal absorption", "LED photobiomodulation", "radiofrequency dermal heating". Do NOT reduce a device to just the ingredients of a serum it uses; the device's own mode of action is the primary thing to evaluate. List any serum ingredients separately in "ingredients" if present, but mechanisms lead with the device action.
- subject is the specific item being evaluated (e.g. "Medicube Booster Pro", "Laneige Lip Sleeping Mask"), not a generic category.
- claim is the effect/benefit being evaluated, stated neutrally - NOT attributed to a brand.
- Extract the FULL ingredient list when one is present (INCI lists, "Ingredients:" blocks). Do NOT limit to "key actives" - capture every ingredient you can read, in order.
- Ignore site navigation, promotions, rewards, shipping, and login text; extract only from the product/ingredient content.
- Always populate mechanisms (how the subject plausibly produces the claimed effect).`;

  const raw = await askClaude(prompt, 1000);
  const parsed = parseClaudeJson<RawProductInfo>(raw);

  if (parsed) {
    return {
      subject_type: (parsed.subject_type as SubjectType) ?? "product",
      subject: parsed.subject ?? "",
      claim: parsed.claim ?? userQuery,
      ingredients: parsed.ingredients ?? [],
      ingredient_benefits: parsed.ingredient_benefits ?? {},
      mechanisms: parsed.mechanisms ?? [],
      confidence: (parsed.confidence as ProductInfo["confidence"]) ?? "low",
      notes: parsed.notes ?? "",
      source_urls: [],
    };
  }

  return {
    subject_type: "product",
    subject: "",
    claim: userQuery,
    ingredients: [],
    ingredient_benefits: {},
    mechanisms: [],
    confidence: "low",
    notes: raw,
    source_urls: [],
  };
}

export async function autoExtractProductInfo(userQuery: string): Promise<ProductInfo> {
  const cls = await classifyQuery(userQuery);
  const pages = await findProductPages(userQuery, cls);

  if (pages.length === 0) {
    return {
      subject_type: "unknown",
      subject: userQuery,
      claim: userQuery,
      ingredients: [],
      ingredient_benefits: {},
      mechanisms: [],
      confidence: "low",
      notes: "No product pages retrieved (search returned nothing).",
      source_urls: [],
    };
  }

  // Prefer Tavily's server-side extracted text — it reads JS-rendered brand
  // pages (Shopify storefronts, etc.) that our static scraper can't. Fall back
  // to a direct scrape only when Tavily returned no content for that page.
  const candidates = pages.slice(0, 3);
  const scrapedTexts: string[] = [];
  for (const r of candidates) {
    let text = (r.rawContent ?? "").trim();
    if (!text) text = await scrapePageText(r.url);
    if (text) scrapedTexts.push(`SOURCE: ${r.url}\n${text.slice(0, 15000)}`);
  }

  const info = await extractProductInfoFromText(userQuery, scrapedTexts, cls);
  info.source_urls = pages.map((r) => r.url);
  return info;
}
