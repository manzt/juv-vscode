// @ts-check
const fs = require("node:fs");
const childProcess = require("node:child_process");

const vscode = require("vscode");
const toml = require("toml");

const logChannel = vscode.window.createOutputChannel("juv");

/** @param {string} message */
function log(message) {
  logChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

module.exports = {
  /** @param {vscode.ExtensionContext} context */
  activate(context) {
    context.subscriptions.push(
      registerCommand("juv.add", async () => {
        const editor = vscode.window.activeNotebookEditor;
        assert(editor, "No active notebook.");
        const packagesInput = await vscode.window.showInputBox({
          title: "Add packages",
          placeHolder: "package(s)",
          prompt: "Enter package names separated by spaces",
        });
        const packages = (packagesInput ?? "").split(" ").filter(Boolean);
        if (packages.length === 0) {
          return;
        }
        await editor.notebook.save();
        await juv({ args: ["add", editor.notebook.uri.fsPath, ...packages] });
        await vscode.commands.executeCommand("juv.sync");
      }),
      registerCommand("juv.remove", async () => {
        const editor = vscode.window.activeNotebookEditor;
        assert(editor, "No active notebook.");
        const cell = editor.notebook
          .getCells()
          .find(tryParseInlineScriptMetadata);
        assert(cell, "No packages found.");
        const meta = tryParseInlineScriptMetadata(cell);
        assert(meta, "No packages found.");
        const packages = await vscode.window.showQuickPick(meta.dependencies, {
          title: "Remove packages",
          canPickMany: true,
        });
        if (!packages?.length) {
          // none selected
          return;
        }
        await editor.notebook.save();
        await juv({
          args: ["remove", editor.notebook.uri.fsPath, ...packages],
        });
        await vscode.commands.executeCommand("juv.sync");
      }),
      registerCommand("juv.sync", async () => {
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
            title: kind === "sync"
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
      }),
      registerCommand("juv.main", async () => {
        await vscode.window.activeNotebookEditor?.notebook.save();
        const result = await vscode.window.showQuickPick(
          [
            {
              label: "Sync Environment",
              detail:
                "Create or sync a virtual environment with notebook requirements",
              picked: true,
            },
            {
              label: "Add Packages",
              detail: "Add a new notebook requirement",
            },
            {
              label: "Remove Packages",
              detail: "Remove an existing notebook requirement",
            },
          ],
          {
            title: "juv",
          },
        );
        if (!result) {
          return;
        }
        if (result.label.includes("Add")) {
          await vscode.commands.executeCommand("juv.add");
          return;
        }
        if (result.label.includes("Remove")) {
          await vscode.commands.executeCommand("juv.remove");
          return;
        }
        await vscode.commands.executeCommand("juv.sync");
      }),
      vscode.workspace.onDidOpenNotebookDocument(async (notebook) => {
        if (
          vscode.workspace.getWorkspaceFolder(notebook.uri) &&
          notebook.getCells().some(tryParseInlineScriptMetadata)
        ) {
          const selection = await vscode.window.showInformationMessage(
            "Notebook includes PEP 723 metadata. Create or sync an isolated virtual environment?",
            "Yes",
            "No",
          );
          if (selection === "Yes") {
            await vscode.commands.executeCommand("juv.sync");
          }
        }
      }),
    );
  },
  deactivate() {},
};

class AssertionError extends Error {
  /** @override */
  name = "AssertionError";
}

class AbortError extends Error {
  /** @override */
  name = "AbortError";
}

class JuvError extends Error {
  /** @override */
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
        message = `Juv command failed: \`juv ${error.args.join(" ")}\`

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
 * @param {string} command
 */
function commandExists(command) {
  const result = childProcess.spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: true,
  });
  return result.status === 0;
}

/**
 * Determines the executable for `juv`, considering user configuration, absolute paths, and fallbacks.
 */
function getJuvExecutable() {
  const config = vscode.workspace.getConfiguration("juv");
  /** @type {string | undefined} */
  const userDefined = config.get("executable");

  if (userDefined) {
    const [executable, ...args] = userDefined.split(" ");
    assert(
      commandExists(executable),
      `Executable not found: ${JSON.stringify(executable)}.`,
    );
    return { executable, args };
  }

  // TODO: Check version?

  if (commandExists("juv")) {
    return { executable: "juv", args: [] };
  }

  if (commandExists("uvx")) {
    return { executable: "uvx", args: ["juv"] };
  }

  throw new AssertionError(
    "Could not find 'juv' or 'uv' executable. Please install one of them or specify a path for the `juv` executable in your VS Code settings.",
  );
}

/**
 * @param {{args: Array<string>; signal?: AbortSignal }} options
 * @returns {Promise<{ stdout: string; stderr: string }>}
 */
function juv(options) {
  const { executable, args } = getJuvExecutable();
  log(`${executable} ${JSON.stringify([...args, ...options.args])}`);

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new AbortError());
    }

    const process = childProcess.execFile(
      executable,
      [...args, ...options.args],
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

/**
 * @param {vscode.NotebookCell} cell
 * @returns {{ dependencies: Array<string> } | undefined}
 */
function tryParseInlineScriptMetadata(cell) {
  if (cell.kind !== vscode.NotebookCellKind.Code) {
    return undefined;
  }
  const contents = cell.document.getText();
  const match = contents.match(
    /^# \/\/\/ script$\s(?<content>(^#(| .*)$\s?)+)^# \/\/\/$/m,
  );
  if (!match?.groups) {
    return undefined;
  }
  const tomlString = match.groups.content
    .split("\n")
    .map((line) => (line.startsWith("# ") ? line.slice(2) : line.slice(1)))
    .join("\n");
  return toml.parse(tomlString);
}
