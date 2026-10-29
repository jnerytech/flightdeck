/** Files imported as text (`with { type: "text" }`), such as the release public key. */
declare module "*.pub" {
  const content: string;
  export default content;
}
