import Database from 'better-sqlite3'
import { SCHEMA } from './schema.js'

let db: Database.Database | null = null

export function initDB(path: string = 'sentinel.db'): void {
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
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
