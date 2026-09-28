/** Product category, used only to decide which facts are generic and which gaps matter. */

const RULES = [
  ["audio", /earbud|headphone|earphone|headset|\btws\b|airpod|speaker/i],
  ["phone", /smartphone|iphone|\bphone\b|pixel\s?\d|galaxy\s+[asz]/i],
  ["laptop", /laptop|notebook|macbook|chromebook/i],
  ["tv", /\btelevision\b|\btv\b|\boled\b|\bqled\b/i],
  ["power", /power\s?bank|powerbank|charger|adapter/i],
  ["kitchen", /blender|mixer|cooker|kettle|air\s?fryer|\bpan\b|knife|toaster/i],
  ["wearable", /smart\s?watch|\bwatch\b|fitness tracker|fitness band/i],
  ["skincare", /serum|moisturizer|moisturiser|sunscreen|cleanser|shampoo|cream\b/i],
  ["supplement", /supplement|vitamin|protein powder|\bcapsules?\b/i],
  ["apparel", /shirt|shoes|sneaker|jeans|jacket|\bdress\b|hoodie/i],
  ["tablet", /\bipad\b|android tablet|galaxy tab|\btablet\b/i],
];

export function detectCategory(scrape) {
  const text = [scrape?.title, scrape?.brand, ...(scrape?.breadcrumbs || [])].filter(Boolean).join(" ");
  for (const [id, pattern] of RULES) {
    if (pattern.test(text)) return id;
  }
  return "general";
}

/** Days below which a stated warranty is short for that category. Apparel often has none. */
export const WARRANTY_FLOOR_DAYS = {
  audio: 180,
  phone: 365,
  laptop: 365,
  tablet: 365,
  tv: 365,
  power: 180,
  kitchen: 180,
  wearable: 180,
  skincare: 0,
  supplement: 0,
  apparel: 0,
  general: 90,
};

export const EXPECTATIONS = {
  audio: [
    { id: "driver", label: "Driver size or speaker type", re: /\b\d+(?:\.\d+)?\s*mm\b|dynamic driver|planar|balanced armature/i },
    { id: "battery", label: "Battery life with the condition stated", re: /battery|playtime|playback|\b\d+\s*(?:h|hr|hrs|hours)\b/i },
    { id: "ingress", label: "Water or dust rating", re: /\bIP\d{2}\b/ },
    { id: "codec", label: "Codec support", re: /\b(?:ldac|aptx|aac|sbc|lc3|lhdc)\b/i },
    { id: "weight", label: "Weight", re: /\b\d+(?:\.\d+)?\s*(?:g|kg)\b/i },
  ],
  phone: [
    { id: "battery", label: "Battery capacity in mAh", re: /\b\d{3,5}\s*mAh\b/i },
    { id: "charge", label: "Charging wattage", re: /\b\d+(?:\.\d+)?\s*W\b/ },
    { id: "ingress", label: "Ingress rating", re: /\bIP\d{2}\b/ },
    { id: "updates", label: "OS update commitment", re: /update|years of (?:os|security)/i },
  ],
  laptop: [
    { id: "ram", label: "RAM amount", re: /\b\d+\s*GB\b.*\bRAM\b|\bRAM\b.*\b\d+\s*GB\b/i },
    { id: "storage", label: "Storage type and size", re: /\b(?:SSD|NVMe|HDD)\b/i },
    { id: "display", label: "Display resolution or brightness", re: /\b\d{3,4}\s*[x×]\s*\d{3,4}\b|\bnits?\b/i },
    { id: "battery", label: "Battery in watt-hours", re: /\b\d+(?:\.\d+)?\s*Wh\b/ },
    { id: "weight", label: "Weight", re: /\b\d+(?:\.\d+)?\s*(?:kg|g|lb|lbs)\b/i },
  ],
  power: [
    { id: "capacity", label: "Capacity in mAh or Wh", re: /\b\d{4,6}\s*mAh\b|\b\d+(?:\.\d+)?\s*Wh\b/i },
    { id: "power", label: "Output wattage", re: /\b\d+(?:\.\d+)?\s*W\b/ },
    { id: "ports", label: "Port types", re: /usb-?c|usb-?a|lightning/i },
    { id: "weight", label: "Weight", re: /\b\d+(?:\.\d+)?\s*(?:g|kg)\b/i },
  ],
  tv: [
    { id: "panel", label: "Panel type and size", re: /\b(?:oled|qled|mini-?led|lcd|led)\b|\b\d{2,3}\s*(?:inch|in|")/i },
    { id: "refresh", label: "Refresh rate", re: /\b\d{2,3}\s*Hz\b/ },
    { id: "hdr", label: "HDR format", re: /\b(?:HDR10|Dolby Vision|HLG)\b/i },
  ],
  kitchen: [
    { id: "material", label: "Material", re: /stainless|cast iron|borosilicate|ceramic|non-?stick/i },
    { id: "power", label: "Wattage", re: /\b\d+(?:\.\d+)?\s*W\b/ },
    { id: "capacity", label: "Capacity", re: /\b\d+(?:\.\d+)?\s*(?:l|ml|qt|cup)\b/i },
  ],
  wearable: [
    { id: "battery", label: "Battery life", re: /\b\d+\s*(?:h|hr|hrs|hours|days)\b/i },
    { id: "ingress", label: "Water rating", re: /\bIP\d{2}\b|ATM|5ATM/i },
    { id: "sensors", label: "Sensors actually named", re: /heart|spo2|gps|ecg/i },
  ],
  skincare: [
    { id: "ingredients", label: "Ingredient list or concentration", re: /\b\d+(?:\.\d+)?\s*%|ingredient|niacinamide|retinol|glycerin/i },
  ],
  supplement: [
    { id: "amount", label: "Amount per serving", re: /\b\d+(?:\.\d+)?\s*(?:mg|mcg|iu|g)\b/i },
  ],
  apparel: [
    { id: "fabric", label: "Fabric composition", re: /cotton|polyester|wool|linen|nylon|elastane|%\s*cotton/i },
  ],
  tablet: [
    { id: "display", label: "Display size and resolution", re: /\b\d+(?:\.\d+)?\s*(?:inch|in)\b|\b\d{3,4}\s*[x×]\s*\d{3,4}\b/i },
    { id: "battery", label: "Battery life or capacity", re: /battery|\b\d+\s*(?:h|hr|hrs|hours|mAh)\b/i },
  ],
  general: [],
};

export function categoryExpectations(category) {
  return EXPECTATIONS[category] || [];
}
