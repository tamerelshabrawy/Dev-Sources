# pd4web Build Setup

This project uses [pd4web](https://github.com/charlesneimog/pd4web) to compile Pure Data patches for the web.

---

## Requirements

### Python 3.12

**Use Python 3.12 — do NOT use Python 3.14.**

The Emscripten SDK bundled with pd4web is incompatible with Python 3.14 and will crash with a `TypeError` (`types.GenericAlias | None`).

Check your Python version:

```bash
python3.12 --version
```

If you don't have 3.12, install it via [python.org](https://www.python.org/downloads/) or Homebrew:

```bash
brew install python@3.12
```

### pd4web 3.1.1a1

Install pd4web using [pipx](https://pipx.pypa.io/) with Python 3.12 explicitly:

```bash
pipx install --python python3.12 pd4web==3.1.1a1
```

> **Why pipx?** Modern macOS enforces PEP 668, which prevents installing packages into the system Python environment with `pip`. `pipx` creates an isolated virtual environment and is the recommended approach.

---

## Known Issues

### `markov.pd` contains a `display` GUI object that crashes `--nogui` builds

The ELSE library abstraction `markov.pd` includes a `display` object (a GUI number-box). This object causes pd4web to crash when building with `--nogui` because there is no screen to render it on.

**Fix** — remove the `display` line from `markov.pd` inside the pd4web virtual environment:

```bash
find ~/.local/pipx/venvs/pd4web/ -name "markov.pd" \
  -exec sed -i.bak '/display/d' {} \;
```

> Removing `display` does **not** affect performance or audio behaviour. The `display` object is a pure GUI element; it does not process audio or route messages in any way.

---

## Build

### Clean build (recommended before each rebuild)

Old `.build` cache can cause issues. Always clean before rebuilding:

```bash
rm -rf .build .tmp
```

### Run the build

```bash
pd4web Main_scenes_adc.pd --nogui -m 512
```

---

## Quick-start checklist

1. Install Python 3.12
2. Install pipx (`brew install pipx`)
3. Install pd4web: `pipx install --python python3.12 pd4web==3.1.1a1`
4. Apply the `markov.pd` fix (see above)
5. Clean: `rm -rf .build .tmp`
6. Build: `pd4web Main_scenes_adc.pd --nogui -m 512`
