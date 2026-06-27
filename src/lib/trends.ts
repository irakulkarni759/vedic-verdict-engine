export type Verdict = "BACKED" | "MIXED" | "DEBUNKED";

export type Trend = {
  slug: string;
  name: string;
  category: string; // matches CATEGORIES slugs
  verdict: Verdict;
  oneLiner: string;
  studies: number;
  confidence: "high" | "moderate" | "low";
  sentiment: number; // 0-100
  updated: string; // YYYY-MM-DD
  evidence: string[];
  quotes: { handle: string; text: string }[];
  related: string[]; // slugs
};

export const CATEGORIES = [
  { slug: "skincare", label: "SKINCARE" },
  { slug: "haircare", label: "HAIRCARE" },
  { slug: "supplements", label: "SUPPLEMENTS" },
  { slug: "nutrition", label: "NUTRITION" },
  { slug: "sleep", label: "SLEEP" },
  { slug: "gut-health", label: "GUT HEALTH" },
  { slug: "fitness", label: "FITNESS" },
  { slug: "mental-wellness", label: "MENTAL WELLNESS" },
];

export const TRENDS: Trend[] = [
  {
    slug: "daily-spf",
    name: "Daily SPF 30+ Sunscreen",
    category: "skincare",
    verdict: "BACKED",
    oneLiner: "Daily broad-spectrum sunscreen meaningfully reduces photoaging and skin-cancer risk.",
    studies: 142,
    confidence: "high",
    sentiment: 89,
    updated: "2026-05-14",
    evidence: [
      "Multiple RCTs show daily SPF use reduces visible photoaging within 12 months.",
      "Long-term cohort studies link daily use to lower rates of squamous cell carcinoma.",
      "Broad-spectrum formulas outperform UVB-only on pigmentation outcomes.",
      "Reapplication every ~2 hours sun exposure is required to retain stated SPF.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "The single highest ROI step in any routine." },
      { handle: "@skinlab", text: "Texture has finally caught up — no more white cast." },
    ],
    related: ["retinol", "vitamin-c-serum", "niacinamide"],
  },
  {
    slug: "retinol",
    name: "Retinoids for Wrinkles",
    category: "skincare",
    verdict: "BACKED",
    oneLiner: "Topical retinoids reliably reduce fine lines and improve skin texture over months.",
    studies: 96,
    confidence: "high",
    sentiment: 84,
    updated: "2026-04-22",
    evidence: [
      "Tretinoin shows the strongest evidence for wrinkle reduction across decades of trials.",
      "OTC retinol takes 12+ weeks to show measurable change in most users.",
      "Pairing with SPF is required — retinoids increase photosensitivity.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "Slow start, real results. Patience tax." },
      { handle: "@routinegeek", text: "Started at 0.025% — barely peeled, big payoff." },
    ],
    related: ["daily-spf", "vitamin-c-serum", "niacinamide"],
  },
  {
    slug: "vitamin-c-serum",
    name: "Vitamin C Serum",
    category: "skincare",
    verdict: "BACKED",
    oneLiner: "L-ascorbic acid at 10–20% brightens, supports collagen, and boosts SPF performance.",
    studies: 58,
    confidence: "moderate",
    sentiment: 78,
    updated: "2026-03-30",
    evidence: [
      "L-ascorbic acid 10–20% shows antioxidant and brightening effects in clinical trials.",
      "Formulation stability matters — opaque packaging and pH < 3.5 preserve potency.",
      "Pairs synergistically with sunscreen in photoprotection studies.",
    ],
    quotes: [
      { handle: "@skinlab", text: "Glow is real, but your serum oxidizing is realer." },
      { handle: "@routinegeek", text: "Worth it only if you actually use it before it browns." },
    ],
    related: ["daily-spf", "retinol", "niacinamide"],
  },
  {
    slug: "niacinamide",
    name: "Niacinamide for Redness",
    category: "skincare",
    verdict: "BACKED",
    oneLiner: "Topical niacinamide 4–5% reduces redness, sebum, and supports the skin barrier.",
    studies: 41,
    confidence: "moderate",
    sentiment: 81,
    updated: "2026-02-18",
    evidence: [
      "4–5% niacinamide reduces transepidermal water loss in barrier-compromised skin.",
      "Modest reduction in sebum production and pore appearance shown in trials.",
      "Plays well with almost everything — low irritation profile.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "The 'goes with anything' active." },
      { handle: "@skinlab", text: "Calmed my rosacea flare in two weeks." },
    ],
    related: ["daily-spf", "retinol", "vitamin-c-serum"],
  },
  {
    slug: "slugging",
    name: "Slugging",
    category: "skincare",
    verdict: "BACKED",
    oneLiner: "Sealing skin with petrolatum overnight reduces water loss for dry/compromised skin.",
    studies: 22,
    confidence: "moderate",
    sentiment: 74,
    updated: "2026-01-12",
    evidence: [
      "Petrolatum is the most effective occlusive in studies of TEWL reduction.",
      "Most useful in winter, post-procedure, or with eczema-prone skin.",
      "Not recommended for acne-prone skin without testing first.",
    ],
    quotes: [
      { handle: "@routinegeek", text: "Winter skin saver. Pillowcase tax accepted." },
      { handle: "@skinlab", text: "Tretinoin nights + slug = no more flaking." },
    ],
    related: ["retinol", "daily-spf", "snail-mucin"],
  },
  {
    slug: "snail-mucin",
    name: "Snail Mucin",
    category: "skincare",
    verdict: "BACKED",
    oneLiner: "Snail secretion filtrate shows real evidence for hydration and wound-repair markers.",
    studies: 19,
    confidence: "moderate",
    sentiment: 72,
    updated: "2025-12-08",
    evidence: [
      "Clinical studies show improvement in hydration and post-procedure recovery markers.",
      "Effects are real but modest vs. heavily marketed claims.",
      "Generally well tolerated; allergic reactions are rare but documented.",
    ],
    quotes: [
      { handle: "@skinlab", text: "Plumping is legit. Anti-aging claims, oversold." },
      { handle: "@routinegeek", text: "The K-beauty hype that actually held up." },
    ],
    related: ["niacinamide", "slugging", "hyaluronic-acid"],
  },
  {
    slug: "hyaluronic-acid",
    name: "Hyaluronic Acid",
    category: "skincare",
    verdict: "BACKED",
    oneLiner: "Topical HA hydrates the upper skin layers — apply to damp skin and seal.",
    studies: 64,
    confidence: "high",
    sentiment: 80,
    updated: "2026-04-02",
    evidence: [
      "Demonstrated humectant effect in stratum corneum hydration studies.",
      "Apply to damp skin and seal with moisturizer — dry-air application can backfire.",
      "Multiple molecular weights penetrate differently; impact on wrinkles is modest.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "Hydration, not a miracle. Use it correctly." },
      { handle: "@skinlab", text: "Apply on dry skin and it'll wick moisture out." },
    ],
    related: ["niacinamide", "snail-mucin", "daily-spf"],
  },
  {
    slug: "jade-roller",
    name: "Jade Roller",
    category: "skincare",
    verdict: "MIXED",
    oneLiner: "Brief de-puffing is real; structural skin benefits are not.",
    studies: 9,
    confidence: "low",
    sentiment: 52,
    updated: "2025-11-04",
    evidence: [
      "Cold massage temporarily reduces puffiness via vasoconstriction.",
      "No evidence for collagen stimulation or 'lymphatic drainage' claims.",
      "Cleanliness matters more than the stone — bacteria buildup is common.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "Fancy ice cube. Nothing more, nothing less." },
      { handle: "@skinlab", text: "Feels nice. That's the whole product." },
    ],
    related: ["gua-sha", "dry-brushing", "snail-mucin"],
  },
  {
    slug: "gua-sha",
    name: "Gua Sha",
    category: "skincare",
    verdict: "MIXED",
    oneLiner: "Temporary lift and de-puffing; lasting facial sculpting claims aren't supported.",
    studies: 11,
    confidence: "low",
    sentiment: 58,
    updated: "2025-10-21",
    evidence: [
      "Short-term de-puffing and improved circulation in small studies.",
      "No evidence for lasting jawline reshaping from facial gua sha.",
      "Technique matters — heavy pressure can bruise without benefit.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "Morning de-puff: yes. Bone restructuring: no." },
      { handle: "@routinegeek", text: "Treat it as massage, not surgery." },
    ],
    related: ["jade-roller", "dry-brushing", "snail-mucin"],
  },
  {
    slug: "activated-charcoal",
    name: "Activated Charcoal Masks",
    category: "skincare",
    verdict: "DEBUNKED",
    oneLiner: "Won't 'pull toxins.' Peel-off versions can damage your skin barrier.",
    studies: 14,
    confidence: "high",
    sentiment: 38,
    updated: "2026-01-30",
    evidence: [
      "No evidence charcoal masks remove toxins from skin or pores.",
      "Peel-off formulations can rip out vellus hair and damage stratum corneum.",
      "May reduce surface oil briefly but no lasting acne or pore benefit.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "Marketing fiction with peel-off pain." },
      { handle: "@skinlab", text: "Pulled out my eyebrow hairs once. Never again." },
    ],
    related: ["jade-roller", "dry-brushing", "gua-sha"],
  },
  {
    slug: "dry-brushing",
    name: "Dry Brushing",
    category: "skincare",
    verdict: "MIXED",
    oneLiner: "Mild exfoliation, real. Cellulite reduction and lymphatic detox claims, no.",
    studies: 7,
    confidence: "low",
    sentiment: 48,
    updated: "2025-09-10",
    evidence: [
      "Mechanical exfoliation can smooth skin temporarily.",
      "No reliable evidence for cellulite reduction or 'detox' effects.",
      "Aggressive use can damage skin barrier — light pressure only.",
    ],
    quotes: [
      { handle: "@routinegeek", text: "Feels invigorating. Does nothing for cellulite." },
    ],
    related: ["jade-roller", "gua-sha", "activated-charcoal"],
  },

  // HAIRCARE
  {
    slug: "rosemary-oil",
    name: "Rosemary Oil for Hair",
    category: "haircare",
    verdict: "MIXED",
    oneLiner: "One trial vs. minoxidil showed comparable results; broader evidence is thin.",
    studies: 12,
    confidence: "moderate",
    sentiment: 67,
    updated: "2026-02-04",
    evidence: [
      "A 2015 RCT showed comparable hair count to 2% minoxidil at 6 months.",
      "Replication is limited; mechanism is not fully understood.",
      "Generally safe; dilute in carrier oil to avoid scalp irritation.",
    ],
    quotes: [
      { handle: "@routinegeek", text: "Cheap to try, low downside. Manage expectations." },
      { handle: "@skinlab", text: "Worked for my thinning edges. n=1." },
    ],
    related: ["biotin", "collagen-peptides", "slugging"],
  },
  {
    slug: "biotin",
    name: "Biotin for Hair",
    category: "haircare",
    verdict: "MIXED",
    oneLiner: "Only helps if you're actually deficient — most people aren't.",
    studies: 18,
    confidence: "moderate",
    sentiment: 49,
    updated: "2026-03-01",
    evidence: [
      "Effective only in documented biotin deficiency, which is uncommon.",
      "Can interfere with lab tests including thyroid and cardiac markers.",
      "No evidence supplementation grows hair in non-deficient adults.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "Tell your doctor before bloodwork." },
    ],
    related: ["rosemary-oil", "collagen-peptides", "ashwagandha"],
  },

  // SUPPLEMENTS
  {
    slug: "collagen-peptides",
    name: "Collagen Peptides",
    category: "supplements",
    verdict: "BACKED",
    oneLiner: "10–15g/day shows modest improvements in skin elasticity and joint comfort.",
    studies: 73,
    confidence: "moderate",
    sentiment: 76,
    updated: "2026-04-15",
    evidence: [
      "Meta-analyses show modest improvement in skin elasticity at 8–12 weeks.",
      "Some evidence for joint discomfort reduction in active populations.",
      "Type and dose matter — hydrolyzed peptides at 10–15g/day are most studied.",
    ],
    quotes: [
      { handle: "@labnotes", text: "Real effect, modest size. Don't expect miracles." },
      { handle: "@routinegeek", text: "Hair and nails? Maybe. Joints? Yes." },
    ],
    related: ["creatine", "ashwagandha", "magnesium-sleep"],
  },
  {
    slug: "ashwagandha",
    name: "Ashwagandha",
    category: "supplements",
    verdict: "BACKED",
    oneLiner: "Clinically reduces self-reported stress and cortisol at 300–600mg/day.",
    studies: 47,
    confidence: "moderate",
    sentiment: 79,
    updated: "2026-03-19",
    evidence: [
      "RCTs show reductions in perceived stress and serum cortisol over 8 weeks.",
      "Effects on sleep quality and anxiety are consistent across studies.",
      "Avoid with thyroid medication and during pregnancy.",
    ],
    quotes: [
      { handle: "@labnotes", text: "One of the few adaptogens with real RCTs." },
      { handle: "@sleepdoc", text: "I sleep through the night now. First month was wild." },
    ],
    related: ["magnesium-sleep", "melatonin", "creatine"],
  },
  {
    slug: "creatine",
    name: "Creatine Monohydrate",
    category: "supplements",
    verdict: "BACKED",
    oneLiner: "The most-studied performance supplement. 3–5g/day, period.",
    studies: 218,
    confidence: "high",
    sentiment: 88,
    updated: "2026-05-02",
    evidence: [
      "Largest evidence base of any sports supplement; strength and lean mass gains.",
      "Emerging evidence for cognitive benefits under sleep deprivation.",
      "Loading phase is optional — 3–5g daily reaches saturation in ~4 weeks.",
    ],
    quotes: [
      { handle: "@labnotes", text: "If you take one supplement, take this." },
      { handle: "@gymsci", text: "Cheap, safe, works. Rare combo." },
    ],
    related: ["ashwagandha", "collagen-peptides", "magnesium-sleep"],
  },
  {
    slug: "melatonin",
    name: "Melatonin",
    category: "sleep",
    verdict: "BACKED",
    oneLiner: "Effective for jet lag and shift work at 0.3–0.5mg. Most OTC doses are way too high.",
    studies: 132,
    confidence: "high",
    sentiment: 71,
    updated: "2026-04-08",
    evidence: [
      "Strongest evidence for circadian shifts: jet lag, delayed sleep phase, shift work.",
      "Low doses (0.3–0.5mg) outperform 5–10mg doses in most trials.",
      "US OTC dosing is typically 10–20× the effective dose.",
    ],
    quotes: [
      { handle: "@sleepdoc", text: "Take less. Timing matters more than dose." },
    ],
    related: ["magnesium-sleep", "ashwagandha"],
  },
  {
    slug: "magnesium-sleep",
    name: "Magnesium for Sleep",
    category: "sleep",
    verdict: "BACKED",
    oneLiner: "Glycinate form, 200–400mg, modest but real sleep-quality improvements.",
    studies: 38,
    confidence: "moderate",
    sentiment: 75,
    updated: "2026-03-25",
    evidence: [
      "Magnesium glycinate shows modest improvements in sleep onset and quality.",
      "Most useful in adults with low dietary intake or elevated stress.",
      "Oxide form is poorly absorbed — use glycinate or threonate.",
    ],
    quotes: [
      { handle: "@sleepdoc", text: "Glycinate at dinner. Game changer for restless legs." },
    ],
    related: ["melatonin", "ashwagandha"],
  },

  // NUTRITION
  {
    slug: "celery-juice",
    name: "Celery Juice Detox",
    category: "nutrition",
    verdict: "DEBUNKED",
    oneLiner: "No 'detox' mechanism exists. You bought expensive celery water.",
    studies: 4,
    confidence: "high",
    sentiment: 22,
    updated: "2026-02-12",
    evidence: [
      "No clinical evidence supports any 'detox' claim for celery juice.",
      "Healthy livers and kidneys already detoxify — no juice required.",
      "Some benefit comes from added hydration and produce intake generally.",
    ],
    quotes: [
      { handle: "@labnotes", text: "Celery's fine. The mythology around it isn't." },
    ],
    related: ["activated-charcoal", "turmeric"],
  },
  {
    slug: "turmeric",
    name: "Turmeric for Inflammation",
    category: "nutrition",
    verdict: "BACKED",
    oneLiner: "Curcumin with piperine shows real anti-inflammatory effects in joint and metabolic studies.",
    studies: 89,
    confidence: "moderate",
    sentiment: 73,
    updated: "2026-04-19",
    evidence: [
      "Curcumin shows measurable reduction in CRP and joint pain across meta-analyses.",
      "Bioavailability is poor without piperine or lipid carriers.",
      "Effects are modest — not a substitute for NSAIDs in acute inflammation.",
    ],
    quotes: [
      { handle: "@labnotes", text: "Real, when formulated for absorption." },
    ],
    related: ["ashwagandha", "collagen-peptides"],
  },
  {
    slug: "intermittent-fasting",
    name: "Intermittent Fasting",
    category: "nutrition",
    verdict: "MIXED",
    oneLiner: "Works mainly through calorie reduction — no magic metabolic effect.",
    studies: 64,
    confidence: "moderate",
    sentiment: 60,
    updated: "2026-03-08",
    evidence: [
      "Most weight-loss benefit is from reduced caloric intake, not timing per se.",
      "Some metabolic markers improve, but matched-calorie comparisons show small effects.",
      "May worsen disordered eating patterns — not for everyone.",
    ],
    quotes: [
      { handle: "@labnotes", text: "Works if it works for your schedule. That's it." },
    ],
    related: ["creatine", "ashwagandha"],
  },
  {
    slug: "oil-pulling",
    name: "Oil Pulling",
    category: "gut-health",
    verdict: "DEBUNKED",
    oneLiner: "Doesn't whiten teeth or 'detox.' Brush, floss, repeat.",
    studies: 16,
    confidence: "high",
    sentiment: 29,
    updated: "2026-01-22",
    evidence: [
      "No reliable evidence for whitening or systemic detox claims.",
      "May slightly reduce plaque vs. nothing, but inferior to brushing and flossing.",
      "Linked to occasional lipoid pneumonia from accidental aspiration.",
    ],
    quotes: [
      { handle: "@derm_notes", text: "Brushing exists. Use it." },
    ],
    related: ["celery-juice", "activated-charcoal"],
  },
];

export function trendBySlug(slug: string): Trend | undefined {
  return TRENDS.find((t) => t.slug === slug);
}

export function trendsByCategory(slug: string): Trend[] {
  return TRENDS.filter((t) => t.category === slug);
}

export function categoryBySlug(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug);
}
