const { DatabaseSync } = require("node:sqlite");
const { mkdirSync } = require("node:fs");
const { dirname } = require("node:path");

function openDatabase(filename) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, sku TEXT NOT NULL UNIQUE,
      categoria TEXT NOT NULL, cents INTEGER NOT NULL CHECK(cents > 0),
      stock INTEGER NOT NULL CHECK(stock >= 0), version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY);
  `);
  if (!db.prepare("SELECT id FROM migrations WHERE id=1").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const insert = db.prepare(
        "INSERT INTO products (nombre,sku,categoria,cents,stock) VALUES (?,?,?,?,?)",
      );
      for (const item of [
        ["Teclado", "TEC-001", "Periféricos", 15000, 10],
        ["Mouse", "MOU-001", "Periféricos", 8000, 25],
        ["Monitor", "MON-001", "Pantallas", 90000, 5],
        ["Audífonos", "AUD-001", "Audio", 20000, 0],
      ])
        insert.run(...item);
      db.exec("INSERT INTO migrations VALUES (1); COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}
module.exports = { openDatabase };
