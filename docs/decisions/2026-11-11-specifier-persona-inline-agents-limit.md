# The specifier persona and the inline --agents limit (issue #1961)

The pack grows from 13 to 14 personas with `specifier` (after `docs`, English and pt-BR). The pack's
persona subagents, as the JSON of an interactive `claude --agents`, went from about 19 400 to about
21 000 characters, past `INLINE_AGENTS_MAX` (20 000, issue #1711). Past that limit the wrapper drops
`--agents` and a terminal-launched `claude` opens with no persona subagents at all, so the new
persona would have switched off the other thirteen there.

`INLINE_AGENTS_MAX` moves from 20 000 to 28 000 characters. A Windows command line holds about
32 767 characters; the JSON's escaped quotes (about 260 for the pack) and the other arguments stay
well under the 4 000 that are left. The limit still leaves room for the person's own personas (about
7 000 characters), where before the pack alone filled it. The Windows run is the person's to test
by hand (Windows gates nothing, #534); a pack past the new limit drops the agents with the same
stderr notice as before.
