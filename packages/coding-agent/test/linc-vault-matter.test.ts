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
import { formatVaultOption, loadCaseDevVault, loadCaseDevVaults, toLincVaultRef } from "../src/linc/casedev-vaults.ts";
import matterExtension from "../src/linc/extensions/matter.ts";
import vaultExtension from "../src/linc/extensions/vault.ts";
import { materializeMatterMd } from "../src/linc/matter-md.ts";
import { formatVaultRef, getAttachedVault, LINC_VAULT_ENTRY_TYPE } from "../src/linc/vault-attachment.ts";

const mocks = vi.hoisted(() => ({
	runCaseDevCli: vi.fn(),
}));

vi.mock("../src/linc/casedev-cli.ts", () => ({
	formatCaseDevCliResult: (result: { stdout: string; stderr: string; code: number }) => {
		if (result.code !== 0) throw new Error(result.stderr || `casedev exited with code ${result.code}`);
		return result.stdout.trim();
	},
	runCaseDevCli: mocks.runCaseDevCli,
}));

interface TestContextOptions {
	cwd: string;
	entries?: unknown[];
	statuses?: Map<string, string | undefined>;
	hasUI?: boolean;
	notifications?: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;
	editor?: (title: string, prefill?: string) => Promise<string | undefined>;
}

function createContext({
	cwd,
	entries = [],
	statuses = new Map<string, string | undefined>(),
	hasUI = false,
	notifications = [],
	editor = async () => undefined,
}: TestContextOptions) {
	return {
		cwd,
		signal: undefined,
		hasUI,
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
		mocks.runCaseDevCli.mockReset();
	});

	it("loads and formats vault records from the Case.dev CLI contract", async () => {
		mocks.runCaseDevCli.mockResolvedValueOnce({
			stdout: JSON.stringify({
				vaults: [
					{ id: "vault-1", name: "Alpha", totalObjects: 4 },
					{ id: "vault-2", name: "Beta" },
					{ id: "", name: "Ignored" },
				],
			}),
			stderr: "",
			code: 0,
		});

		const ctx = createContext({ cwd: "/tmp/linc-test" });
		const vaults = await loadCaseDevVaults(ctx);

		expect(vaults).toEqual([
			{ id: "vault-1", name: "Alpha", totalObjects: 4 },
			{ id: "vault-2", name: "Beta", totalObjects: undefined },
		]);
		expect(formatVaultOption(vaults[0]!)).toBe("Alpha · vault-1 · 4 objects");
		expect(toLincVaultRef(vaults[0]!)).toEqual({ id: "vault-1", name: "Alpha", totalObjects: 4 });
		expect(mocks.runCaseDevCli).toHaveBeenCalledWith(ctx, ["vault", "list"], undefined);
	});

	it("fails loudly when vault list metadata has the wrong shape", async () => {
		mocks.runCaseDevCli.mockResolvedValueOnce({
			stdout: JSON.stringify({ data: [] }),
			stderr: "",
			code: 0,
		});

		await expect(loadCaseDevVaults(createContext({ cwd: "/tmp/linc-test" }))).rejects.toThrow(
			"Case.dev returned invalid vault list metadata.",
		);
	});

	it("loads one vault by id", async () => {
		mocks.runCaseDevCli.mockResolvedValueOnce({
			stdout: JSON.stringify({ id: "vault-1", name: "Alpha", totalObjects: 4 }),
			stderr: "",
			code: 0,
		});

		const ctx = createContext({ cwd: "/tmp/linc-test" });
		await expect(loadCaseDevVault(ctx, "vault-1")).resolves.toEqual({
			id: "vault-1",
			name: "Alpha",
			totalObjects: 4,
		});
		expect(mocks.runCaseDevCli).toHaveBeenCalledWith(ctx, ["vault", "get", "vault-1"], undefined);
	});
});

describe("MATTER.md source precedence", () => {
	let cwd: string;
	let statuses: Map<string, string | undefined>;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "linc-matter-test-"));
		statuses = new Map();
		mocks.runCaseDevCli.mockReset();
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
		expect(mocks.runCaseDevCli).not.toHaveBeenCalled();
		expect(statuses.get("linc.matter")).toBe("matter: MATTER.md");
	});

	it("replaces stale workspace MATTER.md when vault-first is selected", async () => {
		await writeFile(join(cwd, "MATTER.md"), "# Stale Matter\n", "utf-8");
		mocks.runCaseDevCli.mockImplementation(async (_ctx: ExtensionContext, args: string[]) => {
			if (args.join(" ") === "vault object list vault-1") {
				return {
					stdout: JSON.stringify({ objects: [{ id: "object-1", name: "MATTER.md" }] }),
					stderr: "",
					code: 0,
				};
			}
			if (args[0] === "vault" && args[1] === "download") {
				const outDir = args[args.indexOf("--out") + 1];
				await writeFile(join(outDir!, "MATTER.md"), "# Vault Matter\n", "utf-8");
				return { stdout: JSON.stringify({ ok: true }), stderr: "", code: 0 };
			}
			throw new Error(`Unexpected casedev args: ${args.join(" ")}`);
		});

		const state = await materializeMatterMd(contextWithAttachedVault(), { sourcePrecedence: "vault-first" });

		expect(state?.content).toBe("# Vault Matter\n");
		expect(await readFile(join(cwd, "MATTER.md"), "utf-8")).toBe("# Vault Matter\n");
		expect(statuses.get("linc.matter")).toBe("matter: MATTER.md");
		expect(mocks.runCaseDevCli).toHaveBeenCalledTimes(2);
	});

	it("returns missing state when vault-first has no vault MATTER.md", async () => {
		mocks.runCaseDevCli.mockResolvedValueOnce({
			stdout: JSON.stringify({ objects: [] }),
			stderr: "",
			code: 0,
		});

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
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("treats /vault unlink as an attached-vault clear action", async () => {
		const { commands, entries } = loadLincCommands();
		const vaultCommand = commands.get("vault");
		expect(vaultCommand).toBeDefined();

		await vaultCommand!.handler(
			"unlink",
			createContext({
				cwd,
				notifications,
				entries: [attachedVaultEntry({ id: "vault-1", name: "Alpha" })],
			}),
		);

		expect(entries).toEqual([{ customType: LINC_VAULT_ENTRY_TYPE, data: {} }]);
		expect(notifications).toEqual([{ message: "Cleared attached vault", type: "info" }]);
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
		mocks.runCaseDevCli.mockResolvedValueOnce({
			stdout: JSON.stringify({ id: "object-1", name: "MATTER.md" }),
			stderr: "",
			code: 0,
		});

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
		expect(mocks.runCaseDevCli).toHaveBeenCalledWith(
			expect.objectContaining({ cwd }),
			[
				"vault",
				"object",
				"upload",
				join(cwd, "MATTER.md"),
				"--vault",
				"vault-1",
				"--name",
				"MATTER.md",
				"--content-type",
				"text/markdown",
				"--no-ingest",
			],
			undefined,
		);
		expect(notifications).toEqual([
			{ message: "Saved MATTER.md and synced it to the attached Case.dev vault", type: "info" },
		]);
	});
});
