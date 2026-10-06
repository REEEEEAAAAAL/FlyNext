/**
 * Statement splitting for the repository's `.sql` files.
 *
 * Shared by everything that runs SQL through Prisma: the demo seed
 * (`prisma/seed.ts`, replaying `generate_data.sql`) and the integration suite's
 * migration bootstrap (`tests/support/migrate.ts`).
 *
 * `$executeRawUnsafe` sends its argument over the extended query protocol, which
 * parses exactly one statement per call. Handing it a whole file instead
 * fails with SQLSTATE 42601, "cannot insert multiple commands into a prepared
 * statement" — which is why both callers split first and execute in a loop.
 */

/**
 * Split a SQL script into the individual statements it contains.
 *
 * A plain `split(";")` is not good enough, because these files are not lists of
 * trivial one-liners:
 *
 *   - `prisma/generate_data.sql` contains `DO $$ … END $$;` blocks whose bodies
 *     are full of semicolons;
 *   - a literal such as `'O''Hare International Airport'` escapes a quote by
 *     doubling it, and a semicolon inside any string or comment is data (or
 *     prose) rather than a separator;
 *   - a migration file may open with a long comment block that belongs to the
 *     statement after it.
 *
 * The scan below therefore walks the script one character at a time, tracks the
 * lexical state it is in, and cuts only on a semicolon that appears in ordinary
 * SQL.
 *
 * @param sql contents of a `.sql` file.
 * @returns the executable statements in file order, each without its terminating
 *          semicolon. Blank and comment-only fragments are dropped, because
 *          Postgres rejects an empty statement.
 */
export function splitSqlStatements(sql: string): string[] {
	/** Matches a dollar-quote delimiter: `$$` or `$tag$`. */
	const DOLLAR_QUOTE = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;

	const statements: string[] = [];
	let statement = "";
	// Set once the fragment holds something Postgres would actually execute,
	// which is what separates a real statement from trailing comments and blank
	// lines at the end of the file.
	let executable = false;
	let at = 0;

	const endStatement = (): void => {
		const trimmed = statement.trim();
		if (executable && trimmed.length > 0) {
			statements.push(trimmed);
		}
		statement = "";
		executable = false;
	};

	while (at < sql.length) {
		const char = sql[at];
		const next = sql[at + 1];

		// `-- …` runs to the end of the line. The text is kept, since a comment is
		// legal inside a statement, but it does not make a fragment executable.
		if (char === "-" && next === "-") {
			const newline = sql.indexOf("\n", at);
			const stop = newline === -1 ? sql.length : newline;
			statement += sql.slice(at, stop);
			at = stop;
			continue;
		}

		// `/* … */`. Postgres allows these to nest, so the depth is counted.
		if (char === "/" && next === "*") {
			let depth = 1;
			let cursor = at + 2;
			while (cursor < sql.length && depth > 0) {
				if (sql.startsWith("/*", cursor)) {
					depth += 1;
					cursor += 2;
				} else if (sql.startsWith("*/", cursor)) {
					depth -= 1;
					cursor += 2;
				} else {
					cursor += 1;
				}
			}
			statement += sql.slice(at, cursor);
			at = cursor;
			continue;
		}

		// `'…'`, a string literal, where `''` is an embedded quote: the `O''Hare`
		// airport name must not be read as the end of the literal.
		if (char === "'") {
			let cursor = at + 1;
			while (cursor < sql.length) {
				if (sql[cursor] !== "'") {
					cursor += 1;
				} else if (sql[cursor + 1] === "'") {
					cursor += 2;
				} else {
					cursor += 1;
					break;
				}
			}
			statement += sql.slice(at, cursor);
			executable = true;
			at = cursor;
			continue;
		}

		// `"…"`, a quoted identifier such as `"City"`; `""` is an embedded quote.
		if (char === '"') {
			let cursor = at + 1;
			while (cursor < sql.length) {
				if (sql[cursor] !== '"') {
					cursor += 1;
				} else if (sql[cursor + 1] === '"') {
					cursor += 2;
				} else {
					cursor += 1;
					break;
				}
			}
			statement += sql.slice(at, cursor);
			executable = true;
			at = cursor;
			continue;
		}

		// `$$ … $$` or `$tag$ … $tag$`. The bodies of the `DO` blocks in
		// `generate_data.sql` are full of semicolons and have to survive the split
		// untouched. A number such as `$1` is not a delimiter, which is why the tag
		// must be followed by `$`.
		if (char === "$") {
			const delimiter = DOLLAR_QUOTE.exec(sql.slice(at));
			if (delimiter !== null) {
				const closer = sql.indexOf(delimiter[0], at + delimiter[0].length);
				const stop = closer === -1 ? sql.length : closer + delimiter[0].length;
				statement += sql.slice(at, stop);
				executable = true;
				at = stop;
				continue;
			}
		}

		if (char === ";") {
			endStatement();
			at += 1;
			continue;
		}

		statement += char;
		if (!/\s/.test(char)) {
			executable = true;
		}
		at += 1;
	}

	endStatement();
	return statements;
}

/** The first line of a statement, short enough for an error message. */
export function firstLine(statement: string): string {
	const line = statement.split("\n", 1)[0].trim();
	return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}
