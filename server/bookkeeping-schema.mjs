// Append-only accounting evidence. Existing inboxes and provider data stay intact.
export const BOOK_TOKEN=`(SELECT count(*)||':'||coalesce(sum(version),0) FROM orders)||':'||
 (SELECT count(*) FROM accounting_documents)||':'||(SELECT count(*) FROM accounting_classifications)||':'||
 (SELECT coalesce(max(revision_id),0) FROM accounting_bank_revisions)||':'||(SELECT count(*) FROM accounting_bank_classifications)||':'||
 (SELECT count(*) FROM advisor_proposals)||':'||(SELECT count(*) FROM advisor_decisions)||':'||(SELECT count(*) FROM book_commands)`;
export async function bookkeepingSchema(env){
  const definitions=[
    `CREATE TABLE IF NOT EXISTS book_commands(id TEXT PRIMARY KEY,expected TEXT NOT NULL,at TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS book_settings(id INTEGER PRIMARY KEY AUTOINCREMENT,command_id TEXT NOT NULL REFERENCES book_commands(id),data TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS book_matches(id TEXT PRIMARY KEY,command_id TEXT NOT NULL REFERENCES book_commands(id),bank_key TEXT NOT NULL,bank_revision INTEGER NOT NULL REFERENCES accounting_bank_revisions(revision_id),month TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),order_id TEXT REFERENCES orders(id),payment_id TEXT,created_payment INTEGER NOT NULL,note TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS book_match_reversals(match_id TEXT PRIMARY KEY REFERENCES book_matches(id),command_id TEXT NOT NULL REFERENCES book_commands(id))`,
    `CREATE TABLE IF NOT EXISTS book_resolutions(id INTEGER PRIMARY KEY AUTOINCREMENT,command_id TEXT NOT NULL REFERENCES book_commands(id),source_key TEXT NOT NULL,source_hash TEXT NOT NULL,month TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('post','exclude','reverse')),reason TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS book_entries(id TEXT PRIMARY KEY,resolution_id INTEGER NOT NULL REFERENCES book_resolutions(id),month TEXT NOT NULL,data TEXT NOT NULL,reversal_of TEXT UNIQUE REFERENCES book_entries(id))`,
    `CREATE TABLE IF NOT EXISTS book_periods(id INTEGER PRIMARY KEY AUTOINCREMENT,command_id TEXT NOT NULL REFERENCES book_commands(id),month TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('close','reopen')),snapshot TEXT NOT NULL,sha256 TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS book_exports(id TEXT PRIMARY KEY,command_id TEXT NOT NULL REFERENCES book_commands(id),period_id INTEGER UNIQUE NOT NULL REFERENCES book_periods(id),month TEXT NOT NULL,filename TEXT NOT NULL,bytes_base64 TEXT NOT NULL,sha256 TEXT NOT NULL,entry_count INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS book_export_entries(entry_id TEXT PRIMARY KEY REFERENCES book_entries(id),export_id TEXT NOT NULL REFERENCES book_exports(id))`,
    `CREATE INDEX IF NOT EXISTS book_source ON book_resolutions(source_key,id)`,
    `CREATE INDEX IF NOT EXISTS book_month ON book_entries(month)`,
    `CREATE TRIGGER IF NOT EXISTS book_command_guard BEFORE INSERT ON book_commands WHEN NEW.expected!=(${BOOK_TOKEN}) BEGIN SELECT RAISE(ABORT,'BOOK_STALE'); END`,
    // A payment which is reconciled cannot be silently changed in the old order UI.
    `CREATE TRIGGER IF NOT EXISTS book_payment_guard BEFORE UPDATE ON orders WHEN EXISTS(
      SELECT 1 FROM book_matches m WHERE m.order_id=OLD.id AND NOT EXISTS(SELECT 1 FROM book_match_reversals r WHERE r.match_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.data,'$.payments') p WHERE json_extract(p.value,'$.id')=m.payment_id
        AND json_extract(p.value,'$.amountCents')=m.amount AND json_extract(p.value,'$.cancelledAt') IS NULL
        AND json_extract(p.value,'$.at')=(SELECT json_extract(o.value,'$.at') FROM json_each(OLD.data,'$.payments') o WHERE json_extract(o.value,'$.id')=m.payment_id)
        AND json_extract(p.value,'$.method')='Überweisung'))
      BEGIN SELECT RAISE(ABORT,'BOOK_PAYMENT_LOCKED'); END`
  ];
  for(const table of ['book_commands','book_settings','book_matches','book_match_reversals','book_resolutions','book_entries','book_periods','book_exports','book_export_entries'])for(const action of ['UPDATE','DELETE'])definitions.push(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Buchhaltungsverlauf ist unveränderlich'); END`);
  await env.DB.batch(definitions.map(sql=>env.DB.prepare(sql)));
}
