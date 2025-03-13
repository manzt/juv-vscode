# juv

Official VS Code extension for [juv](https://github.com/manzt/juv): reproducible
Jupyter notebooks, powered by uv.

## Requirements

- VS Code
  [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)
- Either:
  - [`uv`](https://github.com/astral-sh/uv) (**recommended**)
  - [`juv`](https://github.com/manzt/juv)

By default, the extension prioritizes invoking `juv` CLI through the
[`uv tool` interface](https://docs.astral.sh/uv/concepts/tools/#the-uv-tool-interface)
(i.e., `uvx juv`). If `uv` is not available, it falls back to calling `juv`
directly (if installed globally).

To override this behavior, you can specify an explicit `juv` executable in the
extension settings.
