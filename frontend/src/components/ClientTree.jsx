import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { Avatar } from '../lib/ui';

// Desktop client → project tree (wireframe 2a middle column).
// Expanded in place; current project highlighted with an inset accent bar.
export default function ClientTree() {
  const { clientId, projectId } = useParams();
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState({});

  useEffect(() => {
    api.get('/clients', { params: { include: 'projects' } }).then((r) => {
      setClients(r.data);
      if (clientId) setOpen((o) => ({ ...o, [clientId]: true }));
    });
  }, [clientId]);

  return (
    <div className="card p-3 flex flex-col gap-0.5 sticky top-4">
      <div className="flex items-center justify-between px-2 pb-2 border-b border-border mb-1">
        <Link to="/clients" className="font-semibold text-purple-darkest hover:underline">Clients</Link>
        <Link to="/settings/clients" className="text-xs text-purple-mid hover:underline">Manage</Link>
      </div>
      {clients.map((c) => (
        <div key={c.id}>
          <button
            onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
              c.id === clientId && !projectId ? 'bg-bg-light' : 'hover:bg-bg-page'
            }`}
          >
            <Avatar name={c.name} size="sm" sub={c.isInternal} />
            <span className="flex-1 text-sm font-semibold text-text-body truncate">{c.name}</span>
            <span className="text-xs text-text-muted">{open[c.id] ? '▾' : '›'}</span>
          </button>
          {open[c.id] &&
            c.projects.map((p) => (
              <Link
                key={p.id}
                to={`/clients/${c.id}/projects/${p.id}`}
                className={`flex items-center justify-between gap-2 py-1.5 pl-9 pr-2 rounded-lg text-sm transition-colors ${
                  p.id === projectId
                    ? 'bg-white shadow-[inset_2px_0_0_#5c2680] font-semibold text-purple-darkest'
                    : 'text-text-muted hover:bg-bg-page'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.isRetainer ? 'bg-olive' : 'bg-purple-dark'}`} />
                  <span className="truncate">{p.name}</span>
                </span>
                {p.burnPct != null && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      p.burnState === 'ok' ? 'bg-olive/10 text-olive' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {p.burnPct}%
                  </span>
                )}
              </Link>
            ))}
          {open[c.id] && c.projects.length === 0 && (
            <div className="pl-9 pr-2 py-1 text-xs text-text-muted">No active projects</div>
          )}
        </div>
      ))}
    </div>
  );
}
