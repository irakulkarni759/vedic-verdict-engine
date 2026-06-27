import { XMLParser } from "fast-xml-parser";
import { askClaude, parseClaudeJson } from "./anthropic.server";

// Ported from search_pubmed() / fetch_pubmed() / expand_search_terms() /
// build_pubmed_queries() / run_pubmed_layers() in the notebook. The E-utilities
// REST API is plain HTTP/XML — no browser, no special runtime needs — so this
// translates over cleanly.

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/** PubMed's XML is inconsistent about which nodes carry attributes, so a
 * given field shows up as either a plain string or `{ "#text": "..." }`. */
function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && node !== null && "#text" in node) {
    return String((node as { "#text": unknown })["#text"]);
  }
  return "";
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export interface PubmedPaper {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  publication_types: string[];
  abstract: string;
}

export async function searchPubmed(
  query: string,
  retmax = 20,
): Promise<{ ids: string[]; total: number }> {
  const url = new URL(BASE + "esearch.fcgi");
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("term", query);
  url.searchParams.set("retmode", "json");
  url.searchParams.set("retmax", String(retmax));
  url.searchParams.set("sort", "relevance");

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`PubMed esearch failed: ${res.status}`);

  const json = (await res.json()) as {
    esearchresult?: { idlist?: string[]; count?: string };
  };
  const ids = json.esearchresult?.idlist ?? [];
  const total = parseInt(json.esearchresult?.count ?? "0", 10);
  return { ids, total };
}

export async function fetchPubmed(ids: string[]): Promise<PubmedPaper[]> {
  if (ids.length === 0) return [];

  const url = new URL(BASE + "efetch.fcgi");
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("retmode", "xml");

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`PubMed efetch failed: ${res.status}`);

  const xml = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = xmlParser.parse(xml) as any;
  const articles = asArray(parsed?.PubmedArticleSet?.PubmedArticle);

  const papers: PubmedPaper[] = [];
  for (const article of articles) {
    const medline = article?.MedlineCitation;
    const art = medline?.Article;
    if (!art) continue;

    const title = textOf(art.ArticleTitle);
    const pmid = textOf(medline?.PMID);
    const journal = textOf(art.Journal?.Title);
    const year =
      textOf(art.Journal?.JournalIssue?.PubDate?.Year) ||
      textOf(art.Journal?.JournalIssue?.PubDate?.MedlineDate).slice(0, 4);

    const abstractParts = asArray(art.Abstract?.AbstractText).map(textOf).filter(Boolean);
    const abstract = abstractParts.join(" ");

    const publicationTypes = asArray(art.PublicationTypeList?.PublicationType)
      .map(textOf)
      .filter(Boolean);

    if (abstract) {
      papers.push({ pmid, title, journal, year, publication_types: publicationTypes, abstract });
    }
  }
  return papers;
}

function pubmedOrTerms(terms: string[]): string {
  return terms
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `"${t}"[Title/Abstract]`)
    .join(" OR ");
}

export interface ExpandedTerms {
  subject_terms: string[];
  claim_terms: string[];
  mechanism_terms: string[];
}

interface SubjectForExpansion {
  subject: string;
  claim: string;
  mechanisms: string[];
}

export async function expandSearchTerms(info: SubjectForExpansion): Promise<ExpandedTerms> {
  const prompt = `Translate consumer wellness language into the scientific terms PubMed uses.

Subject: ${info.subject}
Claimed effect: ${info.claim}
Proposed mechanisms: ${JSON.stringify(info.mechanisms)}

Return valid JSON only, no preamble:
{
  "subject_terms": ["scientific/MeSH synonyms for the subject, e.g. 'cold water immersion', 'cold exposure', 'cryotherapy'"],
  "claim_terms": ["scientific synonyms for the claimed effect, e.g. 'cortisol', 'psychological stress', 'mood', 'anxiety'"],
  "mechanism_terms": ["scientific synonyms for the mechanisms, e.g. 'autonomic nervous system', 'parasympathetic', 'sympathetic'"]
}

Rules:
- Use terminology that appears in peer-reviewed titles/abstracts, not marketing words.
- ALWAYS include the clinical/intervention name even for consumer DEVICES. Examples:
  "vibration plate" -> "whole-body vibration", "whole-body vibration training", "vibration therapy";
  "red light mask" -> "photobiomodulation", "low-level light therapy";
  "cold plunge" -> "cold water immersion", "cold exposure", "cryotherapy".
- The device/practice itself is the subject - generate subject_terms for it even if it has no ingredients.
- 3-6 terms per list. No explanations.`;

  const raw = await askClaude(prompt, 600);
  const exp = parseClaudeJson<Partial<ExpandedTerms>>(raw) ?? {};

  const subjectTerms = exp.subject_terms ?? [];
  const claimTerms = exp.claim_terms ?? [];
  const mechanismTerms = exp.mechanism_terms ?? [];

  if (info.subject && !subjectTerms.includes(info.subject)) subjectTerms.push(info.subject);
  if (info.claim && !claimTerms.includes(info.claim)) claimTerms.push(info.claim);
  for (const m of info.mechanisms) if (!mechanismTerms.includes(m)) mechanismTerms.push(m);

  return { subject_terms: subjectTerms, claim_terms: claimTerms, mechanism_terms: mechanismTerms };
}

interface ProductInfoForQueries {
  ingredients: string[];
}

export function buildPubmedQueries(
  productInfo: ProductInfoForQueries,
  expanded: ExpandedTerms,
): Record<string, string> {
  const {
    subject_terms: subjectTerms,
    claim_terms: claimTerms,
    mechanism_terms: mechanismTerms,
  } = expanded;
  const ingredients = productInfo.ingredients ?? [];
  const queries: Record<string, string> = {};

  // Direct: does the subject itself (product or practice) affect the claim?
  if (subjectTerms.length && claimTerms.length) {
    queries["Direct evidence"] =
      `(${pubmedOrTerms(subjectTerms)}) AND (${pubmedOrTerms(claimTerms)})`;
  }

  // Ingredient layers only for products that actually have ingredients
  if (ingredients.length && claimTerms.length) {
    queries["Ingredient-to-claim evidence"] =
      `(${pubmedOrTerms(ingredients)}) AND (${pubmedOrTerms(claimTerms)})`;
  }
  if (ingredients.length && mechanismTerms.length) {
    queries["Ingredient-to-mechanism evidence"] =
      `(${pubmedOrTerms(ingredients)}) AND (${pubmedOrTerms(mechanismTerms)})`;
  }

  // Mechanism-to-claim: applies to both, carries the weight for practices
  if (mechanismTerms.length && claimTerms.length) {
    queries["Mechanism-to-claim evidence"] =
      `(${pubmedOrTerms(mechanismTerms)}) AND (${pubmedOrTerms(claimTerms)})`;
  }

  return queries;
}

export interface EvidenceLayer {
  label: string;
  query: string;
  total_matches: number;
  papers: PubmedPaper[];
  error?: string;
}

interface ProductInfoForLayers {
  subject: string;
  claim: string;
  mechanisms: string[];
  ingredients: string[];
}

/** Runs all applicable evidence layers concurrently (Promise.all instead of
 * the notebook's ThreadPoolExecutor) and never throws — a failed layer
 * degrades to zero results rather than failing the whole pipeline. */
export async function runPubmedLayers(productInfo: ProductInfoForLayers): Promise<EvidenceLayer[]> {
  const expanded = await expandSearchTerms(productInfo);
  const queries = buildPubmedQueries(productInfo, expanded);

  const entries = Object.entries(queries);
  return Promise.all(
    entries.map(async ([label, query]): Promise<EvidenceLayer> => {
      try {
        const { ids, total } = await searchPubmed(query);
        const papers = await fetchPubmed(ids);
        return { label, query, total_matches: total, papers };
      } catch (e) {
        return {
          label,
          query,
          total_matches: 0,
          papers: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
}
