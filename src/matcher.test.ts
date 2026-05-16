import { describe, it, expect } from "vitest";
import { splitIntoSpans, findMatches, applyReplacements, MatchResult } from "./matcher";

// ---------------------------------------------------------------------------
// splitIntoSpans
// ---------------------------------------------------------------------------
describe("splitIntoSpans", () => {
	it("returns single scannable span for plain text", () => {
		const spans = splitIntoSpans("hello world");
		expect(spans).toEqual([{ start: 0, end: 11, scannable: true }]);
	});

	it("marks YAML frontmatter as protected", () => {
		const content = "---\ntitle: Note\n---\nHello world";
		const spans = splitIntoSpans(content);
		const frontmatter = spans.find((s) => s.start === 0 && !s.scannable);
		expect(frontmatter).toBeDefined();
		// text after frontmatter should be scannable
		const scannable = spans.filter((s) => s.scannable);
		expect(scannable.some((s) => content.slice(s.start, s.end).includes("Hello world"))).toBe(true);
	});

	it("marks fenced code block (backtick) as protected", () => {
		const content = "before\n```\ncode here\n```\nafter";
		const spans = splitIntoSpans(content);
		const codeSpan = spans.find((s) => !s.scannable && content.slice(s.start, s.end).includes("code here"));
		expect(codeSpan).toBeDefined();
		expect(spans.filter((s) => s.scannable).some((s) => content.slice(s.start, s.end).includes("before"))).toBe(true);
		expect(spans.filter((s) => s.scannable).some((s) => content.slice(s.start, s.end).includes("after"))).toBe(true);
	});

	it("marks fenced code block (tilde) as protected", () => {
		const content = "before\n~~~\ncode here\n~~~\nafter";
		const spans = splitIntoSpans(content);
		const codeSpan = spans.find((s) => !s.scannable && content.slice(s.start, s.end).includes("code here"));
		expect(codeSpan).toBeDefined();
	});

	it("marks inline code as protected", () => {
		const content = "Use `myVar` here";
		const spans = splitIntoSpans(content);
		const inlineCode = spans.find((s) => !s.scannable && content.slice(s.start, s.end) === "`myVar`");
		expect(inlineCode).toBeDefined();
	});

	it("marks math block $$ as protected", () => {
		const content = "See $$E=mc^2$$ for details";
		const spans = splitIntoSpans(content);
		const math = spans.find((s) => !s.scannable && content.slice(s.start, s.end).includes("E=mc^2"));
		expect(math).toBeDefined();
	});

	it("marks inline math $ as protected", () => {
		const content = "Formula $x+y$ is here";
		const spans = splitIntoSpans(content);
		const math = spans.find((s) => !s.scannable && content.slice(s.start, s.end).includes("x+y"));
		expect(math).toBeDefined();
	});

	it("marks existing wikilinks as protected", () => {
		const content = "See [[My Note]] for info";
		const spans = splitIntoSpans(content);
		const wikilink = spans.find((s) => !s.scannable && content.slice(s.start, s.end) === "[[My Note]]");
		expect(wikilink).toBeDefined();
	});

	it("marks aliased wikilinks as protected", () => {
		const content = "See [[My Note|alias]] for info";
		const spans = splitIntoSpans(content);
		const wikilink = spans.find((s) => !s.scannable && content.slice(s.start, s.end) === "[[My Note|alias]]");
		expect(wikilink).toBeDefined();
	});

	it("marks markdown links as protected", () => {
		const content = "Check [link text](https://example.com) out";
		const spans = splitIntoSpans(content);
		const mdlink = spans.find((s) => !s.scannable && content.slice(s.start, s.end).includes("link text"));
		expect(mdlink).toBeDefined();
	});

	it("marks HTML comments as protected", () => {
		const content = "Hello <!-- this is a comment --> world";
		const spans = splitIntoSpans(content);
		const comment = spans.find((s) => !s.scannable && content.slice(s.start, s.end).includes("this is a comment"));
		expect(comment).toBeDefined();
	});

	it("marks hashtags as protected", () => {
		const content = "Tagged with #my-tag here";
		const spans = splitIntoSpans(content);
		const tag = spans.find((s) => !s.scannable && content.slice(s.start, s.end) === "#my-tag");
		expect(tag).toBeDefined();
	});

	it("handles overlapping protected zones without duplicates", () => {
		const content = "```\n`nested` code\n```";
		const spans = splitIntoSpans(content);
		// should be one protected span covering the whole block
		const protected_spans = spans.filter((s) => !s.scannable);
		for (let i = 1; i < protected_spans.length; i++) {
			expect(protected_spans[i].start).toBeGreaterThanOrEqual(protected_spans[i - 1].end);
		}
	});
});

// ---------------------------------------------------------------------------
// findMatches
// ---------------------------------------------------------------------------
describe("findMatches", () => {
	it("finds a simple match", () => {
		const matches = findMatches("Hello Alice is here", ["Alice"]);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchedText).toBe("Alice");
	});

	it("is case-insensitive", () => {
		const matches = findMatches("hello alice is here", ["Alice"]);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchedText).toBe("alice");
	});

	it("skips matches inside fenced code blocks", () => {
		const content = "```\nAlice is here\n```";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips matches inside inline code", () => {
		const content = "Use `Alice` variable";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips matches inside math blocks", () => {
		const content = "$$Alice + Bob$$";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips matches inside inline math", () => {
		const content = "Let $Alice = 5$";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips matches inside YAML frontmatter", () => {
		const content = "---\ntitle: Alice\n---\nHello Bob";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips matches inside existing wikilinks", () => {
		const content = "See [[Alice]] for info";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips matches inside aliased wikilinks", () => {
		const content = "See [[Alice|A]] for info";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips matches inside markdown link text", () => {
		const content = "Check [Alice](https://example.com) out";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips matches inside HTML comments", () => {
		const content = "<!-- Alice is here -->";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("skips hashtag tokens", () => {
		const content = "Tagged with #Alice here";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(0);
	});

	it("enforces whole-word matching", () => {
		const content = "Alices and Alice and AliceWonderland";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchedText).toBe("Alice");
	});

	it("handles Unicode terms correctly", () => {
		const content = "Café is great and café au lait";
		const matches = findMatches(content, ["Café"]);
		expect(matches).toHaveLength(2);
	});

	it("handles regex metacharacters in terms", () => {
		const content = "C++ is a language and C++ rocks";
		const matches = findMatches(content, ["C++"]);
		expect(matches).toHaveLength(2);
	});

	it("prefers longest match when multiple terms overlap", () => {
		const content = "Hello Alice Wonder";
		const matches = findMatches(content, ["Alice", "Alice Wonder"]);
		// Should match "Alice Wonder" not just "Alice"
		expect(matches).toHaveLength(1);
		expect(matches[0].matchedText).toBe("Alice Wonder");
	});

	it("skips terms shorter than 2 characters", () => {
		const matches = findMatches("Hello A world", ["A"]);
		expect(matches).toHaveLength(0);
	});

	it("skips whitespace-only terms", () => {
		const matches = findMatches("Hello world", ["  "]);
		expect(matches).toHaveLength(0);
	});

	it("handles no-aliases case (basename only)", () => {
		const content = "My Note is here and my note is there";
		const matches = findMatches(content, ["My Note"]);
		expect(matches).toHaveLength(2);
	});

	it("provides correct context around match", () => {
		const content = "The quick brown fox Alice jumps over the lazy dog";
		const matches = findMatches(content, ["Alice"]);
		expect(matches).toHaveLength(1);
		expect(matches[0].contextBefore).toContain("quick brown fox ");
		expect(matches[0].contextAfter).toContain("jumps over");
	});

	it("finds multiple terms across same content", () => {
		const content = "Alice and Bob are friends";
		const matches = findMatches(content, ["Alice", "Bob"]);
		expect(matches).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// applyReplacements
// ---------------------------------------------------------------------------
describe("applyReplacements", () => {
	it("replaces exact title match with simple wikilink", () => {
		const content = "Hello Alice world";
		const matches = findMatches(content, ["Alice"]);
		const result = applyReplacements(content, matches, "Alice");
		expect(result).toBe("Hello [[Alice]] world");
	});

	it("replaces alias with piped wikilink", () => {
		const content = "Hello ali world";
		const matches: MatchResult[] = [
			{
				start: 6,
				end: 9,
				matchedText: "ali",
				term: "ali",
				contextBefore: "Hello ",
				contextAfter: " world",
			},
		];
		const result = applyReplacements(content, matches, "Alice");
		expect(result).toBe("Hello [[Alice|ali]] world");
	});

	it("replaces differing-case match with piped wikilink", () => {
		const content = "Hello alice world";
		const matches = findMatches(content, ["Alice"]);
		const result = applyReplacements(content, matches, "Alice");
		expect(result).toBe("Hello [[Alice|alice]] world");
	});

	it("handles multiple replacements in correct order", () => {
		const content = "Alice met Alice yesterday";
		const matches = findMatches(content, ["Alice"]);
		const result = applyReplacements(content, matches, "Alice");
		expect(result).toBe("[[Alice]] met [[Alice]] yesterday");
	});

	it("handles no matches gracefully", () => {
		const content = "Hello world";
		const result = applyReplacements(content, [], "Alice");
		expect(result).toBe("Hello world");
	});

	it("replaces regex-metachar term", () => {
		const content = "C++ is great";
		const matches = findMatches(content, ["C++"]);
		const result = applyReplacements(content, matches, "C++");
		expect(result).toBe("[[C++]] is great");
	});
});

// ---------------------------------------------------------------------------
// Frontmatter alias forms
// ---------------------------------------------------------------------------
describe("alias frontmatter forms", () => {
	it("bare string alias: finds match outside frontmatter", () => {
		// The main.ts reads aliases; matcher only needs to handle the term
		const content = "---\naliases: myalias\n---\nmyalias is here";
		// frontmatter is protected so only the body match counts
		const matches = findMatches(content, ["myalias"]);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchedText).toBe("myalias");
	});

	it("array alias: finds match outside frontmatter", () => {
		const content = "---\naliases:\n  - myalias\n---\nmyalias is here";
		const matches = findMatches(content, ["myalias"]);
		expect(matches).toHaveLength(1);
	});

	it("missing aliases: still finds title match", () => {
		const content = "---\ntitle: MyNote\n---\nMyNote is here";
		const matches = findMatches(content, ["MyNote"]);
		expect(matches).toHaveLength(1);
	});
});
