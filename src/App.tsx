import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import AuthScreen from '@/screens/AuthScreen';
import ProjectList from '@/screens/ProjectList';
import ProjectWorkspace from '@/screens/ProjectWorkspace';
import { Loader2 } from 'lucide-react';

function AppContent() {
  const { session, loading } = useAuth();
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  // Restore open project from URL hash
  useEffect(() => {
    const hash = window.location.hash.replace('#/project/', '');
    if (hash) setOpenProjectId(hash);
  }, []);

  // Update URL hash when project changes
  useEffect(() => {
    if (openProjectId) {
      window.location.hash = `/project/${openProjectId}`;
    } else {
      window.location.hash = '';
    }
  }, [openProjectId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-neutral-600" />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (openProjectId) {
    return (
      <ProjectWorkspace
        projectId={openProjectId}
        onBack={() => setOpenProjectId(null)}
      />
    );
  }

  return <ProjectList onOpenProject={setOpenProjectId} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
