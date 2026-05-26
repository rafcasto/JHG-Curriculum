import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const UserProfileContext = createContext(null);

export function UserProfileProvider({ children }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const refreshProfile = useCallback(async () => {
    if (!user) { setProfile(null); return; }
    setProfileLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setProfile(await res.json());
    } catch {
      // profile unavailable — keep null
    } finally {
      setProfileLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  return (
    <UserProfileContext.Provider value={{ profile, profileLoading, refreshProfile }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  return useContext(UserProfileContext);
}
