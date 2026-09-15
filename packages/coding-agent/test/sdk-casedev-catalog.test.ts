import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

// CD-1557 review: with the packaged Case.dev defaults gone, the direct SDK entry
// point must load the live catalog itself, or a caller with valid Case.dev auth
// gets "No models available" while the catalog is reachable.
describe("createAgentSession loads the Case.dev catalog", () => {
	let tempDir: string;
	const catalog = {
		object: "list",
		data: [
			{
				id: "casemark/core-mini",
				object: "model",
				type: "language",
				name: "CaseMark Core Mini",
				context_window: 262144,
				max_tokens: 32000,
				tags: ["reasoning"],
				pricing: { input: "0.000002", output: "0.000006" },
			},
		],
	};

	function makeDeps() {
		const authStorage = AuthStorage.inMemory();
		authStorage.set("casedev", { type: "api_key", key: "sk_case_test" });
		const settingsManager = SettingsManager.inMemory({
			defaultProvider: "casedev",
			defaultModel: "casemark/core-mini",
		});
		return { authStorage, settingsManager, sessionManager: SessionManager.inMemory() };
	}

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "sdk-casedev-catalog-"));
		vi.unstubAllEnvs();
		vi.stubEnv("PI_OFFLINE", "");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("fetches the catalog once and selects the configured Case.dev default", async () => {
		const fetchMock = vi.fn(async (_input: string | URL | Request) => ({ ok: true, json: async () => catalog }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await createAgentSession({ cwd: tempDir, agentDir: tempDir, ...makeDeps() });

		const catalogCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/llm/v1/models"));
		expect(catalogCalls).toHaveLength(1);
		expect(result.session.model).toMatchObject({
			provider: "casedev",
			id: "casemark/core-mini",
			contextWindow: 262144,
		});
		expect(result.modelFallbackMessage).toBeUndefined();
		expect(result.caseDevModelsWarning).toBeUndefined();
		result.session.dispose();
	});

	it("does not refetch when the caller supplies its own registry", async () => {
		const fetchMock = vi.fn(async (_input: string | URL | Request) => ({ ok: true, json: async () => catalog }));
		vi.stubGlobal("fetch", fetchMock);
		const deps = makeDeps();
		const modelRegistry = ModelRegistry.create(deps.authStorage, join(tempDir, "models.json"));
		await modelRegistry.refreshCaseDevModels();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const result = await createAgentSession({ cwd: tempDir, agentDir: tempDir, ...deps, modelRegistry });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.session.model?.id).toBe("casemark/core-mini");
		result.session.dispose();
	});

	it("reports a warning and no Case.dev models when the catalog fetch fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("gateway unreachable");
			}),
		);

		const result = await createAgentSession({ cwd: tempDir, agentDir: tempDir, ...makeDeps() });

		expect(result.caseDevModelsWarning).toContain("Failed to fetch Case.dev models: gateway unreachable");
		expect(result.session.model?.provider).not.toBe("casedev");
		result.session.dispose();
	});
});
