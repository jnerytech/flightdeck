# Project key of a folder that becomes a repository (issue #1711, moved from DECISIONS.md)

- **A folder key is dropped when the folder gains a `.git`; a parent that becomes a repository is not noticed.** `ProjectKeys` records, for a folder git found no repository in, whether its own `.git` existed at that moment, and asks git again when it exists now and did not then. The check looks only at the cached folder itself: a sub-folder cached with a folder key keeps it, after a parent folder becomes a repository, until the daemon restarts.
