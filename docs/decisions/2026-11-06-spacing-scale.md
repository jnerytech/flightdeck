# One spacing scale, applied by role (issue #588)

The user found blocks touching across the app: on a project's page the configuration card sat on
the link cards, its sections were cramped, and the side-by-side sessions had too little room
above them. The Teams page (#594) had rows whose state and actions moved with the name's length.

## The scale

The scale already existed as the `Gap` of `components/layout/stack.tsx`: 4, 8, 12, 16, 24 and
32 px (Tailwind's `gap-1` to `gap-8`, steps of `--spacing`). No second set of tokens is added; each
role takes one step:

| Role | Step | Where |
| --- | --- | --- |
| Between the blocks of a page's body | 24 px (`gap-6`) | `Page` |
| Between a section's heading and its content, inside a panel | 12 px (`gap-3`) | `Section`, `Panel`, the trust card's groups |
| Between a row's controls, between cards of a list | 8 px (`gap-2`) | `Inline`, `card-grid`'s neighbours, the Teams rows |
| Between the lines of one item (a title and its hint, a group's entries) | 4 px (`gap-1`) | `stack-tight` |

## The root cause

`Page` put its children straight into the scrolling body with no gap, so every page with more
than one block in its body depended on each block bringing its own margin. Most did not. The body
is now a column with the 24 px step, which fixes all of them at once instead of one page at a time.

## Long text in a card

A command, a path or a URL in a card wraps (`overflow-wrap: anywhere`), and a long one sits in a
padded, rounded block with the muted background, so it never runs to the card's edge.

## What comes next

fd-harness's gap contract on every page in `demo:shots` (#588) lists the pairs still under 8 px;
each area is fixed against that list in a small PR.
