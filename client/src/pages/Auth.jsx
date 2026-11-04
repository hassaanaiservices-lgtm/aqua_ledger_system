import React, { useState } from 'react';
import { Lock, Droplets, ArrowRight } from 'lucide-react';
import { api, setToken } from '../lib/api';

export default function Auth({ status, onAuthenticated }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const isSetup = !status?.password_set;
  const minLength = status?.min_password_length ?? 4;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (isSetup && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isSetup ? '/auth/setup' : '/auth/login';
      const res = await api.post(endpoint, { password });
      if (res.token) {
        setToken(res.token);
        onAuthenticated();
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand-logo" style={{ margin: '0 auto 16px', width: 54, height: 54 }}>
          <Droplets size={30} />
        </div>
        <h1 style={{ fontSize: '24px', margin: '0 0 6px 0' }}>
          {status?.business_name || 'Aqua Home Appliance'}
        </h1>
        <p className="muted small" style={{ margin: 0 }}>
          {isSetup ? 'Initial Setup: Create your business owner password' : 'Enter your password to access the business management system'}
        </p>

        {error && (
          <div className="badge rose" style={{ marginTop: 16, width: '100%', justifyContent: 'center', padding: '8px 12px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>{isSetup ? 'Create Master Password' : 'Owner Password'}</span>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
              autoFocus
              minLength={minLength}
              placeholder="••••••••" 
            />
          </label>

          {isSetup && (
            <label className="field">
              <span>Confirm Password</span>
              <input 
                type="password" 
                value={confirmPassword} 
                onChange={(e) => setConfirmPassword(e.target.value)} 
                required 
                minLength={minLength}
                placeholder="••••••••" 
              />
            </label>
          )}

          <button type="submit" className="btn btn-primary" style={{ marginTop: 10 }} disabled={loading}>
            {loading ? 'Verifying...' : isSetup ? 'Save & Open System' : 'Unlock Dashboard'} <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
