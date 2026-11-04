import React, { useState } from 'react';
import { Lock, Droplets, ArrowRight } from 'lucide-react';
import { api, setToken } from '../lib/api';

export default function Auth({ status, onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { username: username.trim(), password });
      if (res.token) {
        setToken(res.token);
        onAuthenticated();
      }
    } catch (err) {
      setError(err.message || 'Could not sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <Droplets size={28} color="#fff" />
        </div>
        <h1>{status?.business_name || 'Aqua Home Appliance'}</h1>
        <p className="muted small" style={{ margin: 0 }}>Sign in to open your books</p>

        {error && (
          <div className="badge rose" style={{ marginTop: 16, width: '100%', justifyContent: 'center', padding: '8px 12px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              placeholder="Username"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </label>

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
            <Lock size={15} /> {loading ? 'Signing in…' : 'Sign in'} {!loading && <ArrowRight size={15} />}
          </button>
        </form>
      </div>
    </div>
  );
}
