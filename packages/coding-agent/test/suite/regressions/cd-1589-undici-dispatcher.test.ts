import { createServer, request as httpRequest, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { gzipSync } from "node:zlib";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { getGlobalDispatcher, request, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { configureHttpDispatcher } from "../../../src/core/http-dispatcher.ts";
import { createHarness } from "../harness.ts";

let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;
let restoreGlobals: (() => void) | undefined;
const servers: Server[] = [];
const sockets = new Set<Duplex>();

function preserveChangedGlobals(operation: () => void): () => void {
	const before = Object.getOwnPropertyDescriptors(globalThis);
	operation();
	const after = Object.getOwnPropertyDescriptors(globalThis);
	const changed = [...new Set([...Reflect.ownKeys(before), ...Reflect.ownKeys(after)])].filter((key) => {
		const previous = Reflect.get(before, key) as PropertyDescriptor | undefined;
		const current = Reflect.get(after, key) as PropertyDescriptor | undefined;
		return ["value", "get", "set", "writable", "enumerable", "configurable"].some(
			(field) => !Object.is(previous && Reflect.get(previous, field), current && Reflect.get(current, field)),
		);
	});
	return () => {
		for (const key of changed) {
			const descriptor = Reflect.get(before, key) as PropertyDescriptor | undefined;
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else if (!Reflect.deleteProperty(globalThis, key)) throw new Error(`Cannot restore global ${String(key)}`);
		}
	};
}

function configureFixtureDispatcher(timeoutMs: number): void {
	restoreGlobals = preserveChangedGlobals(() => configureHttpDispatcher(timeoutMs));
}

beforeEach(() => {
	originalDispatcher = getGlobalDispatcher();
	restoreGlobals = undefined;
	for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY", "no_proxy"])
		vi.stubEnv(name, "");
});

afterEach(async () => {
	const installed = getGlobalDispatcher();
	setGlobalDispatcher(originalDispatcher);
	if (installed !== originalDispatcher) await installed.destroy();
	for (const socket of sockets) socket.destroy();
	sockets.clear();
	for (const server of servers) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	servers.length = 0;
	restoreGlobals?.();
	vi.unstubAllEnvs();
});

async function listen(server: Server): Promise<number> {
	servers.push(server);
	server.on("connection", (socket) => sockets.add(socket));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing loopback address");
	return address.port;
}

describe("CD-1589 upgraded HTTP dispatcher", () => {
	test("global cleanup restores descriptors and removes newly installed globals", () => {
		const existing = Symbol("existing fixture global");
		const added = Symbol("new fixture global");
		const descriptor = { value: "original", writable: true, configurable: true, enumerable: false };
		Object.defineProperty(globalThis, existing, descriptor);
		try {
			const restore = preserveChangedGlobals(() => {
				Object.defineProperty(globalThis, existing, { ...descriptor, value: "changed", enumerable: true });
				Object.defineProperty(globalThis, added, { value: "new", configurable: true });
			});
			restore();
			expect(Object.getOwnPropertyDescriptor(globalThis, existing)).toEqual(descriptor);
			expect(Object.hasOwn(globalThis, added)).toBe(false);
		} finally {
			Reflect.deleteProperty(globalThis, existing);
			Reflect.deleteProperty(globalThis, added);
		}
	});

	for (const proxied of [false, true]) {
		test(`agent tool reads compressed JSON ${proxied ? "through an authenticated loopback proxy" : "directly"}`, async () => {
			let receivedAuthorization: string | undefined;
			const proxyTargets: string[] = [];
			const port = await listen(
				createServer((_req, res) => {
					res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
					res.end(gzipSync(JSON.stringify({ item: "Ask for the date." })));
				}),
			);
			if (proxied) {
				const proxy = createServer((req, res) => {
					proxyTargets.push(req.url ?? "");
					receivedAuthorization = req.headers["proxy-authorization"];
					if (req.url !== `http://127.0.0.1:${port}/checklist`) {
						res.writeHead(400).end();
						return;
					}
					const upstream = httpRequest({ hostname: "127.0.0.1", port, path: "/checklist" }, (response) => {
						res.writeHead(response.statusCode ?? 502, response.headers);
						response.pipe(res);
					});
					upstream.on("error", () => res.destroy());
					req.pipe(upstream);
				});
				const proxyPort = await listen(proxy);
				vi.stubEnv("http_proxy", `http://fixture-user:fixture-pass@127.0.0.1:${proxyPort}`);
			}
			configureFixtureDispatcher(1_000);
			const harness = await createHarness({
				tools: [
					{
						name: "fixture_fetch",
						label: "Fixture fetch",
						description: "Fetch loopback fixture",
						parameters: Type.Object({}),
						async execute() {
							const response = await fetch(`http://127.0.0.1:${port}/checklist`, {
								signal: AbortSignal.timeout(2_000),
							});
							return { content: [{ type: "text", text: JSON.stringify(await response.json()) }], details: {} };
						},
					},
				],
			});
			try {
				harness.setResponses([
					fauxAssistantMessage([fauxToolCall("fixture_fetch", {})], { stopReason: "toolUse" }),
					fauxAssistantMessage("Ask for the date."),
				]);
				await harness.session.prompt("Read the fixture checklist.");
				const results = harness.eventsOfType("tool_execution_end");
				expect(results).toHaveLength(1);
				if (proxied) expect(proxyTargets).toContain(`http://127.0.0.1:${port}/checklist`);
				expect(results[0]).toMatchObject({ isError: false });
				expect(JSON.stringify(results[0].result)).toContain("Ask for the date.");
				if (proxied)
					expect(receivedAuthorization).toBe(
						`Basic ${Buffer.from("fixture-user:fixture-pass").toString("base64")}`,
					);
			} finally {
				harness.cleanup();
			}
		});
	}

	test("configured header idle timeout rejects a stalled loopback response", async () => {
		const port = await listen(createServer(() => {}));
		configureFixtureDispatcher(20);
		await expect(request(`http://127.0.0.1:${port}/stall`)).rejects.toMatchObject({
			code: "UND_ERR_HEADERS_TIMEOUT",
		});
	});
});
