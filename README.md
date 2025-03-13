# juv

Official VS Code extension for [juv](https://github.com/manzt/juv). Create,
manage, and run Jupyter notebooks with their dependencies.

![](https://github.com/user-attachments/assets/c3b068f1-ec7a-4fb8-8542-eeb264d2935a)

## Features

- 🗂️ Create, manage, and run reproducible notebooks
- 📌 Pin dependencies with
  [PEP 723 - inline script metadata](https://peps.python.org/pep-0723)
- ⚡ Powered by [uv](https://docs.astral.sh/uv/) for fast dependency management

## Requirements

- VS Code
  [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)
- Either the [`uv`](https://github.com/astral-sh/uv) (recommended) or
  [`juv`](https://github.com/manzt/juv) CLI

By default, the extension prioritizes invoking `juv` CLI through the
[`uv tool` interface](https://docs.astral.sh/uv/concepts/tools/#the-uv-tool-interface)
(i.e., `uvx juv`). If `uv` is not available, it falls back to calling `juv`
directly (if installed globally).

To override this behavior, you can specify an explicit `juv` executable in the
extension settings.
