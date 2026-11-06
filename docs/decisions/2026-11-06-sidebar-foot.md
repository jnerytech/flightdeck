# The sidebar foot: the Claude account, Settings and Sign out of GitHub (issue #213, with #122 and #123)

Ported from the stranded `home-settings` branch onto current `main`; the entries of `DECISIONS.md` there, moved to a file of their own (#304).

- **The foot of the bar is the Claude account** (its email and plan, read from the host's account card; the narrow rail shows only its initial) and a menu with Settings, Toggle theme and Manual; Search stays a button, and Simple mode (which `main` has and the branch did not) stays a button after the account. About fifteen tests that clicked Settings or Toggle theme in the bar go through `chooseFromAccountMenu`.
- **Which account.** The account of the open host; when no host is open, the one the online hosts share, or "N accounts" when they differ. An offline host contributes none (HK-M4).
- **Settings is a visible item again**, between Search and the account row, marked while Settings is open (HK-m5 of the v0.37 review): `aria-current="page"` and the accent row. It stays in the account menu too, so both paths work and the menu keeps its three items.
- **Sign out of GitHub** (item 5 of #122) is in the account menu, one item per online host whose `gh` is signed in with a login the app can remove (a login from the daemon's environment is left out; with two hosts the item names the host). Who is signed in is asked when the menu opens, not on every render, so an item can lag one open behind a sign-in made elsewhere. Signing out asks first: it ends repository access for that host's sessions until the next sign-in.
- **Left to the branches that follow.** The marker bar at the left edge of the open row (`nav-active`) belongs to the sidebar's own work, so the tests here check `aria-current` and the accent row.
