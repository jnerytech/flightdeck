# A folded Machines group keeps a summary mark (issue #208)

- When the Machines group is folded, its per-host markers are hidden. The title now shows a small warning triangle with the name "A
  machine needs attention" when any host is offline (also unauthorized or incompatible), is missing a required dependency or forwards
  an API key. Unfolded, the rows carry their own markers and the title shows nothing. The rail has no group titles, so it is
  unchanged (each host keeps its dot). The version-differs marker is not part of the summary: the issue lists three causes.
