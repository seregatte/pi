import type { Extension, RegisteredCommand, ResolvedCommand } from "./extensions/types.ts";
import type { PromptTemplate } from "./prompt-templates.ts";
import type { Skill } from "./skills.ts";

export interface CommandResources {
	extensions: readonly Extension[];
	prompts: readonly PromptTemplate[];
	skills: readonly Skill[];
}

export type ResourceCommand =
	| { source: "extension"; name: string; command: ResolvedCommand }
	| { source: "prompt"; name: string; prompt: PromptTemplate }
	| { source: "skill"; name: string; skill: Skill };

/** Resolve extension command invocation names using Pi's native collision rules. */
export function resolveExtensionCommands(extensions: readonly Extension[]): ResolvedCommand[] {
	const commands: RegisteredCommand[] = [];
	const counts = new Map<string, number>();

	for (const ext of extensions) {
		for (const command of ext.commands.values()) {
			commands.push(command);
			counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
		}
	}

	const seen = new Map<string, number>();
	const takenInvocationNames = new Set<string>();

	return commands.map((command) => {
		const occurrence = (seen.get(command.name) ?? 0) + 1;
		seen.set(command.name, occurrence);

		let invocationName = (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;

		if (takenInvocationNames.has(invocationName)) {
			let suffix = occurrence;
			do {
				suffix++;
				invocationName = `${command.name}:${suffix}`;
			} while (takenInvocationNames.has(invocationName));
		}

		takenInvocationNames.add(invocationName);
		return { ...command, invocationName };
	});
}

/**
 * List resource-backed commands in Pi's catalog order: extensions, prompts, then skills.
 * This does not include built-in TUI commands.
 */
export function listResourceCommands(resources: CommandResources): ResourceCommand[] {
	const extensionCommands: ResourceCommand[] = resolveExtensionCommands(resources.extensions).map((command) => ({
		source: "extension",
		name: command.invocationName,
		command,
	}));
	const prompts: ResourceCommand[] = resources.prompts.map((prompt) => ({
		source: "prompt",
		name: prompt.name,
		prompt,
	}));
	const skills: ResourceCommand[] = resources.skills.map((skill) => ({
		source: "skill",
		name: `skill:${skill.name}`,
		skill,
	}));
	return [...extensionCommands, ...prompts, ...skills];
}

/**
 * Resolve the command Pi would handle before prompt expansion.
 * Precedence matches AgentSession: extension command, explicit skill command, prompt template.
 */
export function resolveResourceCommand(resources: CommandResources, name: string): ResourceCommand | undefined {
	const extensionCommand = resolveExtensionCommands(resources.extensions).find(
		(command) => command.invocationName === name,
	);
	if (extensionCommand) {
		return { source: "extension", name: extensionCommand.invocationName, command: extensionCommand };
	}

	if (name.startsWith("skill:")) {
		const skillName = name.slice("skill:".length);
		const skill = resources.skills.find((candidate) => candidate.name === skillName);
		if (skill) {
			return { source: "skill", name, skill };
		}
	}

	const prompt = resources.prompts.find((candidate) => candidate.name === name);
	return prompt ? { source: "prompt", name, prompt } : undefined;
}
