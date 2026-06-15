import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../core/extensions/types.ts";
import type { EditToolDetails } from "../core/tools/edit.ts";
import {
	applyEditsToNormalizedContent,
	detectLineEnding,
	type Edit,
	generateDiffString,
	generateUnifiedPatch,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "../core/tools/edit-diff.ts";
import { withFileMutationQueue } from "../core/tools/file-mutation-queue.ts";
import { getTextOutput } from "../core/tools/render-utils.ts";
import type { Theme } from "../modes/interactive/theme/theme.ts";
import {
	getMatterMdPath,
	MATTER_MD_FILENAME,
	materializeMatterMd,
	readMatterMd,
	writeMatterMdContent,
} from "./matter-md.ts";

interface CaseDevMatterToolDetails {
	synced: boolean;
	syncOutput?: string;
}

type CaseDevMatterEditDetails = EditToolDetails & CaseDevMatterToolDetails;

const matterReadSchema = Type.Object({});

const matterWriteSchema = Type.Object(
	{
		content: Type.String({ description: "Complete replacement content for the workspace MATTER.md file." }),
	},
	{ additionalProperties: false },
);

const replaceEditSchema = Type.Object(
	{
		oldText: Type.String({
			description: "Exact text to replace. It must match a unique block in the current MATTER.md.",
		}),
		newText: Type.String({ description: "Replacement text for this targeted MATTER.md edit." }),
	},
	{ additionalProperties: false },
);

const matterEditSchema = Type.Object(
	{
		edits: Type.Array(replaceEditSchema, {
			description:
				"One or more exact replacements against the current MATTER.md. Merge nearby changes into one edit.",
		}),
	},
	{ additionalProperties: false },
);

type MatterReadInput = Static<typeof matterReadSchema>;
type MatterWriteInput = Static<typeof matterWriteSchema>;
type MatterEditInput = Static<typeof matterEditSchema>;

function renderCall(name: string, theme: Theme): Text {
	return new Text(theme.fg("toolTitle", theme.bold(name)), 0, 0);
}

function renderResult(result: {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}): Text {
	const output = getTextOutput(result, false).trim();
	return new Text(output ? `\n${output}` : "", 0, 0);
}

async function ensureMatterMd(ctx: ExtensionContext) {
	const materialized = await materializeMatterMd(ctx);
	const state = materialized ?? (await readMatterMd(ctx));
	if (!state) {
		throw new Error("No MATTER.md is available. Attach a vault with MATTER.md or initialize matter context first.");
	}
	return state;
}

function validateEdits(input: MatterEditInput): Edit[] {
	if (!Array.isArray(input.edits) || input.edits.length === 0) {
		throw new Error("MATTER.md edit input is invalid. edits must contain at least one replacement.");
	}
	return input.edits;
}

export function createMatterMdTools(): ToolDefinition[] {
	return [
		{
			name: "casedev_matter_read",
			label: "case.dev matter read",
			description: "Read the current durable MATTER.md context for the attached legal matter.",
			promptSnippet: "Read durable MATTER.md context for the active legal matter.",
			promptGuidelines: ["Use casedev_matter_read before making durable matter-level decisions or edits."],
			parameters: matterReadSchema,
			async execute(_toolCallId, _params: MatterReadInput, _signal, _onUpdate, ctx) {
				const state = await ensureMatterMd(ctx);
				return {
					content: [{ type: "text", text: state.content }],
					details: { synced: state.vault !== undefined } satisfies CaseDevMatterToolDetails,
				};
			},
			renderCall: (_args, theme) => renderCall("case.dev matter read", theme),
			renderResult,
		},
		{
			name: "casedev_matter_write",
			label: "case.dev matter write",
			description:
				"Replace MATTER.md and sync it to the attached Case.dev vault. Use for initialization or deliberate full rewrites only.",
			promptSnippet: "Replace durable MATTER.md context and sync it to the attached Case.dev vault.",
			promptGuidelines: [
				"Use casedev_matter_write only for deliberate full MATTER.md rewrites.",
				"Keep MATTER.md concise and durable; do not paste raw evidence, transcripts, research dumps, or scratchpad reasoning.",
			],
			parameters: matterWriteSchema,
			async execute(_toolCallId, params: MatterWriteInput, _signal, _onUpdate, ctx) {
				return withFileMutationQueue(getMatterMdPath(ctx), async () => {
					const syncOutput = await writeMatterMdContent(ctx, params.content);
					return {
						content: [
							{
								type: "text",
								text: `Wrote ${params.content.length} bytes to ${MATTER_MD_FILENAME} and synced it to the attached Case.dev vault.`,
							},
						],
						details: { synced: true, syncOutput } satisfies CaseDevMatterToolDetails,
					};
				});
			},
			renderCall: (_args, theme) => renderCall("case.dev matter write", theme),
			renderResult,
		},
		{
			name: "casedev_matter_edit",
			label: "case.dev matter edit",
			description:
				"Apply exact targeted replacements to MATTER.md and sync the updated file to the attached Case.dev vault.",
			promptSnippet: "Edit durable MATTER.md context and sync the update to the attached Case.dev vault.",
			promptGuidelines: [
				"Use casedev_matter_edit for durable matter state updates.",
				"Before editing MATTER.md, read the current file and make the smallest useful change.",
				"Do not store raw evidence, credentials, sync tokens, chat history, or scratchpad reasoning in MATTER.md.",
			],
			parameters: matterEditSchema,
			async execute(_toolCallId, input: MatterEditInput, _signal, _onUpdate, ctx) {
				const edits = validateEdits(input);
				return withFileMutationQueue(getMatterMdPath(ctx), async () => {
					const state = await ensureMatterMd(ctx);
					const { bom, text } = stripBom(state.content);
					const originalEnding = detectLineEnding(text);
					const normalizedContent = normalizeToLF(text);
					const { baseContent, newContent } = applyEditsToNormalizedContent(
						normalizedContent,
						edits,
						MATTER_MD_FILENAME,
					);
					const finalContent = bom + restoreLineEndings(newContent, originalEnding);
					const syncOutput = await writeMatterMdContent(ctx, finalContent);
					const diffResult = generateDiffString(baseContent, newContent);
					const patch = generateUnifiedPatch(MATTER_MD_FILENAME, baseContent, newContent);
					return {
						content: [
							{
								type: "text",
								text: `Updated ${MATTER_MD_FILENAME} with ${edits.length} replacement(s) and synced it to the attached Case.dev vault.`,
							},
						],
						details: {
							diff: diffResult.diff,
							patch,
							firstChangedLine: diffResult.firstChangedLine,
							synced: true,
							syncOutput,
						} satisfies CaseDevMatterEditDetails,
					};
				});
			},
			renderCall: (_args, theme) => renderCall("case.dev matter edit", theme),
			renderResult,
		},
	];
}
