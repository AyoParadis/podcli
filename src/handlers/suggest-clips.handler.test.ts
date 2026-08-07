import { describe, expect, it } from "vitest";
import { handleSuggestClips } from "./suggest-clips.handler.js";

describe("handleSuggestClips", () => {
  it("binds suggestions to an exact edit revision", async () => {
    const result = JSON.parse(await handleSuggestClips({
      edit_project_id: "project-1",
      edit_revision: 9,
      suggestions: [{
        title: "Moment",
        start_second: 2,
        end_second: 12,
        reasoning: "Strong opening",
      }],
    }));
    expect(result.clips[0]).toMatchObject({
      edit_project_id: "project-1",
      edit_revision: 9,
      start_second: 2,
      end_second: 12,
    });
  });
});
