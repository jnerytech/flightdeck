# The sidebar by purpose (issue #128, from the LiteLLM reference of #122)

- **Five groups, no loose items.** Work (Sessions, Needs you, Projects, Board), Automation (Workflows, Teams, Conversations),
  Observability (Costs, History), Library (unchanged) and Machines. The Home item of #123 is not drawn: that page does not exist yet.
  History moved next to Costs because it is a record of what was done, not infrastructure.
- **Machines replaces Infra and Hosts.** It holds the hosts (dot, name, the required-dependency mark of #121, the version and API-key
  marks, the menu) with a + in its title, then SSH (what the sidebar called Connections: the saved destinations opened in a terminal).
  In the icon rail it is the host dots and SSH. A folded state saved for the old `infra` group is simply not read.
- **The open page** is a filled row plus a 3 px bar of the brand color at its left edge (`nav-active`); `aria-current` stays. Items with
  sub-pages (Vault, Settings) end in a chevron, Teams carries Beta and Conversations New, and the Needs you count is unchanged.
- **Manual** is a footer item that opens `docs/manual/<language>.md` on GitHub in the browser; it carries an external-link icon. It is the
  only item that leaves the app (the issue also named GitHub releases, which the app already reaches from the update banner).
- **Tests that clicked "Conexões"** now click "SSH"; the screen is still called Connections where its page names it.
