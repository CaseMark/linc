import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],
	server: {
		proxy: {
			"/api/casedev": {
				target: "https://api.case.dev",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api\/casedev/, ""),
			},
		},
	},
});
