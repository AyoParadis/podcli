# Episode editor

Podclip's episode editor is a local, non-destructive hard-cut workflow. It stores edit instructions and a transcript snapshot while leaving the source video untouched.

## Workflow

1. Import and transcribe an episode in Studio.
2. Split, trim, ripple-delete, reorder, or remove timed transcript phrases.
3. Review and apply silence detection if needed.
4. Choose **Use edited episode** to find social clips or preview and export the full YouTube episode.

Use **Skip editing** to continue with the unchanged episode. Drafts remain in Library and on the Editor page, where they can be resumed, moved to Trash, or restored. Trash retains project metadata for 30 days and never deletes source media or completed exports.

## Controls

- Space: play or pause
- `S`: split at the playhead
- Delete or Backspace: ripple-delete the selection
- Command-Z: undo
- Shift-Command-Z: redo
- Drag a segment edge to trim; drag a segment to reorder it
- Click the ruler or drag the playhead to scrub; use **Fit** to show the whole episode
- Click a transcript phrase to seek; Shift-click to select consecutive phrases
- Choose **Copy full transcript** to copy the complete formatted edited episode at once

The focused editor keeps the video, transcript, transport, and timeline in one window. The timeline, transcript, waveform, storyboard, captions, and logo preview share edited time. Caption style, font scale, placement, logo placement, and output format remain in Episode Workspace.

## Rendering and recovery

All edits autosave with revision checks and 100 persistent undo steps. Clip and full-episode renders require the exact active revision, map edited ranges back to ordered source slices, and render from the original media. Reordered and repeated source sections are preserved.

Preview playback starts from the original file over local HTTP Range streaming. Podclip creates a disposable 720p proxy only after a playback error or two failed seeks. Waveform, storyboard, and proxy files are caches and are safe to regenerate.

If a source file moves, relink the same file; Podclip verifies its fingerprint before accepting it. A stale editing tab stops autosaving and offers to reload the saved project or duplicate the current edit.
