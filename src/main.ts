import { App, Modal, Notice, Plugin, TFile } from "obsidian";
import { findMatches, applyReplacements, MatchResult } from "./matcher";

interface FileMatches {
	file: TFile;
	matches: MatchResult[];
}

function getAliases(raw: unknown): string[] {
	if (!raw) return [];
	if (typeof raw === "string") return [raw];
	if (Array.isArray(raw)) return raw.filter((a): a is string => typeof a === "string");
	return [];
}

function buildReport(fileMatches: FileMatches[], canonicalTitle: string): string {
	const totalMatches = fileMatches.reduce((sum, fm) => sum + fm.matches.length, 0);
	const lines: string[] = [
		`## Link Unlinked Mentions: "${canonicalTitle}"`,
		``,
		`**${totalMatches} match${totalMatches !== 1 ? "es" : ""}** in ${fileMatches.length} file${fileMatches.length !== 1 ? "s" : ""}`,
		``,
	];

	for (const { file, matches } of fileMatches) {
		lines.push(`### ${file.path} (${matches.length})`);
		lines.push(``);
		for (const m of matches) {
			const before = m.contextBefore.replace(/\n/g, " ");
			const after = m.contextAfter.replace(/\n/g, " ");
			lines.push(`- …${before}**${m.matchedText}**${after}…`);
		}
		lines.push(``);
	}

	return lines.join("\n");
}

class ConfirmModal extends Modal {
	private report: string;
	private totalMatches: number;
	private onConfirm: () => void;

	constructor(app: App, report: string, totalMatches: number, onConfirm: () => void) {
		super(app);
		this.report = report;
		this.totalMatches = totalMatches;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("link-unlinked-modal");

		const title = contentEl.createEl("h2", { text: "Link Unlinked Mentions" });
		title.style.marginTop = "0";

		const summary = contentEl.createEl("p");
		summary.setText(
			`Found ${this.totalMatches} unlinked mention${this.totalMatches !== 1 ? "s" : ""}. ` +
			`This operation is irreversible without a vault backup. Proceed?`
		);

		const reportContainer = contentEl.createEl("div");
		reportContainer.style.maxHeight = "400px";
		reportContainer.style.overflowY = "auto";
		reportContainer.style.border = "1px solid var(--background-modifier-border)";
		reportContainer.style.borderRadius = "4px";
		reportContainer.style.padding = "8px 12px";
		reportContainer.style.marginBottom = "16px";
		reportContainer.style.fontFamily = "var(--font-monospace)";
		reportContainer.style.fontSize = "0.85em";
		reportContainer.style.whiteSpace = "pre-wrap";
		reportContainer.style.wordBreak = "break-word";
		reportContainer.setText(this.report);

		const buttonRow = contentEl.createEl("div");
		buttonRow.style.display = "flex";
		buttonRow.style.justifyContent = "flex-end";
		buttonRow.style.gap = "8px";

		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const confirmBtn = buttonRow.createEl("button", { text: `Link ${this.totalMatches} mention${this.totalMatches !== 1 ? "s" : ""}` });
		confirmBtn.addClass("mod-cta");
		confirmBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export default class LinkUnlinkedMentionsPlugin extends Plugin {
	async onload(): Promise<void> {
		this.addRibbonIcon("link", "Link all unlinked mentions", () => {
			this.linkUnlinkedMentions();
		});

		this.addCommand({
			id: "link-all-unlinked-mentions",
			name: "Link all unlinked mentions for current note",
			callback: () => {
				this.linkUnlinkedMentions();
			},
		});
	}

	private async linkUnlinkedMentions(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active note.");
			return;
		}

		const canonicalTitle = activeFile.basename;

		// Collect search terms
		const cache = this.app.metadataCache.getFileCache(activeFile);
		const rawAliases = cache?.frontmatter?.["aliases"] as unknown;
		const aliases = getAliases(rawAliases);
		const terms = [canonicalTitle, ...aliases];

		// Scan all other markdown files
		const allFiles = this.app.vault.getMarkdownFiles();
		const otherFiles = allFiles.filter((f) => f.path !== activeFile.path);

		const fileMatches: FileMatches[] = [];

		for (const file of otherFiles) {
			const content = await this.app.vault.cachedRead(file);
			const matches = findMatches(content, terms);
			if (matches.length > 0) {
				fileMatches.push({ file, matches });
			}
		}

		const totalMatches = fileMatches.reduce((sum, fm) => sum + fm.matches.length, 0);

		if (totalMatches === 0) {
			new Notice(`No unlinked mentions of "${canonicalTitle}" found.`);
			return;
		}

		const report = buildReport(fileMatches, canonicalTitle);

		new ConfirmModal(this.app, report, totalMatches, async () => {
			let totalReplaced = 0;
			let filesModified = 0;

			for (const { file, matches } of fileMatches) {
				await this.app.vault.process(file, (content) => {
					return applyReplacements(content, matches, canonicalTitle);
				});
				totalReplaced += matches.length;
				filesModified++;
			}

			new Notice(
				`Linked ${totalReplaced} mention${totalReplaced !== 1 ? "s" : ""} in ${filesModified} file${filesModified !== 1 ? "s" : ""}.`
			);
		});
	}
}
