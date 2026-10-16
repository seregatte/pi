import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import {
	createEventBus,
	createExtensionRuntime,
	createSyntheticSourceInfo,
	expandPromptTemplate,
	listResourceCommands,
	ProjectTrustStore,
	type PromptTemplate,
	resolveExtensionCommands,
	resolveProjectTrusted,
	resolveResourceCommand,
	type Skill,
} from "../src/index.ts";

describe("public command APIs", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	function makeTempDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-public-command-api-"));
		tempDirs.push(dir);
		return dir;
	}

	it("resolves extension invocation names without session or model services", async () => {
		const cwd = makeTempDir();
		const runtime = createExtensionRuntime();
		let handlerCalls = 0;
		const first = await loadExtensionFromFactory(
			(pi) => {
				pi.registerCommand("shared", {
					description: "first",
					handler: async () => {
						handlerCalls++;
					},
				});
			},
			cwd,
			createEventBus(),
			runtime,
			"<inline:first>",
		);
		const second = await loadExtensionFromFactory(
			(pi) => {
				pi.registerCommand("shared", {
					description: "second",
					handler: async () => {
						handlerCalls++;
					},
				});
			},
			cwd,
			createEventBus(),
			runtime,
			"<inline:second>",
		);

		const commands = resolveExtensionCommands([first, second]);
		expect(commands.map((command) => command.invocationName)).toEqual(["shared:1", "shared:2"]);
		expect(commands.map((command) => command.description)).toEqual(["first", "second"]);
		expect(handlerCalls).toBe(0);
	});

	it("lists resource commands in catalog order and resolves native precedence", async () => {
		const cwd = makeTempDir();
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(
			(pi) => {
				pi.registerCommand("review", {
					description: "extension review",
					handler: async () => {},
				});
			},
			cwd,
			createEventBus(),
			runtime,
			"<inline:review>",
		);
		const sourceInfo = createSyntheticSourceInfo(cwd, { source: "local", baseDir: cwd });
		const prompts: PromptTemplate[] = [
			{
				name: "review",
				description: "prompt review",
				content: "prompt review $1",
				sourceInfo,
				filePath: path.join(cwd, "review.md"),
			},
			{
				name: "skill:deploy",
				description: "prompt that collides with an explicit skill invocation",
				content: "prompt deploy",
				sourceInfo,
				filePath: path.join(cwd, "skill:deploy.md"),
			},
		];
		const skills: Skill[] = [
			{
				name: "deploy",
				description: "deploy skill",
				filePath: path.join(cwd, "SKILL.md"),
				baseDir: cwd,
				sourceInfo,
				disableModelInvocation: false,
			},
		];
		const resources = { extensions: [extension], prompts, skills };

		expect(listResourceCommands(resources).map((command) => `${command.source}:${command.name}`)).toEqual([
			"extension:review",
			"prompt:review",
			"prompt:skill:deploy",
			"skill:skill:deploy",
		]);
		expect(resolveResourceCommand(resources, "review")?.source).toBe("extension");
		expect(resolveResourceCommand(resources, "skill:deploy")?.source).toBe("skill");
		expect(resolveResourceCommand(resources, "missing")).toBeUndefined();
	});

	it("exports native prompt expansion and project trust resolution from the package root", async () => {
		const cwd = makeTempDir();
		const agentDir = path.join(cwd, "agent");
		fs.mkdirSync(agentDir);
		const sourceInfo = createSyntheticSourceInfo(cwd, { source: "local", baseDir: cwd });
		const template: PromptTemplate = {
			name: "review",
			description: "review",
			content: `first=$1 all=$@ default=\${2:-fallback}`,
			sourceInfo,
			filePath: path.join(cwd, "review.md"),
		};

		expect(expandPromptTemplate('/review "hello world"', [template])).toBe(
			"first=hello world all=hello world default=fallback",
		);

		await expect(
			resolveProjectTrusted({
				cwd,
				trustStore: new ProjectTrustStore(agentDir),
				projectTrustContext: {
					cwd,
					mode: "print",
					hasUI: false,
					ui: {
						select: async () => undefined,
						confirm: async () => false,
						input: async () => undefined,
						notify: () => {},
					},
				},
			}),
		).resolves.toBe(true);
	});
});
