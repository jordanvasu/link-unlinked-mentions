# Link Unlinked Mentions — Obsidian Plugin

Scans the **active note** for plain-text mentions of other notes' titles and aliases, then converts them to wikilinks in one click.

> **Warning:** This operation modifies the active note in-place. It is **irreversible without a vault backup**. Back up your vault before using this plugin.

---

## What it does

When invoked on a note, the plugin:

1. Enumerates every other markdown file in the vault and collects their basenames and `aliases` from frontmatter.
2. Scans the active note for whole-word, case-insensitive matches of those terms — skipping code blocks, inline code, math, existing wikilinks, markdown links, HTML comments, tags, and YAML frontmatter.
3. Shows a dry-run preview in a modal (with surrounding context for each match) and lists any terms that were skipped because they matched multiple notes ambiguously.
4. On confirmation, rewrites matching text as `[[Target Note]]` (exact case) or `[[Target Note|matched text]]` (alias or differing case).

---

## Features

- **Inverted scope** — operates on the active note, not the vault. Use it to clean up a specific note.
- **Ambiguity detection** — if two notes share the same term, that term is skipped and reported, not guessed.
- **Longest-match preference** — `Internal Validity` beats `Validity` at the same position.
- **Alias support** — reads all three frontmatter forms (bare string, block array, flow array).
- **Performance** — single combined alternation regex; large spans are chunked at newline boundaries.
- **Unicode-aware** — word boundaries use `\p{L}` lookarounds, not `\b`, so `Café` and similar terms match correctly.

---

## Build

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Commands

```bash
# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build

# Run tests
npm test
```

The production build outputs `main.js` in the project root.

---
## Install in Obsidian

https://community.obsidian.md/plugins/link-unlinked-mentions

---

## Manual Installation

1. Run `npm run build` to produce `main.js`.
2. In your vault, create the folder:
   ```
   <vault>/.obsidian/plugins/link-unlinked-mentions/
   ```
3. Copy these three files into that folder:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Open Obsidian → Settings → Community plugins → Enable **Link Unlinked Mentions**.

---

## Usage

1. Open the note you want to enrich with links.
2. Open the command palette (`Ctrl/Cmd + P`) and run **"Link mentions of other notes in current note"**, or click the link icon in the left ribbon.
3. Review the dry-run preview — matches are listed with context; ambiguous terms appear in a separate section.
4. Click **"Link N mentions"** to apply, or **Cancel** to abort.

A notice confirms how many mentions were linked.

---

## Skip zones

The following regions in the active note are never modified:

| Zone | Example |
|---|---|
| YAML frontmatter | `--- … ---` at file start |
| Fenced code blocks | ` ``` … ``` ` and `~~~ … ~~~` |
| Inline code | `` `code` `` |
| Math blocks | `$$ … $$` |
| Inline math | `$ … $` |
| Existing wikilinks | `[[Note]]`, `[[Note\|alias]]` |
| Markdown links | `[text](url)` |
| HTML comments | `<!-- … -->` |
| Tags | `#tag` |

---

## Alias support

Aliases are read from frontmatter via Obsidian's metadata cache. All three forms are recognised:

```yaml
# Bare string
aliases: My Alias

# Block array
aliases:
  - My Alias
  - Another Alias

# Flow array
aliases: [My Alias, Another Alias]
```

---

## Development

Tests live in `src/matcher.test.ts` and use [Vitest](https://vitest.dev/). The `src/matcher.ts` module has no Obsidian imports and runs entirely in Node.js.
