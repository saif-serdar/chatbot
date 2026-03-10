import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

interface Agent {
  id: string;
  name: string;
  email: string;
  bitrixUserId: string | null;
  chatappUserId: string | null;
}

interface EditState {
  bitrixUserId: string;
  chatappUserId: string;
}

interface NewAgent {
  bitrixUserId: string;
  password: string;
}

interface BitrixUser {
  id: string;
  name: string;
  email: string;
}

const apiClient = axios.create({ baseURL: '/api' });
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('adminToken');
      window.location.href = '/admin';
    }
    return Promise.reject(err);
  }
);

export function AgentMappingPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Bitrix24 user list for dropdowns
  const [bitrixUsers, setBitrixUsers] = useState<BitrixUser[]>([]);
  const [loadingBitrixUsers, setLoadingBitrixUsers] = useState(false);

  // Add agent modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAgent, setNewAgent] = useState<NewAgent>({ bitrixUserId: '', password: '' });
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('adminToken')) {
      navigate('/admin');
      return;
    }
    fetchAgents();
    fetchBitrixUsers();
  }, []);

  function isRealId(val: string | null): boolean {
    return !!val && /^\d+$/.test(val.trim());
  }

  async function fetchAgents() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/agents');
      setAgents(res.data.agents);
      const state: Record<string, EditState> = {};
      res.data.agents.forEach((a: Agent) => {
        state[a.id] = {
          bitrixUserId: isRealId(a.bitrixUserId) ? a.bitrixUserId! : '',
          chatappUserId: isRealId(a.chatappUserId) ? a.chatappUserId! : '',
        };
      });
      setEdits(state);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }

  async function fetchBitrixUsers() {
    setLoadingBitrixUsers(true);
    try {
      const res = await apiClient.get('/admin/bitrix-users');
      setBitrixUsers(res.data.users);
    } catch {
      // Non-fatal — dropdowns will just be empty, admin can retry via Sync
    } finally {
      setLoadingBitrixUsers(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = agents.map((a) => ({
        id: a.id,
        bitrixUserId: edits[a.id]?.bitrixUserId || null,
        chatappUserId: edits[a.id]?.chatappUserId || null,
      }));
      await apiClient.post('/admin/agents/save', { agents: payload });
      setSuccess('Saved successfully! Names updated from Bitrix24.');
      fetchAgents();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiClient.post('/admin/sync');
      const { synced, total, errors } = res.data;
      if (synced > 0) {
        setSuccess(`Synced ${synced} of ${total} agent(s) from Bitrix24.`);
      } else if (errors?.length) {
        setError(`Sync failed — ${errors.join(' | ')}`);
      } else if (total === 0) {
        setError('No agents with numeric Bitrix ID found.');
      } else {
        setError(`Found ${total} agent(s) with Bitrix ID but Bitrix24 returned no data. Check if the ID is correct.`);
      }
      fetchAgents();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(agentId: string, label: string) {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    try {
      await apiClient.delete(`/admin/agents/${agentId}`);
      fetchAgents();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete agent');
    }
  }

  async function handleAddAgent(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await apiClient.post('/admin/agents/create', newAgent);
      setShowAddModal(false);
      setNewAgent({ bitrixUserId: '', password: '' });
      setSuccess('Agent created successfully.');
      fetchAgents();
    } catch (err: any) {
      setAddError(err.response?.data?.error || 'Failed to create agent');
    } finally {
      setAdding(false);
    }
  }

  function closeModal() {
    setShowAddModal(false);
    setNewAgent({ bitrixUserId: '', password: '' });
    setAddError(null);
  }

  function update(agentId: string, field: keyof EditState, value: string) {
    setEdits((prev) => ({ ...prev, [agentId]: { ...prev[agentId], [field]: value } }));
    setSuccess(null);
  }

  function handleLogout() {
    localStorage.removeItem('adminToken');
    navigate('/admin');
  }

  // IDs already assigned to other agents (used to filter dropdown options)
  function takenBitrixIds(excludeAgentId?: string): Set<string> {
    return new Set(
      agents
        .filter((a) => a.id !== excludeAgentId)
        .map((a) => edits[a.id]?.bitrixUserId)
        .filter(Boolean) as string[]
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Agent Settings</h1>
            <p className="text-sm text-gray-500">Admin Panel — Map Bitrix24 and ChatApp IDs</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Agent
            </button>
            <button
              onClick={handleSync}
              disabled={syncing || loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {syncing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Syncing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Sync User Details
                </>
              )}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-5 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
            {success}
          </div>
        )}

        <div className="mb-5 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
          <p><strong>ChatApp Responsible ID:</strong> Open ChatApp → go to <strong>Settings → Employees</strong> → the number shown next to each employee's name.</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-20 text-gray-500">No agents found. Use "Add Agent" to create one.</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="grid grid-cols-[1.5fr_1.5fr_1fr_auto] bg-gray-50 border-b border-gray-200 px-6 py-3 gap-4">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bitrix24 User</span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ChatApp Responsible ID</span>
              <span />
            </div>

            <div className="divide-y divide-gray-100">
              {agents.map((agent) => {
                const taken = takenBitrixIds(agent.id);
                const currentBitrixId = edits[agent.id]?.bitrixUserId || '';
                return (
                  <div key={agent.id} className="grid grid-cols-[1.5fr_1.5fr_1fr_auto] gap-4 items-center px-6 py-4">
                    <div>
                      <p className="font-medium text-gray-900">
                        {isRealId(agent.bitrixUserId) ? agent.name : 'Unknown'}
                      </p>
                      <p className="text-sm text-gray-500">{agent.email}</p>
                    </div>

                    <div>
                      <select
                        value={currentBitrixId}
                        onChange={(e) => update(agent.id, 'bitrixUserId', e.target.value)}
                        disabled={loadingBitrixUsers}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white disabled:opacity-50"
                      >
                        <option value="">— Select user —</option>
                        {bitrixUsers
                          .filter((u) => u.id === currentBitrixId || !taken.has(u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}{u.email ? ` (${u.email})` : ''}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div>
                      <input
                        type="text"
                        placeholder="e.g. 90098"
                        value={edits[agent.id]?.chatappUserId || ''}
                        onChange={(e) => update(agent.id, 'chatappUserId', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <button
                      onClick={() => handleDelete(agent.id, isRealId(agent.bitrixUserId) ? agent.name : agent.email)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete agent"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Add Agent Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">Add Agent</h2>
              <button
                onClick={closeModal}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-500 -mt-3 mb-4">
              Name and email will be fetched automatically from Bitrix24.
            </p>

            <form onSubmit={handleAddAgent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bitrix24 User</label>
                <select
                  required
                  value={newAgent.bitrixUserId}
                  onChange={(e) => setNewAgent((p) => ({ ...p, bitrixUserId: e.target.value }))}
                  disabled={loadingBitrixUsers}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white disabled:opacity-50"
                >
                  <option value="">
                    {loadingBitrixUsers ? 'Loading users…' : '— Select user —'}
                  </option>
                  {bitrixUsers
                    .filter((u) => !agents.some((a) => a.bitrixUserId === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.email ? ` (${u.email})` : ''}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={newAgent.password}
                  onChange={(e) => setNewAgent((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Set a login password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {addError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                  {addError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding || !newAgent.bitrixUserId}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {adding ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Creating…
                    </>
                  ) : 'Create Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
