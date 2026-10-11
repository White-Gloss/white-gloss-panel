export const SCHEMA=[
`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS sequences(name TEXT PRIMARY KEY,value INTEGER NOT NULL)`,
`INSERT OR IGNORE INTO sequences VALUES('WG',0)`,
`CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,wg TEXT UNIQUE NOT NULL,website_id TEXT UNIQUE,version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0)`,
`CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT,version INTEGER,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(order_id,version))`,
`CREATE TRIGGER IF NOT EXISTS order_insert_audit AFTER INSERT ON orders BEGIN INSERT INTO audit(order_id,version,at,actor,action,status) VALUES(NEW.id,NEW.version,NEW.updated_at,NEW.actor,NEW.action,NEW.status); END`,
`CREATE TRIGGER IF NOT EXISTS order_update_audit AFTER UPDATE ON orders BEGIN INSERT INTO audit(order_id,version,at,actor,action,status) VALUES(NEW.id,NEW.version,NEW.updated_at,NEW.actor,NEW.action,NEW.status); END`,
`CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL,mime TEXT NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,provider_id TEXT,detail TEXT,UNIQUE(order_id,kind))`,
`CREATE TABLE IF NOT EXISTS appointments(order_id TEXT PRIMARY KEY,start TEXT NOT NULL,end TEXT NOT NULL)`,
`CREATE TRIGGER IF NOT EXISTS no_overlap_insert BEFORE INSERT ON appointments WHEN EXISTS(SELECT 1 FROM appointments WHERE start<NEW.end AND end>NEW.start AND order_id!=NEW.order_id) BEGIN SELECT RAISE(ABORT,'Terminüberschneidung'); END`,
`CREATE TRIGGER IF NOT EXISTS no_overlap_update BEFORE UPDATE ON appointments WHEN EXISTS(SELECT 1 FROM appointments WHERE start<NEW.end AND end>NEW.start AND order_id!=NEW.order_id) BEGIN SELECT RAISE(ABORT,'Terminüberschneidung'); END`,
`CREATE TABLE IF NOT EXISTS offer_tokens(hash TEXT PRIMARY KEY,order_id TEXT NOT NULL,expires_at TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)`,
`CREATE TABLE IF NOT EXISTS protocol_drafts(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL)`
 ,`CREATE TABLE IF NOT EXISTS signature_bindings(asset_id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,snapshot_hash TEXT NOT NULL)`
 ,`CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,data TEXT NOT NULL,search TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`
 ,`CREATE TABLE IF NOT EXISTS vehicles(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,data TEXT NOT NULL,search TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`
 ,`CREATE TABLE IF NOT EXISTS customer_orders(order_id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,vehicle_id TEXT)`
 ,`CREATE TABLE IF NOT EXISTS document_requests(hash TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL,expires_at TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)`
 // Kunden, Fahrzeuge und Aufträge werden nie gelöscht; Änderungen bleiben im Verlauf.
 ,`CREATE TRIGGER IF NOT EXISTS no_customer_delete BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT,'Kunden werden nicht gelöscht'); END`
 ,`CREATE TRIGGER IF NOT EXISTS no_vehicle_delete BEFORE DELETE ON vehicles BEGIN SELECT RAISE(ABORT,'Fahrzeuge werden nicht gelöscht'); END`
 ,`CREATE TRIGGER IF NOT EXISTS no_order_delete BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT,'Aufträge werden nicht gelöscht'); END`
];
