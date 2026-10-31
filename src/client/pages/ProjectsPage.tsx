import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FolderKanban, Plus, Search } from 'lucide-react';
import type { ProjectStatus, ProjectSummaryDto } from '@shared/types';
import { PageHeader } from '../components/shell';
import {
  BandPill,
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
  useToast,
} from '../components/ui';
import { api, ApiError, type ProjectInput } from '../lib/api';
import { BAND_LABELS, EVENT_LABELS, STATUS_LABELS, dateShort, money, percent, today } from '../lib/format';

const STATUS_OPTIONS: ProjectStatus[] = [
  'draft',
  'quoted',
  'approved',
  'in_production',
  'completed',
  'cancelled',
];

export function ProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [projects, setProjects] = useState<ProjectSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { projects: rows } = await api.projects.list(status ? { status } : {});
      setProjects(rows);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load projects');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  // The dashboard links here with ?new=1 to open the form straight away.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreating(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return projects ?? [];
    return (projects ?? []).filter((project) =>
      [project.name, project.clientName, project.reference].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [projects, search]);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Every production, its margin and what is still owed."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            className="pl-9"
            aria-label="Search projects"
          />
        </div>
        <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-auto min-w-40" aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {STATUS_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      {error ? (
        <Card className="mb-3 border-danger/30 bg-danger-soft px-4 py-3 text-xs text-danger">{error}</Card>
      ) : null}

      <Card className="overflow-hidden">
        {projects === null ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<FolderKanban className="size-5" aria-hidden />}
            title={projects.length === 0 ? 'No projects yet' : 'Nothing matches that search'}
            description={
              projects.length === 0
                ? 'Create a project, add its cost lines, and ProductionDesk works out the margin.'
                : 'Try a different name, client or reference.'
            }
            action={
              projects.length === 0 ? (
                <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
                  New project
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-line text-[10px] tracking-wide text-faint uppercase">
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Margin</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                  <th className="px-5 py-2.5 font-medium">Event</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((project) => (
                  <tr key={project.id} className="border-b border-line/60 transition-colors hover:bg-raised">
                    <td className="px-5 py-3">
                      <Link to={`/projects/${project.id}`} className="block">
                        <span className="block text-[13px] font-medium text-ink">{project.name}</span>
                        <span className="block text-[11px] text-faint">
                          {project.reference} · {EVENT_LABELS[project.eventType] ?? project.eventType}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-muted">{project.clientName}</td>
                    <td className="px-3 py-3">
                      <StatusPill status={project.status} label={STATUS_LABELS[project.status] ?? project.status} />
                    </td>
                    <td className="px-3 py-3">
                      <BandPill band={project.band} label={BAND_LABELS[project.band] ?? project.band} />
                    </td>
                    <td className="tabular px-3 py-3 text-right text-[13px] text-ink">
                      {money(project.sellingPriceNetKobo)}
                      <span className="ml-1 text-[10px] text-faint">{percent(project.estimatedMarginBp)}</span>
                    </td>
                    <td className="tabular px-3 py-3 text-right text-[13px] text-muted">{money(project.balanceKobo)}</td>
                    <td className="px-5 py-3 text-[12px] text-muted">{dateShort(project.eventDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewProjectDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id, name) => {
          toast(`${name} created`);
          setCreating(false);
          navigate(`/projects/${id}`);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  name: '',
  clientName: '',
  clientContact: '',
  clientEmail: '',
  eventType: 'corporate',
  location: '',
  eventDate: today(),
  productionDays: '1',
  description: '',
  targetMarginPreset: 'midrange',
};

function NewProjectDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    const payload: ProjectInput = {
      name: form.name.trim(),
      clientName: form.clientName.trim(),
      clientContact: form.clientContact.trim(),
      clientEmail: form.clientEmail.trim(),
      eventType: form.eventType,
      location: form.location.trim(),
      eventDate: form.eventDate || null,
      productionDays: Number(form.productionDays) || 1,
      description: form.description.trim(),
      targetMarginPreset: form.targetMarginPreset as ProjectInput['targetMarginPreset'],
    };

    try {
      const detail = await api.projects.create(payload);
      setForm(EMPTY_FORM);
      onCreated(detail.project.id, detail.project.name);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFields(caught.fields);
      } else {
        setError('Could not create the project');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New project"
      description="The essentials first — costs come next."
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="new-project-form" type="submit" loading={busy}>
            Create project
          </Button>
        </div>
      }
    >
      <form id="new-project-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Project name" error={fields.name} htmlFor="p-name">
          <Input
            id="p-name"
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="Annual Leadership Summit"
            required
            invalid={Boolean(fields.name)}
          />
        </Field>

        <Field label="Client" error={fields.clientName} htmlFor="p-client">
          <Input
            id="p-client"
            value={form.clientName}
            onChange={(event) => set('clientName', event.target.value)}
            placeholder="Acme Holdings"
            required
            invalid={Boolean(fields.clientName)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact name" htmlFor="p-contact">
            <Input
              id="p-contact"
              value={form.clientContact}
              onChange={(event) => set('clientContact', event.target.value)}
              placeholder="Chidi"
            />
          </Field>
          <Field label="Contact email" htmlFor="p-email">
            <Input
              id="p-email"
              type="email"
              value={form.clientEmail}
              onChange={(event) => set('clientEmail', event.target.value)}
              placeholder="chidi@acme.com"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Event type" htmlFor="p-type">
            <Select id="p-type" value={form.eventType} onChange={(event) => set('eventType', event.target.value)}>
              {Object.entries(EVENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Event date" error={fields.eventDate} htmlFor="p-date">
            <Input
              id="p-date"
              type="date"
              min="2000-01-01"
              value={form.eventDate}
              onChange={(event) => set('eventDate', event.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Location" htmlFor="p-location">
            <Input
              id="p-location"
              value={form.location}
              onChange={(event) => set('location', event.target.value)}
              placeholder="Lagos"
            />
          </Field>
          <Field label="Production days" error={fields.productionDays} htmlFor="p-days">
            <Input
              id="p-days"
              type="number"
              min={1}
              max={365}
              value={form.productionDays}
              onChange={(event) => set('productionDays', event.target.value)}
            />
          </Field>
        </div>

        <Field label="Margin target" hint="Used to recommend a selling price." htmlFor="p-margin">
          <Select
            id="p-margin"
            value={form.targetMarginPreset}
            onChange={(event) => set('targetMarginPreset', event.target.value)}
          >
            <option value="budget">Budget</option>
            <option value="midrange">Mid-range</option>
            <option value="premium">Premium</option>
          </Select>
        </Field>

        <Field label="Brief" hint="Optional — what the client is asking for." htmlFor="p-brief">
          <Textarea
            id="p-brief"
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            placeholder="Two-day hybrid conference, main hall plus breakout rooms…"
          />
        </Field>

        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">{error}</p>
        ) : null}
      </form>
    </Drawer>
  );
}
