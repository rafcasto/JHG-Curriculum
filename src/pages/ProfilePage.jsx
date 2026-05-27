import { useState, useEffect, useRef } from 'react';
import { updateProfile } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import './ProfilePage.css';

export default function ProfilePage() {
  const { user } = useAuth();
  const { profile, profileLoading, refreshProfile } = useUserProfile();
  const { workspaces } = useWorkspace();

  const [form, setForm] = useState({ firstName: '', lastName: '', dateOfBirth: '', company: '' });
  const [photoURL, setPhotoURL] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const [earnedBadges, setEarnedBadges] = useState([]);     // { badgeId, workspaceId, awardedAt }
  const [badgeDefs, setBadgeDefs] = useState([]);           // { id, name, icon, iconType, workspaceId }

  // Populate form when profile loads
  useEffect(() => {
    if (profile) {
      setForm({
        firstName: profile.firstName ?? '',
        lastName: profile.lastName ?? '',
        dateOfBirth: profile.dateOfBirth ?? '',
        company: profile.company ?? '',
      });
      setPhotoURL(profile.photoURL ?? '');
      setPhotoPreview(profile.photoURL ?? '');
    }
  }, [profile]);

  // Fetch earned badges across all user workspaces
  useEffect(() => {
    if (!user || !workspaces?.length) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const results = await Promise.all(
          workspaces.map((ws) =>
            Promise.all([
              fetch(`/api/badges?workspaceId=${encodeURIComponent(ws.id)}`, {
                headers: { Authorization: `Bearer ${token}` },
              }).then((r) => r.ok ? r.json() : []),
              fetch(`/api/badges?earned=true&workspaceId=${encodeURIComponent(ws.id)}`, {
                headers: { Authorization: `Bearer ${token}` },
              }).then((r) => r.ok ? r.json() : []),
            ])
          )
        );
        if (cancelled) return;
        const allDefs = results.flatMap(([defs]) => defs);
        const allEarned = results.flatMap(([, earned]) => earned);
        setBadgeDefs(allDefs);
        setEarnedBadges(allEarned);
      } catch {
        // non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [user, workspaces]);

  async function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview immediately
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);

    setUploading(true);
    setError(null);
    try {
      const storageRef = ref(storage, `profiles/${user.uid}/avatar`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const downloadURL = await getDownloadURL(storageRef);
      await updateProfile(user, { photoURL: downloadURL });
      setPhotoURL(downloadURL);
    } catch (e) {
      setError('Photo upload failed: ' + e.message);
      setPhotoPreview(photoURL); // revert preview
    } finally {
      setUploading(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/users?profile=true', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, photoURL }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      await refreshProfile();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const initials = form.firstName && form.lastName
    ? `${form.firstName[0]}${form.lastName[0]}`.toUpperCase()
    : (user?.email?.[0] ?? '?').toUpperCase();

  if (profileLoading) {
    return <div className="profile-page"><p className="profile-loading">Loading profile…</p></div>;
  }

  return (
    <div className="profile-page">
      <div className="profile-card">
        <h1 className="profile-title">Your profile</h1>

        {/* Avatar upload */}
        <div className="profile-avatar-section">
          <div
            className="profile-avatar-large"
            onClick={() => fileInputRef.current?.click()}
            title="Click to change photo"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="Profile" className="profile-avatar-large-img" />
            ) : (
              <span className="profile-avatar-large-initials">{initials}</span>
            )}
            <div className="profile-avatar-overlay">
              {uploading ? 'Uploading…' : 'Change Photo'}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="profile-file-input"
            onChange={handlePhotoSelect}
            disabled={uploading}
          />
          <p className="profile-avatar-hint">Click the photo to upload a new image</p>
        </div>

        {/* Profile form */}
        <form className="profile-form" onSubmit={handleSave}>
          <div className="profile-form-row">
            <div className="profile-field">
              <label className="profile-label">First Name</label>
              <input
                className="profile-input"
                type="text"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="First name"
              />
            </div>
            <div className="profile-field">
              <label className="profile-label">Last Name</label>
              <input
                className="profile-input"
                type="text"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="Last name"
              />
            </div>
          </div>

          <div className="profile-form-row">
            <div className="profile-field">
              <label className="profile-label">Date of Birth</label>
              <input
                className="profile-input"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
              />
            </div>
            <div className="profile-field">
              <label className="profile-label">Company</label>
              <input
                className="profile-input"
                type="text"
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                placeholder="Your company"
              />
            </div>
          </div>

          <div className="profile-field profile-field--email">
            <label className="profile-label">Email</label>
            <input className="profile-input profile-input--readonly" type="email" value={user?.email ?? ''} readOnly />
          </div>

          {error && <p className="profile-error">{error}</p>}
          {success && <p className="profile-success">Profile saved successfully!</p>}

          <div className="profile-actions">
            <button
              className="profile-save-btn"
              type="submit"
              disabled={saving || uploading}
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>

        {/* Earned badges */}
        {earnedBadges.length > 0 && (
          <div className="profile-badges-section">
            <h2 className="profile-badges-title">Earned Badges</h2>
            <div className="profile-badges-grid">
              {earnedBadges.map((earned) => {
                const def = badgeDefs.find((d) => d.id === earned.badgeId);
                if (!def) return null;
                return (
                  <div key={earned.id ?? earned.badgeId} className="profile-badge-chip" title={def.name}>
                    <span className="profile-badge-icon">
                      {def.iconType === 'url' ? (
                        <img src={def.icon} alt="" className="profile-badge-img" />
                      ) : (
                        <span role="img" aria-label={def.name}>{def.icon}</span>
                      )}
                    </span>
                    <span className="profile-badge-name">{def.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
