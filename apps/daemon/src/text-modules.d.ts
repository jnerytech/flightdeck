/** Files imported as text (`with { type: "text" }`), such as the release public key. */
declare module "*.pub" {
  const content: string;
  export default content;
}

/** The persona files of the pack (phase 20), which travel inside the compiled binary. */
declare module "*.md" {
  const content: string;
  export default content;
}
