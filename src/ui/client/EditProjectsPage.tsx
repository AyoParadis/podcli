import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RotateCcw, Scissors } from "lucide-react";
import type { EditProjectSummary } from "../../models/index.js";
import { PageHeader } from "./Page";
import { api, timeAgo, friendlyProjectName, friendlySourceFilename } from "./lib";
import EditProjectCard from "./EditProjectCard";

export default function EditProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<EditProjectSummary[]>([]);
  const [trash, setTrash] = useState<EditProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ projects: EditProjectSummary[]; trash: EditProjectSummary[] }>("/edit-projects");
      setProjects(data.projects || []);
      setTrash(data.trash || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load edit projects");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const activate = async (project: EditProjectSummary) => {
    setError(null);
    try {
      await api(`/edit-projects/${project.id}/activate`, { method: "POST", body: JSON.stringify({ expected_revision: project.revision }) });
      navigate("/episode");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that saved edit");
    }
  };

  const moveToTrash = async (project: EditProjectSummary) => {
    setError(null);
    try {
      await api(`/edit-projects/${project.id}/trash`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move that project to Trash");
    }
  };

  const restore = async (project: EditProjectSummary) => {
    setError(null);
    try {
      await api(`/edit-projects/${project.id}/restore`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore that project");
    }
  };

  return (
    <div className="app edit-projects-page">
      <PageHeader title="Episode editor" actions={<Link to="/episode" className="btn btn-primary btn-sm">+ Import episode</Link>} />
      {error && <div className="set-note err">{error}</div>}
      {loading ? <div className="edit-loading"><div className="spinner sm" /> Loading projects…</div> : (
        <>
          <section>
            <div className="library-section-heading"><div><h2>Draft episodes</h2><p>Non-destructive edits over your original local files.</p></div><span>{projects.length}</span></div>
            {projects.length === 0 ? (
              <Link to="/episode" className="drop-zone edit-project-empty"><Scissors size={22} /><strong>Import an episode to start editing</strong><span>Transcription opens the editor automatically.</span></Link>
            ) : <div className="draft-grid">{projects.map((project) => <EditProjectCard key={project.id} project={project} onActivate={activate} onTrash={moveToTrash} />)}</div>}
          </section>
          {trash.length > 0 && <section className="project-trash"><div className="library-section-heading"><div><h2>Trash</h2><p>Project metadata is retained for 30 days. Raw video and exports are never deleted.</p></div><span>{trash.length}</span></div><div className="trash-list">{trash.map((project) => <div key={project.id}><div><strong>{friendlyProjectName(project.name, project.source_filename)}</strong><span>{friendlySourceFilename(project.source_filename)} · moved {timeAgo(project.trashed_at || project.updated_at)}</span></div><button className="btn btn-ghost btn-sm" onClick={() => void restore(project)}><RotateCcw size={13} /> Restore</button></div>)}</div></section>}
        </>
      )}
    </div>
  );
}
