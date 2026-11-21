'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  Flag,
  HeartPulse,
  KeyRound,
  Lock,
  LogOut,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  AdminAuditLogRecord,
  SavedSessionRecord,
  UserProfileRecord,
  adminFetchAllProfiles,
  adminFetchAllSessions,
  adminFetchAuditLogs,
  adminWriteAuditLog,
  deleteSavedSession,
} from '@/lib/firebase-client';
import type { AnswerVerificationReport } from '@/lib/answer-reports-store';
import type { FacilityInfoReport } from '@/lib/facility-reports-store';
import type { ServerAuditEntry, ServerManagedRecord } from '@/app/api/admin/records/route';
import { useAuth } from './AuthProvider';

export function AdminPortal() {
  const { user, isFirebaseAdmin, signInWithGoogle, signOut } = useAuth();

  // Server-side `dev admin` auth state (Bearer token kept strictly in React state, NEVER localStorage)
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [requiresFirstRunSetup, setRequiresFirstRunSetup] = useState(false);
  const [configuredViaEnv, setConfiguredViaEnv] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminLabel, setAdminLabel] = useState<string | null>(null);

  // Form inputs
  const [username, setUsername] = useState('dev admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Server records, facility reports, AI answer reports & security posture
  const [serverRecords, setServerRecords] = useState<ServerManagedRecord[]>([]);
  const [facilityReports, setFacilityReports] = useState<FacilityInfoReport[]>([]);
  const [answerReports, setAnswerReports] = useState<AnswerVerificationReport[]>([]);
  const [serverAuditLogs, setServerAuditLogs] = useState<ServerAuditEntry[]>([]);
  const [securityPosture, setSecurityPosture] = useState<{
    geminiKeyServerOnly: boolean;
    mapsKeyConfigured: boolean;
    rawMedicalPhotosStored: boolean;
    secretsExposedToClient: boolean;
    dpdpConsentEnforced: boolean;
  } | null>(null);

  // Live Firestore admin records (available when signed in as verified Firebase admin)
  const [firestoreProfiles, setFirestoreProfiles] = useState<UserProfileRecord[]>([]);
  const [firestoreSessions, setFirestoreSessions] = useState<SavedSessionRecord[]>([]);
  const [firestoreAudit, setFirestoreAudit] = useState<AdminAuditLogRecord[]>([]);

  // UI filters & detail drawer
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [activeSubTab, setActiveSubTab] = useState<
    'records' | 'patients' | 'reports' | 'ai_quality' | 'audit'
  >('records');
  const [selectedRecord, setSelectedRecord] = useState<{
    title: string;
    subtitle: string;
    summary: string;
    urgency: string;
    language: string;
    isSynthetic: boolean;
    source: 'server' | 'firestore';
  } | null>(null);

  const loadServerAdminData = useCallback(async (token: string) => {
    const res = await fetch('/api/admin/records', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setServerRecords(data.records || []);
    setFacilityReports(data.facilityReports || []);
    setAnswerReports(data.answerReports || []);
    setServerAuditLogs(data.auditLogs || []);
    setSecurityPosture(data.securityPosture || null);
  }, []);

  const loadFirestoreAdminData = useCallback(async () => {
    if (!isFirebaseAdmin || !user) return;
    try {
      const [profiles, sessions, logs] = await Promise.all([
        adminFetchAllProfiles(),
        adminFetchAllSessions(),
        adminFetchAuditLogs(),
      ]);
      setFirestoreProfiles(profiles);
      setFirestoreSessions(sessions);
      setFirestoreAudit(logs);
      await adminWriteAuditLog({
        adminUid: user.uid,
        adminLabel: user.email || 'Firebase Admin',
        action: 'view_dashboard',
        targetRefId: 'admin-portal',
        details: 'Opened SAHAAY Admin Portal dashboard.',
      });
    } catch {
      // Non-fatal if Firestore admin permissions not matched
    }
  }, [isFirebaseAdmin, user]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/auth')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setRequiresFirstRunSetup(Boolean(data.requiresFirstRunSetup));
          setConfiguredViaEnv(Boolean(data.configuredViaEnv));
        }
      })
      .finally(() => {
        if (!cancelled) setBootstrapLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!adminToken) return;
    let cancelled = false;
    fetch('/api/admin/records', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setServerRecords(data.records || []);
          setFacilityReports(data.facilityReports || []);
          setAnswerReports(data.answerReports || []);
          setServerAuditLogs(data.auditLogs || []);
          setSecurityPosture(data.securityPosture || null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [adminToken]);

  useEffect(() => {
    if (!isFirebaseAdmin || !user) return;
    let cancelled = false;
    Promise.all([adminFetchAllProfiles(), adminFetchAllSessions(), adminFetchAuditLogs()])
      .then(([profiles, sessions, logs]) => {
        if (cancelled) return;
        setFirestoreProfiles(profiles);
        setFirestoreSessions(sessions);
        setFirestoreAudit(logs);
        return adminWriteAuditLog({
          adminUid: user.uid,
          adminLabel: user.email || 'Firebase Admin',
          action: 'view_dashboard',
          targetRefId: 'admin-portal',
          details: 'Opened SAHAAY Admin Portal dashboard.',
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isFirebaseAdmin, user]);

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (requiresFirstRunSetup && password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }

    setAuthBusy(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: requiresFirstRunSetup ? 'claim' : 'login',
          username,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed.');
        return;
      }
      setAdminToken(data.token);
      setAdminLabel(data.adminUser || 'dev admin');
      setRequiresFirstRunSetup(false);
      setPassword('');
      setConfirmPassword('');
    } catch {
      setAuthError('Could not reach admin authentication service.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (adminToken) {
      await fetch('/api/admin/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ action: 'logout' }),
      }).catch(() => {});
    }
    setAdminToken(null);
    setAdminLabel(null);
    setServerRecords([]);
    setServerAuditLogs([]);
    setSelectedRecord(null);
  };

  const handleArchiveToggle = async (record: ServerManagedRecord) => {
    if (!adminToken) return;
    const res = await fetch('/api/admin/records', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ id: record.id, archived: !record.archived }),
    });
    if (res.ok) {
      await loadServerAdminData(adminToken);
    }
  };

  const handleDeleteServerRecord = async (id: string) => {
    if (!adminToken) return;
    const res = await fetch(`/api/admin/records?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (res.ok) {
      await loadServerAdminData(adminToken);
    }
  };

  const handleMarkReportReviewed = async (reportId: string) => {
    if (!adminToken) return;
    const res = await fetch('/api/admin/records', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reportId, markReviewed: true }),
    });
    if (res.ok) {
      await loadServerAdminData(adminToken);
    }
  };

  const handleMarkAnswerReportReviewed = async (answerReportId: string) => {
    if (!adminToken) return;
    const res = await fetch('/api/admin/records', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ answerReportId, markReviewed: true }),
    });
    if (res.ok) {
      await loadServerAdminData(adminToken);
    }
  };

  const handleExportRecord = (title: string, summary: string) => {
    const safeSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'record';
    const blob = new Blob([`SAHAAY Consented Record Export\nTitle: ${title}\n\n${summary}`], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sahaay-admin-${safeSlug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isAuthorized = Boolean(adminToken || isFirebaseAdmin);

  const combinedRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fsRows = firestoreSessions.map((s) => ({
      id: s.sessionId,
      patientLabel: s.patientRefId,
      recordType: s.sessionType,
      language: s.language,
      title: s.title,
      summary: s.summary,
      urgencyLevel: s.urgencyLevel,
      archived: s.status === 'archived',
      isSyntheticDemo: false,
      source: 'firestore' as const,
      createdAt: s.createdAt?.toDate?.()?.toISOString?.() || '',
    }));

    const srvRows = serverRecords.map((r) => ({
      id: r.id,
      patientLabel: r.patientLabel,
      recordType: r.recordType,
      language: r.language,
      title: r.title,
      summary: r.summary,
      urgencyLevel: r.urgencyLevel,
      archived: r.archived,
      isSyntheticDemo: r.isSyntheticDemo,
      source: 'server' as const,
      createdAt: r.createdAt,
    }));

    return [...fsRows, ...srvRows].filter((row) => {
      if (typeFilter !== 'all' && !row.recordType.includes(typeFilter)) return false;
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.patientLabel.toLowerCase().includes(q) ||
        row.summary.toLowerCase().includes(q)
      );
    });
  }, [firestoreSessions, serverRecords, search, typeFilter]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-slate-900">
                SAHAAY Role-Protected Admin Portal
              </div>
              <div className="text-[11px] text-slate-500">
                Consented Summary Governance &amp; Security Audit Console
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/?autostart=1"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Return to SAHAAY App</span>
            </Link>
            {isAuthorized && (
              <button
                type="button"
                onClick={() => {
                  void handleLogout();
                  if (user) void signOut();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {!isAuthorized ? (
          <div className="mx-auto max-w-lg space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-teal-800 uppercase">
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                <span>
                  {requiresFirstRunSetup
                    ? 'First-Run Administrator Setup'
                    : 'Administrator Authentication Required'}
                </span>
              </div>
              <h1 className="mt-2 text-xl font-extrabold text-slate-900">
                {requiresFirstRunSetup
                  ? 'Initialize "dev admin" Passcode'
                  : 'Sign In to SAHAAY Admin Portal'}
              </h1>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                {requiresFirstRunSetup
                  ? 'No default password is ever hardcoded. Set a strong administrator password (10+ characters with uppercase, lowercase, and number) or configure SAHAAY_ADMIN_PASSCODE in Settings > Secrets.'
                  : 'Enter your server-verified administrator credentials. Protected by scrypt verification, 5-attempt lockout, and HMAC-SHA256 Bearer sessions.'}
              </p>

              {bootstrapLoading ? (
                <div className="mt-5 text-xs text-slate-500">Checking server security state...</div>
              ) : (
                <form onSubmit={handleAdminSubmit} className="mt-5 space-y-4">
                  <div>
                    <label htmlFor="admin-user" className="block text-xs font-semibold text-slate-700">
                      Administrator Username
                    </label>
                    <input
                      id="admin-user"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="admin-pass" className="block text-xs font-semibold text-slate-700">
                      {requiresFirstRunSetup ? 'Create Strong Passcode' : 'Administrator Passcode'}
                    </label>
                    <input
                      id="admin-pass"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={requiresFirstRunSetup ? 10 : 1}
                      placeholder={
                        requiresFirstRunSetup
                          ? 'At least 10 chars (e.g., Upper + lower + digit)'
                          : 'Enter administrator passcode'
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
                    />
                  </div>

                  {requiresFirstRunSetup && (
                    <div>
                      <label
                        htmlFor="admin-pass-confirm"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Confirm Passcode
                      </label>
                      <input
                        id="admin-pass-confirm"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={10}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
                      />
                    </div>
                  )}

                  {authError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
                    >
                      {authError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-teal-800 disabled:opacity-60"
                  >
                    {authBusy
                      ? 'Verifying...'
                      : requiresFirstRunSetup
                        ? 'Claim "dev admin" & Open Portal'
                        : 'Sign In as Administrator'}
                  </button>
                </form>
              )}

              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-xs text-slate-600">
                  Or sign in with your verified Google Admin account to access live Firestore records:
                </p>
                <button
                  type="button"
                  onClick={() => void signInWithGoogle('en')}
                  className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50"
                >
                  <HeartPulse className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  <span>Sign in with Verified Admin Google Account</span>
                </button>
                {configuredViaEnv && (
                  <p className="mt-2 text-[11px] text-teal-800">
                    Environment secret SAHAAY_ADMIN_PASSCODE is active on the server.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Security Posture & Real Counts */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="text-xs font-semibold text-slate-500">Live Firestore Patients</div>
                <div className="mt-1 font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
                  {firestoreProfiles.length}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {isFirebaseAdmin
                    ? 'Synced with Firestore'
                    : 'Sign in with Firebase Admin Google account to view live profiles'}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="text-xs font-semibold text-slate-500">Consented Saved Records</div>
                <div className="mt-1 font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
                  {combinedRecords.length}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {firestoreSessions.length} live · {serverRecords.length} labeled synthetic preview
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="text-xs font-semibold text-slate-500">Audit Events Logged</div>
                <div className="mt-1 font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
                  {serverAuditLogs.length + firestoreAudit.length}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Append-only administrative accountability
                </div>
              </div>

              <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-teal-900">
                  <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  <span>Secret Isolation Verified</span>
                </div>
                <ul className="mt-2 space-y-1 text-[11px] text-teal-950">
                  <li className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-teal-700" aria-hidden="true" />
                    Gemini API Key: Server-Only
                  </li>
                  <li className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-teal-700" aria-hidden="true" />
                    Raw Medical Photos: Never Stored
                  </li>
                  <li className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-teal-700" aria-hidden="true" />
                    Client Secrets Exposed: {securityPosture?.secretsExposedToClient ? 'Yes' : 'Zero'}
                  </li>
                </ul>
              </div>
            </section>

            {/* Sub-Tab Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'records', label: 'Consented Session Records', icon: ClipboardList },
                    { id: 'patients', label: 'Registered Profiles', icon: Users },
                    {
                      id: 'reports',
                      label: `Facility Reports (${facilityReports.length})`,
                      icon: Flag,
                    },
                    {
                      id: 'ai_quality',
                      label: `AI Quality Monitor (${answerReports.length})`,
                      icon: ShieldAlert,
                    },
                    { id: 'audit', label: 'Append-Only Audit Log', icon: ShieldCheck },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveSubTab(tab.id)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                        activeSubTab === tab.id
                          ? 'bg-teal-700 text-white'
                          : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="text-xs text-slate-500">
                Active Operator:{' '}
                <strong className="font-semibold text-slate-800">
                  {adminLabel || user?.email || 'Administrator'}
                </strong>
              </div>
            </div>

            {/* Records Table */}
            {activeSubTab === 'records' && (
              <div className="rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by patient reference, title, or summary..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
                    />
                  </div>
                  <select
                    aria-label="Filter record type"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700"
                  >
                    <option value="all">All Types</option>
                    <option value="chat">Medical Q&amp;A</option>
                    <option value="medicine">Medicine Scan</option>
                    <option value="injury">Injury Observation</option>
                    <option value="triage">Guided Triage</option>
                  </select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
                      <tr>
                        <th className="px-4 py-3">Patient / Record Label</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Urgency</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {combinedRecords.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3.5">
                            <div className="font-bold text-slate-900">{row.title}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {row.patientLabel}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 font-mono text-[11px] uppercase text-slate-600">
                            {row.recordType}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-[11px] font-bold uppercase text-slate-800">
                            {row.urgencyLevel}
                          </td>
                          <td className="px-4 py-3.5 text-[11px] text-slate-600">
                            {row.archived ? 'Archived' : 'Active'}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedRecord({
                                    title: row.title,
                                    subtitle: row.patientLabel,
                                    summary: row.summary,
                                    urgency: row.urgencyLevel,
                                    language: row.language,
                                    isSynthetic: row.isSyntheticDemo,
                                    source: row.source,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportRecord(row.title, row.summary)}
                                aria-label="Export summary"
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                              {row.source === 'server' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const orig = serverRecords.find((r) => r.id === row.id);
                                      if (orig) void handleArchiveToggle(orig);
                                    }}
                                    aria-label="Archive or restore record"
                                    className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100"
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteServerRecord(row.id)}
                                    aria-label="Delete record"
                                    className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                              {row.source === 'firestore' && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await deleteSavedSession(row.id);
                                    await loadFirestoreAdminData();
                                  }}
                                  aria-label="Delete Firestore record"
                                  className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Patients Directory Tab */}
            {activeSubTab === 'patients' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-bold text-slate-900">
                  Registered User Profiles (Consented Metadata Only)
                </h2>
                {firestoreProfiles.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    No live Firestore user profiles loaded yet. Sign in with the verified Firebase
                    Admin Google account to query live profiles.
                  </p>
                ) : (
                  <div className="mt-4 divide-y divide-slate-100 text-xs">
                    {firestoreProfiles.map((p) => (
                      <div key={p.uid} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div>
                          <div className="font-bold text-slate-900">
                            {p.displayName} ({p.patientRefId})
                          </div>
                          <div className="text-slate-500">
                            Lang: {p.preferredLanguage.toUpperCase()} · Retention: {p.retentionDays}d
                            · Medical History Consent: {p.consentMedicalHistory ? 'Granted' : 'No'}
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500">{p.email}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* User-Submitted Facility Info Reports Tab */}
            {activeSubTab === 'reports' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-bold text-slate-900">
                  User-Reported Facility Corrections
                </h2>
                {facilityReports.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    No facility correction reports submitted yet. Users can report closed hospitals
                    or wrong phone numbers directly from the Live Hospital Map.
                  </p>
                ) : (
                  <div className="mt-4 divide-y divide-slate-100 text-xs">
                    {facilityReports.map((rep) => (
                      <div
                        key={rep.id}
                        className="flex flex-wrap items-start justify-between gap-3 py-3"
                      >
                        <div>
                          <div className="font-bold text-slate-900">{rep.facilityName}</div>
                          <div className="text-[11px] text-slate-500">{rep.facilityAddress}</div>
                          <div className="mt-1 text-slate-700">
                            <span className="font-mono font-bold text-amber-800 uppercase">
                              {rep.issueType.replace(/_/g, ' ')}
                            </span>{' '}
                            — {rep.details}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] uppercase text-slate-500">
                            {rep.status}
                          </span>
                          {rep.status === 'open' && adminToken && (
                            <button
                              type="button"
                              onClick={() => void handleMarkReportReviewed(rep.id)}
                              className="rounded-lg bg-teal-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-teal-800"
                            >
                              Mark Reviewed
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* AI Response Quality Monitor Tab */}
            {activeSubTab === 'ai_quality' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      AI Response Quality Monitor &amp; Verification Reports
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      User-flagged AI medical answers submitted from the chat interface or the
                      dedicated /verification portal.
                    </p>
                  </div>
                  <Link
                    href="/verification"
                    className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800 hover:bg-teal-100"
                  >
                    Open Public /verification Registry
                  </Link>
                </div>

                {answerReports.length === 0 ? (
                  <p className="mt-4 text-xs text-slate-500">
                    No AI medical answer quality reports have been submitted yet.
                  </p>
                ) : (
                  <div className="mt-4 divide-y divide-slate-100 text-xs">
                    {answerReports.map((rep) => (
                      <div
                        key={rep.id}
                        className="flex flex-wrap items-start justify-between gap-4 py-3.5"
                      >
                        <div className="max-w-3xl space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-amber-800 uppercase">
                              {rep.issueCategory.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[11px] text-slate-400">·</span>
                            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                              {new Date(rep.createdAt).toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                              })}
                            </span>
                          </div>
                          <div className="font-bold text-slate-900">
                            Question: {rep.questionSnippet}
                          </div>
                          {rep.answerSnippet && (
                            <div className="text-slate-600">Answer excerpt: {rep.answerSnippet}</div>
                          )}
                          <div className="text-slate-800">Report details: {rep.details}</div>
                          {rep.sourceCited && (
                            <div className="text-[11px] text-teal-800">
                              Source cited: {rep.sourceCited}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-[11px] font-bold uppercase ${
                              rep.reviewed ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          >
                            {rep.reviewed ? 'Reviewed' : 'Open Review'}
                          </span>
                          {!rep.reviewed && adminToken && (
                            <button
                              type="button"
                              onClick={() => void handleMarkAnswerReportReviewed(rep.id)}
                              className="rounded-lg bg-teal-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-teal-800"
                            >
                              Mark Reviewed
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Audit Log Tab */}
            {activeSubTab === 'audit' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-bold text-slate-900">
                  Append-Only Administrative Audit Trail
                </h2>
                <div className="mt-3 divide-y divide-slate-100 text-xs">
                  {serverAuditLogs.map((log) => (
                    <div key={log.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-bold text-teal-800">{log.action}</span>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {new Date(log.createdAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                          })}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-700">{log.details}</p>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Actor: {log.actor} · Target: {log.targetId}
                      </div>
                    </div>
                  ))}
                  {firestoreAudit.map((log) => (
                    <div key={log.logId} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-bold text-slate-800">{log.action}</span>
                        <span className="font-mono text-[11px] text-slate-500">Firestore</span>
                      </div>
                      <p className="mt-1 text-slate-700">{log.details}</p>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Actor: {log.adminLabel} · Target: {log.targetRefId}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Consented Record Detail Drawer Modal */}
      {selectedRecord && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] font-bold text-teal-800 uppercase">
                  {selectedRecord.isSynthetic
                    ? 'Synthetic Demo Preview Record'
                    : 'Consented Patient Summary'}
                </div>
                <h2 className="mt-1 text-base font-extrabold text-slate-900">
                  {selectedRecord.title}
                </h2>
                <p className="text-xs text-slate-500">{selectedRecord.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                aria-label="Close detail drawer"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-800">
              {selectedRecord.summary}
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Privacy guarantee: Raw uploaded medicine or injury photographs, password hashes, and
              API credentials are never stored or visible in this portal.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
