const vscode = require("vscode");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const inlineScriptMeta = `# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///`.trim();

module.exports = {
	/** @param {vscode.ExtensionContext} context */
	async activate(context) {
		context.subscriptions.push(
			registerCommand("juv.init", async () => {
				await vscode.commands.executeCommand("ipynb.newUntitledIpynb");
				const editor = vscode.window.activeNotebookEditor;
				assert(editor, "Failed to create a new notebook.");
				const edit = new vscode.WorkspaceEdit();
				edit.set(editor.notebook.uri, [
					vscode.NotebookEdit.insertCells(0, [
						new vscode.NotebookCellData(
							vscode.NotebookCellKind.Code,
							inlineScriptMeta,
							"python",
						),
					]),
				]);
				await vscode.workspace.applyEdit(edit);
			}),
			vscode.commands.registerCommand("juv.add", async () => {
				const editor = vscode.window.activeNotebookEditor;
				assert(editor, "No active notebook.");
				const packagesInput = await vscode.window.showInputBox({
					title: "packages",
					placeHolder: "polars anywidget",
				});
				const packages = (packagesInput ?? "").split(" ").filter(Boolean);
				if (packages.length === 0) {
					return;
				}
				await editor.notebook.save();
				await juv({ args: ["add", editor.notebook.uri.fsPath, ...packages] });
				await vscode.commands.executeCommand("juv.sync");
			}),
			vscode.commands.registerCommand("juv.remove", async () => {
				const editor = vscode.window.activeNotebookEditor;
				assert(editor, "No active notebook.");
				const packagesInput = await vscode.window.showInputBox({
					title: "packages",
				});
				const packages = (packagesInput ?? "").split(" ").filter(Boolean);
				if (packages.length === 0) {
					return;
				}
				await editor.notebook.save();
				await juv({
					args: ["remove", editor.notebook.uri.fsPath, ...packages],
				});
				await vscode.commands.executeCommand("juv.sync");
			}),
			vscode.commands.registerCommand("juv.sync", async () => {
				const editor = vscode.window.activeNotebookEditor;
				assert(editor, "No active notebook.");
				const workspaceFolder = vscode.workspace.getWorkspaceFolder(
					editor.notebook.uri,
				);
				assert(workspaceFolder, "Can only create venv within a workspace.");
				const venv = vscode.Uri.joinPath(workspaceFolder.uri, ".venv");
				const kind = /** @type {const} */ fs.existsSync(venv.fsPath)
					? "sync"
					: "create";
				await editor.notebook.save();
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title:
							kind === "sync"
								? `Syncing virtual enviroment at: ${venv.fsPath}`
								: `Creating virtual enviroment at: ${venv.fsPath}`,
						cancellable: true,
					},
					async (_progress, token) => {
						const controller = new AbortController();
						token.onCancellationRequested(() => controller.abort());
						await juv({
							args: [
								"venv",
								"--from",
								editor.notebook.uri.fsPath,
								vscode.Uri.joinPath(workspaceFolder.uri, ".venv").fsPath,
							],
							signal: controller.signal,
						});
					},
				);
				// TODO: figure out how to auto select/activate the `enviroment`.
				// let conn = await getPythonKernelConnectionMetadata(venv, pythonApi);
				// await vscode.commands.executeCommand("notebook.selectKernel", {
				//   id: conn.interpreter.id,
				//   extension: 'juv',
				//   // extension: 'ms-toolsai.jupyter',
				// });
			}),
			vscode.commands.registerCommand("juv.run", async () => {
				const editor = vscode.window.activeNotebookEditor;
				assert(editor, "No active notebook.");
				await vscode.commands.executeCommand("juv.sync");
				await vscode.commands.executeCommand(
					"notebook.cell.execute",
					editor.notebook.getCells(),
				);
			}),
		);
	},
	deactivate() {},
};

class AssertionError extends Error {
	name = "AssertionError";
}

class AbortError extends Error {
	name = "AbortError";
}

class JuvError extends Error {
	name = "JuvError";
	/**
	 * @param {string} msg
	 * @param {Array<string>} args
	 */
	constructor(msg, args) {
		super(msg);
		this.args = args;
	}
}

/**
 * Make an assertion.
 *
 * Usage
 * @example
 * ```ts
 * const value: boolean = Math.random() <= 0.5;
 * assert(value, "value is greater than than 0.5!");
 * value // true
 * ```
 *
 * @param {unknown} expression - The expression to test.
 * @param {string=} msg - The optional message to display if the assertion fails.
 * @returns {asserts expression}
 * @throws an {@link Error} if `expression` is not truthy.
 *
 * @copyright Trevor Manz 2025
 * @license MIT
 * @see {@link https://github.com/manzt/manzt/blob/0e6658/utils/assert.js}
 */
function assert(expression, msg = "") {
	if (!expression) {
		throw new AssertionError(msg);
	}
}

/**
 * @param {Parameters<typeof vscode.commands.registerCommand>} args
 */
function registerCommand(...args) {
	const [command, callback] = args;
	return vscode.commands.registerCommand(command, async () => {
		try {
			await callback();
		} catch (error) {
			/** @type {string} */
			let message;
			if (error instanceof JuvError) {
				message = `Juv command failed: \`juv ${args.join(" ")}\`

Error: ${JSON.stringify(error.message)}`;
			} else if (error instanceof AssertionError) {
				message = error.message;
			} else {
				message = `Unknown error.

${JSON.stringify(error)}
`;
			}
			vscode.window.showWarningMessage(message);
		}
	});
}

/**
 * @param {{args: Array<string>; signal?: AbortSignal }} options
 * @returns {Promise<{ stdout: string; stderr: string }>}
 */
function juv(options) {
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(new AbortError());
		}

		const process = childProcess.execFile(
			"juv",
			options.args,
			(error, stdout, stderr) => {
				if (error) {
					reject(new JuvError(error.message, options.args));
					return;
				}
				resolve({ stdout, stderr });
			},
		);

		options.signal?.addEventListener("abort", () => {
			process.kill();
			reject(new AbortError());
		});
	});
}
