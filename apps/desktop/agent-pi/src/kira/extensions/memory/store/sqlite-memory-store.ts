import type { MemoryCategory } from "../types.js";

import { DatabaseManager } from "./db.js";
import { buildFallbackFts5Query, isFts5QueryError, normalizeFts5Query } from "./fts-query.js";
import { normalizeMemoryLookupText } from "./memory-lookup.js";

const MEMORY_SELECT_COLUMNS = `
  id,
  project,
  target,
  category,
  content,
  failure_reason,
  tool_state,
  corrected_to,
  created,
  last_referenced
`;

const FAILURE_CATEGORY_SET = new Set<MemoryCategory>([
  "failure",
  "correction",
  "insight",
  "preference",
  "convention",
  "tool-quirk",
]);

/**
 * A memory entry stored in SQLite.
 */
export interface SqliteMemoryEntry {
  id: number;
  project: string | undefined;
  target: "memory" | "user" | "failure";
  category: MemoryCategory | undefined;
  content: string;
  failureReason: string | undefined;
  toolState: string | undefined;
  correctedTo: string | undefined;
  created: string;
  lastReferenced: string;
}

export interface SqliteMemorySyncInput {
  content: string;
  target: "memory" | "user" | "failure";
  project?: string | undefined;
  category?: MemoryCategory | undefined;
  failureReason?: string | undefined;
  toolState?: string | undefined;
  correctedTo?: string | undefined;
  created?: string | undefined;
  lastReferenced?: string | undefined;
}

export interface SqliteMemorySyncResult {
  action: "inserted" | "existing";
  entry: SqliteMemoryEntry;
}

export interface SqliteMemoryUpdateResult {
  matched: number;
  updated: number;
  entries: SqliteMemoryEntry[];
}

export interface SqliteMemoryRemoveResult {
  matched: number;
  removed: number;
}

export interface SqliteMemoryRemoveOptions {
  target: "memory" | "user" | "failure";
  project?: string | undefined;
}

export type ParsedMarkdownMemoryEntry = SqliteMemorySyncInput;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeNullable(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCategory(value?: MemoryCategory | null): MemoryCategory | undefined {
  return value ?? undefined;
}

function mapRow(row: {
  id: number;
  project: string | null;
  target: string;
  category: string | null;
  content: string;
  failure_reason: string | null;
  tool_state: string | null;
  corrected_to: string | null;
  created: string;
  last_referenced: string;
}): SqliteMemoryEntry {
  return {
    id: row.id,
    project: row.project ?? undefined,
    target: row.target as "memory" | "user" | "failure",
    category: normalizeCategory(row.category as MemoryCategory | null),
    content: row.content,
    failureReason: row.failure_reason ?? undefined,
    toolState: row.tool_state ?? undefined,
    correctedTo: row.corrected_to ?? undefined,
    created: row.created,
    lastReferenced: row.last_referenced,
  };
}

function buildScopeConditions(
  params: unknown[],
  target?: string,
  project?: string,
  category?: MemoryCategory,
): string[] {
  const conditions: string[] = [];

  if (target) {
    conditions.push("target = ?");
    params.push(target);
  }

  if (project) {
    conditions.push("project = ?");
    params.push(project);
  }

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }

  return conditions;
}

function getMemoryById(dbManager: DatabaseManager, id: number): SqliteMemoryEntry | undefined {
  const db = dbManager.getDb();
  const row = db
    .prepare(`
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    WHERE id = ?
  `)
    .get(id) as
    | {
        id: number;
        project: string | null;
        target: string;
        category: string | null;
        content: string;
        failure_reason: string | null;
        tool_state: string | null;
        corrected_to: string | null;
        created: string;
        last_referenced: string;
      }
    | undefined;

  return row ? mapRow(row) : undefined;
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

function parseMetadataComment(raw: string): {
  text: string;
  created: string;
  lastReferenced: string;
} {
  const match = raw.match(/^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^>]+)\s*-->\s*$/);
  const [, g1, g2, g3] = match ?? [];
  if (g1 && g2 && g3) {
    return {
      text: g1.trim(),
      created: g2.trim(),
      lastReferenced: g3.trim(),
    };
  }

  const fallback = today();
  return {
    text: raw.trim(),
    created: fallback,
    lastReferenced: fallback,
  };
}

/**
 * Add a memory entry to the SQLite store.
 */
export function addMemory(
  dbManager: DatabaseManager,
  content: string,
  target: "memory" | "user" | "failure" = "memory",
  project: string | undefined = undefined,
  category: MemoryCategory | undefined = undefined,
  failureReason: string | undefined = undefined,
  toolState: string | undefined = undefined,
  correctedTo: string | undefined = undefined,
  created = today(),
  lastReferenced = created,
): SqliteMemoryEntry {
  const db = dbManager.getDb();

  const result = db
    .prepare(`
    INSERT INTO memories (project, target, category, content, failure_reason, tool_state, corrected_to, created, last_referenced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      project,
      target,
      category,
      content,
      failureReason,
      toolState,
      correctedTo,
      created,
      lastReferenced,
    ) as { lastInsertRowid: number | bigint };

  return {
    id: Number(result.lastInsertRowid),
    project,
    target,
    category,
    content,
    failureReason,
    toolState,
    correctedTo,
    created,
    lastReferenced,
  };
}

/**
 * Build the visible failure-memory text stored in Markdown.
 */
export function formatFailureMemoryContent(
  content: string,
  options: {
    category: MemoryCategory;
    failureReason?: string | undefined;
    toolState?: string | undefined;
    correctedTo?: string | undefined;
    project?: string | undefined;
  },
): string {
  const categoryTag = `[${options.category}]`;
  const parts = [`${categoryTag} ${content.trim()}`.trim()];
  if (options.failureReason) parts.push(`Failed: ${options.failureReason}`);
  if (options.toolState) parts.push(`Tool state: ${options.toolState}`);
  if (options.correctedTo) parts.push(`Corrected to: ${options.correctedTo}`);
  if (options.project) parts.push(`Project: ${options.project}`);
  return parts.join(" — ");
}

/**
 * Parse a Markdown memory entry into SQLite sync fields.
 * Best-effort only: if failure metadata cannot be fully reconstructed,
 * content is still imported and available for search.
 */
export function parseMarkdownMemoryEntry(
  rawEntry: string,
  target: "memory" | "user" | "failure",
  project: string | undefined = undefined,
): ParsedMarkdownMemoryEntry {
  const { text, created, lastReferenced } = parseMetadataComment(rawEntry);
  const parsedProject = normalizeNullable(project);

  if (target !== "failure") {
    return {
      content: text,
      target,
      project: parsedProject,
      created,
      lastReferenced,
    };
  }

  let category: MemoryCategory | undefined = undefined;
  let failureReason: string | undefined = undefined;
  let toolState: string | undefined = undefined;
  let correctedTo: string | undefined = undefined;

  const categoryMatch = text.match(/^\[([^\]]+)\]\s+/);
  if (categoryMatch && FAILURE_CATEGORY_SET.has(categoryMatch[1] as MemoryCategory)) {
    category = categoryMatch[1] as MemoryCategory;
  }

  const segments = text.split(" — ");
  for (const segment of segments.slice(1)) {
    if (segment.startsWith("Failed: ") && !failureReason) {
      failureReason = segment.slice("Failed: ".length).trim() || undefined;
      continue;
    }
    if (segment.startsWith("Tool state: ") && !toolState) {
      toolState = segment.slice("Tool state: ".length).trim() || undefined;
      continue;
    }
    if (segment.startsWith("Corrected to: ") && !correctedTo) {
      correctedTo = segment.slice("Corrected to: ".length).trim() || undefined;
    }
  }

  return {
    content: text,
    target: "failure",
    project: parsedProject,
    category,
    failureReason,
    toolState,
    correctedTo,
    created,
    lastReferenced,
  };
}

/**
 * Idempotently sync a Markdown-backed memory entry into SQLite.
 * Duplicate identity is exact: project + target + category + content.
 */
export function syncMemoryEntry(
  dbManager: DatabaseManager,
  input: SqliteMemorySyncInput,
): SqliteMemorySyncResult {
  const db = dbManager.getDb();
  const content = input.content.trim();
  const project = normalizeNullable(input.project);
  const category = normalizeCategory(input.category);
  const failureReason = normalizeNullable(input.failureReason);
  const toolState = normalizeNullable(input.toolState);
  const correctedTo = normalizeNullable(input.correctedTo);
  const created = (input.created && input.created.trim()) || today();
  const lastReferenced = (input.lastReferenced && input.lastReferenced.trim()) || created;

  const params: unknown[] = [];
  const conditions = buildScopeConditions(params, input.target, project, category);
  conditions.push("content = ?");
  params.push(content);

  const existing = db
    .prepare(`
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    WHERE ${conditions.join(" AND ")}
    ORDER BY id ASC
    LIMIT 1
  `)
    .get(...params) as
    | {
        id: number;
        project: string | null;
        target: string;
        category: string | null;
        content: string;
        failure_reason: string | null;
        tool_state: string | null;
        corrected_to: string | null;
        created: string;
        last_referenced: string;
      }
    | undefined;

  if (!existing) {
    return {
      action: "inserted",
      entry: addMemory(
        dbManager,
        content,
        input.target,
        project,
        category,
        failureReason,
        toolState,
        correctedTo,
        created,
        lastReferenced,
      ),
    };
  }

  const updatedCreated = minDate(existing.created, created);
  const updatedLastReferenced = maxDate(existing.last_referenced, lastReferenced);
  const updatedCategory = (existing.category as MemoryCategory | undefined) ?? category;
  const updatedFailureReason = existing.failure_reason ?? failureReason;
  const updatedToolState = existing.tool_state ?? toolState;
  const updatedCorrectedTo = existing.corrected_to ?? correctedTo;

  db.prepare(`
    UPDATE memories
    SET category = ?, failure_reason = ?, tool_state = ?, corrected_to = ?, created = ?, last_referenced = ?
    WHERE id = ?
  `).run(
    updatedCategory,
    updatedFailureReason,
    updatedToolState,
    updatedCorrectedTo,
    updatedCreated,
    updatedLastReferenced,
    existing.id,
  );

  const entry = getMemoryById(dbManager, existing.id);
  if (!entry) throw new Error(`Memory ${existing.id} not found after update`);
  return {
    action: "existing",
    entry,
  };
}

/**
 * Best-effort substring replacement for SQLite-backed memory sync.
 * Updates all matches in the scoped slice to recover from prior duplicate rows.
 */
export function replaceSyncedMemories(
  dbManager: DatabaseManager,
  oldText: string,
  updates: {
    content: string;
    target: "memory" | "user" | "failure";
    project?: string | undefined;
    category?: MemoryCategory | undefined;
    failureReason?: string | undefined;
    toolState?: string | undefined;
    correctedTo?: string | undefined;
    lastReferenced?: string | undefined;
  },
): SqliteMemoryUpdateResult {
  const db = dbManager.getDb();
  const normalizedOldText = normalizeMemoryLookupText(oldText);
  if (!normalizedOldText) return { matched: 0, updated: 0, entries: [] };
  const params: unknown[] = [];
  const conditions = buildScopeConditions(params, updates.target, updates.project ?? undefined);
  conditions.push(`content LIKE ? ESCAPE '\\'`);
  params.push(`%${escapeLikePattern(normalizedOldText)}%`);

  const rows = db
    .prepare(`
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    WHERE ${conditions.join(" AND ")}
    ORDER BY id ASC
  `)
    .all(...params) as Array<{
    id: number;
    project: string | null;
    target: string;
    category: string | null;
    content: string;
    failure_reason: string | null;
    tool_state: string | null;
    corrected_to: string | null;
    created: string;
    last_referenced: string;
  }>;

  if (rows.length === 0) {
    return { matched: 0, updated: 0, entries: [] };
  }

  const nextLastReferenced = (updates.lastReferenced && updates.lastReferenced.trim()) || today();

  for (const row of rows) {
    db.prepare(`
      UPDATE memories
      SET content = ?,
          category = ?,
          failure_reason = ?,
          tool_state = ?,
          corrected_to = ?,
          last_referenced = ?
      WHERE id = ?
    `).run(
      updates.content.trim(),
      updates.category === undefined ? row.category : updates.category,
      updates.failureReason === undefined
        ? row.failure_reason
        : normalizeNullable(updates.failureReason),
      updates.toolState === undefined ? row.tool_state : normalizeNullable(updates.toolState),
      updates.correctedTo === undefined ? row.corrected_to : normalizeNullable(updates.correctedTo),
      nextLastReferenced,
      row.id,
    );
  }

  return {
    matched: rows.length,
    updated: rows.length,
    entries: rows
      .map((row) => getMemoryById(dbManager, row.id))
      .filter((entry): entry is SqliteMemoryEntry => entry !== undefined),
  };
}

/**
 * Best-effort substring removal for SQLite-backed memory sync.
 * Deletes all matches in the scoped slice to recover from prior duplicate rows.
 */
export function removeSyncedMemories(
  dbManager: DatabaseManager,
  oldText: string,
  options: SqliteMemoryRemoveOptions,
): SqliteMemoryRemoveResult {
  const db = dbManager.getDb();
  const normalizedOldText = normalizeMemoryLookupText(oldText);
  if (!normalizedOldText) return { matched: 0, removed: 0 };
  const params: unknown[] = [];
  const conditions = buildScopeConditions(params, options.target, options.project ?? undefined);
  conditions.push(`content LIKE ? ESCAPE '\\'`);
  params.push(`%${escapeLikePattern(normalizedOldText)}%`);

  const matchingIds = db
    .prepare(`
    SELECT id
    FROM memories
    WHERE ${conditions.join(" AND ")}
  `)
    .all(...params) as Array<{ id: number }>;

  if (matchingIds.length === 0) {
    return { matched: 0, removed: 0 };
  }

  const deleteParams = matchingIds.map((row) => row.id);
  const placeholders = deleteParams.map(() => "?").join(", ");
  const result = db
    .prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
    .run(...deleteParams) as { changes: number };

  return {
    matched: matchingIds.length,
    removed: result.changes,
  };
}

/**
 * Exact removal for Markdown entries whose full content is known.
 * Used for FIFO eviction cleanup, where substring matching could remove
 * unrelated SQLite mirror rows that merely contain the evicted text.
 */
export function removeExactSyncedMemories(
  dbManager: DatabaseManager,
  content: string,
  options: SqliteMemoryRemoveOptions,
): SqliteMemoryRemoveResult {
  const db = dbManager.getDb();
  const params: unknown[] = [];
  const conditions = buildScopeConditions(params, options.target, options.project ?? undefined);
  conditions.push("content = ?");
  params.push(content.trim());

  const matchingIds = db
    .prepare(`
    SELECT id
    FROM memories
    WHERE ${conditions.join(" AND ")}
  `)
    .all(...params) as Array<{ id: number }>;

  if (matchingIds.length === 0) {
    return { matched: 0, removed: 0 };
  }

  const deleteParams = matchingIds.map((row) => row.id);
  const placeholders = deleteParams.map(() => "?").join(", ");
  const result = db
    .prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
    .run(...deleteParams) as { changes: number };

  return {
    matched: matchingIds.length,
    removed: result.changes,
  };
}

/**
 * Search memories using FTS5.
 */
export function searchMemories(
  dbManager: DatabaseManager,
  query: string,
  options: { project?: string; target?: string; category?: MemoryCategory; limit?: number } = {},
): SqliteMemoryEntry[] {
  if (query.trim().length === 0) {
    return [];
  }

  const db = dbManager.getDb();
  const { project, target, category, limit = 10 } = options;

  // FTS5 match via subquery with escaped query
  const normalizedQuery = normalizeFts5Query(query);
  if (normalizedQuery.length === 0) {
    return [];
  }

  const runSearch = (matchQuery: string): SqliteMemoryEntry[] => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    conditions.push("m.id IN (SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?)");
    params.push(matchQuery);

    if (project) {
      conditions.push("m.project = ?");
      params.push(project);
    }

    if (target) {
      conditions.push("m.target = ?");
      params.push(target);
    }

    if (category) {
      conditions.push("m.category = ?");
      params.push(category);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT ${MEMORY_SELECT_COLUMNS}
      FROM memories m
      ${whereClause}
      ORDER BY m.last_referenced DESC
      LIMIT ?
    `;

    try {
      const rows = db.prepare(sql).all(...params, limit) as Array<{
        id: number;
        project: string | null;
        target: string;
        category: string | null;
        content: string;
        failure_reason: string | null;
        tool_state: string | null;
        corrected_to: string | null;
        created: string;
        last_referenced: string;
      }>;

      return rows.map(mapRow);
    } catch (err) {
      if (isFts5QueryError(err)) {
        return [];
      }
      throw err;
    }
  };

  const exactResults = runSearch(normalizedQuery);
  if (exactResults.length > 0) {
    return exactResults;
  }

  const fallbackQuery = buildFallbackFts5Query(query);
  if (!fallbackQuery || fallbackQuery === normalizedQuery) {
    return exactResults;
  }

  return runSearch(fallbackQuery);
}

/**
 * Get all memories, optionally filtered.
 */
export function getMemories(
  dbManager: DatabaseManager,
  options: { project?: string; target?: string; category?: MemoryCategory } = {},
): SqliteMemoryEntry[] {
  const db = dbManager.getDb();
  const { project, target, category } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (project) {
    conditions.push("project = ?");
    params.push(project);
  }

  if (target) {
    conditions.push("target = ?");
    params.push(target);
  }

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(`
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    ${whereClause}
    ORDER BY last_referenced DESC
  `)
    .all(...params) as Array<{
    id: number;
    project: string | null;
    target: string;
    category: string | null;
    content: string;
    failure_reason: string | null;
    tool_state: string | null;
    corrected_to: string | null;
    created: string;
    last_referenced: string;
  }>;

  return rows.map(mapRow);
}

/**
 * Remove a memory by ID.
 */
export function removeMemory(dbManager: DatabaseManager, id: number): boolean {
  const db = dbManager.getDb();
  const result = db.prepare("DELETE FROM memories WHERE id = ?").run(id) as { changes: number };
  return result.changes > 0;
}

/**
 * Get recent failure memories (last N days).
 */
export function getRecentFailures(
  dbManager: DatabaseManager,
  maxAgeDays = 7,
  project?: string,
): SqliteMemoryEntry[] {
  const db = dbManager.getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const conditions: string[] = ["target = ?", "created >= ?"];
  const params: unknown[] = ["failure", cutoffStr];

  if (project) {
    conditions.push("(project = ? OR project IS NULL)");
    params.push(project);
  }

  const rows = db
    .prepare(`
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    WHERE ${conditions.join(" AND ")}
    ORDER BY created DESC
    LIMIT 5
  `)
    .all(...params) as Array<{
    id: number;
    project: string | null;
    target: string;
    category: string | null;
    content: string;
    failure_reason: string | null;
    tool_state: string | null;
    corrected_to: string | null;
    created: string;
    last_referenced: string;
  }>;

  return rows.map(mapRow);
}

/**
 * Update a memory's last_referenced date.
 */
export function touchMemory(dbManager: DatabaseManager, id: number): void {
  const db = dbManager.getDb();
  db.prepare("UPDATE memories SET last_referenced = ? WHERE id = ?").run(today(), id);
}

/**
 * Get memory statistics.
 */
export function getMemoryStats(dbManager: DatabaseManager): {
  total: number;
  byProject: { project: string | null; count: number }[];
  byTarget: { target: string; count: number }[];
} {
  const db = dbManager.getDb();

  const total = (db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number })
    .count;

  const byProject = db
    .prepare(`
    SELECT project, COUNT(*) as count
    FROM memories
    GROUP BY project
    ORDER BY count DESC
  `)
    .all() as { project: string | null; count: number }[];

  const byTarget = db
    .prepare(`
    SELECT target, COUNT(*) as count
    FROM memories
    GROUP BY target
    ORDER BY count DESC
  `)
    .all() as { target: string; count: number }[];

  return { total, byProject, byTarget };
}
