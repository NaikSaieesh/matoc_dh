/**
 * Port of ai_services.py: Weighted Rule-Based + NAICS SAM.gov Project Type Classifier
 */

export const PROJECT_TYPES = [
  "Building Renovation",
  "HVAC",
  "Roofing",
  "Electrical",
  "Plumbing",
  "Fire Protection",
  "Doors and Windows",
  "Site Work",
  "Interior Renovation",
  "General Maintenance",
  "New Construction",
  "Demolition",
  "Environmental Abatement",
  "Elevators and Conveying",
  "Security and Communications",
  "Other",
];

type RuleDef = [string, number];

const RULES: Record<string, RuleDef[]> = {
  "HVAC": [
    [String.raw`\bhvac-?r?\b`, 5],
    [String.raw`\bair\s+condition\w*`, 5],
    [String.raw`\bair\s+handl\w*`, 5],
    [String.raw`\bchiller\w*`, 5],
    [String.raw`\bboiler\w*`, 5],
    [String.raw`\bfurnace\w*`, 4],
    [String.raw`\bcooling\s+tower\w*`, 5],
    [String.raw`\bheat\s+pump\w*`, 5],
    [String.raw`\brooftop\s+unit\w*`, 5],
    [String.raw`\b(ahu|vav|rtu|vrf|vrv|ddc)\b`, 4],
    [String.raw`\bfan\s+coil\w*`, 5],
    [String.raw`\bmake-?\s*up\s+air\b`, 4],
    [String.raw`\bductwork\b`, 4],
    [String.raw`\bduct(s|ing)?\b`, 3],
    [String.raw`\bventilat\w*`, 3],
    [String.raw`\bheating\b`, 3],
    [String.raw`\bcooling\b`, 3],
    [String.raw`\brefrigerat\w*`, 3],
    [String.raw`\bthermostat\w*`, 3],
    [String.raw`\bdampers?\b`, 2],
    [String.raw`\bcompressor\w*`, 2],
    [String.raw`\bcondenser\w*`, 3],
    [String.raw`\bevaporator\w*`, 3],
    [String.raw`\bexhaust\s+fan\w*`, 3],
    [String.raw`\bhvac\s+control\w*`, 5],
    [String.raw`\bpneumatic\s+control\w*`, 3],
    [String.raw`\bbuilding\s+automation\b`, 3],
    [String.raw`\bfire\s+damper\w*`, -3],
  ],
  "Fire Protection": [
    [String.raw`\bfire\s+(suppression|sprinkler\w*|alarm\w*|protection|extinguish\w*|pump\w*|detect\w*|hydrant\w*|riser\w*)`, 6],
    [String.raw`\bsprinkler\w*`, 5],
    [String.raw`\bmass\s+notification\b`, 4],
    [String.raw`\b(wet|dry)\s+pipe\s+(system|sprinkler)\w*`, 5],
    [String.raw`\bdeluge\b`, 4],
    [String.raw`\bfm-?200\b`, 5],
    [String.raw`\bclean\s+agent\b`, 4],
    [String.raw`\bfire\s*stop\w*`, 4],
    [String.raw`\bfire\s+barrier\w*`, 4],
    [String.raw`\bfire\s+damper\w*`, 3],
    [String.raw`\blife\s+safety\s+system\w*`, 4],
    [String.raw`\bsmoke\s+(detect|alarm|evacuat)\w*`, 4],
    [String.raw`\bfire\s+door\w*`, -5],
  ],
  "Roofing": [
    [String.raw`\bre-?roof\w*`, 6],
    [String.raw`\broof(ing|s)?\b`, 5],
    [String.raw`\bmembrane\s+roof\w*`, 6],
    [String.raw`\broof\s+(coating|deck|leak|repair|replacement)\w*`, 6],
    [String.raw`\bshingle\w*`, 5],
    [String.raw`\bparapet\w*`, 3],
    [String.raw`\b(epdm|tpo)\b`, 5],
    [String.raw`\bbuilt-?up\s+roof\w*`, 6],
    [String.raw`\bstanding\s+seam\b`, 5],
    [String.raw`\bflashing\b`, 3],
    [String.raw`\bgutter\w*`, 3],
    [String.raw`\bdownspout\w*`, 3],
    [String.raw`\bsoffit\w*`, 2],
    [String.raw`\bfascia\b`, 2],
    [String.raw`\broof\s*top\s+unit\w*`, -6],
    [String.raw`\broof\s*top\s+(hvac|air)\w*`, -4],
  ],
  "Electrical": [
    [String.raw`\belectric(al)?\b`, 4],
    [String.raw`\bwiring\b`, 4],
    [String.raw`\bswitchgear\b`, 5],
    [String.raw`\bswitchboard\w*`, 5],
    [String.raw`\bpanelboard\w*`, 5],
    [String.raw`\bcircuit\s+breaker\w*`, 5],
    [String.raw`\btransformer\w*`, 4],
    [String.raw`\bgenerator\w*`, 4],
    [String.raw`\bsubstation\b`, 5],
    [String.raw`\buninterruptible\s+power\b`, 5],
    [String.raw`\bups\b`, 2],
    [String.raw`\bfeeder\w*`, 3],
    [String.raw`\bconduit\b`, 4],
    [String.raw`\bmotor\s+control\s+center\b`, 5],
    [String.raw`\bmcc\b`, 3],
    [String.raw`\btransfer\s+switch\b`, 5],
    [String.raw`\blight(ing)?\s+(fixture|upgrade|retrofit|pole)\w*`, 4],
    [String.raw`\blighting\b`, 3],
    [String.raw`\bled\s+(light|lamp|retrofit)\w*`, 4],
    [String.raw`\bballast\w*`, 3],
    [String.raw`\breceptacle\w*`, 3],
    [String.raw`\b(high|medium|low)\s+voltage\b`, 4],
    [String.raw`\bpower\s+(distribution|panel|system)\w*`, 4],
    [String.raw`\bsolar\b|\bphotovoltaic\b`, 3],
    [String.raw`\bev\s+charg\w*`, 3],
    [String.raw`\bgrounding\b`, 2],
  ],
  "Plumbing": [
    [String.raw`\bplumb\w*`, 6],
    [String.raw`\bsewer\w*`, 4],
    [String.raw`\bsewage\b`, 4],
    [String.raw`\bwastewater\b`, 3],
    [String.raw`\bwater\s+(main|line|heater|meter)s?\b`, 4],
    [String.raw`\bdomestic\s+water\b`, 5],
    [String.raw`\bbackflow\w*`, 5],
    [String.raw`\bgrease\s+(trap|interceptor)\w*`, 5],
    [String.raw`\bsump\s+pump\w*`, 4],
    [String.raw`\blift\s+station\w*`, 4],
    [String.raw`\bpiping\b`, 3],
    [String.raw`\bpipe(s)?\b`, 2],
    [String.raw`\bdrain(s|age)?\b`, 2],
    [String.raw`\bvalves?\b`, 1],
    [String.raw`\b(toilet|urinal|lavator\w*|faucet|restroom)\w*`, 3],
    [String.raw`\b(hvac|chilled|hot\s+water\s+heating|steam)\s+pip\w*`, -4],
    [String.raw`\bstorm\s*(water|drain)\w*`, -2],
  ],
  "Doors and Windows": [
    [String.raw`\bdoors?\b`, 4],
    [String.raw`\bwindows?\b`, 4],
    [String.raw`\bstorefront\w*`, 5],
    [String.raw`\bglazing\b`, 5],
    [String.raw`\bglass\b`, 2],
    [String.raw`\bglazier\w*`, 4],
    [String.raw`\b(hangar|overhead|roll-?up|sectional|security|fire|automatic|sliding)\s+door\w*`, 6],
    [String.raw`\bfenestration\b`, 5],
    [String.raw`\bcurtain\s*wall\w*`, 5],
    [String.raw`\bthreshold\w*`, 2],
    [String.raw`\btransom\w*`, 3],
    [String.raw`\bdoor\s+hardware\b`, 5],
    [String.raw`\bhardware\b`, 1],
    [String.raw`\b(window|door)\s+replacement\b`, 6],
    [String.raw`\bcaulk\w*|\bsealant\w*`, 1],
  ],
  "Site Work": [
    [String.raw`\bsite\s*work\b`, 6],
    [String.raw`\bsite\s+(prep\w*|improvement\w*|development)\b`, 5],
    [String.raw`\bparking\s+(lot|area|structure|garage)\w*`, 5],
    [String.raw`\bdriveway\w*`, 4],
    [String.raw`\bsidewalk\w*`, 5],
    [String.raw`\basphalt\b`, 5],
    [String.raw`\bpaving\b|\bpavement\b|\brepav\w*`, 5],
    [String.raw`\bexcavat\w*`, 4],
    [String.raw`\bearthwork\b`, 5],
    [String.raw`\bgrading\b|\bregrad\w*`, 4],
    [String.raw`\bstorm\s*water\b|\bstorm\s+drain\w*`, 4],
    [String.raw`\bfenc(e|es|ing)\b`, 4],
    [String.raw`\bcurb(s|ing)?\b`, 3],
    [String.raw`\bretaining\s+wall\w*`, 5],
    [String.raw`\blandscap\w*`, 4],
    [String.raw`\broad(s|way|ways)?\b`, 3],
    [String.raw`\bstreets?\b`, 2],
    [String.raw`\bseal\s*coat\w*`, 4],
    [String.raw`\b(pavement\s+)?striping\b`, 3],
    [String.raw`\bbollard\w*`, 3],
    [String.raw`\b(entry|vehicle|security)\s+gates?\b`, 4],
    [String.raw`\bcatch\s+basin\w*`, 4],
    [String.raw`\bculvert\w*`, 5],
    [String.raw`\berosion\s+control\b`, 5],
    [String.raw`\brunway\w*|\btaxiway\w*|\bapron\b`, 5],
    [String.raw`\bbridge\w*`, 3],
    [String.raw`\bconcrete\s+(pad|slab|apron)\w*`, 3],
    [String.raw`\bdredg\w*`, 4],
  ],
  "Interior Renovation": [
    [String.raw`\binterior\s+(renovat|remodel|finish|construct|alterat|upgrade)\w*`, 6],
    [String.raw`\b(office|room|lobby|suite|kitchen|classroom|clinic|lab|laboratory)\s+(renovat|remodel|upgrade|refresh)\w*`, 6],
    [String.raw`\bdrywall\b|\bsheetrock\b|\bwallboard\b`, 4],
    [String.raw`\bcarpet\w*`, 4],
    [String.raw`\bfloor(ing)?\b`, 3],
    [String.raw`\bacoustic(al)?\s+(ceiling|tile|panel)\w*`, 5],
    [String.raw`\bceiling\w*`, 2],
    [String.raw`\bpaint(ing|ed)?\b`, 3],
    [String.raw`\bpartition\w*`, 4],
    [String.raw`\b(vct|lvt)\b`, 4],
    [String.raw`\btile\w*`, 3],
    [String.raw`\bmillwork\b|\bcasework\b`, 4],
    [String.raw`\bcabinet\w*`, 3],
    [String.raw`\bplaster\w*`, 3],
    [String.raw`\bbuild-?out\b|\btenant\s+improvement\w*`, 5],
    [String.raw`\bfurnish\w*|\bfurniture\b`, 2],
  ],
  "Building Renovation": [
    [String.raw`\bbuilding\s+(renovat|remodel|rehab|moderniz|upgrade)\w*`, 7],
    [String.raw`\b(renovat|remodel|moderniz|rehabilitat)\w*`, 4],
    [String.raw`\brehab\b`, 4],
    [String.raw`\balteration\w*`, 4],
    [String.raw`\bfacility\s+(upgrade|conversion|renovation|modernization|rehab\w*|improvement\w*)\b`, 5],
    [String.raw`\bwhole\s+building\b`, 5],
    [String.raw`\bdesign[\s-]*build\b`, 3],
    [String.raw`\b(repair|improvement)s?\s+(to|of)\s+(building|facility)\b`, 3],
    [String.raw`\bseismic\b|\bstructural\s+(repair|upgrade|retrofit)\w*`, 4],
    [String.raw`\bhistoric\s+(restoration|preservation)\b`, 5],
    [String.raw`\bbuilding\s+envelope\b`, 4],
    [String.raw`\bfacade\b|\bfaçade\b|\bmasonry\b|\btuckpoint\w*`, 3],
    [String.raw`\baddition\s+(to|and)\b`, 3],
  ],
  "New Construction": [
    [String.raw`\bnew\s+(construction|building|facility|hangar|barracks|warehouse|office|station)\b`, 7],
    [String.raw`\bconstruct(ion)?\s+of\b`, 5],
    [String.raw`\bconstruct\b`, 4],
    [String.raw`\berect\w*`, 3],
    [String.raw`\bbuild\s+(a|an|the)\b`, 4],
    [String.raw`\bdesign[\s-]*build\b`, 2],
    [String.raw`\bground-?up\b`, 5],
    [String.raw`\bpre-?engineered\s+building\b`, 5],
    [String.raw`\bmilcon\b`, 4],
  ],
  "Demolition": [
    [String.raw`\bdemoli\w*`, 7],
    [String.raw`\bdeconstruct\w*`, 5],
    [String.raw`\btear\s*down\b`, 5],
    [String.raw`\bremoval\s+of\s+(building|structure|facility)\w*`, 5],
  ],
  "Environmental Abatement": [
    [String.raw`\basbestos\b`, 6],
    [String.raw`\blead[\s-]+(based\s+paint|abatement|remediation)\b`, 6],
    [String.raw`\babatement\b`, 5],
    [String.raw`\bmold\b|\bmould\b`, 4],
    [String.raw`\bremediation\b`, 4],
    [String.raw`\bhazardous\s+(material|waste)s?\b|\bhazmat\b`, 5],
    [String.raw`\bpcb\b`, 4],
    [String.raw`\bsoil\s+remediation\b`, 6],
    [String.raw`\bunderground\s+storage\s+tank\w*|\bust\b`, 4],
    [String.raw`\bmitigat\w*`, 2],
  ],
  "Elevators and Conveying": [
    [String.raw`\belevator\w*`, 6],
    [String.raw`\bescalator\w*`, 6],
    [String.raw`\bwheelchair\s+lift\w*`, 5],
    [String.raw`\bdumbwaiter\w*`, 5],
    [String.raw`\bhoist\w*|\bcrane\w*`, 3],
    [String.raw`\bvertical\s+transport\w*`, 5],
  ],
  "Security and Communications": [
    [String.raw`\b(cctv|surveillance|camera)s?\b`, 5],
    [String.raw`\baccess\s+control\b`, 5],
    [String.raw`\bintrusion\s+detect\w*`, 5],
    [String.raw`\bsecurity\s+system\w*`, 5],
    [String.raw`\b(structured\s+)?cabling\b|\bfiber\s+optic\b|\bnetwork\s+cabl\w*`, 4],
    [String.raw`\bpublic\s+address\b|\bintercom\b`, 4],
    [String.raw`\bcard\s+reader\w*`, 4],
  ],
  "General Maintenance": [
    [String.raw`\bmaintenance\b`, 2],
    [String.raw`\bpreventive\b|\bpreventative\b`, 2],
    [String.raw`\binspect\w*`, 1.5],
    [String.raw`\bjanitorial\b|\bcustodial\b`, 3],
    [String.raw`\bgrounds\s*keeping\b|\bgrounds\s+maintenance\b|\bmowing\b`, 3],
    [String.raw`\bservice\s+(contract|agreement|call)s?\b`, 2],
    [String.raw`\brepairs?\b`, 1.5],
    [String.raw`\bupkeep\b`, 2],
    [String.raw`\bcleaning\b`, 1.5],
    [String.raw`\btesting\b`, 1],
    [String.raw`\bfacilit(y|ies)\s+(support|maintenance|operations)\b`, 3],
    [String.raw`\bpest\s+control\b|\btrash\b|\bwaste\s+removal\b`, 3],
    [String.raw`\bbuilding\s+maintenance\b|\bgeneral\s+maintenance\b|\bminor\s+(repair|construction)\w*`, 4],
  ],
};

const NAICS_HINTS: Record<string, [string, number]> = {
  "238220": ["HVAC", 4],
  "238210": ["Electrical", 6],
  "238160": ["Roofing", 6],
  "238150": ["Doors and Windows", 5],
  "238350": ["Interior Renovation", 3],
  "238310": ["Interior Renovation", 4],
  "238320": ["Interior Renovation", 4],
  "238330": ["Interior Renovation", 4],
  "238910": ["Site Work", 4],
  "237310": ["Site Work", 6],
  "237110": ["Plumbing", 3],
  "237990": ["Site Work", 4],
  "236220": ["New Construction", 3],
  "236210": ["New Construction", 3],
  "238990": ["Site Work", 1],
  "562910": ["Environmental Abatement", 6],
  "562211": ["Environmental Abatement", 3],
  "238290": ["Elevators and Conveying", 3],
  "561210": ["General Maintenance", 4],
  "561720": ["General Maintenance", 4],
  "561730": ["General Maintenance", 4],
  "238130": ["Building Renovation", 1],
  "236118": ["Building Renovation", 3],
  "561621": ["Security and Communications", 5],
  "238120": ["Building Renovation", 2],
  "238140": ["Building Renovation", 3],
  "238170": ["Roofing", 3],
  "238190": ["Building Renovation", 2],
  "238110": ["Site Work", 2],
  "238340": ["Interior Renovation", 4],
  "238390": ["Interior Renovation", 2],
};

const TIE_PRIORITY = [
  "Fire Protection",
  "HVAC",
  "Roofing",
  "Electrical",
  "Plumbing",
  "Elevators and Conveying",
  "Security and Communications",
  "Doors and Windows",
  "Environmental Abatement",
  "Demolition",
  "Site Work",
  "Interior Renovation",
  "Building Renovation",
  "New Construction",
  "General Maintenance",
];

const MIN_SCORE = 2.5;
const DESC_WEIGHT = 0.5;
const MULTI_TRADE_MIN = 4;
const GENERIC = new Set(["General Maintenance", "Building Renovation", "New Construction", "Interior Renovation"]);

const COMPILED: Record<string, Array<{ rx: RegExp; weight: number; pattern: string }>> = {};
for (const [cat, rules] of Object.entries(RULES)) {
  COMPILED[cat] = rules.map(([p, w]) => ({
    rx: new RegExp(p, "i"),
    weight: w,
    pattern: p,
  }));
}

function normalize(text?: string | null): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/_/g, " ")
    .replace(/\//g, " / ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreText(
  text: string,
  factor: number,
  scores: Record<string, number>,
  hits: Record<string, string[]>
) {
  if (!text) return;
  for (const [cat, rules] of Object.entries(COMPILED)) {
    for (const { rx, weight } of rules) {
      const m = rx.exec(text);
      if (m) {
        const delta = weight * factor;
        scores[cat] += delta;
        const sign = delta >= 0 ? `+${delta}` : `${delta}`;
        hits[cat].push(`${m[0].toLowerCase()} (${sign})`);
      }
    }
  }
}

export interface ClassificationResult {
  project_type: string;
  confidence: number;
  secondary: string | null;
  scores: Record<string, number>;
  matched: string[];
  needs_review: boolean;
}

export function classifyProject(
  title: string,
  description: string = "",
  naics?: string | null
): ClassificationResult {
  const titleN = normalize(title);
  const descN = normalize(description);
  if (!titleN && !descN) {
    return {
      project_type: "Other",
      confidence: 0.0,
      secondary: null,
      scores: {},
      matched: [],
      needs_review: true,
    };
  }

  const scores: Record<string, number> = {};
  const hits: Record<string, string[]> = {};
  for (const c of Object.keys(COMPILED)) {
    scores[c] = 0.0;
    hits[c] = [];
  }

  scoreText(titleN, 1.0, scores, hits);
  scoreText(descN, DESC_WEIGHT, scores, hits);

  if (naics) {
    const code = String(naics).trim().slice(0, 6);
    const hint = NAICS_HINTS[code];
    if (hint) {
      scores[hint[0]] += hint[1];
      hits[hint[0]].push(`NAICS ${naics} (+${hint[1]})`);
    }
  }

  for (const c of Object.keys(scores)) {
    scores[c] = Math.max(0.0, Math.round(scores[c] * 100) / 100);
  }

  // Multi-trade jobs roll up to Building Renovation
  const trades = Object.entries(scores)
    .filter(
      ([c, s]) =>
        s >= MULTI_TRADE_MIN &&
        !GENERIC.has(c) &&
        c !== "Demolition" &&
        c !== "Environmental Abatement"
    )
    .map(([c]) => c);

  const renovationSignal = scores["Building Renovation"] + scores["Interior Renovation"];
  if (trades.length >= 3 && renovationSignal >= 2) {
    scores["Building Renovation"] += 3 * trades.length;
    hits["Building Renovation"].push(`multi-trade: ${trades.join(", ")}`);
  }

  let ranked = Object.entries(scores).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const idxA = TIE_PRIORITY.indexOf(a[0]);
    const idxB = TIE_PRIORITY.indexOf(b[0]);
    return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
  });

  let [topCat, top] = ranked[0];
  let [secondCat, second] = ranked[1];

  // A specific trade beats a generic category unless generic is clearly stronger
  if (GENERIC.has(topCat)) {
    const specific = ranked.filter(([c, s]) => !GENERIC.has(c) && s >= MIN_SCORE);
    if (specific.length > 0 && specific[0][1] >= top * 0.6) {
      [topCat, top] = specific[0];
      ranked = [[topCat, top], ...ranked.filter((r) => r[0] !== topCat)];
      [secondCat, second] = ranked[1];
    }
  }

  const nonZeroScores: Record<string, number> = {};
  for (const [c, s] of ranked) {
    if (s > 0) nonZeroScores[c] = s;
  }

  if (top < MIN_SCORE) {
    return {
      project_type: "Other",
      confidence: 0.0,
      secondary: null,
      scores: nonZeroScores,
      matched: [],
      needs_review: true,
    };
  }

  const margin = top ? (top - second) / top : 0;
  const strength = Math.min(top / 8.0, 1.0);
  const confidence = Math.round((0.5 * margin + 0.5 * strength) * 100) / 100;

  return {
    project_type: topCat,
    confidence,
    secondary: second >= MIN_SCORE ? secondCat : null,
    scores: nonZeroScores,
    matched: hits[topCat],
    needs_review: confidence < 0.45,
  };
}

export function classifyProjectType(
  title: string,
  description: string = "",
  naics?: string | null
): string {
  return classifyProject(title, description, naics).project_type;
}
