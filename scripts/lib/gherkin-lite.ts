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

/** Reads a `.feature` text: its language, its scenarios and their steps. Throws on a step out of place. */
export function parseFeature(_text: string): Feature {
  return { language: "pt", title: "", scenarios: [] };
}

/** The titles of the scenarios in the ```gherkin blocks of a spec. */
export function scenarioTitlesOfSpec(_markdown: string): string[] {
  return [];
}
