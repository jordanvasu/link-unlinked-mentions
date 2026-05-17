export interface Span {
	start: number;
	end: number;
	scannable: boolean;
}

export interface TermEntry {
	term: string;
	canonicalTitle: string;
}

export interface TermSource {
	basename: string;
	aliases: string[];
	path: string;
}

export interface MatchResult {
	start: number;
	end: number;
	matchedText: string;
	canonicalTitle: string;
	contextBefore: string;
	contextAfter: string;
}

export function getAliases(raw: unknown): string[] {
	if (!raw) return [];
	if (typeof raw === "string") return [raw];
	if (Array.isArray(raw)) return raw.filter((a): a is string => typeof a === "string");
	return [];
}

/**
 * Builds the deduplicated term list from vault file metadata.
 * Terms that appear in multiple files are dropped and reported as ambiguous.
 * excludeTerms (lowercased) are skipped — used to omit the active note's own names.
 */
export function buildTermEntries(
	sources: TermSource[],
	excludeTerms: Set<string>
): { terms: TermEntry[]; ambiguous: string[] } {
	// key: lowercase(term) → { original term, canonical title, set of file paths }
	const termMap = new Map<string, { term: string; canonicalTitle: string; paths: Set<string> }>();

	for (const source of sources) {
		const seenForFile = new Set<string>();
		for (const raw of [source.basename, ...source.aliases]) {
			const term = raw.trim();
			if (term.length < 2) continue;
			const key = term.toLowerCase();
			if (excludeTerms.has(key) || seenForFile.has(key)) continue;
			seenForFile.add(key);

			const existing = termMap.get(key);
			if (!existing) {
				termMap.set(key, { term, canonicalTitle: source.basename, paths: new Set([source.path]) });
			} else {
				existing.paths.add(source.path);
			}
		}
	}

	const terms: TermEntry[] = [];
	const ambiguous: string[] = [];

	for (const entry of termMap.values()) {
		if (entry.paths.size > 1) {
			ambiguous.push(entry.term);
		} else {
			terms.push({ term: entry.term, canonicalTitle: entry.canonicalTitle });
		}
	}

	// Longest first — ensures longer titles win in the regex alternation
	terms.sort((a, b) => b.term.length - a.term.length);
	return { terms, ambiguous };
}

/**
 * Splits content into scannable and protected spans.
 * Protected: fenced code, inline code, math blocks, inline math, YAML frontmatter,
 * existing wikilinks, markdown links, HTML comments, tags.
 */
export function splitIntoSpans(content: string): Span[] {
	const protected_ranges: Array<{ start: number; end: number }> = [];

	// YAML frontmatter must be at the very start of the file
	const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
	if (fmMatch) {
		protected_ranges.push({ start: 0, end: fmMatch[0].length });
	}

	const patternSources: string[] = [
		"```[\\s\\S]*?```",          // fenced code (backtick)
		"~~~[\\s\\S]*?~~~",          // fenced code (tilde)
		"`[^`\\n]+`",                // inline code
		"\\$\\$[\\s\\S]*?\\$\\$",   // math block
		"\\$[^$\\n]+\\$",           // inline math
		"\\[\\[[^\\]]*\\]\\]",      // wikilinks [[...]] and [[A|B]]
		"\\[[^\\]]*\\]\\([^)]*\\)", // markdown links [text](url)
		"<!--[\\s\\S]*?-->",        // HTML comments
		"#[^\\s#\\[\\](){}<>]+",    // tags (#tag)
	];

	for (const src of patternSources) {
		const re = new RegExp(src, "g");
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			protected_ranges.push({ start: m.index, end: m.index + m[0].length });
		}
	}

	protected_ranges.sort((a, b) => a.start - b.start || b.end - a.end);

	// Merge overlapping protected ranges
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

	const spans: Span[] = [];
	let pos = 0;
	for (const range of merged) {
		if (pos < range.start) spans.push({ start: pos, end: range.start, scannable: true });
		spans.push({ start: range.start, end: range.end, scannable: false });
		pos = range.end;
	}
	if (pos < content.length) spans.push({ start: pos, end: content.length, scannable: true });

	return spans;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// For notes larger than this threshold, process spans line-by-line to stay responsive
const LARGE_SPAN_THRESHOLD = 50_000;

function collectMatches(
	chunk: string,
	chunkBaseOffset: number,
	re: RegExp,
	lookup: Map<string, string>,
	fullContent: string,
	results: MatchResult[]
): void {
	re.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(chunk)) !== null) {
		const matchedText = m[1];
		const absoluteStart = chunkBaseOffset + m.index;
		const absoluteEnd = absoluteStart + matchedText.length;
		const canonicalTitle = lookup.get(matchedText.toLowerCase()) ?? matchedText;
		results.push({
			start: absoluteStart,
			end: absoluteEnd,
			matchedText,
			canonicalTitle,
			contextBefore: fullContent.slice(Math.max(0, absoluteStart - 40), absoluteStart),
			contextAfter: fullContent.slice(absoluteEnd, Math.min(fullContent.length, absoluteEnd + 40)),
		});
	}
}

/**
 * Finds all matches of any TermEntry in the scannable spans of content.
 * Uses a single alternation regex (longest terms first) for performance.
 * Large scannable spans are chunked at newline boundaries.
 */
export function findMatches(content: string, terms: TermEntry[]): MatchResult[] {
	if (terms.length === 0) return [];

	// Build lookup: lowercase term → canonical title
	const lookup = new Map<string, string>();
	for (const entry of terms) {
		lookup.set(entry.term.toLowerCase(), entry.canonicalTitle);
	}

	// Sort longest first so the alternation prefers longer titles
	const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
	const pattern = sorted.map((e) => escapeRegex(e.term)).join("|");
	const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${pattern})(?![\\p{L}\\p{N}_])`, "giu");

	const spans = splitIntoSpans(content);
	const results: MatchResult[] = [];

	for (const span of spans) {
		if (!span.scannable) continue;
		const spanText = content.slice(span.start, span.end);

		if (spanText.length > LARGE_SPAN_THRESHOLD) {
			// Chunk at newline boundaries so no title match crosses a chunk boundary
			let pos = 0;
			while (pos < spanText.length) {
				let end = Math.min(pos + LARGE_SPAN_THRESHOLD, spanText.length);
				if (end < spanText.length) {
					const nl = spanText.lastIndexOf("\n", end);
					if (nl > pos) end = nl + 1;
				}
				collectMatches(spanText.slice(pos, end), span.start + pos, re, lookup, content, results);
				pos = end;
			}
		} else {
			collectMatches(spanText, span.start, re, lookup, content, results);
		}
	}

	results.sort((a, b) => a.start - b.start);
	return results;
}

/**
 * Replaces each match in content with its wikilink form.
 * Uses [[Title]] when matched text equals the canonical title exactly,
 * [[Title|matched]] otherwise (preserves case and alias prose form).
 * Applies in reverse position order so earlier offsets stay valid.
 */
export function applyReplacements(content: string, matches: MatchResult[]): string {
	const sorted = [...matches].sort((a, b) => b.start - a.start);
	let result = content;
	for (const match of sorted) {
		const useAlias = match.matchedText !== match.canonicalTitle;
		const link = useAlias
			? `[[${match.canonicalTitle}|${match.matchedText}]]`
			: `[[${match.canonicalTitle}]]`;
		result = result.slice(0, match.start) + link + result.slice(match.end);
	}
	return result;
}
