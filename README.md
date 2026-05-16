# Link Unlinked Mentions — Obsidian Plugin

Scans your vault for plain-text mentions of the active note's title (and aliases) and converts them to wikilinks in one click.

> **Warning:** This operation modifies files in-place. It is **irreversible without a vault backup**. Back up your vault before using this plugin.

---

## Features

- Finds all unlinked mentions of the active note's basename and any `aliases` defined in its frontmatter
- Shows a dry-run report (with context) in a confirmation modal before making any changes
- Skips protected zones: fenced code, inline code, math blocks, YAML frontmatter, existing wikilinks, markdown links, HTML comments, and tags
- Whole-word, case-insensitive matching with Unicode support
- Uses `[[Title|matched text]]` to preserve original prose casing when it differs from the canonical title

---

## Build

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Commands

```bash
# Install dependencies
npm install

# Development build (with watch mode)
npm run dev

# Production build
npm run build

# Run tests
npm test
```

The production build outputs `main.js` in the project root.

---

## Manual Installation

1. Run `npm run build` to produce `main.js`.
2. In your vault, create the folder:
   ```
   <vault>/.obsidian/plugins/link-unlinked-mentions/
   ```
3. Copy these files into that folder:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Open Obsidian → Settings → Community plugins → Enable "Link Unlinked Mentions".

---

## Usage

1. Open any note whose unlinked mentions you want to link.
2. Open the command palette (`Ctrl/Cmd + P`) and run **"Link all unlinked mentions for current note"**, or click the link icon in the left ribbon.
3. Review the dry-run report in the modal.
4. Click **"Link N mentions"** to apply, or **Cancel** to abort.

A notice will confirm how many mentions were linked and in how many files.

---

## Alias Support

Aliases are read from the note's frontmatter via Obsidian's metadata cache. All three forms are supported:

```yaml
# Bare string
aliases: My Alias

# Array (block style)
aliases:
  - My Alias
  - Another Alias

# Array (flow style)
aliases: [My Alias, Another Alias]
```

---

## Development

Tests live in `src/matcher.test.ts` and use [Vitest](https://vitest.dev/). The `src/matcher.ts` module has no Obsidian imports and can be tested in Node.js directly.
