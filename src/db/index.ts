import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { SCHEMA } from './schema.js'

let db: Database.Database | null = null

export function initDB(dbPath: string = 'sentinel.db'): void {
  const dir = path.dirname(dbPath)
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  addColumnIfMissing(db, 'linked_sessions', 'tty', 'TEXT')
  addColumnIfMissing(db, 'events', 'auto_closed_at', 'TEXT')
  addColumnIfMissing(db, 'events', 'auto_close_reason', 'TEXT')
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
