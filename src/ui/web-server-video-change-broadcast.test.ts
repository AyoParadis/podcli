import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// A bare set_video from MCP (videoPath with no transcript in the same
// request) clears the server's transcript/suggestions/selections, since
// they describe a recording that's no longer loaded. But the SSE broadcast
// only echoed back whatever fields the request body itself carried. A
// request that only sent videoPath never told the studio that transcript
// and suggestions were cleared too, so the studio's in-memory copies stayed
// stale and a later sync from the studio wrote them right back onto the
// server.

const tmp = mkdtempSync(join(tmpdir(), "podcli-video-change-broadcast-"));
const savedEnv: Record<string, string | undefined> = {
  PODCLI_HOME: process.env.PODCLI_HOME,
  PODCLI_DATA: process.env.PODCLI_DATA,
  PODCLI_PORT: process.env.PODCLI_PORT,
};

const PORT = 18429;

vi.mock("../services/python-executor.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/python-executor.js")>();
  class StubExecutor {
    async execute() {
      return { data: {} };
    }
  }
  return { ...original, PythonExecutor: StubExecutor };
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/ui-state`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("web server never came up");
}

beforeAll(async () => {
  process.env.PODCLI_HOME = join(tmp, "home");
  process.env.PODCLI_DATA = join(tmp, "data");
  process.env.PODCLI_PORT = String(PORT);
  mkdirSync(process.env.PODCLI_HOME, { recursive: true });

  await import("./web-server.js");
  await waitForServer();
}, 20_000);

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tmp, { recursive: true, force: true });
});

/** Collects every "event: state-sync" payload broadcast while `during` runs. */
async function captureStateSyncEvents(during: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/events`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<Record<string, unknown>> = [];

  const pump = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const eventLine = chunk.split("\n").find((l) => l.startsWith("event: "));
        const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (eventLine?.slice(7) === "state-sync" && dataLine) {
          events.push(JSON.parse(dataLine.slice(6)));
        }
      }
    }
  };
  const pumpPromise = pump();

  await during();
  await new Promise((r) => setTimeout(r, 200)); // let the broadcast land
  await reader.cancel();
  await pumpPromise.catch(() => {});
  return events;
}

describe("POST /api/ui-state video change broadcast", () => {
  it("broadcasts the cleared transcript and suggestions, not just videoPath", async () => {
    const videoA = join(tmp, "episode-a.mp4");
    const videoB = join(tmp, "episode-b.mp4");

    // Seed a session on video A with a transcript and a suggestion.
    await fetch(`http://127.0.0.1:${PORT}/api/ui-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoPath: videoA,
        transcript: { words: [{ word: "hi", start: 0, end: 1 }] },
        suggestions: [
          { clip_id: "c1", title: "a moment", start_second: 0, end_second: 5, duration: 5, reasoning: "", preview_text: "" },
        ],
      }),
    });

    const events = await captureStateSyncEvents(async () => {
      // A bare set_video from MCP: videoPath changes, no transcript in the
      // same request.
      await fetch(`http://127.0.0.1:${PORT}/api/ui-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath: videoB }),
      });
    });

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.videoPath).toBe(videoB);
    expect(last.transcript).toBeNull();
    expect(last.suggestions).toEqual([]);
  });

  it("updates identity on edit activation and clears the edit when another video is loaded", async () => {
    const { EditProjectStore } = await import("../services/edit-project-store.js");
    const videoA = join(tmp, "edited-source.mp4");
    writeFileSync(videoA, "source");
    const activated: ReturnType<InstanceType<typeof EditProjectStore>["activate"]> = {
      project: {
        schema_version: 1,
        id: "edited-project",
        name: "Edited episode",
        revision: 1,
        created_at: "2026-10-08T00:00:00Z",
        updated_at: "2026-10-08T00:00:00Z",
        source: {
          path: videoA, fingerprint: "source", filename: "edited-source.mp4",
          duration: 10, width: 320, height: 240, fps: 25, has_audio: true,
        },
        timeline: [{ id: "part", source_start: 0, source_end: 10 }],
      },
      transcript: {
        transcript: "", duration: 10, language: "en", words: [], segments: [],
        speakers: { num_speakers: 0, speakers: {} }, speaker_segments: [],
      },
    };
    const activate = vi.spyOn(EditProjectStore.prototype, "activate").mockReturnValue(activated);
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/edit-projects/edited-project/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: 1 }),
      });
      expect(response.ok).toBe(true);
      await vi.waitFor(() => {
        const saved = JSON.parse(readFileSync(join(tmp, "home", "ui-state.json"), "utf8"));
        expect(saved.transcriptVideoIdentity?.path).toBe(videoA);
        expect(saved.videoMissing).toBe(false);
      });

      const events = await captureStateSyncEvents(async () => {
        await fetch(`http://127.0.0.1:${PORT}/api/ui-state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoPath: join(tmp, "another-source.mp4") }),
        });
      });
      expect(events.at(-1)).toMatchObject({ activeEditProjectId: null, activeEditRevision: null });
      const state = await (await fetch(`http://127.0.0.1:${PORT}/api/ui-state`)).json();
      expect(state.activeEditProjectId).toBeNull();
      expect(state.activeEditRevision).toBeNull();
    } finally {
      activate.mockRestore();
    }
  });
});
