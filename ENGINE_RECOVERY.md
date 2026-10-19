# Engine recovery

Recovery requires a trusted operator with database and provider access. Never reset a running job
or delete an operation merely because the client timed out. The provider may already have charged,
created a campaign or changed a budget. Reservations remain held until reconciliation.

1. Inspect the job, its lease, and all `fbads.operations` rows for that job/action. Stop the old worker.
   Query the provider using saved IDs, task IDs, timestamps and deterministic names.
2. For a confirmed success, record the actual provider result in the operation and mark it `done`.
   Reconstruct local campaign/ad-set/ad rows from those IDs. Do not create the remote entity again.
3. For a confirmed absent/failed remote operation, record the evidence in the job checkpoint and audit
   log. Preserve the operation record under an archived attempt key before making the original key
   available for a reviewed retry. Never retry a charge/creation without conclusive absence evidence.
4. Reset a reconciled job to `pending` with no claimed_by/lease, so the gateway can issue a new lease.
   The normal gateway still checks current approvals, account sync and budget allowance.
5. For a scale action, reconcile actual remote budget before adjusting local budgets, reservations,
   executed_at or action status. If scale succeeded, complete it as executed and keep the cooldown.
   If conclusively absent, release only that operation's reserved delta under the safety transaction
   lock (`pg_advisory_xact_lock(310001)`). Do not release unrelated campaign reservations.
6. Insert an `engine_actions` audit row describing operator, evidence, original operation key and
   the recovery decision. Any unresolved uncertainty remains `needs_review` and is not retried.

There is intentionally no automatic “retry everything” button. Use parameterized administrator
queries in a transaction, keep a backup and retain original evidence. Recovery procedures cannot
verify provider state without real connector access.
