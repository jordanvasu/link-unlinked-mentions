import { App, Modal, Notice, Plugin } from "obsidian";
import {
	getAliases,
	buildTermEntries,
	findMatches,
	applyReplacements,
	MatchResult,
} from "./matcher";

function buildReport(
	matches: MatchResult[],
	ambiguous: string[],
	activeTitle: string
): string {
	const lines: string[] = [
		`## Link Mentions in "${activeTitle}"`,
		``,
		`**${matches.length} match${matches.length !== 1 ? "es" : ""}** found` +
			(ambiguous.length > 0
				? ` · **${ambiguous.length} term${ambiguous.length !== 1 ? "s" : ""} skipped** (ambiguous)`
				: "") +
			".",
		``,
	];

	if (matches.length > 0) {
		lines.push(`### Matches`, ``);
		for (const m of matches) {
			const before = m.contextBefore.replace(/\n/g, " ");
			const after = m.contextAfter.replace(/\n/g, " ");
			lines.push(
				`- "${m.matchedText}" → [[${m.canonicalTitle}]]  …${before}**${m.matchedText}**${after}…`
			);
		}
		lines.push(``);
	}

	if (ambiguous.length > 0) {
		lines.push(`### Skipped — Ambiguous Terms`, ``);
		lines.push(`These terms match multiple notes and were not linked:`, ``);
		for (const term of ambiguous) {
			lines.push(`- "${term}"`);
		}
		lines.push(``);
	}

	return lines.join("\n");
}

class ConfirmModal extends Modal {
	private report: string;
	private matchCount: number;
	private onConfirm: () => Promise<void>;

	constructor(app: App, report: string, matchCount: number, onConfirm: () => Promise<void>) {
		super(app);
		this.report = report;
		this.matchCount = matchCount;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const heading = contentEl.createEl("h2", { text: "Link Mentions of Other Notes" });
		heading.style.marginTop = "0";

		const warning = contentEl.createEl("p");
		warning.setText(
			`${this.matchCount} mention${this.matchCount !== 1 ? "s" : ""} will be converted to wikilinks. ` +
				`This operation is irreversible without a vault backup.`
		);

		const reportEl = contentEl.createEl("div");
		reportEl.style.maxHeight = "400px";
		reportEl.style.overflowY = "auto";
		reportEl.style.border = "1px solid var(--background-modifier-border)";
		reportEl.style.borderRadius = "4px";
		reportEl.style.padding = "8px 12px";
		reportEl.style.marginBottom = "16px";
		reportEl.style.fontFamily = "var(--font-monospace)";
		reportEl.style.fontSize = "0.85em";
		reportEl.style.whiteSpace = "pre-wrap";
		reportEl.style.wordBreak = "break-word";
		reportEl.setText(this.report);

		const buttonRow = contentEl.createEl("div");
		buttonRow.style.display = "flex";
		buttonRow.style.justifyContent = "flex-end";
		buttonRow.style.gap = "8px";

		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const confirmBtn = buttonRow.createEl("button", {
			text: `Link ${this.matchCount} mention${this.matchCount !== 1 ? "s" : ""}`,
		});
		confirmBtn.addClass("mod-cta");
		confirmBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm().catch((err: unknown) => {
				new Notice(`Link Unlinked Mentions error: ${err instanceof Error ? err.message : String(err)}`);
				console.error("[link-unlinked-mentions]", err);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export default class LinkUnlinkedMentionsPlugin extends Plugin {
	async onload(): Promise<void> {
		this.addRibbonIcon("link", "Link mentions of other notes in current note", () => {
			this.linkMentionsInCurrentNote().catch((err) => {
				new Notice(`Link Unlinked Mentions error: ${err instanceof Error ? err.message : String(err)}`);
				console.error("[link-unlinked-mentions]", err);
			});
		});

		this.addCommand({
			id: "link-mentions-of-other-notes",
			name: "Link mentions of other notes in current note",
			callback: () => {
				this.linkMentionsInCurrentNote().catch((err) => {
					new Notice(`Link Unlinked Mentions error: ${err instanceof Error ? err.message : String(err)}`);
					console.error("[link-unlinked-mentions]", err);
				});
			},
		});
	}

	private async linkMentionsInCurrentNote(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active note.");
			return;
		}

		// Collect the active note's own names so they're excluded from the term list
		const activeCache = this.app.metadataCache.getFileCache(activeFile);
		const activeAliases = getAliases(activeCache?.frontmatter?.["aliases"] as unknown);
		const excludeTerms = new Set([
			activeFile.basename.toLowerCase(),
			...activeAliases.map((a) => a.toLowerCase()),
		]);

		// Build term sources from every other markdown file in the vault
		const sources = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path !== activeFile.path)
			.map((f) => {
				const cache = this.app.metadataCache.getFileCache(f);
				return {
					basename: f.basename,
					aliases: getAliases(cache?.frontmatter?.["aliases"] as unknown),
					path: f.path,
				};
			});

		const { terms, ambiguous } = buildTermEntries(sources, excludeTerms);

		const content = await this.app.vault.cachedRead(activeFile);
		const matches = findMatches(content, terms);

		if (matches.length === 0) {
			const msg =
				ambiguous.length > 0
					? `No unlinked mentions found. ${ambiguous.length} term${ambiguous.length !== 1 ? "s" : ""} skipped due to ambiguity.`
					: "No unlinked mentions found in the current note.";
			new Notice(msg);
			return;
		}

		const report = buildReport(matches, ambiguous, activeFile.basename);

		new ConfirmModal(this.app, report, matches.length, async () => {
			// Re-run matching inside vault.process so the edit is based on the file's
			// current bytes even if it was modified between the preview and confirm.
			let actualCount = 0;
			await this.app.vault.process(activeFile, (fileContent) => {
				const freshMatches = findMatches(fileContent, terms);
				actualCount = freshMatches.length;
				return applyReplacements(fileContent, freshMatches);
			});
			new Notice(
				`Linked ${actualCount} mention${actualCount !== 1 ? "s" : ""} in "${activeFile.basename}".`
			);
		});
	}
}
