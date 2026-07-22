import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionEvent,
	ExtensionHandler,
	RegisteredCommand,
} from "../src/core/extensions/types.ts";
import { createCaseDevVaultTools } from "../src/linc/casedev-vault-tools.ts";
import { formatVaultOption, loadCaseDevVault, loadCaseDevVaults, toLincVaultRef } from "../src/linc/casedev-vaults.ts";
import matterExtension from "../src/linc/extensions/matter.ts";
import vaultExtension from "../src/linc/extensions/vault.ts";
import { materializeMatterMd } from "../src/linc/matter-md.ts";
import { formatVaultRef, getAttachedVault, LINC_VAULT_ENTRY_TYPE } from "../src/linc/vault-attachment.ts";

const mocks = vi.hoisted(() => ({
	runCaseDevCli: vi.fn(),
	listCaseDevVaults: vi.fn(),
	getCaseDevVault: vi.fn(),
	listCaseDevVaultObjects: vi.fn(),
	downloadCaseDevVaultObject: vi.fn(),
	uploadCaseDevVaultFile: vi.fn(),
	searchCaseDevVault: vi.fn(),
}));

vi.mock("../src/linc/casedev-cli.ts", () => ({
	formatCaseDevCliResult: (result: { stdout: string; stderr: string; code: number }) => {
		if (result.code !== 0) throw new Error(result.stderr || `casedev exited with code ${result.code}`);
		return result.stdout.trim();
	},
	runCaseDevCli: mocks.runCaseDevCli,
}));

vi.mock("../src/linc/casedev-vault-api.ts", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/linc/casedev-vault-api.ts")>();
	return {
		...original,
		listCaseDevVaults: mocks.listCaseDevVaults,
		getCaseDevVault: mocks.getCaseDevVault,
		listCaseDevVaultObjects: mocks.listCaseDevVaultObjects,
		downloadCaseDevVaultObject: mocks.downloadCaseDevVaultObject,
		uploadCaseDevVaultFile: mocks.uploadCaseDevVaultFile,
		searchCaseDevVault: mocks.searchCaseDevVault,
	};
});

interface TestContextOptions {
	cwd: string;
	entries?: unknown[];
	statuses?: Map<string, string | undefined>;
	hasUI?: boolean;
	notifications?: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;
	editor?: (title: string, prefill?: string) => Promise<string | undefined>;
	reload?: () => Promise<void>;
}

function createContext({
	cwd,
	entries = [],
	statuses = new Map<string, string | undefined>(),
	hasUI = false,
	notifications = [],
	editor = async () => undefined,
	reload = async () => {},
}: TestContextOptions) {
	return {
		cwd,
		signal: undefined,
		hasUI,
		reload,
		sessionManager: {
			getEntries: () => entries,
		},
		ui: {
			notify: (message: string, type: "info" | "warning" | "error" | undefined) =>
				notifications.push({ message, type }),
			setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
			editor,
		},
	} as unknown as ExtensionCommandContext;
}

function attachedVaultEntry(vault: { id: string; name: string; totalObjects?: number }): unknown {
	return {
		type: "custom",
		customType: LINC_VAULT_ENTRY_TYPE,
		data: { vault },
	};
}

function loadLincCommands() {
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const entries: Array<{ customType: string; data?: unknown }> = [];
	const userMessages: string[] = [];
	const handlers = new Map<string, ExtensionHandler<ExtensionEvent, unknown>[]>();
	const pi = {
		registerTool: () => {},
		registerCommand: (name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
			commands.set(name, options);
		},
		on: (event: string, handler: ExtensionHandler<ExtensionEvent, unknown>) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		appendEntry: (customType: string, data?: unknown) => {
			entries.push({ customType, data });
		},
		sendUserMessage: (content: string | unknown[]) => {
			if (typeof content === "string") userMessages.push(content);
		},
	} as unknown as ExtensionAPI;

	vaultExtension(pi);
	matterExtension(pi);
	return { commands, entries, userMessages, handlers };
}

describe("Linc vault attachment state", () => {
	it("uses the newest vault entry and treats an empty custom entry as unlink", () => {
		const firstVault = { id: "vault-1", name: "First Vault", totalObjects: 2 };
		const secondVault = { id: "vault-2", name: "Second Vault", totalObjects: 3 };
		const sessionManager = {
			getEntries: () => [attachedVaultEntry(firstVault), attachedVaultEntry(secondVault)],
		};

		expect(getAttachedVault(sessionManager as never)).toEqual(secondVault);
		expect(formatVaultRef(secondVault)).toBe("Second Vault (vault-2, 3 objects)");

		const clearedSessionManager = {
			getEntries: () => [
				attachedVaultEntry(firstVault),
				{ type: "custom", customType: LINC_VAULT_ENTRY_TYPE, data: {} },
			],
		};

		expect(getAttachedVault(clearedSessionManager as never)).toBeUndefined();
	});
});

describe("Case.dev vault metadata", () => {
	beforeEach(() => {
		mocks.listCaseDevVaults.mockReset();
		mocks.getCaseDevVault.mockReset();
	});

	it("loads and formats vault records from the Case.dev API contract", async () => {
		mocks.listCaseDevVaults.mockResolvedValueOnce([
			{ id: "vault-1", name: "Alpha", totalObjects: 4 },
			{ id: "vault-2", name: "Beta" },
		]);

		const ctx = createContext({ cwd: "/tmp/linc-test" });
		const vaults = await loadCaseDevVaults(ctx);

		expect(vaults).toEqual([
			{ id: "vault-1", name: "Alpha", totalObjects: 4 },
			{ id: "vault-2", name: "Beta", totalObjects: undefined },
		]);
		expect(formatVaultOption(vaults[0]!)).toBe("Alpha · vault-1 · 4 objects");
		expect(toLincVaultRef(vaults[0]!)).toEqual({ id: "vault-1", name: "Alpha", totalObjects: 4 });
		expect(mocks.listCaseDevVaults).toHaveBeenCalledWith(ctx);
	});

	it("fails loudly when vault list metadata has the wrong shape", async () => {
		mocks.listCaseDevVaults.mockRejectedValueOnce(new Error("Case.dev returned invalid vault list metadata."));

		await expect(loadCaseDevVaults(createContext({ cwd: "/tmp/linc-test" }))).rejects.toThrow(
			"Case.dev returned invalid vault list metadata.",
		);
	});

	it("loads one vault by id", async () => {
		mocks.getCaseDevVault.mockResolvedValueOnce({ id: "vault-1", name: "Alpha", totalObjects: 4 });

		const ctx = createContext({ cwd: "/tmp/linc-test" });
		await expect(loadCaseDevVault(ctx, "vault-1")).resolves.toEqual({
			id: "vault-1",
			name: "Alpha",
			totalObjects: 4,
		});
		expect(mocks.getCaseDevVault).toHaveBeenCalledWith(ctx, "vault-1");
	});
});

describe("Case.dev vault tools", () => {
	let originalCaseVaultId: string | undefined;
	let originalAllowedVaultIds: string | undefined;

	beforeEach(() => {
		mocks.runCaseDevCli.mockReset();
		mocks.uploadCaseDevVaultFile.mockReset();
		originalCaseVaultId = process.env.CASE_VAULT_ID;
		originalAllowedVaultIds = process.env.CASE_ALLOWED_VAULT_IDS;
		delete process.env.CASE_VAULT_ID;
		delete process.env.CASE_ALLOWED_VAULT_IDS;
	});

	afterEach(() => {
		if (originalCaseVaultId === undefined) {
			delete process.env.CASE_VAULT_ID;
		} else {
			process.env.CASE_VAULT_ID = originalCaseVaultId;
		}
		if (originalAllowedVaultIds === undefined) {
			delete process.env.CASE_ALLOWED_VAULT_IDS;
		} else {
			process.env.CASE_ALLOWED_VAULT_IDS = originalAllowedVaultIds;
		}
	});

	function getTool(name: string) {
		const tool = createCaseDevVaultTools().find((entry) => entry.name === name);
		if (!tool) throw new Error(`Missing tool ${name}`);
		return tool;
	}

	it("registers C3-compatible vault tool aliases", () => {
		const names = createCaseDevVaultTools().map((tool) => tool.name);

		expect(names).toContain("vault_list");
		expect(names).toContain("vault_search");
		expect(names).toContain("vault_upload");
		expect(names).toContain("vault_download");
		expect(names).toContain("casedev_vault_upload");
	});

	it("uploads storage-only deliverables with CASE_VAULT_ID through REST", async () => {
		process.env.CASE_VAULT_ID = "vault-env";
		mocks.uploadCaseDevVaultFile.mockResolvedValueOnce({
			vaultId: "vault-env",
			objectId: "obj-deliverable",
			filename: "Deliverable.docx",
		});

		const ctx = createContext({ cwd: "/tmp/linc-test" }) as unknown as ExtensionContext;
		const result = await getTool("vault_upload").execute(
			"tool-call-1",
			{
				filePath: "Deliverable.docx",
				filename: "Deliverable.docx",
				contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				storageOnly: true,
			},
			undefined,
			undefined,
			ctx,
		);

		const firstContent = result.content[0];
		expect(firstContent?.type).toBe("text");
		expect(firstContent?.type === "text" ? firstContent.text : "").toContain("obj-deliverable");
		expect(firstContent?.type === "text" ? JSON.parse(firstContent.text) : {}).toMatchObject({
			objectId: "obj-deliverable",
			vaultId: "vault-env",
		});
		expect(mocks.uploadCaseDevVaultFile).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/tmp/linc-test" }), {
			vaultId: "vault-env",
			filePath: "Deliverable.docx",
			name: "Deliverable.docx",
			contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			ingest: false,
		});
		expect(mocks.runCaseDevCli).not.toHaveBeenCalled();
	});

	it("propagates REST upload failures", async () => {
		process.env.CASE_VAULT_ID = "vault-env";
		mocks.uploadCaseDevVaultFile.mockRejectedValueOnce(new Error("Case.dev API POST /vault/vault-env/upload failed"));

		const ctx = createContext({ cwd: "/tmp/linc-test" }) as unknown as ExtensionContext;

		await expect(
			getTool("vault_upload").execute(
				"tool-call-1",
				{ filePath: "Deliverable.docx", autoIndex: false },
				undefined,
				undefined,
				ctx,
			),
		).rejects.toThrow("Case.dev API POST /vault/vault-env/upload failed");
	});

	it("fails closed when an explicit vault is outside CASE_ALLOWED_VAULT_IDS", async () => {
		process.env.CASE_ALLOWED_VAULT_IDS = "vault-allowed";
		const ctx = createContext({ cwd: "/tmp/linc-test" }) as unknown as ExtensionContext;

		await expect(
			getTool("vault_search").execute(
				"tool-call-1",
				{ query: "facts", vaultId: "vault-other" },
				undefined,
				undefined,
				ctx,
			),
		).rejects.toThrow("not in CASE_ALLOWED_VAULT_IDS");
		expect(mocks.runCaseDevCli).not.toHaveBeenCalled();
	});

	it("caps oversized search results and steers toward vault_read_text", async () => {
		delete process.env.CASE_ALLOWED_VAULT_IDS;
		const ctx = createContext({ cwd: "/tmp/linc-test" }) as unknown as ExtensionContext;
		mocks.searchCaseDevVault.mockResolvedValue({
			chunks: Array.from({ length: 50 }, (_, i) => ({
				objectId: `obj-${i}`,
				text: "x".repeat(2_000),
				metadata: { page: i + 1 },
			})),
		});

		const result = await getTool("vault_search").execute(
			"tool-call-1",
			{ query: "facts", vaultId: "vault-1", limit: 50 },
			undefined,
			undefined,
			ctx,
		);
		const first = result.content[0];
		const output = first?.type === "text" ? first.text : "";
		expect(output.length).toBeLessThanOrEqual(22_000);
		const parsed = JSON.parse(output);
		expect(parsed.note).toContain("vault_read_text");
		for (const chunk of parsed.chunks) {
			expect(chunk.text.length).toBeLessThanOrEqual(501);
		}
		expect(parsed.omittedResults ?? "").toContain("omitted");
	});

	it("attaches structured sources to search results from the uncapped payload", async () => {
		delete process.env.CASE_ALLOWED_VAULT_IDS;
		const ctx = createContext({ cwd: "/tmp/linc-test" }) as unknown as ExtensionContext;
		mocks.searchCaseDevVault.mockResolvedValue({
			chunks: [
				{
					object_id: "obj-1",
					filename: "Deposition_Smith.pdf",
					text: "a".repeat(600),
					page_start: 3,
					page_end: 4,
					chunk_index: 12,
					total_chunks: 40,
				},
				{
					object_id: "obj-1",
					filename: "Deposition_Smith.pdf",
					text: "second passage from the same document",
					page_start: 7,
					chunk_index: 19,
				},
				{ object_id: "obj-2", name: "Incident Report", text: "short match" },
				{ text: "no object id — skipped" },
			],
		});

		const result = await getTool("vault_search").execute(
			"tool-call-1",
			{ query: "facts", vaultId: "vault-1" },
			undefined,
			undefined,
			ctx,
		);
		const details = result.details as { command: string[]; sources?: Array<Record<string, unknown>> };
		const sources = details.sources;
		expect(sources).toHaveLength(2);
		expect(details.command).toEqual(["POST", "/vault/vault-1/search"]);

		const [first, second] = sources ?? [];
		expect(first).toMatchObject({
			type: "vault",
			object_id: "obj-1",
			title: "Deposition_Smith.pdf",
			pages: "3–4, 7",
			chunkIndices: [12, 19],
			totalChunks: 40,
		});
		// Snippet is display-truncated; fullText keeps the real passages for
		// the citation verifier, merged across the document's chunks.
		expect(String(first?.snippet).length).toBeLessThanOrEqual(301);
		expect(first?.fullText).toContain("a".repeat(600));
		expect(first?.fullText).toContain("second passage from the same document");
		expect(second).toMatchObject({ type: "vault", object_id: "obj-2", title: "Incident Report" });
	});

	it("attaches a structured source to single-object downloads", async () => {
		delete process.env.CASE_ALLOWED_VAULT_IDS;
		const ctx = createContext({ cwd: "/tmp/linc-test" }) as unknown as ExtensionContext;
		mocks.listCaseDevVaultObjects.mockResolvedValue([
			{ id: "obj-9", filename: "Contract.pdf", ingestionStatus: "completed" },
		]);
		mocks.downloadCaseDevVaultObject.mockResolvedValue({ objectId: "obj-9", path: "/tmp/Contract.pdf", bytes: 10 });

		const result = await getTool("vault_download").execute(
			"tool-call-1",
			{ objectId: "obj-9", vaultId: "vault-1" },
			undefined,
			undefined,
			ctx,
		);
		const downloadDetails = result.details as { sources?: unknown };
		expect(downloadDetails.sources).toEqual([{ type: "vault", object_id: "obj-9", title: "Contract.pdf" }]);
	});

	it("passes small search results through intact with the steering note", async () => {
		delete process.env.CASE_ALLOWED_VAULT_IDS;
		const ctx = createContext({ cwd: "/tmp/linc-test" }) as unknown as ExtensionContext;
		mocks.searchCaseDevVault.mockResolvedValue({
			chunks: [{ objectId: "obj-1", text: "short match", metadata: { page: 3 } }],
		});

		const result = await getTool("vault_search").execute(
			"tool-call-1",
			{ query: "facts", vaultId: "vault-1" },
			undefined,
			undefined,
			ctx,
		);
		const firstSmall = result.content[0];
		const parsed = JSON.parse(firstSmall?.type === "text" ? firstSmall.text : "{}");
		expect(parsed.chunks).toHaveLength(1);
		expect(parsed.chunks[0].text).toBe("short match");
		expect(parsed.note).toContain("vault_read_text");
		expect(parsed.omittedResults).toBeUndefined();
	});
});

describe("MATTER.md source precedence", () => {
	let cwd: string;
	let statuses: Map<string, string | undefined>;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "linc-matter-test-"));
		statuses = new Map();
		mocks.listCaseDevVaultObjects.mockReset();
		mocks.downloadCaseDevVaultObject.mockReset();
		mocks.uploadCaseDevVaultFile.mockReset();
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	function contextWithAttachedVault() {
		return createContext({
			cwd,
			statuses,
			entries: [attachedVaultEntry({ id: "vault-1", name: "Alpha", totalObjects: 4 })],
		});
	}

	it("keeps workspace MATTER.md when workspace-first is selected", async () => {
		await writeFile(join(cwd, "MATTER.md"), "# Workspace Matter\n", "utf-8");

		const state = await materializeMatterMd(contextWithAttachedVault(), { sourcePrecedence: "workspace-first" });

		expect(state?.content).toBe("# Workspace Matter\n");
		expect(await readFile(join(cwd, "MATTER.md"), "utf-8")).toBe("# Workspace Matter\n");
		expect(mocks.listCaseDevVaultObjects).not.toHaveBeenCalled();
		expect(statuses.get("linc.matter")).toBe("matter: MATTER.md");
	});

	it("replaces stale workspace MATTER.md when vault-first is selected", async () => {
		await writeFile(join(cwd, "MATTER.md"), "# Stale Matter\n", "utf-8");
		mocks.listCaseDevVaultObjects.mockResolvedValueOnce([{ id: "object-1", name: "MATTER.md" }]);
		mocks.downloadCaseDevVaultObject.mockImplementation(async (_ctx: ExtensionContext, args: { outDir: string }) => {
			await writeFile(join(args.outDir, "MATTER.md"), "# Vault Matter\n", "utf-8");
			return { objectId: "object-1", path: join(args.outDir, "MATTER.md"), bytes: 15 };
		});

		const state = await materializeMatterMd(contextWithAttachedVault(), { sourcePrecedence: "vault-first" });

		expect(state?.content).toBe("# Vault Matter\n");
		expect(await readFile(join(cwd, "MATTER.md"), "utf-8")).toBe("# Vault Matter\n");
		expect(statuses.get("linc.matter")).toBe("matter: MATTER.md");
		expect(mocks.listCaseDevVaultObjects).toHaveBeenCalledTimes(1);
		expect(mocks.downloadCaseDevVaultObject).toHaveBeenCalledWith(
			expect.objectContaining({ cwd }),
			expect.objectContaining({ vaultId: "vault-1", objectId: "object-1", filename: "MATTER.md" }),
		);
	});

	it("returns missing state when vault-first has no vault MATTER.md", async () => {
		mocks.listCaseDevVaultObjects.mockResolvedValueOnce([]);

		await expect(
			materializeMatterMd(contextWithAttachedVault(), { sourcePrecedence: "vault-first" }),
		).resolves.toBeUndefined();
		expect(statuses.get("linc.matter")).toBeUndefined();
	});
});

describe("Linc matter and vault commands", () => {
	let cwd: string;
	let notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "linc-command-test-"));
		notifications = [];
		mocks.runCaseDevCli.mockReset();
		mocks.uploadCaseDevVaultFile.mockReset();
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("treats /vault unlink as an attached-vault clear action", async () => {
		const { commands, entries } = loadLincCommands();
		const vaultCommand = commands.get("vault");
		const reload = vi.fn(async () => {});
		expect(vaultCommand).toBeDefined();

		await vaultCommand!.handler(
			"unlink",
			createContext({
				cwd,
				notifications,
				reload,
				entries: [attachedVaultEntry({ id: "vault-1", name: "Alpha" })],
			}),
		);

		expect(entries).toEqual([{ customType: LINC_VAULT_ENTRY_TYPE, data: {} }]);
		expect(notifications).toEqual([{ message: "Cleared attached vault", type: "info" }]);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("shows a useful /matter warning before a vault is attached", async () => {
		const { commands } = loadLincCommands();
		const matterCommand = commands.get("matter");
		expect(matterCommand).toBeDefined();

		await matterCommand!.handler("", createContext({ cwd, notifications }));

		expect(notifications).toEqual([{ message: "No vault is attached.", type: "warning" }]);
	});

	it("warns when /autoinit runs without an attached vault", async () => {
		const { commands, userMessages } = loadLincCommands();
		const autoInitCommand = commands.get("autoinit");
		expect(autoInitCommand).toBeDefined();

		await autoInitCommand!.handler("", createContext({ cwd, hasUI: true, notifications }));

		expect(userMessages).toEqual([]);
		expect(notifications).toEqual([{ message: "Attach a Case.dev vault before running /autoinit", type: "warning" }]);
	});

	it("discovers MATTER.md as a session context file only when a vault is attached", async () => {
		await writeFile(join(cwd, "MATTER.md"), "# Matter\n", "utf-8");
		const { handlers } = loadLincCommands();
		const resourceHandlers = handlers.get("resources_discover");
		expect(resourceHandlers).toBeDefined();

		await expect(
			resourceHandlers![0]!({ type: "resources_discover", cwd, reason: "startup" }, createContext({ cwd })),
		).resolves.toBeUndefined();

		const result = await resourceHandlers![0]!(
			{ type: "resources_discover", cwd, reason: "startup" },
			createContext({
				cwd,
				entries: [attachedVaultEntry({ id: "vault-1", name: "Alpha" })],
			}),
		);

		expect(result).toEqual({ contextFilePaths: [join(cwd, "MATTER.md")] });
	});

	it("sends an exploratory matter initialization prompt for /autoinit", async () => {
		const { commands, userMessages } = loadLincCommands();
		const autoInitCommand = commands.get("autoinit");
		expect(autoInitCommand).toBeDefined();

		await autoInitCommand!.handler(
			"focus on pleadings and deadlines",
			createContext({
				cwd,
				hasUI: true,
				notifications,
				entries: [attachedVaultEntry({ id: "vault-1", name: "Alpha", totalObjects: 4 })],
			}),
		);

		expect(notifications).toEqual([]);
		expect(userMessages).toHaveLength(1);
		expect(userMessages[0]).toContain("# Linc Matter Auto-Initialization");
		expect(userMessages[0]).toContain("Attached vault: Alpha (vault-1, 4 objects)");
		expect(userMessages[0]).toContain("User notes: focus on pleadings and deadlines");
		expect(userMessages[0]).toContain("Inspect the vault with casedev_vault_get");
		expect(userMessages[0]).toContain("Write UNKNOWN exactly");
		expect(userMessages[0]).toContain("Do not guess");
	});

	it("edits MATTER.md and syncs it to the attached vault", async () => {
		await writeFile(join(cwd, "MATTER.md"), "# Old Matter\n", "utf-8");
		mocks.uploadCaseDevVaultFile.mockResolvedValueOnce({ objectId: "object-1", filename: "MATTER.md" });

		const { commands } = loadLincCommands();
		const matterCommand = commands.get("matter");
		expect(matterCommand).toBeDefined();

		await matterCommand!.handler(
			"edit",
			createContext({
				cwd,
				hasUI: true,
				notifications,
				entries: [attachedVaultEntry({ id: "vault-1", name: "Alpha" })],
				editor: async (title, prefill) => {
					expect(title).toBe("Edit MATTER.md");
					expect(prefill).toBe("# Old Matter\n");
					return "# New Matter\n";
				},
			}),
		);

		expect(await readFile(join(cwd, "MATTER.md"), "utf-8")).toBe("# New Matter\n");
		expect(mocks.uploadCaseDevVaultFile).toHaveBeenCalledWith(expect.objectContaining({ cwd }), {
			vaultId: "vault-1",
			filePath: join(cwd, "MATTER.md"),
			name: "MATTER.md",
			contentType: "text/markdown",
			ingest: false,
		});
		expect(notifications).toEqual([
			{ message: "Saved MATTER.md and synced it to the attached Case.dev vault", type: "info" },
		]);
	});
});
