import { describe, it, expect } from "vitest";
import {
	getAliases,
	buildTermEntries,
	splitIntoSpans,
	findMatches,
	applyReplacements,
	TermSource,
	TermEntry,
	MatchResult,
} from "./matcher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function terms(...pairs: [string, string][]): TermEntry[] {
	return pairs.map(([term, canonicalTitle]) => ({ term, canonicalTitle }));
}

function src(basename: string, path?: string, ...aliases: string[]): TermSource {
	return { basename, aliases, path: path ?? `${basename}.md` };
}

// ---------------------------------------------------------------------------
// getAliases — all three frontmatter forms
// ---------------------------------------------------------------------------
describe("getAliases", () => {
	it("returns [] for undefined", () => {
		expect(getAliases(undefined)).toEqual([]);
	});

	it("returns [] for null", () => {
		expect(getAliases(null)).toEqual([]);
	});

	it("returns [] for empty string", () => {
		expect(getAliases("")).toEqual([]);
	});

	it("wraps a bare string in an array (form: aliases: My Alias)", () => {
		expect(getAliases("My Alias")).toEqual(["My Alias"]);
	});

	it("returns a string array as-is (form: aliases: [A, B])", () => {
		expect(getAliases(["Alice", "Al"])).toEqual(["Alice", "Al"]);
	});

	it("filters non-string elements from a mixed array", () => {
		expect(getAliases(["Alice", 42, null, "Al"])).toEqual(["Alice", "Al"]);
	});

	it("returns [] for a number", () => {
		expect(getAliases(42)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// buildTermEntries
// ---------------------------------------------------------------------------
describe("buildTermEntries", () => {
	it("produces one TermEntry per source with its canonical title", () => {
		const { terms: out, ambiguous } = buildTermEntries(
			[src("Alice"), src("Bob")],
			new Set()
		);
		expect(out).toHaveLength(2);
		expect(out.map((t) => t.canonicalTitle)).toContain("Alice");
		expect(out.map((t) => t.canonicalTitle)).toContain("Bob");
		expect(ambiguous).toHaveLength(0);
	});

	it("includes aliases as additional TermEntries", () => {
		const { terms: out } = buildTermEntries(
			[src("Alice", "alice.md", "Al", "A.J.")],
			new Set()
		);
		const termTexts = out.map((t) => t.term);
		expect(termTexts).toContain("Alice");
		expect(termTexts).toContain("Al");
		// "A.J." length is 4, passes the ≥2 filter
		expect(termTexts).toContain("A.J.");
	});

	it("marks a term as ambiguous when two different files share it", () => {
		const { terms: out, ambiguous } = buildTermEntries(
			[src("Alice", "alice.md", "Shared"), src("Bob", "bob.md", "Shared")],
			new Set()
		);
		expect(ambiguous.map((s) => s.toLowerCase())).toContain("shared");
		expect(out.map((t) => t.term.toLowerCase())).not.toContain("shared");
	});

	it("two files sharing a term by basename vs alias are also ambiguous", () => {
		// File "Validity.md" has basename "Validity"
		// File "Other.md" has alias "Validity"
		const { ambiguous } = buildTermEntries(
			[src("Validity", "validity.md"), src("Other", "other.md", "Validity")],
			new Set()
		);
		expect(ambiguous.map((s) => s.toLowerCase())).toContain("validity");
	});

	it("excludes active note's own title via excludeTerms", () => {
		const { terms: out } = buildTermEntries(
			[src("Alice"), src("ActiveNote")],
			new Set(["activenote"])
		);
		expect(out.map((t) => t.term.toLowerCase())).not.toContain("activenote");
		expect(out.map((t) => t.term.toLowerCase())).toContain("alice");
	});

	it("excludes active note's aliases via excludeTerms", () => {
		const { terms: out } = buildTermEntries(
			[src("Alice"), src("OtherNote", "other.md", "my-alias")],
			new Set(["alice", "my-alias"])  // active note has alias "my-alias"
		);
		expect(out.map((t) => t.term.toLowerCase())).not.toContain("my-alias");
	});

	it("filters terms with fewer than 2 characters", () => {
		const { terms: out } = buildTermEntries(
			[src("A", "a.md"), src("Alice")],
			new Set()
		);
		expect(out.map((t) => t.term.toLowerCase())).not.toContain("a");
		expect(out.map((t) => t.term.toLowerCase())).toContain("alice");
	});

	it("filters whitespace-only terms", () => {
		const { terms: out } = buildTermEntries(
			[src("   ", "blank.md"), src("Alice")],
			new Set()
		);
		expect(out.map((t) => t.term)).not.toContain("   ");
	});

	it("sorts output by term length descending", () => {
		const { terms: out } = buildTermEntries(
			[src("AB"), src("Longer Title"), src("Mid")],
			new Set()
		);
		for (let i = 1; i < out.length; i++) {
			expect(out[i].term.length).toBeLessThanOrEqual(out[i - 1].term.length);
		}
	});

	it("does not double-count when a file lists the same alias twice", () => {
		const { terms: out, ambiguous } = buildTermEntries(
			[
				{ basename: "Alice", aliases: ["Al", "Al"], path: "alice.md" },
				src("Bob"),
			],
			new Set()
		);
		// "Al" should not be ambiguous — it came from one file
		expect(ambiguous.map((s) => s.toLowerCase())).not.toContain("al");
		expect(out.map((t) => t.term.toLowerCase())).toContain("al");
	});
});

// ---------------------------------------------------------------------------
// splitIntoSpans
// ---------------------------------------------------------------------------
describe("splitIntoSpans", () => {
	it("returns a single scannable span for plain text", () => {
		expect(splitIntoSpans("hello world")).toEqual([
			{ start: 0, end: 11, scannable: true },
		]);
	});

	it("protects YAML frontmatter", () => {
		const c = "---\ntitle: Note\n---\nHello";
		const spans = splitIntoSpans(c);
		const fm = spans.find((s) => s.start === 0 && !s.scannable);
		expect(fm).toBeDefined();
		expect(spans.filter((s) => s.scannable).some((s) => c.slice(s.start, s.end).includes("Hello"))).toBe(true);
	});

	it("protects backtick fenced code blocks", () => {
		const c = "before\n```\ncode\n```\nafter";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end).includes("code"))).toBeDefined();
	});

	it("protects tilde fenced code blocks", () => {
		const c = "before\n~~~\ncode\n~~~\nafter";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end).includes("code"))).toBeDefined();
	});

	it("protects inline code", () => {
		const c = "Use `myVar` here";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end) === "`myVar`")).toBeDefined();
	});

	it("protects $$ math blocks", () => {
		const c = "See $$E=mc^2$$ for details";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end).includes("E=mc^2"))).toBeDefined();
	});

	it("protects $...$ inline math", () => {
		const c = "Formula $x+y$ is here";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end).includes("x+y"))).toBeDefined();
	});

	it("protects existing [[wikilinks]]", () => {
		const c = "See [[My Note]] for info";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end) === "[[My Note]]")).toBeDefined();
	});

	it("protects aliased [[wikilinks|alias]]", () => {
		const c = "See [[My Note|alias]]";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end) === "[[My Note|alias]]")).toBeDefined();
	});

	it("protects markdown [text](url) links", () => {
		const c = "Check [link text](https://example.com) out";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end).includes("link text"))).toBeDefined();
	});

	it("protects HTML comments", () => {
		const c = "Hello <!-- hidden --> world";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end).includes("hidden"))).toBeDefined();
	});

	it("protects #hashtag tokens", () => {
		const c = "Tagged #my-tag here";
		const spans = splitIntoSpans(c);
		expect(spans.find((s) => !s.scannable && c.slice(s.start, s.end) === "#my-tag")).toBeDefined();
	});

	it("does not protect ## heading markers as tags", () => {
		const c = "## My Heading\nsome text";
		const spans = splitIntoSpans(c);
		// The heading text should remain scannable (## has no word chars after the second #)
		expect(spans.filter((s) => s.scannable).some((s) => c.slice(s.start, s.end).includes("My Heading"))).toBe(true);
	});

	it("produces non-overlapping, sorted spans covering the full string", () => {
		const c = "A `code` B [[link]] C";
		const spans = splitIntoSpans(c);
		for (let i = 1; i < spans.length; i++) {
			expect(spans[i].start).toBe(spans[i - 1].end);
		}
		expect(spans[0].start).toBe(0);
		expect(spans[spans.length - 1].end).toBe(c.length);
	});
});

// ---------------------------------------------------------------------------
// findMatches
// ---------------------------------------------------------------------------
describe("findMatches", () => {
	it("returns [] when terms list is empty", () => {
		expect(findMatches("Hello Alice", [])).toHaveLength(0);
	});

	it("finds a basic match", () => {
		const ms = findMatches("Hello Alice here", terms(["Alice", "Alice"]));
		expect(ms).toHaveLength(1);
		expect(ms[0].matchedText).toBe("Alice");
		expect(ms[0].canonicalTitle).toBe("Alice");
	});

	it("is case-insensitive and records the matched text as-typed", () => {
		const ms = findMatches("hello alice here", terms(["Alice", "Alice"]));
		expect(ms).toHaveLength(1);
		expect(ms[0].matchedText).toBe("alice");
		expect(ms[0].canonicalTitle).toBe("Alice");
	});

	// --- skip zones ---

	it("skips matches inside backtick fenced code blocks", () => {
		expect(findMatches("```\nAlice\n```", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside tilde fenced code blocks", () => {
		expect(findMatches("~~~\nAlice\n~~~", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside inline code", () => {
		expect(findMatches("Use `Alice` here", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside $$ math blocks", () => {
		expect(findMatches("$$Alice$$", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside $...$ inline math", () => {
		expect(findMatches("$Alice$", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside YAML frontmatter", () => {
		const c = "---\ntitle: Alice\n---\nHello Bob";
		expect(findMatches(c, terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside [[wikilinks]]", () => {
		expect(findMatches("[[Alice]]", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside [[aliased|wikilinks]]", () => {
		expect(findMatches("[[Alice|Al]]", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside markdown [text](url)", () => {
		expect(findMatches("[Alice](http://example.com)", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches inside HTML comments", () => {
		expect(findMatches("<!-- Alice -->", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	it("skips matches that are part of a #hashtag", () => {
		expect(findMatches("#Alice here", terms(["Alice", "Alice"]))).toHaveLength(0);
	});

	// --- word boundaries ---

	it("enforces whole-word boundaries — does not match mid-word", () => {
		const ms = findMatches("Alices alice AliceWonder", terms(["Alice", "Alice"]));
		expect(ms).toHaveLength(1);
		expect(ms[0].matchedText).toBe("alice");
	});

	it("handles Unicode terms with correct word boundaries", () => {
		const ms = findMatches("Café is great and café au lait", terms(["Café", "Café"]));
		expect(ms).toHaveLength(2);
	});

	it("does not match a Unicode term mid-word", () => {
		const ms = findMatches("Cafés are great", terms(["Café", "Café"]));
		expect(ms).toHaveLength(0);
	});

	// --- longest-match preference ---

	it("prefers a longer term over a shorter one at the same position", () => {
		const ms = findMatches(
			"Internal Validity matters",
			terms(["Validity", "Validity"], ["Internal Validity", "Internal Validity"])
		);
		expect(ms).toHaveLength(1);
		expect(ms[0].matchedText).toBe("Internal Validity");
	});

	it("falls back to shorter term when longer does not match", () => {
		const ms = findMatches(
			"Validity matters",
			terms(["Validity", "Validity"], ["Internal Validity", "Internal Validity"])
		);
		expect(ms).toHaveLength(1);
		expect(ms[0].matchedText).toBe("Validity");
	});

	// --- regex metacharacters ---

	it("handles regex metacharacters in terms", () => {
		const ms = findMatches("C++ is a language and C++ rocks", terms(["C++", "C++"]));
		expect(ms).toHaveLength(2);
	});

	it("handles a term with dot (.) metacharacter", () => {
		const ms = findMatches("See U.S.A. for details and U.S.A. again", terms(["U.S.A.", "U.S.A."]));
		expect(ms).toHaveLength(2);
	});

	// --- context ---

	it("provides ~40-char context on each side", () => {
		const c = "The quick brown fox Alice jumps over the lazy dog";
		const ms = findMatches(c, terms(["Alice", "Alice"]));
		expect(ms[0].contextBefore).toContain("quick brown fox ");
		expect(ms[0].contextAfter).toContain("jumps over");
	});

	// --- multiple terms / multiple files ---

	it("finds matches for multiple distinct terms in one pass", () => {
		const ms = findMatches(
			"Alice and Bob are friends",
			terms(["Alice", "Alice"], ["Bob", "Bob"])
		);
		expect(ms).toHaveLength(2);
		const texts = ms.map((m) => m.matchedText);
		expect(texts).toContain("Alice");
		expect(texts).toContain("Bob");
	});

	it("assigns the correct canonical title for an alias match", () => {
		// Term "Al" is an alias whose canonical title is "Alice"
		const ms = findMatches("Say hi to Al today", terms(["Al", "Alice"]));
		expect(ms).toHaveLength(1);
		expect(ms[0].matchedText).toBe("Al");
		expect(ms[0].canonicalTitle).toBe("Alice");
	});
});

// ---------------------------------------------------------------------------
// applyReplacements
// ---------------------------------------------------------------------------
describe("applyReplacements", () => {
	it("uses [[Title]] when matched text equals canonical title exactly", () => {
		const ms = findMatches("Hello Alice world", terms(["Alice", "Alice"]));
		expect(applyReplacements("Hello Alice world", ms)).toBe("Hello [[Alice]] world");
	});

	it("uses [[Title|matched]] when case differs", () => {
		const ms = findMatches("Hello alice world", terms(["Alice", "Alice"]));
		expect(applyReplacements("Hello alice world", ms)).toBe("Hello [[Alice|alice]] world");
	});

	it("uses [[Title|alias]] when the matched term is a different alias string", () => {
		const manualMatch: MatchResult[] = [
			{
				start: 10,
				end: 12,
				matchedText: "Al",
				canonicalTitle: "Alice",
				contextBefore: "Say hi to ",
				contextAfter: " today",
			},
		];
		expect(applyReplacements("Say hi to Al today", manualMatch)).toBe(
			"Say hi to [[Alice|Al]] today"
		);
	});

	it("handles multiple replacements in a single string", () => {
		const ms = findMatches("Alice met Alice", terms(["Alice", "Alice"]));
		expect(applyReplacements("Alice met Alice", ms)).toBe("[[Alice]] met [[Alice]]");
	});

	it("returns the original string when matches is empty", () => {
		expect(applyReplacements("Hello world", [])).toBe("Hello world");
	});

	it("handles regex-metacharacter terms", () => {
		const ms = findMatches("C++ is great", terms(["C++", "C++"]));
		expect(applyReplacements("C++ is great", ms)).toBe("[[C++]] is great");
	});

	it("replaces multiple distinct terms correctly", () => {
		const ms = findMatches(
			"Alice and Bob here",
			terms(["Alice", "Alice"], ["Bob", "Bob"])
		);
		expect(applyReplacements("Alice and Bob here", ms)).toBe("[[Alice]] and [[Bob]] here");
	});
});

// ---------------------------------------------------------------------------
// Integration — alias frontmatter forms feeding into findMatches
// ---------------------------------------------------------------------------
describe("alias frontmatter integration", () => {
	it("bare-string alias: match found outside frontmatter", () => {
		// getAliases("myalias") → ["myalias"]
		// buildTermEntries includes it; findMatches finds it in body
		const { terms: t } = buildTermEntries(
			[{ basename: "MyNote", aliases: getAliases("myalias"), path: "mynote.md" }],
			new Set()
		);
		const ms = findMatches("---\naliases: myalias\n---\nmyalias is here", t);
		expect(ms).toHaveLength(1);
		expect(ms[0].matchedText).toBe("myalias");
	});

	it("array alias: match found outside frontmatter", () => {
		const { terms: t } = buildTermEntries(
			[{ basename: "MyNote", aliases: getAliases(["myalias", "alt"]), path: "mynote.md" }],
			new Set()
		);
		const ms = findMatches("---\naliases:\n  - myalias\n---\nmyalias is here", t);
		expect(ms).toHaveLength(1);
	});

	it("missing aliases: title still matches", () => {
		const { terms: t } = buildTermEntries(
			[{ basename: "MyNote", aliases: getAliases(undefined), path: "mynote.md" }],
			new Set()
		);
		const ms = findMatches("---\ntitle: MyNote\n---\nMyNote is here", t);
		expect(ms).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Active note's own title is excluded from the term list
// ---------------------------------------------------------------------------
describe("active note exclusion", () => {
	it("active note basename is not a search term", () => {
		// Simulate: active note is "Alice.md". Sources include "Alice" (itself, already excluded),
		// so it should not appear in terms and should not be found in its own content.
		const { terms: t } = buildTermEntries(
			[src("Bob"), src("Carol")],
			new Set(["alice"]) // active note's name
		);
		// Neither "Alice" nor any variant is in terms
		expect(t.map((e) => e.term.toLowerCase())).not.toContain("alice");
		// Bob and Carol are still present
		expect(t.map((e) => e.term.toLowerCase())).toContain("bob");
	});

	it("active note alias is not a search term", () => {
		const { terms: t } = buildTermEntries(
			[src("Bob"), src("Alice2", "alice2.md", "active-alias")],
			new Set(["active-alias"]) // one of active note's aliases
		);
		expect(t.map((e) => e.term.toLowerCase())).not.toContain("active-alias");
	});
});
