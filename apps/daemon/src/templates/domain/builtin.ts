import type { Template } from "@flightdeck/protocol";

/**
 * The templates that ship with the daemon (phase 33): written for people who do not use a
 * terminal, in both languages. None asks for more than the preset it names.
 */
export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "summarise-folder",
    title: { en: "Summarise a folder", "pt-BR": "Resumir uma pasta" },
    description: {
      en: "Reads the files in a folder and tells you what is in them.",
      "pt-BR": "Lê os arquivos de uma pasta e conta o que há neles.",
    },
    icon: "folder-search",
    fields: [
      { id: "folder", kind: "folder", label: { en: "Which folder?", "pt-BR": "Qual pasta?" } },
      {
        id: "focus",
        kind: "text",
        optional: true,
        label: { en: "What matters most to you?", "pt-BR": "O que mais importa para você?" },
      },
    ],
    prompt: {
      en: "Read the files in {folder} and write a short summary of what they contain, grouped by topic. If I told you what matters most, put it first: {focus}.",
      "pt-BR":
        "Leia os arquivos de {folder} e escreva um resumo curto do que eles contêm, agrupado por assunto. Se eu disse o que mais importa, comece por isso: {focus}.",
    },
    preset: "read_only",
    planFirst: false,
  },
  {
    id: "draft-report",
    title: { en: "Draft a report", "pt-BR": "Redigir um relatório" },
    description: {
      en: "Writes a first version of a report from the files you point to.",
      "pt-BR":
        "Escreve uma primeira versão de um relatório a partir dos arquivos que você indicar.",
    },
    icon: "file-text",
    fields: [
      {
        id: "folder",
        kind: "folder",
        label: { en: "Folder with the files", "pt-BR": "Pasta com os arquivos" },
      },
      {
        id: "topic",
        kind: "text",
        label: { en: "What is the report about?", "pt-BR": "Sobre o que é o relatório?" },
      },
    ],
    prompt: {
      en: "Using the files in {folder}, draft a report about {topic}. Save it as a document in the results folder and give me a short summary of what it says.",
      "pt-BR":
        "Usando os arquivos de {folder}, redija um relatório sobre {topic}. Salve-o como um documento na pasta de resultados e me dê um resumo curto do que ele diz.",
    },
    preset: "ask_before_changes",
    planFirst: true,
  },
  {
    id: "review-document",
    title: { en: "Review a document", "pt-BR": "Revisar um documento" },
    description: {
      en: "Reads a document and lists what could be clearer, wrong or missing.",
      "pt-BR": "Lê um documento e lista o que poderia ser mais claro, estar errado ou faltar.",
    },
    icon: "file-check",
    fields: [
      { id: "file", kind: "file", label: { en: "Which document?", "pt-BR": "Qual documento?" } },
      {
        id: "depth",
        kind: "choice",
        label: { en: "How thorough?", "pt-BR": "Com que profundidade?" },
        choices: [
          { id: "quick", label: { en: "A quick look", "pt-BR": "Uma olhada rápida" } },
          { id: "careful", label: { en: "Careful", "pt-BR": "Cuidadosa" } },
        ],
      },
    ],
    prompt: {
      en: "Review the document {file}. Level of detail: {depth}. List what could be clearer, what looks wrong and what is missing, and suggest a fix for each. Do not change the document.",
      "pt-BR":
        "Revise o documento {file}. Nível de detalhe: {depth}. Liste o que poderia ser mais claro, o que parece errado e o que falta, e sugira uma correção para cada ponto. Não altere o documento.",
    },
    preset: "read_only",
    planFirst: false,
  },
  {
    id: "compare-files",
    title: { en: "Compare files", "pt-BR": "Comparar arquivos" },
    description: {
      en: "Compares two files and explains the differences in plain words.",
      "pt-BR": "Compara dois arquivos e explica as diferenças em palavras simples.",
    },
    icon: "git-compare",
    fields: [
      { id: "first", kind: "file", label: { en: "First file", "pt-BR": "Primeiro arquivo" } },
      { id: "second", kind: "file", label: { en: "Second file", "pt-BR": "Segundo arquivo" } },
    ],
    prompt: {
      en: "Compare {first} with {second}. Explain what is different in plain words, and say which differences matter most.",
      "pt-BR":
        "Compare {first} com {second}. Explique o que é diferente em palavras simples e diga quais diferenças mais importam.",
    },
    preset: "read_only",
    planFirst: false,
  },
];
