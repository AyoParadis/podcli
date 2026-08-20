## AI Installation

No terminal experience is required. Copy the prompt below into Codex, Claude Code, Cursor, or another coding agent that can use a terminal. The agent will inspect your computer, install this fork safely, and verify that it works.

<details>
<summary><strong>Copy this complete prompt into your coding agent</strong></summary>

```text
Install and verify PodCLI from https://github.com/AyoParadis/podcli on this computer.

My goal is a safe, working installation of this fork, including its fork-specific Studio features. Work autonomously where it is safe, explain blockers in plain language, and do not claim success until the checks below pass.

1. Inspect before changing anything
- Detect the operating system, CPU architecture, available disk space, Git, package managers, FFmpeg/ffprobe, Python 3, Node.js, npm, and whether Node.js meets the repository's >=18 requirement.
- Look for an existing PodCLI installation, checkout, running Studio, `.podcli-home` marker, `.env`, and the PODCLI_HOME, PODCLI_DATA, and PODCLI_OUTPUT locations.
- If PodCLI is already installed, report its command path and version before proceeding. Do not overwrite a modified checkout.

2. Protect my data and privacy
- Preserve existing configuration, knowledge files, presets, assets, history, transcripts, source media, edits, and rendered clips. Back up any configuration file that must change and never use an uninstall purge.
- Never print, commit, or upload API keys, tokens, `.env` contents, or private podcast media. Keep transcription and rendering local unless I explicitly approve a cloud integration or publishing action.
- Ask before using administrator privileges, changing system security settings, installing a system-wide dependency, modifying another application's MCP configuration, or downloading a large speech model.

3. Install this fork from source
- Clone https://github.com/AyoParadis/podcli into a sensible user-owned development folder. If a clean checkout already exists, fetch and fast-forward it safely instead of cloning another copy.
- Configure `origin` as https://github.com/AyoParadis/podcli and a fetch-only `upstream` remote as https://github.com/nmbrthirteen/podcli. Never push to upstream.
- Do not use the podcli.com installer for this task: the checked-in installer currently downloads upstream release binaries and would omit this fork's changes.
- Install only missing prerequisites using a trusted, platform-appropriate package manager after showing me what is needed.
- Follow the repository's source setup: on macOS/Linux run `./setup.sh --install`; on Windows run `powershell -ExecutionPolicy Bypass -File setup.ps1 -Install`. Keep an existing `.env` and user-data paths intact.
- If setup fails, diagnose the first real error, make the smallest safe correction, and retry. Do not disable checksum, TLS, antivirus, Gatekeeper, or execution-policy protections globally.

4. Use Computer Use when helpful
- If a Computer Use or computer-use tool is available, call it for GUI-only steps such as approving an operating-system dialog, confirming the Studio in a browser, or selecting a local test file. Keep terminal work in the terminal.
- Tell me before taking over the screen, avoid unrelated apps and private files, and return control for passwords, tokens, account sign-ins, purchases, publishing, or irreversible choices.

5. Configure conservatively
- Keep optional Hugging Face, AssemblyAI, Claude, Codex, YouTube, and other integrations disabled unless I ask for one. Never invent credentials.
- Recommend one suitable Whisper model based on this computer's memory, performance, and free space; state its approximate download cost and ask before downloading it. Do not download every model.
- Preserve the default local Studio port unless it is occupied; if it is, choose a safe free port and report it.
- Do not register the MCP server with another application unless I approve the exact config change. You may show me the generated configuration first.

6. Verify the installation
- Confirm Git, FFmpeg, ffprobe, Python, Node, npm, and the installed dependencies are callable from the paths PodCLI will use.
- Run the repository build and its smallest relevant smoke checks. Report any failed check exactly; do not hide or skip it.
- Launch the source-built Studio using the repository's documented command, wait for it to become ready, and verify that its local page loads (normally http://localhost:3847). Use Computer Use to inspect the page if available.
- Confirm the fork-specific episode editor is present. Do not process or upload my real media during verification. If a media test is necessary, ask me for a disposable local sample first.
- Stop background processes that were started only for testing unless I ask you to leave the Studio running.

7. Create a safe weekly update automation
- After installation passes, create a user-level scheduled task that checks for and installs updates from this fork once every seven days. Use the operating system's native scheduler (such as launchd on macOS, a systemd user timer on Linux, or Task Scheduler on Windows) without requiring administrator privileges. When supported, make a missed run execute after the computer next becomes available.
- Store the updater script and logs in a user-owned location outside the Git checkout. Use only this fork's `origin/main`; never merge directly from upstream during an unattended run.
- On each run, verify the checkout is on `main` and clean, fetch `origin`, and do nothing if no newer commit exists. Update only with a fast-forward. If local changes, divergence, conflicts, or an unsafe migration are detected, stop without resetting, stashing, deleting, or overwriting anything, then record the reason in the log.
- Preserve `.env`, PODCLI_HOME, PODCLI_DATA, PODCLI_OUTPUT, knowledge, assets, history, transcripts, edits, and rendered media. Before an update that may migrate configuration or data, create a timestamped backup of the affected files. Never purge user data or redownload models unnecessarily.
- After updating, rerun the documented source setup/build steps and a non-interactive smoke check. Do not open the Studio, process media, publish content, or change integrations during an unattended run. Log the previous commit, installed commit, time, checks, and exact outcome.
- Report the automation name, weekly schedule, updater path, log path, next run, and commands to run it immediately or disable it safely.

8. Finish with a plain-language report
- Give me the checkout path, branch and commit installed, config/data/output paths, Studio URL, dependencies installed, model chosen or deferred, checks run, and their results.
- List any optional setup still awaiting my approval. If something is blocked, give the exact error and the smallest next action instead of saying the installation succeeded.
```

</details>

<p align="center">
  <img src="public/podcli-badge.png" height="72" alt="podcli" />
</p>

> [!NOTE]
> **This is a maintained product fork of [nmbrthirteen/podcli](https://github.com/nmbrthirteen/podcli).** It preserves Podcli's local-first engine and CLI while extending Studio for a simpler podcast-production workflow. Upstream changes are reviewed and merged regularly to limit drift.

See the [guarded upstream-sync process](docs/upstream-sync.md) for its schedule, test gates, and conflict policy.

### What this fork adds

- **`podclip` launcher** — open the local Studio from any directory with one command
- **Non-destructive episode editor** — split, trim, ripple-delete, reorder, and edit by transcript without modifying raw media
- **Integrated silence removal** — detect, review, and remove silent sections before editing
- **Quality-gated clip discovery** — scan the full episode for every strong moment without filling a clip quota
- **Full-episode YouTube export** — render and download the complete edited episode from Studio
- **Large YouTube preview** — review the full episode in a responsive 16:9 frame before export
- **Adjustable captions** — preview and change caption placement and font size for each format
- **Adjustable logo overlay** — preview the logo and control its placement on the video
- **YouTube-specific captions** — use a single caption line for horizontal videos
- **Full-episode transcripts** — view a readable, formatted transcript and copy it in one click
- **Per-clip transcripts** — open any rendered clip and copy its complete saved transcript

Launch the Studio from any directory with `podclip`.

Imported episodes now open in **Edit episode** after transcription. Every cut is stored as a small project instruction; previews, silence review, clip discovery, and the final YouTube render all use that saved revision directly. See the [episode editor guide](docs/episode-editor.md).

<p align="center">
  <strong>Open-source AI podcast clipper.</strong><br/>
  Turn a long episode into short clips with face tracking and burned-in captions. Drive it from the CLI, a web studio, or your coding agent.
</p>

<p align="center">
  <a href="https://podcli.com"><strong>podcli.com</strong></a> ·
  <a href="https://podcli.com/docs">Docs</a> ·
  <a href="#install">Install</a> ·
  <a href="#use-it-from-your-agent">MCP</a>
</p>

<p align="center">
  <a href="https://github.com/nmbrthirteen/podcli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="license: AGPL-3.0" /></a>
  <a href="https://github.com/nmbrthirteen/podcli/stargazers"><img src="https://img.shields.io/github/stars/nmbrthirteen/podcli?style=social" alt="stars" /></a>
</p>

<p align="center">
  <a href="https://x.com/nikasiradze_/status/2056061654664708570">
    <img src="public/promo.gif" alt="Podcli demo" width="720" />
  </a>
</p>
<p align="center"><sub>▶ <a href="https://x.com/nikasiradze_/status/2056061654664708570">Watch with sound on X</a></sub></p>

```bash
podcli process episode.mp4
```

That one command transcribes the episode, picks the moments worth clipping, crops to whoever is speaking, and burns the captions in. Transcription and rendering run on your machine. The only network calls are the optional Claude or Codex requests when you use AI clip scoring.

## Install

No prerequisites. The installer fetches a self-contained binary, and the first run provisions Python, Node, FFmpeg, whisper.cpp, and the models it needs into a managed folder.

**macOS and Linux**

```bash
curl -fsSL https://podcli.com/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://podcli.com/install.ps1 | iex
```

Runs on macOS (Apple Silicon), Linux (x64 and arm64), and Windows (x64). Intel Mac support is in progress.

## Quick start

```bash
podcli                       # interactive menu, opens the web studio
podcli process episode.mp4   # transcribe, pick moments, render clips
```

Clips land in `podcli-clips/` in the directory you ran it from, so each show keeps its own renders. Everything else (knowledge, presets, assets, clip history, cache) lives in one managed folder that follows you between directories. Set `PODCLI_OUTPUT` to render somewhere fixed instead.

## What you get

**Clips**

- 9:16, 16:9, or 1:1, with captions sized for each canvas
- Face tracking that follows the speaker, split-screen layouts included
- Multi-segment cuts that drop filler, long pauses, and tangents
- Four caption styles: branded, hormozi, karaoke, subtle
- Logos, intros, outros, and background music from a reusable asset library
- Loudness-normalized audio and hardware encoding on VideoToolbox, NVENC, and VAAPI, with a CPU fallback

**Finding the moments**

- Whisper transcription with speaker diarization, or bring your own transcript as `.txt`, `.srt`, or `.vtt`
- AssemblyAI as an alternative engine, and yt-dlp to pull an episode straight from a URL
- AI scoring against your knowledge base, checked against your episode database so it stops resuggesting moments you already published
- Audio energy and laughter detection to build highlight reels

**The studio at `localhost:3847`**

- Library, episode workspace, per-clip detail, highlights, thumbnails, content, analytics, assets, knowledge, config, integrations, and MCP setup
- `⌘K` command palette across pages, clips, and assets
- Titles, descriptions, tags, and hashtags, with any section regenerated on your own guidance
- Thumbnail studio for 16:9 and 9:16, with frame and text options
- Transcript corrections that carry through to every render

**Shipping it**

- 26 MCP tools, so an agent can transcribe, score, render, and publish through conversation
- YouTube publishing plus performance analytics to see which clips landed
- DaVinci Resolve export as FCPXML when you want to finish by hand
- Presets, clip history with duplicate detection, and a transcript cache

## Why podcli

If you are weighing podcli against the cloud clippers, this is the difference:

- Runs locally. Transcription and rendering happen on your machine by default, so episodes stay there. Only the optional cloud engine (AssemblyAI) and publishing to YouTube send anything out.
- Free and open source under AGPL-3.0. Exports are unlimited, full quality, and watermark-free.
- Agent-native. 26 MCP tools let Claude Code or Codex drive the whole flow, transcription through publishing.
- A knowledge base keeps titles, captions, and descriptions in your show's voice, and stops the engine from resuggesting moments you already published.
- DaVinci Resolve handoff. Export any clip as FCPXML when you want to finish the edit yourself.

## Use it from your agent

podcli is an [MCP](https://modelcontextprotocol.io) server, so an agent can transcribe, suggest clips, and render them through conversation.

```bash
podcli mcp install    # registers it with Claude Code
```

Claude Desktop and Codex setup is in the [MCP docs](https://podcli.com/docs/mcp-server).

## Content workflow

[PodStack](https://github.com/nmbrthirteen/podstack) ships with podcli as a set of Claude Code slash commands. They take a transcript to a publish-ready package: scored moments, titles, descriptions, thumbnail briefs, a brand review, and a publish checklist.

```
/produce-shorts
```

The commands live in `.claude/commands/`. [CLAUDE.md](CLAUDE.md) describes each one.

## Docs

| Guide | What's in it |
| ----- | ------------ |
| [Getting started](https://podcli.com/docs) | Install, first episode, the whole flow |
| [The studio](https://podcli.com/docs/the-studio) | Web UI: library, episodes, content, highlights |
| [CLI](https://podcli.com/docs/cli) | Commands, flags, presets, assets |
| [MCP server](https://podcli.com/docs/mcp-server) | Agent setup and available tools |
| [Captions and formats](https://podcli.com/docs/captions-and-formats) | Styles, aspect ratios, cropping |
| [Configuration](docs/configuration.md) | Environment variables, config profiles, transcript format |

Docs are open source at [nmbrthirteen/podcli-docs](https://github.com/nmbrthirteen/podcli-docs).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup and conventions, and [RELEASE.md](RELEASE.md) for how releases are cut.

## Credits

Content workflow powered by [PodStack](https://github.com/nmbrthirteen/podstack), inspired by [gstack](https://github.com/garrytan/gstack) by Garry Tan.

## License

AGPL-3.0. See [LICENSE](LICENSE).

Need podcli without AGPL terms? A commercial license is available. Email [siradze@nikusha.me](mailto:siradze@nikusha.me) with a one-line description of your use case.
