import type { PathMetadata } from "./package-manager.ts";

export type SourceScope = "user" | "project" | "temporary";
export type SourceOrigin = "package" | "top-level";

export interface SourceInfo {
	path: string;
	source: string;
	scope: SourceScope;
	origin: SourceOrigin;
	baseDir?: string;
	label?: string;
}

export function createSourceInfo(path: string, metadata: PathMetadata): SourceInfo {
	const sourceInfo: SourceInfo = {
		path,
		source: metadata.source,
		scope: metadata.scope,
		origin: metadata.origin,
		baseDir: metadata.baseDir,
	};
	if (metadata.label) {
		sourceInfo.label = metadata.label;
	}
	return sourceInfo;
}

export function createSyntheticSourceInfo(
	path: string,
	options: {
		source: string;
		scope?: SourceScope;
		origin?: SourceOrigin;
		baseDir?: string;
		label?: string;
	},
): SourceInfo {
	const sourceInfo: SourceInfo = {
		path,
		source: options.source,
		scope: options.scope ?? "temporary",
		origin: options.origin ?? "top-level",
		baseDir: options.baseDir,
	};
	if (options.label) {
		sourceInfo.label = options.label;
	}
	return sourceInfo;
}
