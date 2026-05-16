export interface Span {
	start: number;
	end: number;
	scannable: boolean;
}

export interface MatchResult {
	start: number;
	end: number;
	matchedText: string;
	term: string;
	contextBefore: string;
	contextAfter: string;
}

/**
 * Splits content into scannable and protected spans.
 * Protected spans cover: fenced code, inline code, math blocks, inline math,
 * YAML frontmatter, existing wikilinks, markdown links, HTML comments, and tags.
 */
export function splitIntoSpans(content: string): Span[] {
	const spans: Span[] = [];
	let pos = 0;

	// Collect protected ranges
	const protected_ranges: Array<{ start: number; end: number }> = [];

	// YAML frontmatter: must be at start of file
	const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
	if (frontmatterMatch) {
		protected_ranges.push({ start: 0, end: frontmatterMatch[0].length });
	}

	// All other protected zones found by scanning
	const patterns: Array<{ pattern: RegExp; flags?: string }> = [
		// Fenced code blocks (``` or ~~~)
		{ pattern: /```[\s\S]*?```/g },
		{ pattern: /~~~[\s\S]*?~~~/g },
		// Inline code
		{ pattern: /`[^`\n]+`/g },
		// Math blocks $$...$$
		{ pattern: /\$\$[\s\S]*?\$\$/g },
		// Inline math $...$  (single dollar, not $$)
		{ pattern: /\$[^\$\n]+\$/g },
		// Existing wikilinks [[...]] including [[A|B]]
		{ pattern: /\[\[[^\]]*\]\]/g },
		// Markdown links [text](url)
		{ pattern: /\[[^\]]*\]\([^)]*\)/g },
		// HTML comments <!-- ... -->
		{ pattern: /<!--[\s\S]*?-->/g },
		// Tags: #word (not part of heading)
		{ pattern: /#[^\s#\[\](){}<>!@$%^&*+=|\\;:'",.?/`~]+/g },
	];

	for (const { pattern } of patterns) {
		const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			protected_ranges.push({ start: m.index, end: m.index + m[0].length });
		}
	}

	// Sort protected ranges by start, then merge overlapping ones
	protected_ranges.sort((a, b) => a.start - b.start || b.end - a.end);

	const merged: Array<{ start: number; end: number }> = [];
	for (const range of protected_ranges) {
		if (merged.length === 0) {
			merged.push({ ...range });
		} else {
			const last = merged[merged.length - 1];
			if (range.start <= last.end) {
				last.end = Math.max(last.end, range.end);
			} else {
				merged.push({ ...range });
			}
		}
	}

	// Build spans from merged protected ranges
	pos = 0;
	for (const range of merged) {
		if (pos < range.start) {
			spans.push({ start: pos, end: range.start, scannable: true });
		}
		spans.push({ start: range.start, end: range.end, scannable: false });
		pos = range.end;
	}
	if (pos < content.length) {
		spans.push({ start: pos, end: content.length, scannable: true });
	}

	return spans;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds all matches of any term in the scannable spans of content.
 * Prefers longest match when multiple terms overlap at the same position.
 */
export function findMatches(content: string, terms: string[]): MatchResult[] {
	const validTerms = terms
		.filter((t) => t.trim().length >= 2)
		.sort((a, b) => b.length - a.length); // longest first

	if (validTerms.length === 0) return [];

	const spans = splitIntoSpans(content);
	const results: MatchResult[] = [];

	// Build a combined pattern that tries longest term first
	const pattern = validTerms.map(escapeRegex).join("|");
	// Unicode-aware word boundaries using lookarounds
	const re = new RegExp(
		`(?<![\\p{L}\\p{N}_])(${pattern})(?![\\p{L}\\p{N}_])`,
		"giu"
	);

	for (const span of spans) {
		if (!span.scannable) continue;

		const chunk = content.slice(span.start, span.end);
		re.lastIndex = 0;

		let m: RegExpExecArray | null;
		while ((m = re.exec(chunk)) !== null) {
			const matchedText = m[1];
			const absoluteStart = span.start + m.index;
			const absoluteEnd = absoluteStart + m[0].length;

			// Determine which term matched (for canonical replacement)
			const matchedTerm = validTerms.find(
				(t) => t.toLowerCase() === matchedText.toLowerCase()
			) ?? matchedText;

			const ctxStart = Math.max(0, absoluteStart - 40);
			const ctxEnd = Math.min(content.length, absoluteEnd + 40);
			const contextBefore = content.slice(ctxStart, absoluteStart);
			const contextAfter = content.slice(absoluteEnd, ctxEnd);

			results.push({
				start: absoluteStart,
				end: absoluteEnd,
				matchedText,
				term: matchedTerm,
				contextBefore,
				contextAfter,
			});
		}
	}

	// Sort by position ascending
	results.sort((a, b) => a.start - b.start);

	return results;
}

/**
 * Applies replacements to content, replacing matches with wikilinks.
 * If matched text equals canonical title (case-insensitively), uses [[Title]].
 * Otherwise uses [[Title|matched text]] to preserve prose form.
 * Processes matches in reverse order to preserve offsets.
 */
export function applyReplacements(
	content: string,
	matches: MatchResult[],
	canonicalTitle: string
): string {
	// Work from end to start so offsets stay valid
	const sorted = [...matches].sort((a, b) => b.start - a.start);

	let result = content;
	for (const match of sorted) {
		const before = result.slice(0, match.start);
		const after = result.slice(match.end);
		const useAlias = match.matchedText !== canonicalTitle;
		const link = useAlias
			? `[[${canonicalTitle}|${match.matchedText}]]`
			: `[[${canonicalTitle}]]`;
		result = before + link + after;
	}

	return result;
}
