import { useState, type FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';

type Mode = 'signin' | 'signup';

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error } = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
    setSubmitting(false);

    if (error) {
      setError(error);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Dialogue Polish</h1>
          <p className="mt-2 text-sm text-neutral-500">Professional film dialogue processing</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-neutral-400 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 transition-colors"
              placeholder="you@studio.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-neutral-400 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 transition-colors"
              placeholder="At least 6 characters"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
            }}
            className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
