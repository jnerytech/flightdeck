# Clients: grouping work across hosts and projects

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/clients-grouping-work-across-hosts-and-projects.md)

A **host** is a machine and a **project** is a repository (or a folder). If you work for several
clients, with several machines and many folders, a **client** groups projects across hosts: it is
kept by the app, crosses hosts, and is **never required**. With no client defined, the app looks
and behaves as before (the only difference is one line in **Settings**). Hosts are not grouped under
clients, since one machine often serves several of them.

**Creating clients.** Open **Manage clients** (the line in **Settings**, **Ctrl+K**, or the
switcher once a client exists). **Create client** takes a name (unique, ignoring case); each client
has a color, can be renamed, moved up or down, and deleted (its projects go back to the rules of
the others, or to no client; nothing is deleted from the hosts). The order of the clients is the
order their rules are tried in.

**Rules.** A project joins a client by the first rule that matches it:

- **Remote**: a prefix of the project's remote, with `*` at the end (`github.com/acme/*`,
  `dev.azure.com/orgb/*`) or one exact repository. The same repository on two machines is one
  project, so one rule covers both.
- **Folder**: an absolute folder prefix (`/home/me/work/acme`, `C:\work\acme`), for any host or
  for one (picked by name). There is no `~`: a host does not tell the app its home folder. A
  folder rule also claims a project known by its remote when any folder its sessions ran in is
  inside the prefix. A rule whose host was removed or paired again shows **unknown host** and
  matches nothing. If two hosts share a daemon name, a project known only by its folder does not
  match a rule for one host, and the screen says so.
- **By hand**: **Assign** on a project with no client pins it to a client, and **Projects pinned by
  hand** lists the pins (**Let go** undoes one). A pin beats the rules.

Each rule form shows how many projects it matches right now. **Suggest from what I have** offers
one client per owner of the remotes the app has seen (`github.com/acme`, an Azure DevOps
organization), largest first; nothing is created until you click, and an owner that already has a
client gets the rule added to it. Projects no rule or pin claims are **No client**; the screen
counts them. **Export clients** shows the setup as text and **Import** merges pasted text by
client id (new ones added, the same id replaced, nothing deleted), to move to another desktop.

**The switcher.** Once a client exists, a menu under the brand in the sidebar picks **All
clients**, one client (with its running or waiting sessions) or **No client** (with its project
count). A mark beside it counts requests waiting in *other* clients. The choice is kept between
starts, and **Ctrl+K** has **Client: <name>** entries. **Alt+Shift+C** switches to the next one: all
clients, each client in order, **No client**, then all again (it does nothing before a client exists).

**What the choice filters.** Sessions (and a client chip on each project header while all clients
are shown), the Board and Workflows project picker, Conversations (a message shows when either of
its sessions is in the client), Budgets (a host's own budgets always show, and a line counts the
ones hidden), Costs, and the Vault. It never filters **Needs you**, the tray, notifications,
budget alerts or the global search, and each request there wears its client's chip. A host's own
**Projects** screen always lists every project.

**Costs and budgets.** On **Costs**, the **Data from** menu in the toolbar (the same as Home's, and
kept across starts) picks **All hosts**, which is how Costs opens and adds the hosts up, or one host.
A link that names a host (an alert, a card on Home) shows that host for that visit and leaves the
menu's choice alone. If the chosen host is offline or does not report costs, Costs says so and
offers **Show all hosts**. **By client** splits the spend (with **No client**), and a selected client
narrows everything; a host that is offline, has no costs or does not answer is named. The CSV export
covers every host on **All hosts**, with the host's name as the first column (a host that does not
answer is left out). The quota charts are per host: on **All hosts** one line, **Pick a host to see
its quota**, has a button for each host. A project whose name is also a project on another host
shows with its host (`docs-site · alfa`), the same on Home and on Costs, even when only one of
them is in the list on screen. Each
client can have a **monthly limit** (US$): the app looks at it when a host with costs comes online,
when you change it and every ten minutes, warns once a month at 50%, 80% and 100% (a notification
and a line in **Needs you**), and **does not hold cards**: the limits of each host and project stay
on the hosts.

**Defaults.** Each client can set a **default persona** (preselected in **New session** from the
folder you choose, and in **Claude here**; you can change it, and a persona the screen was opened
with wins) and a **snippet tag** (the client's snippets come first on **Snippets** and in
**Ctrl+K**, and a new snippet starts with it). Cards keep the project's persona per column.

**Vault.** A client can name a **vault tag**: with the client selected, secrets with the tag come
first in the **Vault**, then those of no client, then other clients' (nothing is hidden), and a new
secret starts with the tag. The Clients screen lists, read-only, a tagged secret with a rule that
allows or asks for another client's project, or whose allowed hosts include one that holds none of
the client's projects. **Keep the secrets with this tag in the client's projects only** is opt-in:
after a confirmation that shows how many rules each secret gets, the app sends the hosts, in front
of the secret's own rules, an **ask** rule per project of the client and a **deny** for Claude,
automations and workflows anywhere else (your own use in the app is not denied, and the daemon
still holds the rules to its ceiling). These rules are generated, not saved: the rules editor shows
only yours and says how many come before them, they follow the client's projects (with a notice),
and turning the scope off sends exactly your own rules again. The scope holds only while **this**
desktop writes the secret's rules: if another app saves them on a host, the app notices on connect,
says so and sends them again; a host that refuses them (the daemon takes at most 200 rules per
secret) is named, and the secret is then not held in its client on that host.
