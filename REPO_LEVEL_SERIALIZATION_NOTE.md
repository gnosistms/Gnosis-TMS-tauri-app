# Repo-Level Serialization

## What It Means

Repo-level serialization means that, for any one local project repo, the app allows only one repo-sensitive operation at a time.

In practice, operations for the same repo would share a single lock or queue. If one operation is already running, the next one waits until the first finishes.

Different repos can still run in parallel.

## Why We Would Want It

The goal is to stop overlapping repo operations from observing inconsistent git state.

Without serialization, these kinds of operations can overlap:

- editor background sync
- save row
- save reviewed marker
- unreview all
- insert row
- soft delete / restore / hard delete row
- save or delete row comment when it creates a commit
- restore from history
- undo batch replace

When they overlap, one operation can read an older `HEAD` while another operation is in the middle of creating a newer commit. That can lead to race conditions, confusing stale detection, and other timing bugs.

## What It Prevents

Repo-level serialization would prevent:

- background sync reading old git state while a local save is committing
- two overlapping repo writes racing each other
- stale or inconsistent `HEAD` comparisons
- timing bugs where one local operation appears to be an external change

## What It Does Not Mean

Repo-level serialization does **not** mean:

- serializing the whole app
- blocking unrelated repos
- blocking simple read-only UI work
- adding separate Windows and Mac behavior

It is a per-repo rule, not a global rule.

## Likely Design

The intended design is:

1. Give each local repo its own lock or queue.
2. Require all repo-sensitive editor operations for that repo to acquire the same lock.
3. Let the operation run.
4. Release the lock when the operation finishes.
5. Start the next queued operation for that repo.

The safest scope would be to have editor background sync and all commit-producing editor commands use the same per-repo serialization path.

## Relationship To The Head-Aware Fix

The head-aware fix is the minimum correct fix for the immediate stale-badge bug. It makes stale marking ignore sync results that started from an older repo head than the editor currently knows about.

Repo-level serialization is a later hardening step. It is not required to fix the immediate bug, but it would reduce future race conditions and make repo behavior more deterministic.

## Short Version

Repo-level serialization = one repo-sensitive operation at a time, per repo, using a shared lock or queue so sync and local commits cannot overlap in that repo.
