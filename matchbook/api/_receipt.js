// Reading a receipt photo with Claude (vision). The photo is sent once and never stored.
// Needs ANTHROPIC_API_KEY. Capped by DAILY_RECEIPT_LIMIT (default 100) a day.
import Anthropic from "@anthropic-ai/sdk";

const SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean", description: "false if this isn't a legible itemized receipt" },
    merchant: { type: "string", description: "the restaurant or bar name as printed, or empty" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: "integer", description: "quantity on the line (1 if not shown)" },
          unitPrice: { type: "number", description: "price of one unit in dollars" },
          lineTotal: { type: "number", description: "the line's printed total in dollars" },
        },
        required: ["name", "qty", "unitPrice", "lineTotal"],
        additionalProperties: false,
      },
    },
    subtotal: { type: "number", description: "subtotal before tax and tip, in dollars (0 if not printed)" },
    tax: { type: "number", description: "tax in dollars (0 if none)" },
    tipIncluded: { type: "boolean", description: "true only if a tip, gratuity or service charge is printed on the receipt" },
    tip: { type: "number", description: "the printed tip/gratuity/service charge in dollars (0 if none)" },
    total: { type: "number", description: "the printed total in dollars" },
  },
  required: ["readable", "merchant", "items", "subtotal", "tax", "tipIncluded", "tip", "total"],
  additionalProperties: false,
};

const PROMPT = `Read this restaurant or bar receipt and return its line items and totals.
- One entry per printed line item. Use the printed quantity; if a line shows "4 Bud Light 28.00", qty is 4, lineTotal 28.00 and unitPrice 7.00.
- Leave out discounts, payments, card info, change due and suggested-tip tables (those suggestion tables are not a tip).
- Modifiers with their own price (e.g. "+ add bacon 2.00") are separate items; free modifiers are not items.
- Amounts are in dollars as plain numbers. If something isn't printed, use 0.
- If the image isn't a legible itemized receipt, set readable to false and return an empty items list.`;

let client;
export async function readReceipt(base64, mediaType = "image/jpeg") {
  client ||= new Anthropic(); // reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL if set)
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: PROMPT }] }],
  });
  if (response.stop_reason === "refusal") throw Object.assign(new Error("refused"), { friendly: "Couldn't read that receipt. Type the total instead." });
  if (response.stop_reason === "max_tokens") throw Object.assign(new Error("max_tokens"), { friendly: "That receipt was too long to read. Type the total instead." });
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}
