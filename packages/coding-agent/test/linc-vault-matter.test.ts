import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { formatVaultOption, loadCaseDevVault, loadCaseDevVaults, toLincVaultRef } from "../src/linc/casedev-vaults.ts";
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
}

function createContext({ cwd, entries = [], statuses = new Map<string, string | undefined>() }: TestContextOptions) {
	return {
		cwd,
		signal: undefined,
		sessionManager: {
			getEntries: () => entries,
		},
		ui: {
			setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
		},
	} as unknown as ExtensionContext;
}

function attachedVaultEntry(vault: { id: string; name: string; totalObjects?: number }): unknown {
	return {
		type: "custom",
		customType: LINC_VAULT_ENTRY_TYPE,
		data: { vault },
	};
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
