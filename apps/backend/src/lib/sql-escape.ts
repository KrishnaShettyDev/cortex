/**
 * SQL LIKE Pattern Escaping
 *
 * Prevents SQL injection via LIKE pattern wildcards.
 * In SQLite, LIKE special characters are: % (any chars), _ (single char), \ (escape)
 *
 * Without escaping, user input like "100% discount" becomes a wildcard pattern.
 */

/**
 * Escape special characters in a string for use in SQL LIKE patterns
 *
 * @param value - The user input to escape
 * @returns Escaped string safe for use in LIKE patterns
 *
 * @example
 * ```ts
 * // User searches for "100% off"
 * const escaped = escapeLikePattern("100% off");
 * // Returns "100\% off"
 *
 * // Use in query
 * db.prepare("SELECT * FROM products WHERE name LIKE ?")
 *   .bind(`%${escaped}%`)
 *   .all();
 * ```
 */
export function escapeLikePattern(value: string): string {
  if (!value) return '';

  return value
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/%/g, '\\%')   // Escape percent signs
    .replace(/_/g, '\\_');  // Escape underscores
}

/**
 * Build a LIKE pattern for partial matching with escaped user input
 *
 * @param value - The user input to search for
 * @param position - Where to add wildcards ('start', 'end', 'both', or 'exact')
 * @returns LIKE pattern with proper escaping
 *
 * @example
 * ```ts
 * // Contains search
 * const pattern = buildLikePattern("test", "both"); // "%test%"
 *
 * // Starts with
 * const pattern = buildLikePattern("test", "end"); // "test%"
 *
 * // Ends with
 * const pattern = buildLikePattern("test", "start"); // "%test"
 * ```
 */
export function buildLikePattern(
  value: string,
  position: 'start' | 'end' | 'both' | 'exact' = 'both'
): string {
  const escaped = escapeLikePattern(value);

  switch (position) {
    case 'start':
      return `%${escaped}`;
    case 'end':
      return `${escaped}%`;
    case 'both':
      return `%${escaped}%`;
    case 'exact':
      return escaped;
    default:
      return `%${escaped}%`;
  }
}

/**
 * Build multiple LIKE conditions for keyword search
 *
 * @param keywords - Array of keywords to search for
 * @param column - The column name to search in
 * @param operator - 'OR' or 'AND' to combine conditions
 * @returns Object with SQL condition string and parameter values
 *
 * @example
 * ```ts
 * const { condition, params } = buildKeywordSearch(
 *   ["hello", "world"],
 *   "content",
 *   "OR"
 * );
 * // condition: "(content LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')"
 * // params: ["%hello%", "%world%"]
 *
 * // Use in query
 * db.prepare(`SELECT * FROM memories WHERE user_id = ? AND ${condition}`)
 *   .bind(userId, ...params)
 *   .all();
 * ```
 */
export function buildKeywordSearch(
  keywords: string[],
  column: string,
  operator: 'OR' | 'AND' = 'OR'
): { condition: string; params: string[] } {
  if (!keywords.length) {
    return { condition: '1=1', params: [] };
  }

  // Filter and escape keywords
  const validKeywords = keywords
    .filter((k) => k && k.trim().length > 0)
    .map((k) => buildLikePattern(k.trim(), 'both'));

  if (!validKeywords.length) {
    return { condition: '1=1', params: [] };
  }

  // Note: SQLite uses ESCAPE clause to specify the escape character
  const conditions = validKeywords.map(() => `${column} LIKE ? ESCAPE '\\'`);
  const condition = `(${conditions.join(` ${operator} `)})`;

  return { condition, params: validKeywords };
}
