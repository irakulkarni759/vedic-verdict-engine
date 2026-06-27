import type { Verdict } from "@/data/trends";

export const VERDICT_META: Record<
  Verdict,
  { label: string; color: string; glowClass: string; dotClass: string; badgeClass: string }
> = {
  backed: {
    label: "Backed",
    color: "#0f6e6a",
    glowClass: "",
    dotClass: "bg-[#0f6e6a]",
    badgeClass: "bg-[#0f6e6a]/12 text-[#0f6e6a] border border-[#0f6e6a]/40",
  },
  mixed: {
    label: "Mixed",
    color: "#c98414",
    glowClass: "",
    dotClass: "bg-[#c98414]",
    badgeClass: "bg-[#c98414]/12 text-[#8a5a0d] border border-[#c98414]/40",
  },
  debunked: {
    label: "Debunked",
    color: "#b8442a",
    glowClass: "",
    dotClass: "bg-[#b8442a]",
    badgeClass: "bg-[#b8442a]/12 text-[#b8442a] border border-[#b8442a]/40",
  },
  unmapped: {
    label: "Unmapped",
    color: "#1e3a6e",
    glowClass: "",
    dotClass: "bg-[#1e3a6e]",
    badgeClass: "bg-[#1e3a6e]/12 text-[#1e3a6e] border border-[#1e3a6e]/40",
  },
};

export const VERDICT_FILTERS: { value: "all" | Verdict; label: string }[] = [
  { value: "all", label: "All" },
  { value: "backed", label: "Backed" },
  { value: "mixed", label: "Mixed" },
  { value: "debunked", label: "Debunked" },
  { value: "unmapped", label: "Unmapped" },
];

