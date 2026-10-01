import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Project } from '@/types/database';
import { Plus, FolderOpen, LogOut, Trash2 } from 'lucide-react';
import { formatTimestamp } from '@/lib/format';

interface ProjectListProps {
  onOpenProject: (projectId: string) => void;
}

export default function ProjectList({ onOpenProject }: ProjectListProps) {
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setProjects(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);

    const { data, error } = await supabase
      .from('projects')
      .insert({ name: newName.trim() })
      .select()
      .maybeSingle();

    setCreating(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (data) {
      setNewName('');
      setShowCreate(false);
      onOpenProject(data.id);
    }
  };

  const handleDelete = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    if (error) {
      setError(error.message);
    } else {
      setProjects(projects.filter((p) => p.id !== projectId));
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="border-b border-neutral-800/80">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-neutral-100">Dialogue Polish</h1>
            <span className="text-xs text-neutral-600 hidden sm:inline">·</span>
            <span className="text-xs text-neutral-600 hidden sm:inline">{user?.email}</span>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-medium text-neutral-200">Projects</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white transition-colors"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>

        {error && (
          <p className="mb-4 text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {showCreate && (
          <form onSubmit={handleCreate} className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
            <label htmlFor="projectName" className="block text-xs font-medium text-neutral-400 mb-2">
              Project Name
            </label>
            <div className="flex gap-2">
              <input
                id="projectName"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Reel 1 — Scene 3 Dialogue"
                autoFocus
                className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50 transition-colors"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewName(''); }}
                className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-neutral-500">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-12 text-center">
            <FolderOpen size={36} className="mx-auto text-neutral-700 mb-3" />
            <p className="text-sm text-neutral-500">No projects yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => onOpenProject(project.id)}
                className="group rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 hover:border-neutral-700 hover:bg-neutral-900 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-neutral-200 truncate">{project.name}</h3>
                    <p className="mt-0.5 text-xs text-neutral-600">
                      Created {formatTimestamp(project.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDelete(project.id, e)}
                    className="flex-shrink-0 p-1.5 text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete project"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
