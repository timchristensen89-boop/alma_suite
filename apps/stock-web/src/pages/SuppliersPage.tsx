import { useEffect, useMemo, useState } from 'react';
import type { Supplier, SuppliersPayload } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Spinner, StatCard } from '@alma/ui';
import { IconSuppliers } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';
import { SupplierForm } from '../features/suppliers/SupplierForm';

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; supplier: Supplier };

export function SuppliersPage() {
  useDocumentTitle('Suppliers');
  const { user } = useAuth();
  const canManage = canManageStock(user);
  const [data, setData] = useState<SuppliersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSuppliers() {
      try {
        const payload = await api<SuppliersPayload>('/api/suppliers');
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Could not load suppliers';
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSuppliers();

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const suppliers = data?.suppliers ?? [];
    return {
      total: suppliers.length,
      active: suppliers.filter((s) => s.status === 'ACTIVE').length,
      archived: suppliers.filter((s) => s.status === 'ARCHIVED').length
    };
  }, [data]);

  function handleSupplierCreated(supplier: Supplier) {
    setData((current) => {
      const existing = current ?? { suppliers: [] };
      const next = [...existing.suppliers, supplier].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      return { suppliers: next };
    });
    setForm({ mode: 'closed' });
  }

  function handleSupplierUpdated(supplier: Supplier) {
    setData((current) => {
      const existing = current ?? { suppliers: [] };
      const next = existing.suppliers
        .map((s) => (s.id === supplier.id ? supplier : s))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { suppliers: next };
    });
    setForm({ mode: 'closed' });
  }

  const selectedSuppliers = useMemo(
    () => (data?.suppliers ?? []).filter((supplier) => selectedIds.has(supplier.id)),
    [data, selectedIds]
  );

  const allSelected = Boolean(
    data?.suppliers.length &&
      data.suppliers.every((supplier) => selectedIds.has(supplier.id))
  );

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((current) => {
      const suppliers = data?.suppliers ?? [];
      const next = new Set(current);
      if (suppliers.every((supplier) => next.has(supplier.id))) {
        suppliers.forEach((supplier) => next.delete(supplier.id));
      } else {
        suppliers.forEach((supplier) => next.add(supplier.id));
      }
      return next;
    });
  }

  async function deleteSelectedSuppliers() {
    if (selectedIds.size === 0) return;
    if (!canManage) {
      setError('Manager access is required to delete suppliers.');
      return;
    }
    const ids = Array.from(selectedIds);
    const idSet = new Set(ids);
    const sampleNames = selectedSuppliers
      .slice(0, 3)
      .map((supplier) => supplier.name)
      .join(', ');
    const confirmed = confirmDangerousAction({
      title: `Delete ${ids.length} supplier${ids.length === 1 ? '' : 's'}?`,
      message:
        `${sampleNames ? `${sampleNames}${ids.length > 3 ? ', ...' : ''}\n\n` : ''}` +
        'This removes supplier records only when they are not linked to imported invoices. Archive active suppliers instead.',
      confirmationText: 'DELETE SUPPLIERS'
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api<{ deleted: number }>('/api/suppliers', {
        method: 'DELETE',
        body: JSON.stringify({ ids, confirmationText: 'DELETE SUPPLIERS' })
      });
      setData((current) =>
        current
          ? {
              suppliers: current.suppliers.filter((supplier) => !idSet.has(supplier.id))
            }
          : current
      );
      if (form.mode === 'edit' && idSet.has(form.supplier.id)) {
        setForm({ mode: 'closed' });
      }
      setSelectedIds(new Set());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete suppliers');
    } finally {
      setDeleting(false);
    }
  }

  const cardTitle =
    form.mode === 'edit' ? `Editing ${form.supplier.name}` : 'Suppliers';
  const cardSubtitle =
    form.mode === 'edit'
      ? 'Update this supplier — changes save in place.'
      : 'Vendors, contact details and account references.';

  return (
    <div className="page-stack">
      <div className="stat-grid">
        <StatCard
          icon={<IconSuppliers size={18} />}
          label="Total suppliers"
          value={loading ? '—' : String(stats.total)}
          hint="On file across statuses"
        />
        <StatCard
          label="Active"
          value={loading ? '—' : String(stats.active)}
          hint="Currently ordering from"
          tone="positive"
        />
        <StatCard
          label="Archived"
          value={loading ? '—' : String(stats.archived)}
          hint="Retired vendors kept for reference"
        />
      </div>

      <Card
        title={cardTitle}
        subtitle={cardSubtitle}
        action={
          form.mode === 'closed' ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setForm({ mode: 'create' })}
            >
              New supplier
            </Button>
          ) : null
        }
      >
        {form.mode === 'create' ? (
          <SupplierForm
            mode="create"
            onSaved={handleSupplierCreated}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : form.mode === 'edit' ? (
          <SupplierForm
            mode="edit"
            initial={form.supplier}
            onSaved={handleSupplierUpdated}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : loading ? (
          <Spinner label="Loading suppliers" />
        ) : error ? (
          <EmptyState
            icon={<IconSuppliers size={24} />}
            title="Suppliers unavailable"
            description={error}
          />
        ) : data && data.suppliers.length > 0 ? (
          <div className="table-card">
            <div className="table-toolbar stock-bulk-toolbar">
              <span>
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : `${data.suppliers.length} suppliers`}
              </span>
              <span className="table-toolbar-right stock-bulk-actions">
                {selectedIds.size > 0 ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedIds(new Set())}
                      disabled={deleting}
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => void deleteSelectedSuppliers()}
                      disabled={deleting || !canManage}
                      title={canManage ? undefined : 'Manager access required'}
                    >
                      {deleting
                        ? 'Deleting...'
                        : canManage
                          ? 'Delete selected'
                          : 'Manager required'}
                    </Button>
                  </>
                ) : (
                  `${stats.active} active · ${stats.archived} archived`
                )}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th className="select-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all suppliers"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.suppliers.map((supplier) => (
                  <tr
                    key={supplier.id}
                    className={`row-interactive ${selectedIds.has(supplier.id) ? 'stock-selected-row' : ''}`}
                    onClick={() => setForm({ mode: 'edit', supplier })}
                  >
                    <td className="select-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${supplier.name}`}
                        checked={selectedIds.has(supplier.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleSelected(supplier.id)}
                      />
                    </td>
                    <td>
                      <span className="cell-stack">
                        <strong>{supplier.name}</strong>
                        <span className="subtle">
                          {supplier.accountNumber
                            ? `Acct ${supplier.accountNumber}`
                            : supplier.paymentTerms ?? 'No terms recorded'}
                        </span>
                      </span>
                    </td>
                    <td>{supplier.contactName ?? '—'}</td>
                    <td>{supplier.phone ?? '—'}</td>
                    <td>{supplier.email ?? '—'}</td>
                    <td>
                      <Badge
                        tone={supplier.status === 'ACTIVE' ? 'positive' : 'muted'}
                        dot
                      >
                        {supplier.status}
                      </Badge>
                    </td>
                    <td className="cell-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setForm({ mode: 'edit', supplier });
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<IconSuppliers size={24} />}
            title="No suppliers yet"
            description="Record your vendors, contact details and payment terms here."
            action={
              <Button
                type="button"
                onClick={() => setForm({ mode: 'create' })}
              >
                Add the first supplier
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
}
