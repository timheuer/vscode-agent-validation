// VS Code Custom Agent (.agent.md) validation types
// Spec: https://code.visualstudio.com/docs/copilot/customization/custom-agents

export interface Handoff {
	label?: string;
	agent?: string;
	prompt?: string;
	send?: boolean;
	model?: string;
}

export interface McpServer {
	[key: string]: unknown;
}

export interface AgentFrontmatter {
	/** Brief description shown as placeholder text in chat input */
	description?: string;
	/** Name of the custom agent (defaults to filename if not specified) */
	name?: string;
	/** Hint text shown in chat input field */
	"argument-hint"?: string;
	/** List of tool or tool set names available to this agent */
	tools?: string[];
	/** List of agent names available as subagents (use * for all, [] for none) */
	agents?: string[] | "*";
	/** AI model to use (single string or prioritized array) */
	model?: string | string[];
	/** Whether agent appears in agents dropdown (default: true) */
	"user-invokable"?: boolean;
	/** Prevent agent from being invoked as subagent (default: false) */
	"disable-model-invocation"?: boolean;
	/** Deprecated - use user-invokable and disable-model-invocation instead */
	infer?: boolean;
	/** Target environment: vscode or github-copilot */
	target?: "vscode" | "github-copilot";
	/** MCP server configurations for github-copilot target */
	"mcp-servers"?: McpServer[];
	/** Handoff configurations for workflow transitions */
	handoffs?: Handoff[];
	/** Any additional unknown fields */
	[key: string]: unknown;
}

export type RuleSeverity = "error" | "warning";

export type RuleId =
	| "frontmatter-required"
	| "frontmatter-valid"
	| "file-extension"
	| "description-format"
	| "description-quality"
	| "name-format"
	| "argument-hint-format"
	| "tools-format"
	| "agents-format"
	| "model-format"
	| "user-invokable-format"
	| "disable-model-invocation-format"
	| "infer-deprecated"
	| "target-valid"
	| "mcp-servers-format"
	| "handoffs-format"
	| "handoff-label-required"
	| "handoff-agent-required"
	| "handoff-send-format"
	| "handoff-model-format"
	| "unknown-field"
	| "body-empty"
	| "body-too-long"
	| "reference-not-found";

export interface RuleDefinition {
	id: RuleId;
	severity: RuleSeverity;
	message: string;
}

export interface ValidationIssue {
	ruleId: RuleId;
	message: string;
	severity: RuleSeverity;
	file?: string;
	line?: number;
}

export interface FileValidationResult {
	file: string;
	valid: boolean;
	errors: ValidationIssue[];
	warnings: ValidationIssue[];
}

export interface ValidationResult {
	valid: boolean;
	filesValidated: number;
	errors: ValidationIssue[];
	warnings: ValidationIssue[];
	fileResults: FileValidationResult[];
}

export interface ParseError {
	message: string;
	ruleId: RuleId | null;
}

export interface ParseSuccess {
	success: true;
	data: AgentFrontmatter;
	body: string;
}

export interface ParseFailure {
	success: false;
	error: ParseError;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface PathResolutionSuccess {
	success: true;
	files: string[];
}

export interface PathResolutionFailure {
	success: false;
	error: {
		message: string;
		ruleId: RuleId | null;
	};
}

export type PathResolutionResult =
	| PathResolutionSuccess
	| PathResolutionFailure;

export interface ActionInputs {
	path: string;
	failOnWarning: boolean;
	ignoreRules: string[];
	validateReferences: boolean;
}

export interface ValidateOptions {
	ignoreRules: string[];
	validateReferences: boolean;
	filePath: string;
}

export const KNOWN_FIELDS = new Set<string>([
	"description",
	"name",
	"argument-hint",
	"tools",
	"agents",
	"model",
	"user-invokable",
	"disable-model-invocation",
	"infer",
	"target",
	"mcp-servers",
	"handoffs",
]);

export const VALID_TARGETS = new Set<string>(["vscode", "github-copilot"]);
