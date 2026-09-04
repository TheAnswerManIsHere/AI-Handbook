# Adjudications — this repository's own

The mechanical records behind **AI-Handbook's own** review-loop adjudications,
one per dispatch, named `<pr>-<n>.json`. Not payload: the copy under
`core/.agents/adjudications/` is what a consumer receives.

**What these records are and why they are committed rather than left in a
working tree:** [`core/.agents/adjudications/README.md`](../../core/.agents/adjudications/README.md).

This file also holds the directory open. Git does not track empty directories,
and the machinery reads this path out of a committed ref — so without it, a
repo that has adjudicated nothing yet is indistinguishable from one where the
directory is missing.
