# Adjudications

The records the review-loop adjudicator reads and writes, one per dispatch.

**These are decisions, so they are committed.** Same line as the receipts
directory next door and for the same reason: an adjudication is taken once and
binds afterwards. A verdict that lived only in a working tree would be
re-litigated by the next session, which is precisely the loop the budget
machinery exists to end.

Naming is `<pr>-<n>.json` — the PR number and which dispatch on that PR this
was. The sequence matters: tripwire 2 asks how many self-serve extensions a
loop has already spent, and it answers by counting these.

This file exists partly to hold the directory open. Git does not track empty
directories, and the machinery reads this path out of a **committed ref**
rather than the working tree — so in a repo where nothing has been adjudicated
yet, an untracked directory is indistinguishable from a missing one, and the
read that would have found it never happens.

Contents are per-repo history and never sync between repos. Only this README
arrives from the handbook.
