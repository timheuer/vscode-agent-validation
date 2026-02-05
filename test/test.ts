/**
 * Test runner for VS Code Agent Validator
 * Run with: pnpm test
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Test utilities (simplified version of validator logic for testing)
// ============================================================================

interface TestResult {
	name: string;
	passed: boolean;
	message?: string;
}

const extractFrontmatter = (
	content: string,
): { frontmatter: string | null; body: string } => {
	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
	const match = content.match(frontmatterRegex);
	if (!match) return { frontmatter: null, body: content };
	return { frontmatter: match[1], body: match[2] };
};

const parseAgentFile = (
	filePath: string,
): {
	success: boolean;
	data?: Record<string, unknown>;
	body?: string;
	error?: string;
} => {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const { frontmatter, body } = extractFrontmatter(content);

		if (frontmatter === null) {
			return { success: false, error: "No frontmatter" };
		}

		const data = load(frontmatter) as Record<string, unknown>;
		return { success: true, data, body };
	} catch (err) {
		return { success: false, error: String(err) };
	}
};

// ============================================================================
// Test definitions
// ============================================================================

const tests: Array<() => TestResult> = [];

// Test: Valid files should parse successfully
const validFixturesDir = path.join(__dirname, "fixtures", "valid");
if (fs.existsSync(validFixturesDir)) {
	const validFiles = fs
		.readdirSync(validFixturesDir)
		.filter((f) => f.endsWith(".agent.md"));

	for (const file of validFiles) {
		tests.push(() => {
			const filePath = path.join(validFixturesDir, file);
			const result = parseAgentFile(filePath);

			if (!result.success) {
				return {
					name: `Valid file "${file}" should parse`,
					passed: false,
					message: result.error,
				};
			}

			return {
				name: `Valid file "${file}" should parse`,
				passed: true,
			};
		});
	}
}

// Test: Planner agent should have all expected fields
tests.push(() => {
	const filePath = path.join(validFixturesDir, "planner.agent.md");
	const result = parseAgentFile(filePath);

	if (!result.success || !result.data) {
		return {
			name: "Planner agent should have expected fields",
			passed: false,
			message: "Failed to parse",
		};
	}

	const data = result.data;
	const checks = [
		typeof data.description === "string",
		typeof data.name === "string",
		Array.isArray(data.tools),
		Array.isArray(data.handoffs),
		typeof data["user-invokable"] === "boolean",
	];

	if (!checks.every(Boolean)) {
		return {
			name: "Planner agent should have expected fields",
			passed: false,
			message: "Missing or invalid fields",
		};
	}

	return {
		name: "Planner agent should have expected fields",
		passed: true,
	};
});

// Test: No frontmatter file should fail
tests.push(() => {
	const filePath = path.join(
		__dirname,
		"fixtures",
		"invalid",
		"no-frontmatter.agent.md",
	);
	const result = parseAgentFile(filePath);

	return {
		name: "No frontmatter file should fail parsing",
		passed: !result.success,
		message: result.success ? "Should have failed" : undefined,
	};
});

// Test: Invalid types should parse but have wrong types
tests.push(() => {
	const filePath = path.join(
		__dirname,
		"fixtures",
		"invalid",
		"invalid-types.agent.md",
	);
	const result = parseAgentFile(filePath);

	if (!result.success || !result.data) {
		return {
			name: "Invalid types file should parse YAML",
			passed: false,
			message: "Failed to parse YAML",
		};
	}

	// Description is 123 (number), should be caught by validator
	const hasInvalidDescription = typeof result.data.description === "number";

	return {
		name: "Invalid types file should have numeric description",
		passed: hasInvalidDescription,
	};
});

// Test: Invalid handoffs should parse but have incomplete handoffs
tests.push(() => {
	const filePath = path.join(
		__dirname,
		"fixtures",
		"invalid",
		"invalid-handoffs.agent.md",
	);
	const result = parseAgentFile(filePath);

	if (!result.success || !result.data) {
		return {
			name: "Invalid handoffs file should parse YAML",
			passed: false,
			message: "Failed to parse",
		};
	}

	const handoffs = result.data.handoffs as Array<Record<string, unknown>>;
	const firstMissingLabelAndAgent = !handoffs[0]?.label && !handoffs[0]?.agent;
	const secondMissingAgent = Boolean(handoffs[1]?.label) && !handoffs[1]?.agent;

	return {
		name: "Invalid handoffs should be missing required fields",
		passed: Boolean(firstMissingLabelAndAgent && secondMissingAgent),
	};
});

// Test: Model can be a string
tests.push(() => {
	const filePath = path.join(validFixturesDir, "planner.agent.md");
	const result = parseAgentFile(filePath);

	return {
		name: "Model can be a string",
		passed: result.success && typeof result.data?.model === "string",
	};
});

// Test: Model can be an array
tests.push(() => {
	const filePath = path.join(validFixturesDir, "multi-model.agent.md");
	const result = parseAgentFile(filePath);

	return {
		name: "Model can be an array",
		passed: result.success && Array.isArray(result.data?.model),
	};
});

// Test: Target can be github-copilot
tests.push(() => {
	const filePath = path.join(validFixturesDir, "copilot-target.agent.md");
	const result = parseAgentFile(filePath);

	return {
		name: "Target can be github-copilot",
		passed: result.success && result.data?.target === "github-copilot",
	};
});

// ============================================================================
// Test runner
// ============================================================================

const runTests = (): void => {
	console.log("Running VS Code Agent Validator Tests\n");
	console.log("=".repeat(50));

	let passed = 0;
	let failed = 0;

	for (const test of tests) {
		const result = test();

		if (result.passed) {
			console.log(`✓ ${result.name}`);
			passed++;
		} else {
			console.log(`✗ ${result.name}`);
			if (result.message) {
				console.log(`  → ${result.message}`);
			}
			failed++;
		}
	}

	console.log(`\n${"=".repeat(50)}`);
	console.log(`Results: ${passed} passed, ${failed} failed`);

	if (failed > 0) {
		process.exit(1);
	}
};

runTests();
