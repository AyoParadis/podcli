import React from "react";
import { Link } from "react-router-dom";
import { Clock3, Scissors, Trash2 } from "lucide-react";
import type { EditProjectSummary } from "../../models/index.js";
import { fmtMs, friendlyProjectName, friendlySourceFilename, timeAgo } from "./lib";

export default function EditProjectCard({
  project,
  onActivate,
  onTrash,
}: {
  project: EditProjectSummary;
  onActivate: (project: EditProjectSummary) => void;
  onTrash: (project: EditProjectSummary) => void;
}) {
  const displayName = friendlyProjectName(project.name, project.source_filename);
  return (
    <article className="draft-card">
      <div className="draft-card-icon"><Scissors size={18} /></div>
      <div className="draft-card-copy">
        <h3>{displayName}</h3>
        <p>{friendlySourceFilename(project.source_filename)}</p>
        <div>
          <span>{fmtMs(project.original_duration)} original</span>
          <span>{fmtMs(project.edited_duration)} edited</span>
          <span>{fmtMs(project.removed_duration)} removed</span>
          <span><Clock3 size={11} /> {timeAgo(project.updated_at)}</span>
        </div>
        {project.source_missing && <b>Source file needs relinking</b>}
      </div>
      <div className="draft-card-actions">
        <Link className="btn btn-ghost btn-sm" to={`/editor/${project.id}`}>Resume editing</Link>
        <button className="btn btn-primary btn-sm" onClick={() => onActivate(project)} disabled={project.edited_duration <= 0 || project.source_missing}>Continue to clips</button>
        <button className="draft-trash" title="Move project to Trash" aria-label={`Move ${displayName} to Trash`} onClick={() => onTrash(project)}><Trash2 size={14} /></button>
      </div>
    </article>
  );
}
