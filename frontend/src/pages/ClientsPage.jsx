import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { Avatar, BurnBar, BurnRing, ProjectKindChip, StateChip } from '../lib/ui';

function ClientCard({ client }) {
  const projectCount = client.projects.length;
  // Worst-burning project drives the ring on the card (wireframe 1c)
  const worst = client.projects
    .filter((p) => p.burnPct != null)
    .sort((a, b) => b.burnPct - a.burnPct)[0];
  return (
    <Link to={`/clients/${client.id}`} className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
      <Avatar name={client.name} size="lg" sub={client.isInternal} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-purple-darkest truncate">{client.name}</div>
        <div className="text-xs text-text-muted">
          {projectCount} {projectCount === 1 ? 'project' : 'projects'} · {client.openTasks} open {client.openTasks === 1 ? 'task' : 'tasks'}
        </div>
      </div>
      {worst ? (
        <BurnRing pct={worst.burnPct} state={worst.burnState} size={40} label={`${worst.burnPct}`} />
      ) : (
        <span className="text-text-muted">›</span>
      )}
    </Link>
  );
}

function ClientsIndex({ clients, loading }) {
  const external = clients.filter((c) => !c.isInternal);
  const internal = clients.filter((c) => c.isInternal);
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">Clients</h1>
        <Link to="/settings/clients" className="btn-secondary">Manage clients</Link>
      </div>
      {loading ? (
        <div className="text-text-muted text-sm">Loading…</div>
      ) : (
        <div className="max-w-2xl space-y-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Active</h2>
            <div className="space-y-3">
              {external.map((c) => <ClientCard key={c.id} client={c} />)}
              {external.length === 0 && (
                <div className="card p-8 text-center text-text-muted">
                  No clients yet. <Link to="/settings/clients" className="text-purple-mid underline">Add your first client</Link>
                </div>
              )}
            </div>
          </div>
          {internal.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Internal</h2>
              <div className="space-y-3">
                {internal.map((c) => <ClientCard key={c.id} client={c} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClientDetail({ client }) {
  if (!client) return <div className="text-text-muted text-sm">Loading…</div>;
  return (
    <div>
      <Link to="/clients" className="text-sm font-semibold text-purple-mid hover:underline">‹ Clients</Link>
      <div className="flex items-center gap-3 mt-3 mb-1">
        <Avatar name={client.name} size="lg" sub={client.isInternal} />
        <div>
          <h1 className="page-title">{client.name}</h1>
          <div className="text-xs text-text-muted">
            {client.isInternal
              ? 'Internal — non-client work lives here'
              : client.contacts?.length
                ? `From HubSpot · ${client.contacts.map((ct) => ct.name).join(', ')}`
                : 'From HubSpot · no contacts yet'}
          </div>
        </div>
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted mt-6 mb-2">Projects</h2>
      <div className="max-w-2xl space-y-3">
        {client.projects.map((p) => (
          <Link
            key={p.id}
            to={`/clients/${client.id}/projects/${p.id}`}
            className="card p-4 flex flex-col gap-2 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-purple-darkest truncate">{p.name}</span>
                <ProjectKindChip isRetainer={p.isRetainer} />
              </div>
              {p.budgetHours ? <StateChip state={p.burnState} /> : null}
            </div>
            {p.budgetHours ? (
              <>
                <div className="text-xs text-text-muted">Forecast burn</div>
                <div className="flex items-center gap-3">
                  <BurnBar logged={p.loggedHours} forecast={p.budgetHours} state={p.burnState} className="flex-1" />
                  <span className="text-xs text-text-muted whitespace-nowrap">{p.loggedHours} / {p.budgetHours}h</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-text-muted">{p.loggedHours}h logged{p.isRetainer ? ' · retainer' : ' · no forecast set'}</div>
            )}
            <div className="flex gap-2">
              <span className="badge bg-bg-light text-text-muted border border-border">{p.openTasks} {p.openTasks === 1 ? 'task' : 'tasks'}</span>
              {p.sowNumber && <span className="badge bg-bg-light text-text-muted border border-border">{p.sowNumber}</span>}
            </div>
          </Link>
        ))}
        {client.projects.length === 0 && (
          <div className="card p-8 text-center text-text-muted">
            No active projects. <Link to="/projects" className="text-purple-mid underline">Create one</Link>
          </div>
        )}
        <div className="text-right">
          <Link to="/projects" className="text-xs text-purple-mid hover:underline">Manage projects →</Link>
        </div>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const { clientId } = useParams();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/clients', { params: { include: 'projects' } })
      .then((r) => setClients(r.data))
      .finally(() => setLoading(false));
  }, [clientId]);

  if (clientId) {
    return <ClientDetail client={clients.find((c) => c.id === clientId)} />;
  }
  return <ClientsIndex clients={clients} loading={loading} />;
}
