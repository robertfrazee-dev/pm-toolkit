// Turns a sentence like "I want cheap wings at a sports bar in Hoboken, open now" into a search:
// { query: "wings at a sports bar", area: "Hoboken", maxPrice: 1, openNow: true }

const FILLER = /^(?:(?:i|we)(?:'m| am|'re| are)? (?:really )?(?:want(?:ing)?|craving|feeling|in the mood for|looking for|thinking|down for)(?: to)?(?: (?:go|get|grab|find|try|eat|have|do))?(?: (?:to|at|for))?|(?:i|we)(?:'d| would) (?:like|love)(?: to)?(?: (?:go|get|grab|find|try|eat|have|do))?(?: (?:to|at|for))?|let'?s (?:go|get|grab|find|try|do|eat)(?: (?:to|at|for))?|find (?:me|us)|show (?:me|us))\s+/i;
const LEADING_ARTICLE = /^(?:some|a|an)\s+/i;
const CHEAP = /\b(?:cheap|inexpensive|budget|on a budget|dirt cheap)\b/i;
const MID = /\b(?:not too (?:expensive|pricey|fancy)|affordable|reasonabl[ey](?: priced)?|mid-?range)\b/i;
const OPEN_NOW = /\b(?:open (?:right )?now|right now|that'?s open|still open)\b/i;
// "in/near/around <place>", but not "in a sports bar" or "with a view".
const PLACE_WORDS = /\b(?:bar|bars|pub|restaurant|spot|place|joint|cafe|café|lounge|club|venue|setting|mood|vibe|group|crowd|backyard|patio|rooftop|garden|booth|basement)\b/i;
// "by the water", "near the beach": a setting, not somewhere we can look up.
const NOT_AN_AREA = /^(?:the\s+)?(?:water|waterfront|beach|river|ocean|lake|bay|harbor|park|station|subway|train|office|house|apartment|hotel)$/i;
const AREA = /\b(?:in|near|around|by)\s+((?:the\s+)?[A-Za-z0-9][A-Za-z0-9 .'&-]*?)(?=\s*(?:,|\.|!|\?|$|\b(?:under|that|with|open|for|tonight|today|right|please|and)\b))/gi;

export function parseMood(text) {
  let s = String(text || "").replace(/\s+/g, " ").trim();
  const out = { query: "", area: "", maxPrice: 0, openNow: false };
  if (!s) return out;

  if (OPEN_NOW.test(s)) { out.openNow = true; s = s.replace(OPEN_NOW, " "); }
  if (CHEAP.test(s)) { out.maxPrice = 1; s = s.replace(CHEAP, " "); }
  else if (MID.test(s)) { out.maxPrice = 2; s = s.replace(MID, " "); }

  for (const m of s.matchAll(AREA)) {
    const place = m[1].trim();
    if (place && !PLACE_WORDS.test(place) && !/^(?:a|an)\b/i.test(place) && !NOT_AN_AREA.test(place)) {
      out.area = place;
      s = s.replace(m[0], " ");
      break;
    }
  }

  s = s.replace(/\s+/g, " ").replace(/^[\s,.!?-]+|[\s,.!?-]+$/g, "").trim();
  for (let i = 0; i < 2; i++) s = s.replace(FILLER, "").replace(LEADING_ARTICLE, "").trim();
  out.query = s.replace(/\s+(?:please|pls|plz)$/i, "").trim();
  return out;
}
