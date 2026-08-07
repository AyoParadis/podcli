import React, { useEffect, useState } from "react";
import { PageHeader } from "./Page";
import { Link, useNavigate } from "react-router-dom";
import { api, fmt, timeAgo, basename } from "./lib";
import { TrashIcon, PlayIcon } from "./icons";
import SetupChecklist from "./SetupChecklist";
import type { EditProjectSummary } from "../../models/index.js";
import EditProjectCard from "./EditProjectCard";

interface Clip {
  id: string;
  source_video: string;
  title: string;
  caption_style: string;
  duration: number;
  file_size_mb?: number;
  output_path: string;
  created_at: string;
  content_type?: string;
  thumbnail_config?: { image_path?: string; preview_path?: string };
}

interface Episode {
  source: string;
  clips: Clip[];
  latest: string;
}

function groupEpisodes(clips: Clip[]): Episode[] {
  const map = new Map<string, Clip[]>();
  for (const c of clips) {
    const key = basename(c.source_video) || "unknown";
    (map.get(key) ?? map.set(key, []).get(key)!).push(c);
  }
  return Array.from(map.entries())
    .map(([source, list]) => ({
      source,
      clips: list,
      latest: list.reduce((a, c) => (c.created_at > a ? c.created_at : a), list[0]?.created_at || ""),
    }))
    .sort((a, b) => (a.latest < b.latest ? 1 : -1));
}

export default function StudioHome() {
  const navigate = useNavigate();
  const [clips, setClips] = useState<Clip[]>([]);
  const [drafts, setDrafts] = useState<EditProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    const loadHistory = () => {
      Promise.all([api("/history?limit=500"), api<{ projects: EditProjectSummary[] }>("/edit-projects")])
        .then(([d, p]) => { setClips(Array.isArray(d) ? d : []); setDrafts(p.projects || []); })
        .catch(() => setClips([]))
        .finally(() => setLoading(false));
    };

    loadHistory();
    const events = new EventSource("/api/events");
    events.addEventListener("history-updated", loadHistory);
    const onStart = (e: MessageEvent) => { try { setExporting(JSON.parse(e.data).clipCount || 0); } catch { setExporting(1); } };
    const onEnd = () => setExporting(0);
    events.addEventListener("export-started", onStart as EventListener);
    events.addEventListener("job-complete", onEnd as EventListener);
    events.addEventListener("job-error", onEnd as EventListener);
    return () => events.close();
  }, []);

  const remove = async (e: React.MouseEvent, c: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleting || !window.confirm(`Delete "${c.title}"? This removes the rendered file too.`)) return;
    setDeleting(c.id);
    try {
      await api(`/clips/${c.id}`, { method: "DELETE" });
      setClips((prev) => prev.filter((x) => x.id !== c.id));
    } catch {
      // Keep the card; the SSE refresh will reconcile if it was actually removed.
    } finally {
      setDeleting(null);
    }
  };

  const episodes = groupEpisodes(clips);

  const continueProject = async (project: EditProjectSummary) => {
    setDraftError(null);
    try {
      await api(`/edit-projects/${project.id}/activate`, {
        method: "POST",
        body: JSON.stringify({ expected_revision: project.revision }),
      });
      navigate("/episode");
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Could not open that saved edit");
    }
  };

  const trashProject = async (project: EditProjectSummary) => {
    setDraftError(null);
    try {
      await api(`/edit-projects/${project.id}/trash`, { method: "POST" });
      setDrafts((items) => items.filter((item) => item.id !== project.id));
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Could not move that project to Trash");
    }
  };

  return (
    <div className="app">
      <PageHeader
        title="Library"
        actions={<Link to="/episode" className="btn btn-primary btn-sm" style={{ textDecoration: "none" }}>+ New episode</Link>}
      />

      <SetupChecklist />

      {draftError && <div className="set-note err">{draftError}</div>}

      {!loading && drafts.length > 0 && (
        <section className="library-drafts">
          <div className="library-section-heading"><div><h2>Draft episodes</h2><p>Resume a non-destructive edit or continue with its saved revision.</p></div><Link to="/editor">View all</Link></div>
          <div className="draft-grid">{drafts.map((project) => <EditProjectCard key={project.id} project={project} onActivate={continueProject} onTrash={trashProject} />)}</div>
        </section>
      )}

      {exporting > 0 && (
        <div className="set-note ok" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div className="spinner sm" /> Exporting {exporting} clip{exporting > 1 ? "s" : ""}. They appear here as each finishes.
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text2)" }}>
          <div className="spinner sm" /> Loading…
        </div>
      ) : episodes.length === 0 && drafts.length === 0 ? (
        <Link to="/episode" className="drop-zone" style={{ textAlign: "center", padding: "48px 20px", display: "block", textDecoration: "none" }}>
          <div className="label">
            <span style={{ color: "var(--accent)" }}>Start a new episode</span>
          </div>
        </Link>
      ) : episodes.length > 0 ? (
        <div>
          {episodes.map((ep) => (
            <div key={ep.source} className="episode-block fade-in">
              <div className="episode-head">
                <h2>{ep.source}</h2>
                <span className="sub">{ep.clips.length} · {timeAgo(ep.latest)}</span>
              </div>
              <div className="clip-grid">
                {ep.clips.map((c) => {
                  const file = basename(c.output_path);
                  const thumb = c.thumbnail_config?.preview_path;
                  return (
                    <Link key={c.id} to={`/clip/${c.id}`} className="clip-card">
                      <button
                        className="clip-card-del"
                        title="Delete clip"
                        onClick={(e) => remove(e, c)}
                        disabled={deleting === c.id}
                      >
                        {deleting === c.id ? <div className="spinner sm" /> : <TrashIcon />}
                      </button>
                      {thumb ? (
                        <img className="clip-card-media" src={`/api/image?path=${encodeURIComponent(thumb)}`} alt="" />
                      ) : file ? (
                        <video className="clip-card-media" src={`/api/clips/${c.id}/preview#t=0.1`} muted preload="metadata" playsInline />
                      ) : (
                        <div className="clip-card-media empty"><PlayIcon size={20} /></div>
                      )}
                      <div className="clip-card-body">
                        <div className="clip-card-title">{c.title}</div>
                        <div className="clip-card-meta">
                          {fmt(c.duration)} · {c.caption_style}{c.content_type ? ` · ${c.content_type}` : ""}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
