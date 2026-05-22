# Link Unlinked Mentions — Obsidian Plugin

Turns plain-text mentions of other notes in your current note into `[[wikilinks]]` — all at once, with a preview before anything changes.

> **Warning:** This plugin edits your active note directly. Once applied, changes are not reversible without a vault backup. Back up your vault before first use.

---

## What it does

When you write a note and mention another note by name without linking it, Obsidian calls that an "unlinked mention." Linking each one by hand is tedious. This plugin links them all in one pass.

When you run the command on a note, it:

1. Looks at every other note in your vault and collects their titles and aliases.
2. Scans your current note for any place where those titles or aliases appear in plain text.
3. Shows you a preview of every match it found, with surrounding context.
4. Waits for you to confirm before changing anything.
5. Converts the confirmed matches into wikilinks pointing to the right notes.

The plugin only edits the note you're currently viewing. It does not modify other notes in your vault.

---

## What it ignores

Not every appearance of a word should become a link. The plugin leaves text alone inside:

| Region | Example |
|---|---|
| The note's frontmatter | The `---` block at the top |
| Code blocks | Triple-backtick or `~~~` blocks |
| Inline code | Text in single backticks |
| Math | `$ ... $` and `$$ ... $$` |
| Existing wikilinks | `[[Note]]` or `[[Note\|alias]]` |
| Markdown links | `[text](url)` |
| HTML comments | `<!-- ... -->` |
| Tags | `#tag` |

If two different notes share the same title or alias, the plugin has no way to know which one you meant. Rather than guess, it skips that term and tells you in the preview which terms were skipped and why.

---

## Install

The easiest way:

1. Open Obsidian → Settings → Community plugins.
2. Click Browse and search for **Link Unlinked Mentions**.
3. Install, then enable.

Or visit the community plugins page directly:
https://community.obsidian.md/plugins/link-unlinked-mentions

---

## How to use it

1. Open the note you want to add links to.
2. Either:
   - Open the command palette (`Ctrl+P` on Windows, `Cmd+P` on Mac) and run **Link mentions of other notes in current note**, or
   - Click the link icon in the left ribbon.
3. A preview window opens. It lists every match found, with the surrounding text so you can see context, and a separate section for any terms that were skipped because of ambiguity.
4. Click **Link N mentions** to apply the changes, or **Cancel** to back out without changing anything.

A notification confirms how many mentions were linked.

---

## Aliases

If a note has aliases defined in its frontmatter, the plugin recognizes those as well as the title. All three frontmatter formats work:

```yaml
