#!/usr/bin/env node

import {
	copyFileSync,
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const docsRoot = join(repoRoot, "docs", "linc");
const defaultPort = 4317;
const defaultDocSlug = "overlay";
const docOrder = [defaultDocSlug, "overview", "quickstart", "web-ui", "gateway", "configuration", "development"];

function parsePort(argv) {
	const index = argv.indexOf("--port");
	if (index === -1) return defaultPort;
	const value = Number(argv[index + 1]);
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		throw new Error(`Invalid --port value: ${argv[index + 1] ?? ""}`);
	}
	return value;
}

function parseBuildOutput(argv) {
	const index = argv.indexOf("--build");
	if (index === -1) return undefined;
	const value = argv[index + 1];
	return value && !value.startsWith("-") ? value : "dist/linc-docs";
}

function escapeHtml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function slugFromFile(fileName) {
	return fileName.replace(/\.md$/, "");
}

function titleFromMarkdown(fileName) {
	const body = readFileSync(join(docsRoot, fileName), "utf8");
	const heading = body.match(/^#\s+(.+)$/m);
	if (heading) return heading[1].trim();
	return slugFromFile(fileName)
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function getDocs() {
	return readdirSync(docsRoot)
		.filter((fileName) => fileName.endsWith(".md"))
		.sort((a, b) => {
			const aIndex = docOrder.indexOf(slugFromFile(a));
			const bIndex = docOrder.indexOf(slugFromFile(b));
			if (aIndex !== -1 || bIndex !== -1) {
				return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
			}
			return titleFromMarkdown(a).localeCompare(titleFromMarkdown(b));
		})
		.map((fileName) => ({
			fileName,
			slug: slugFromFile(fileName),
			title: titleFromMarkdown(fileName),
		}));
}

function renderInline(value) {
	let html = escapeHtml(value);
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
		const url = String(href).endsWith(".md") ? `/docs/${String(href).replace(/\.md$/, "")}` : String(href);
		return `<a href="${escapeHtml(url)}">${label}</a>`;
	});
	return html;
}

function renderMarkdown(markdown) {
	const lines = markdown.replaceAll("\r\n", "\n").split("\n");
	const html = [];
	let inCode = false;
	let listOpen = false;
	let paragraph = [];

	function closeParagraph() {
		if (paragraph.length === 0) return;
		html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
		paragraph = [];
	}

	function closeList() {
		if (!listOpen) return;
		html.push("</ul>");
		listOpen = false;
	}

	for (const line of lines) {
		if (line.startsWith("```")) {
			closeParagraph();
			closeList();
			if (inCode) {
				html.push("</code></pre>");
			} else {
				const lang = line.slice(3).trim();
				html.push(`<pre><code data-lang="${escapeHtml(lang)}">`);
			}
			inCode = !inCode;
			continue;
		}

		if (inCode) {
			html.push(`${escapeHtml(line)}\n`);
			continue;
		}

		if (line.trim() === "") {
			closeParagraph();
			closeList();
			continue;
		}

		const heading = line.match(/^(#{1,4})\s+(.+)$/);
		if (heading) {
			closeParagraph();
			closeList();
			const level = heading[1].length;
			html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
			continue;
		}

		const listItem = line.match(/^\s*-\s+(.+)$/);
		if (listItem) {
			closeParagraph();
			if (!listOpen) {
				html.push("<ul>");
				listOpen = true;
			}
			html.push(`<li>${renderInline(listItem[1])}</li>`);
			continue;
		}

		paragraph.push(line.trim());
	}

	closeParagraph();
	closeList();
	if (inCode) html.push("</code></pre>");
	return html.join("\n");
}

function renderPage(activeSlug) {
	const docs = getDocs();
	const activeDoc = docs.find((doc) => doc.slug === activeSlug);
	if (!activeDoc) {
		return undefined;
	}
	const markdown = readFileSync(join(docsRoot, activeDoc.fileName), "utf8");
	const nav = docs
		.map((doc) => {
			const active = doc.slug === activeDoc.slug ? ' aria-current="page"' : "";
			return `<a${active} href="/docs/${doc.slug}">${escapeHtml(doc.title)}</a>`;
		})
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(activeDoc.title)} - Linc Docs</title>
<style>
@font-face { font-family: "Season Sans"; src: url("/fonts/season-sans/SeasonSans-TRIAL-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "Season Sans"; src: url("/fonts/season-sans/SeasonSans-TRIAL-Bold.woff2") format("woff2"); font-weight: 700; font-style: normal; font-display: swap; }
@font-face { font-family: "Season Mix"; src: url("/fonts/season-mix/SeasonMix-TRIAL-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "Season Mix"; src: url("/fonts/season-mix/SeasonMix-TRIAL-Bold.woff2") format("woff2"); font-weight: 700; font-style: normal; font-display: swap; }
:root { color-scheme: light; --bg: #fff; --fg: #111; --muted: #666; --line: #d8d8d8; --soft: #f5f5f5; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.55 "Season Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
nav { border-right: 1px solid var(--line); padding: 20px 14px; position: sticky; top: 0; height: 100vh; overflow: auto; }
.brand { font-family: "Season Mix", "Season Sans", ui-sans-serif, system-ui, sans-serif; font-weight: 700; font-size: 18px; margin: 0 0 18px; letter-spacing: 0; }
nav a { display: block; color: var(--fg); text-decoration: none; padding: 6px 8px; border-radius: 6px; }
nav a[aria-current="page"] { background: var(--fg); color: var(--bg); }
main { max-width: 980px; padding: 42px 56px 80px; }
h1, h2, h3 { font-family: "Season Mix", "Season Sans", ui-sans-serif, system-ui, sans-serif; }
h1 { font-size: 38px; line-height: 1.1; margin: 0 0 28px; letter-spacing: 0; font-weight: 700; }
h2 { margin-top: 34px; border-top: 1px solid var(--line); padding-top: 22px; font-size: 24px; letter-spacing: 0; font-weight: 700; }
h3 { margin-top: 26px; font-size: 18px; letter-spacing: 0; font-weight: 700; }
p, li { max-width: 760px; }
a { color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }
code { font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px; }
pre { overflow: auto; background: #111; color: #fff; border-radius: 6px; padding: 16px; max-width: 900px; }
pre code { background: transparent; border: 0; color: inherit; padding: 0; }
ul { padding-left: 22px; }
@media (max-width: 760px) {
  .layout { display: block; }
  nav { height: auto; position: static; border-right: 0; border-bottom: 1px solid var(--line); }
  main { padding: 28px 20px 56px; }
  h1 { font-size: 30px; }
}
</style>
</head>
<body>
<div class="layout">
<nav>
<p class="brand">Linc Docs</p>
${nav}
</nav>
<main>
${renderMarkdown(markdown)}
</main>
</div>
</body>
</html>`;
}

function sendText(response, statusCode, contentType, body) {
	response.writeHead(statusCode, { "content-type": contentType });
	response.end(body);
}

function safeAssetPath(pathname) {
	const assetPath = normalize(join(docsRoot, pathname.replace(/^\/+/, "")));
	const rel = relative(docsRoot, assetPath);
	if (rel.startsWith("..") || rel.includes(`..${sep}`)) return undefined;
	return assetPath;
}

function serveAsset(pathname, response) {
	const assetPath = safeAssetPath(pathname);
	if (!assetPath || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
		sendText(response, 404, "text/plain; charset=utf-8", "Not found");
		return;
	}
	const ext = extname(assetPath);
	const contentType = ext === ".png" ? "image/png" : ext === ".woff2" ? "font/woff2" : "application/octet-stream";
	response.writeHead(200, { "content-type": contentType });
	createReadStream(assetPath).pipe(response);
}

function copyDirectory(source, target) {
	if (!existsSync(source)) return;
	mkdirSync(target, { recursive: true });
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		const sourcePath = join(source, entry.name);
		const targetPath = join(target, entry.name);
		if (entry.isDirectory()) {
			copyDirectory(sourcePath, targetPath);
		} else if (entry.isFile()) {
			copyFileSync(sourcePath, targetPath);
		}
	}
}

function buildStatic(outputDir) {
	const targetRoot = normalize(join(repoRoot, outputDir));
	rmSync(targetRoot, { recursive: true, force: true });
	mkdirSync(targetRoot, { recursive: true });
	for (const doc of getDocs()) {
		const docDir = join(targetRoot, "docs", doc.slug);
		mkdirSync(docDir, { recursive: true });
		writeFileSync(join(docDir, "index.html"), renderPage(doc.slug));
	}
	writeFileSync(
		join(targetRoot, "index.html"),
		`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/docs/${defaultDocSlug}"><title>Linc Docs</title><a href="/docs/${defaultDocSlug}">Linc Docs</a>`,
	);
	copyDirectory(join(docsRoot, "images"), join(targetRoot, "images"));
	copyDirectory(join(docsRoot, "fonts"), join(targetRoot, "fonts"));
	console.log(`Built Linc docs to ${targetRoot}`);
}

const buildOutput = parseBuildOutput(process.argv.slice(2));
if (buildOutput) {
	buildStatic(buildOutput);
	process.exit(0);
}

const port = parsePort(process.argv.slice(2));
const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
	if (url.pathname === "/health") {
		sendText(response, 200, "text/plain; charset=utf-8", "ok");
		return;
	}
	if (url.pathname === "/") {
		response.writeHead(302, { location: `/docs/${defaultDocSlug}` });
		response.end();
		return;
	}
	if (url.pathname.startsWith("/docs/")) {
		const page = renderPage(url.pathname.replace("/docs/", ""));
		if (!page) {
			sendText(response, 404, "text/plain; charset=utf-8", "Not found");
			return;
		}
		sendText(response, 200, "text/html; charset=utf-8", page);
		return;
	}
	if (url.pathname.startsWith("/images/") || url.pathname.startsWith("/fonts/")) {
		serveAsset(url.pathname, response);
		return;
	}
	sendText(response, 404, "text/plain; charset=utf-8", "Not found");
});

server.listen(port, "127.0.0.1", () => {
	console.log(`Linc docs preview: http://127.0.0.1:${port}`);
});
