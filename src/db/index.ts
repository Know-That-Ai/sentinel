import Database from 'better-sqlite3'
import { SCHEMA } from './schema.js'

let db: Database.Database | null = null

export function initDB(path: string = 'sentinel.db'): void {
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  addColumnIfMissing(db, 'linked_sessions', 'tty', 'TEXT')
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  type: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function getDB(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.')
  }
  return db
}

export function closeDB(): void {
  if (db) {
    db.close()
    db = null
  }
}
