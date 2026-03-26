// Models are fetched dynamically from case.dev /llm/v1/models at runtime.
// This file provides an empty fallback.

import type { Model } from "./types.js";

export const MODELS: Record<string, Record<string, Model<any>>> = {};
