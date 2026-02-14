import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { pb } from '@/lib/pb';
import type { RecordModel } from 'pocketbase';
import { ClientResponseError } from 'pocketbase';

interface AuthContextType {
  user: RecordModel | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Check if a PocketBase SDK error is a network/connection error (status 0). */
function isNetworkError(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status === 0;
}

// Try authRefresh on the collection that issued the stored token.
// authStore.record.collectionName tells us which collection the token belongs to.
async function tryAuthRefresh() {
  const collection = pb.authStore.record?.collectionName;
  if (collection) {
    return await pb.collection(collection).authRefresh();
  }
  // Fallback: try _superusers first, then users
  try {
    return await pb.collection('_superusers').authRefresh();
  } catch (err) {
    if (isNetworkError(err)) throw err;
    return await pb.collection('users').authRefresh();
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<RecordModel | null>(pb.authStore.record);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: verify stored token with server
  useEffect(() => {
    const verify = async () => {
      if (!pb.authStore.isValid) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      try {
        const result = await tryAuthRefresh();
        setUser(result.record);
      } catch {
        pb.authStore.clear();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    verify();
  }, []);

  // Reactive: sync on any authStore change
  useEffect(() => {
    return pb.authStore.onChange((_token, record) => {
      setUser(record);
    });
  }, []);

  // Login: try _superusers first, then users.
  // Distinguish network errors (throw immediately) from auth errors (try next collection).
  const login = useCallback(async (email: string, password: string) => {
    try {
      const result = await pb.collection('_superusers').authWithPassword(email, password);
      setUser(result.record);
      return;
    } catch (err) {
      if (isNetworkError(err)) {
        throw new Error('Unable to connect to server');
      }
      // Auth failure (400) → try users collection
    }
    try {
      const result = await pb.collection('users').authWithPassword(email, password);
      setUser(result.record);
    } catch (err) {
      if (isNetworkError(err)) {
        throw new Error('Unable to connect to server');
      }
      throw new Error('Invalid email or password');
    }
  }, []);

  const logout = useCallback(() => {
    pb.authStore.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
