import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
	js.configs.recommended,
	{
		files: ["**/*.{js,ts}"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: "./tsconfig.json",
			},
			globals: {
				...globals.browser,
			},
		},
		plugins: {
			"@typescript-eslint": ts,
		},
		rules: {
			...ts.configs.recommended.rules,
		},
	},
	...svelte.configs["flat/recommended"],
	{
		files: ["**/*.svelte"],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tsParser,
			},
			globals: {
				...globals.browser,
			},
		},
	},
	{
		// Svelte 5 rune modules (reactive $state/$derived shared outside a
		// component). svelte-eslint-parser handles them, but needs the TS parser
		// wired in as its sub-parser to read type annotations.
		files: ["**/*.svelte.{js,ts}"],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tsParser,
				project: "./tsconfig.json",
			},
			globals: {
				...globals.browser,
			},
		},
	},
	prettier,
	{
		ignores: [
			"node_modules/",
			".svelte-kit/",
			"build/",
			"dist/",
			"src/lib/types/",
		],
	},
];
