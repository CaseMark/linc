export interface OpenAITextPart {
	type: "text";
	text: string;
}

export interface OpenAIChatMessage {
	role: "system" | "user" | "assistant";
	content: string | OpenAITextPart[] | null;
}

export interface OpenAIChatCompletionRequest {
	model: string;
	messages: OpenAIChatMessage[];
	stream?: boolean;
}

export interface OpenAIModelObject {
	id: string;
	object: "model";
	created: number;
	owned_by: string;
}

export interface OpenAIModelList {
	object: "list";
	data: OpenAIModelObject[];
}

export interface OpenAIChatCompletionChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: "assistant";
			content?: string;
		};
		finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
	}>;
}

export interface OpenAIChatCompletion {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: "assistant";
			content: string;
		};
		finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
	}>;
}
