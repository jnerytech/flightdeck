export type StepKind = "given" | "when" | "then";

export interface Step {
  kind: StepKind;
  text: string;
}

export interface Scenario {
  title: string;
  steps: Step[];
}

export interface Feature {
  language: "en" | "pt";
  title: string;
  scenarios: Scenario[];
}

const WORDS = {
  en: {
    scenario: "Scenario:",
    feature: "Feature:",
    kinds: { Given: "given", When: "when", Then: "then" },
    and: ["And", "But"],
  },
  pt: {
    scenario: "Cenário:",
    feature: "Funcionalidade:",
    kinds: { Dado: "given", Quando: "when", Então: "then" },
    and: ["E", "Mas"],
  },
} as const;

/** Reads a `.feature` text: its language, its scenarios and their steps. Throws on a step out of place. */
export function parseFeature(text: string): Feature {
  const language = /^#\s*language:\s*pt\b/m.test(text) ? "pt" : "en";
  const words = WORDS[language];
  const kinds: Record<string, StepKind> = words.kinds;
  let title = "";
  const scenarios: Scenario[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith(words.feature)) {
      title = line.slice(words.feature.length).trim();
    } else if (line.startsWith(words.scenario)) {
      scenarios.push({ title: line.slice(words.scenario.length).trim(), steps: [] });
    } else {
      const [word = "", ...rest] = line.split(/\s+/);
      const body = rest.join(" ");
      const scenario = scenarios.at(-1);
      const isAnd = (words.and as readonly string[]).includes(word);
      if (!(word in kinds) && !isAnd) continue;
      if (!scenario) throw new Error(`a step outside a scenario: ${line}`);
      const kind = isAnd ? scenario.steps.at(-1)?.kind : kinds[word];
      if (!kind) throw new Error(`"${word}" with nothing before it: ${line}`);
      scenario.steps.push({ kind, text: body });
    }
  }
  return { language, title, scenarios };
}

/** The titles of the scenarios in the ```gherkin blocks of a spec. */
export function scenarioTitlesOfSpec(markdown: string): string[] {
  const titles: string[] = [];
  let inside = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) inside = line.trim() === "```gherkin" && !inside;
    else if (inside && line.trim().startsWith("Scenario:")) {
      titles.push(line.trim().slice("Scenario:".length).trim());
    }
  }
  return titles;
}
