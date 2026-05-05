import { useState } from 'react';
import type {
  Supplier,
  SupplierCreateInput,
  SupplierStatus,
  SupplierUpdateInput
} from '@alma/shared';
import { Button, Input, Select } from '@alma/ui';
import { ApiError, api } from '../../lib/api';

type Mode = 'create' | 'edit';

type Props = {
  mode: Mode;
  initial?: Supplier;
  onSaved: (supplier: Supplier) => void;
  onCancel: () => void;
};

type Draft = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  accountNumber: string;
  paymentTerms: string;
  notes: string;
  status: SupplierStatus;
};

const STATUS_OPTIONS: Array<{ label: string; value: SupplierStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Archived', value: 'ARCHIVED' }
];

function emptyDraft(): Draft {
  return {
    name: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    accountNumber: '',
    paymentTerms: '',
    notes: '',
    status: 'ACTIVE'
  };
}

function draftFromSupplier(supplier: Supplier): Draft {
  return {
    name: supplier.name,
    contactName: supplier.contactName ?? '',
    email: supplier.email ?? '',
    phone: supplier.phone ?? '',
    website: supplier.website ?? '',
    address: supplier.address ?? '',
    accountNumber: supplier.accountNumber ?? '',
    paymentTerms: supplier.paymentTerms ?? '',
    notes: supplier.notes ?? '',
    status: supplier.status
  };
}

/**
 * Inline supplier form used on the Suppliers page for create + edit.
 *
 * Lives inside an existing Card wrapper so it doesn't need its own chrome.
 * Mirrors the ItemForm shape so the two modules feel uniform: single column
 * of grid rows, status at the bottom, and a single submit that either POSTs
 * or PATCHes depending on mode.
 */
export function SupplierForm({ mode, initial, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    mode === 'edit' && initial ? draftFromSupplier(initial) : emptyDraft()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    if (!draft.name.trim()) {
      setError('Supplier name is required');
      return;
    }

    const payload: SupplierCreateInput = {
      name: draft.name.trim(),
      contactName: draft.contactName.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      website: draft.website.trim(),
      address: draft.address.trim(),
      accountNumber: draft.accountNumber.trim(),
      paymentTerms: draft.paymentTerms.trim(),
      notes: draft.notes.trim(),
      status: draft.status
    };

    setSubmitting(true);
    try {
      if (mode === 'edit' && initial) {
        const updatePayload: SupplierUpdateInput = payload;
        const saved = await api<Supplier>(`/api/suppliers/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify(updatePayload)
        });
        onSaved(saved);
      } else {
        const created = await api<Supplier>('/api/suppliers', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        onSaved(created);
        setDraft(emptyDraft());
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : mode === 'edit'
            ? 'Could not save changes'
            : 'Could not create supplier'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = submitting
    ? mode === 'edit'
      ? 'Saving…'
      : 'Creating…'
    : mode === 'edit'
      ? 'Save changes'
      : 'Create supplier';

  return (
    <form
      className="new-item-form"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="form-grid two">
        <Input
          label="Name"
          required
          value={draft.name}
          onChange={(event) => update('name', event.currentTarget.value)}
          placeholder="e.g. Sydney Meat Co"
        />
        <Input
          label="Contact name"
          value={draft.contactName}
          onChange={(event) => update('contactName', event.currentTarget.value)}
          placeholder="Optional"
        />
      </div>

      <div className="form-grid two">
        <Input
          label="Email"
          type="email"
          value={draft.email}
          onChange={(event) => update('email', event.currentTarget.value)}
          placeholder="orders@example.com"
        />
        <Input
          label="Phone"
          value={draft.phone}
          onChange={(event) => update('phone', event.currentTarget.value)}
          placeholder="+61 …"
        />
      </div>

      <div className="form-grid two">
        <Input
          label="Website"
          value={draft.website}
          onChange={(event) => update('website', event.currentTarget.value)}
          placeholder="https://…"
        />
        <Input
          label="Account number"
          value={draft.accountNumber}
          onChange={(event) => update('accountNumber', event.currentTarget.value)}
          placeholder="Optional"
        />
      </div>

      <div className="form-grid two">
        <Input
          label="Payment terms"
          value={draft.paymentTerms}
          onChange={(event) => update('paymentTerms', event.currentTarget.value)}
          placeholder="e.g. Net 30"
        />
        <Select
          label="Status"
          value={draft.status}
          onChange={(event) => update('status', event.currentTarget.value as SupplierStatus)}
          options={STATUS_OPTIONS}
        />
      </div>

      <Input
        label="Address"
        value={draft.address}
        onChange={(event) => update('address', event.currentTarget.value)}
        placeholder="Street, suburb, postcode"
      />

      <Input
        label="Notes"
        value={draft.notes}
        onChange={(event) => update('notes', event.currentTarget.value)}
        placeholder="Anything useful — delivery days, min order, etc."
      />

      {error ? <p className="error-text">{error}</p> : null}

      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
