/**
 * VS Code Custom Agent (.agent.md) Validator
 * Spec: https://code.visualstudio.com/docs/copilot/customization/custom-agents
 */

import fs from "node:fs";
import path from "node:path";
import {
    error,
    getInput,
    info,
    setFailed,
    setOutput,
    warning,
} from "@actions/core";
import { load } from "js-yaml";
import rules from "./rules.json" with { type: "json" };
import {
    type ActionInputs,
    type AgentFrontmatter,
    type FileValidationResult,
    type Handoff,
    KNOWN_FIELDS,
    type ParseResult,
    type PathResolutionResult,
    type RuleId,
    type RuleSeverity,
    VALID_TARGETS,
    type ValidateOptions,
    type ValidationIssue,
} from "./types.js";

const DESCRIPTION_MIN_QUALITY = 50;
const BODY_MAX_LINES = 1000;
const MAX_FILE_SIZE_KB = 512;

const getErrorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    return String(err);
};

const createIssue = (
    ruleId: RuleId,
    detail: string | null,
    file?: string,
    line?: number,
): ValidationIssue => {
    const rule = rules[ruleId as keyof typeof rules];
    let message = rule.message;

    if (detail) {
        message = message
            .replace("{detail}", detail)
            .replace("{length}", detail)
            .replace("{lines}", detail)
            .replace("{value}", detail)
            .replace("{field}", detail)
            .replace("{path}", detail)
            .replace("{index}", detail)
            .replace("{knownFields}", [...KNOWN_FIELDS].join(", "));
    }

    return {
        ruleId,
        message,
        severity: rule.severity as RuleSeverity,
        file,
        line,
    };
};

const addIssue = (
    ruleId: RuleId,
    detail: string | null,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file?: string,
    line?: number,
): void => {
    if (ignoreRules.includes(ruleId)) {
        return;
    }

    const issue = createIssue(ruleId, detail, file, line);

    if (issue.severity === "error") {
        errors.push(issue);
    } else {
        warnings.push(issue);
    }
};

const resolveAgentPaths = (inputPath: string): PathResolutionResult => {
    const resolvedPath = path.resolve(inputPath);

    if (!fs.existsSync(resolvedPath)) {
        return {
            success: false,
            error: {
                message: `Path not found: ${inputPath}`,
                ruleId: null,
            },
        };
    }

    const stats = fs.statSync(resolvedPath);

    if (stats.isFile()) {
        if (!resolvedPath.endsWith(".agent.md")) {
            return {
                success: false,
                error: {
                    message: `File must have .agent.md extension: ${inputPath}`,
                    ruleId: "file-extension",
                },
            };
        }
        return { success: true, files: [resolvedPath] };
    }

    if (stats.isDirectory()) {
        const files: string[] = [];

        const agentsDir = path.join(resolvedPath, ".github", "agents");
        if (fs.existsSync(agentsDir)) {
            const agentFiles = fs
                .readdirSync(agentsDir)
                .filter((f) => f.endsWith(".agent.md"))
                .map((f) => path.join(agentsDir, f));
            files.push(...agentFiles);
        }

        const rootFiles = fs
            .readdirSync(resolvedPath)
            .filter((f) => f.endsWith(".agent.md"))
            .map((f) => path.join(resolvedPath, f));
        files.push(...rootFiles);

        const legacyChatmodesDir = path.join(resolvedPath, ".github", "chatmodes");
        if (fs.existsSync(legacyChatmodesDir)) {
            const chatmodeFiles = fs
                .readdirSync(legacyChatmodesDir)
                .filter((f) => f.endsWith(".chatmode.md"))
                .map((f) => path.join(legacyChatmodesDir, f));
            files.push(...chatmodeFiles);
        }

        if (files.length === 0) {
            return {
                success: false,
                error: {
                    message: `No .agent.md files found in: ${inputPath}`,
                    ruleId: null,
                },
            };
        }

        return { success: true, files: [...new Set(files)] };
    }

    return {
        success: false,
        error: {
            message: `Invalid path type: ${inputPath}`,
            ruleId: null,
        },
    };
};

const extractFrontmatter = (
    content: string,
): { frontmatter: string | null; body: string } => {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
        return { frontmatter: null, body: content };
    }

    return {
        frontmatter: match[1],
        body: match[2],
    };
};

const isAgentFrontmatter = (data: unknown): data is AgentFrontmatter => {
    return typeof data === "object" && data !== null;
};

const parseAgentFile = (filePath: string): ParseResult => {
    let content: string;

    try {
        const stats = fs.statSync(filePath);
        if (stats.size > MAX_FILE_SIZE_KB * 1024) {
            return {
                success: false,
                error: {
                    message: `File too large (${Math.round(stats.size / 1024)}KB). Maximum: ${MAX_FILE_SIZE_KB}KB`,
                    ruleId: null,
                },
            };
        }
        content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
        return {
            success: false,
            error: {
                message: `Failed to read file: ${getErrorMessage(err)}`,
                ruleId: null,
            },
        };
    }

    const { frontmatter, body } = extractFrontmatter(content);

    if (frontmatter === null) {
        return {
            success: false,
            error: {
                message:
                    "Agent file must contain YAML frontmatter (content between --- markers)",
                ruleId: "frontmatter-required",
            },
        };
    }

    try {
        const parsed: unknown = load(frontmatter);

        if (!isAgentFrontmatter(parsed)) {
            return {
                success: false,
                error: {
                    message: "Frontmatter must be a valid YAML object",
                    ruleId: "frontmatter-valid",
                },
            };
        }

        return { success: true, data: parsed, body };
    } catch (err) {
        return {
            success: false,
            error: {
                message: `Invalid YAML frontmatter: ${getErrorMessage(err)}`,
                ruleId: "frontmatter-valid",
            },
        };
    }
};

const validateDescription = (
    description: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (description === undefined || description === null) {
        addIssue("description-format", null, errors, warnings, ignoreRules, file);
        return;
    }

    if (typeof description !== "string") {
        addIssue(
            "description-format",
            "must be a string",
            errors,
            warnings,
            ignoreRules,
            file,
        );
        return;
    }

    if (description.trim().length === 0) {
        addIssue("description-format", null, errors, warnings, ignoreRules, file);
        return;
    }

    if (description.length < DESCRIPTION_MIN_QUALITY) {
        addIssue(
            "description-quality",
            String(description.length),
            errors,
            warnings,
            ignoreRules,
            file,
        );
    }
};

const validateName = (
    name: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (name === undefined || name === null) {
        return;
    }

    if (typeof name !== "string") {
        addIssue("name-format", null, errors, warnings, ignoreRules, file);
    }
};

const validateArgumentHint = (
    hint: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (hint === undefined || hint === null) {
        return;
    }

    if (typeof hint !== "string") {
        addIssue("argument-hint-format", null, errors, warnings, ignoreRules, file);
    }
};

const validateTools = (
    tools: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (tools === undefined || tools === null) {
        return;
    }

    if (!Array.isArray(tools)) {
        addIssue(
            "tools-format",
            "Expected an array",
            errors,
            warnings,
            ignoreRules,
            file,
        );
        return;
    }

    for (let i = 0; i < tools.length; i++) {
        if (typeof tools[i] !== "string") {
            addIssue(
                "tools-format",
                `Item at index ${i} is not a string`,
                errors,
                warnings,
                ignoreRules,
                file,
            );
        }
    }
};

const validateAgents = (
    agents: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (agents === undefined || agents === null) {
        return;
    }

    if (agents === "*") {
        return;
    }

    if (!Array.isArray(agents)) {
        addIssue(
            "agents-format",
            "Expected an array or '*'",
            errors,
            warnings,
            ignoreRules,
            file,
        );
        return;
    }

    for (let i = 0; i < agents.length; i++) {
        if (typeof agents[i] !== "string") {
            addIssue(
                "agents-format",
                `Item at index ${i} is not a string`,
                errors,
                warnings,
                ignoreRules,
                file,
            );
        }
    }
};

const validateModel = (
    model: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (model === undefined || model === null) {
        return;
    }

    if (typeof model === "string") {
        return;
    }

    if (Array.isArray(model)) {
        for (let i = 0; i < model.length; i++) {
            if (typeof model[i] !== "string") {
                addIssue(
                    "model-format",
                    `Item at index ${i} is not a string`,
                    errors,
                    warnings,
                    ignoreRules,
                    file,
                );
            }
        }
        return;
    }

    addIssue(
        "model-format",
        "Expected a string or array of strings",
        errors,
        warnings,
        ignoreRules,
        file,
    );
};

const validateBooleanField = (
    value: unknown,
    ruleId: RuleId,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (value === undefined || value === null) {
        return;
    }

    if (typeof value !== "boolean") {
        addIssue(ruleId, null, errors, warnings, ignoreRules, file);
    }
};

const validateTarget = (
    target: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (target === undefined || target === null) {
        return;
    }

    if (typeof target !== "string" || !VALID_TARGETS.has(target)) {
        addIssue(
            "target-valid",
            String(target),
            errors,
            warnings,
            ignoreRules,
            file,
        );
    }
};

const validateMcpServers = (
    mcpServers: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (mcpServers === undefined || mcpServers === null) {
        return;
    }

    if (!Array.isArray(mcpServers)) {
        addIssue("mcp-servers-format", null, errors, warnings, ignoreRules, file);
    }
};

const validateHandoff = (
    handoff: unknown,
    index: number,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (typeof handoff !== "object" || handoff === null) {
        addIssue(
            "handoffs-format",
            `Item at index ${index} is not an object`,
            errors,
            warnings,
            ignoreRules,
            file,
        );
        return;
    }

    const h = handoff as Handoff;

    if (!h.label || typeof h.label !== "string") {
        addIssue(
            "handoff-label-required",
            String(index),
            errors,
            warnings,
            ignoreRules,
            file,
        );
    }

    if (!h.agent || typeof h.agent !== "string") {
        addIssue(
            "handoff-agent-required",
            String(index),
            errors,
            warnings,
            ignoreRules,
            file,
        );
    }

    if (h.send !== undefined && typeof h.send !== "boolean") {
        addIssue(
            "handoff-send-format",
            String(index),
            errors,
            warnings,
            ignoreRules,
            file,
        );
    }

    if (h.model !== undefined && typeof h.model !== "string") {
        addIssue(
            "handoff-model-format",
            String(index),
            errors,
            warnings,
            ignoreRules,
            file,
        );
    }
};

const validateHandoffs = (
    handoffs: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (handoffs === undefined || handoffs === null) {
        return;
    }

    if (!Array.isArray(handoffs)) {
        addIssue("handoffs-format", null, errors, warnings, ignoreRules, file);
        return;
    }

    for (let i = 0; i < handoffs.length; i++) {
        validateHandoff(handoffs[i], i, errors, warnings, ignoreRules, file);
    }
};

const validateInfer = (
    infer: unknown,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (infer !== undefined) {
        addIssue("infer-deprecated", null, errors, warnings, ignoreRules, file);
    }
};

const validateUnknownFields = (
    data: AgentFrontmatter,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    for (const key of Object.keys(data)) {
        if (!KNOWN_FIELDS.has(key)) {
            addIssue("unknown-field", key, errors, warnings, ignoreRules, file);
        }
    }
};

const validateBody = (
    body: string,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    if (!body || body.trim().length === 0) {
        addIssue("body-empty", null, errors, warnings, ignoreRules, file);
        return;
    }

    const lines = body.split("\n").length;
    if (lines > BODY_MAX_LINES) {
        addIssue(
            "body-too-long",
            String(lines),
            errors,
            warnings,
            ignoreRules,
            file,
        );
    }
};

const validateFileReferences = (
    body: string,
    agentDir: string,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    ignoreRules: string[],
    file: string,
): void => {
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null = linkRegex.exec(body);

    while (match !== null) {
        const linkPath = match[2];

        if (
            linkPath.startsWith("http://") ||
            linkPath.startsWith("https://") ||
            linkPath.startsWith("#")
        ) {
            match = linkRegex.exec(body);
            continue;
        }

        const resolvedPath = path.resolve(agentDir, linkPath);

        if (!fs.existsSync(resolvedPath)) {
            addIssue(
                "reference-not-found",
                linkPath,
                errors,
                warnings,
                ignoreRules,
                file,
            );
        }
        match = linkRegex.exec(body);
    }
};

const validateAgentFile = (
    filePath: string,
    options: ValidateOptions,
): FileValidationResult => {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const { ignoreRules, validateReferences: checkRefs } = options;

    const isLegacyChatmode = filePath.endsWith(".chatmode.md");
    if (isLegacyChatmode) {
        info(`Note: ${path.basename(filePath)} uses legacy .chatmode.md extension`);
    }

    const parseResult = parseAgentFile(filePath);

    if (!parseResult.success) {
        const issue = createIssue(
            parseResult.error.ruleId || "frontmatter-required",
            parseResult.error.message,
            filePath,
        );
        errors.push(issue);
        return {
            file: filePath,
            valid: false,
            errors,
            warnings,
        };
    }

    const { data, body } = parseResult;

    validateDescription(
        data.description,
        errors,
        warnings,
        ignoreRules,
        filePath,
    );
    validateName(data.name, errors, warnings, ignoreRules, filePath);
    validateArgumentHint(
        data["argument-hint"],
        errors,
        warnings,
        ignoreRules,
        filePath,
    );
    validateTools(data.tools, errors, warnings, ignoreRules, filePath);
    validateAgents(data.agents, errors, warnings, ignoreRules, filePath);
    validateModel(data.model, errors, warnings, ignoreRules, filePath);
    validateBooleanField(
        data["user-invokable"],
        "user-invokable-format",
        errors,
        warnings,
        ignoreRules,
        filePath,
    );
    validateBooleanField(
        data["disable-model-invocation"],
        "disable-model-invocation-format",
        errors,
        warnings,
        ignoreRules,
        filePath,
    );
    validateTarget(data.target, errors, warnings, ignoreRules, filePath);
    validateMcpServers(
        data["mcp-servers"],
        errors,
        warnings,
        ignoreRules,
        filePath,
    );
    validateHandoffs(data.handoffs, errors, warnings, ignoreRules, filePath);
    validateInfer(data.infer, errors, warnings, ignoreRules, filePath);
    validateUnknownFields(data, errors, warnings, ignoreRules, filePath);
    validateBody(body, errors, warnings, ignoreRules, filePath);

    if (checkRefs) {
        const agentDir = path.dirname(filePath);
        validateFileReferences(
            body,
            agentDir,
            errors,
            warnings,
            ignoreRules,
            filePath,
        );
    }

    return {
        file: filePath,
        valid: errors.length === 0,
        errors,
        warnings,
    };
};

const getInputs = (): ActionInputs => {
    return {
        path: getInput("path") || ".",
        failOnWarning: getInput("fail-on-warning") === "true",
        ignoreRules: getInput("ignore-rules")
            .split(",")
            .map((r) => r.trim())
            .filter((r) => r.length > 0),
        validateReferences: getInput("validate-references") === "true",
    };
};

const run = async (): Promise<void> => {
    try {
        const inputs = getInputs();

        info(`Validating agent files in: ${inputs.path}`);
        if (inputs.ignoreRules.length > 0) {
            info(`Ignoring rules: ${inputs.ignoreRules.join(", ")}`);
        }
        if (inputs.validateReferences) {
            info("Reference validation enabled");
        }

        const pathResult = resolveAgentPaths(inputs.path);

        if (!pathResult.success) {
            setFailed(pathResult.error.message);
            setOutput("valid", "false");
            setOutput(
                "errors",
                JSON.stringify([{ message: pathResult.error.message }]),
            );
            setOutput("warnings", JSON.stringify([]));
            setOutput("files-validated", "0");
            return;
        }

        info(`Found ${pathResult.files.length} agent file(s) to validate`);

        const fileResults: FileValidationResult[] = [];
        const allErrors: ValidationIssue[] = [];
        const allWarnings: ValidationIssue[] = [];

        for (const filePath of pathResult.files) {
            info(`Validating: ${path.basename(filePath)}`);

            const result = validateAgentFile(filePath, {
                ignoreRules: inputs.ignoreRules,
                validateReferences: inputs.validateReferences,
                filePath,
            });

            fileResults.push(result);
            allErrors.push(...result.errors);
            allWarnings.push(...result.warnings);
        }

        for (const result of fileResults) {
            const fileName = path.basename(result.file);

            if (result.errors.length > 0) {
                for (const err of result.errors) {
                    error(`[${fileName}] ${err.message}`, {
                        title: err.ruleId,
                    });
                }
            }

            if (result.warnings.length > 0) {
                for (const warn of result.warnings) {
                    warning(`[${fileName}] ${warn.message}`, {
                        title: warn.ruleId,
                    });
                }
            }

            if (result.valid && result.warnings.length === 0) {
                info(`✓ ${fileName} is valid`);
            } else if (result.valid) {
                info(`✓ ${fileName} is valid (with warnings)`);
            }
        }

        const hasErrors = allErrors.length > 0;
        const hasWarnings = allWarnings.length > 0;
        const isValid = !hasErrors && (!inputs.failOnWarning || !hasWarnings);

        setOutput("valid", String(isValid));
        setOutput("errors", JSON.stringify(allErrors));
        setOutput("warnings", JSON.stringify(allWarnings));
        setOutput("files-validated", String(fileResults.length));

        info("---");
        info(`Files validated: ${fileResults.length}`);
        info(`Errors: ${allErrors.length}`);
        info(`Warnings: ${allWarnings.length}`);

        if (!isValid) {
            if (hasErrors) {
                setFailed(`Validation failed with ${allErrors.length} error(s)`);
            } else if (inputs.failOnWarning && hasWarnings) {
                setFailed(
                    `Validation failed with ${allWarnings.length} warning(s) (fail-on-warning enabled)`,
                );
            }
        } else {
            info("✓ All agent files are valid");
        }
    } catch (err) {
        setFailed(`Unexpected error: ${getErrorMessage(err)}`);
    }
};

run();
