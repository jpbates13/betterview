import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Plus, Store, Trash2 } from 'lucide-react';
import { bootstrapSchema } from '../../dbQueries.js';
import { addMerchantRule, deleteMerchantRule, getMerchantRules } from '../../db/merchants-store.js';
import { Empty, ErrorNote, Loading, Section } from '../planning/ui';
import { dangerIconButtonClass, errorMessage, inputClass, primaryButtonClass, useDbData, useMutation } from '../planning/shared';
import type { Db } from '../planning/shared';

type MerchantRule = { id: number; pattern: string; merchant: string };

const loadRules = async (db: Db) => {
  await bootstrapSchema(db);
  return (await getMerchantRules(db)) as MerchantRule[];
};

export default function MerchantRulesSection() {
  const { data: rules, isLoading, error: loadError } = useDbData(loadRules, [] as MerchantRule[]);
  const mutate = useMutation();
  const [pattern, setPattern] = useState('');
  const [merchant, setMerchant] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      await mutate((db) => addMerchantRule(db, { pattern, merchant }));
      setPattern('');
      setMerchant('');
    } catch (err) {
      setError(errorMessage(err, 'Could not add the merchant name.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (rule: MerchantRule) => {
    if (!window.confirm(`Stop renaming "${rule.pattern}" to ${rule.merchant}?`)) return;
    setError('');
    try {
      await mutate((db) => deleteMerchantRule(db, rule.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the merchant name.'));
    }
  };

  return (
    <Section
      icon={Store}
      title="Merchant names"
      description="Descriptions containing the text get this merchant name. Applies to existing and future transactions."
    >
      <ErrorNote message={loadError || error} />
      <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          className={inputClass}
          placeholder="Description contains, e.g. AMZN"
          aria-label="Description contains"
          required
        />
        <input
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          className={inputClass}
          placeholder="Merchant name, e.g. Amazon"
          aria-label="Merchant name"
          required
        />
        <button type="submit" className={primaryButtonClass} disabled={isSaving}>
          <Plus className="h-4 w-4" aria-hidden="true" /> {isSaving ? 'Adding…' : 'Add'}
        </button>
      </form>
      {isLoading && rules.length === 0 ? (
        <Loading />
      ) : rules.length === 0 ? (
        <Empty>No custom merchant names. Names are cleaned up automatically; add one here to override.</Empty>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rules.map((rule) => (
            <li key={rule.id} className="py-2 flex items-center justify-between gap-2">
              <p className="min-w-0 flex items-center gap-2 text-sm flex-wrap">
                <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 break-all">{rule.pattern}</code>
                <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" aria-label="becomes" />
                <span className="font-medium text-gray-900 break-words">{rule.merchant}</span>
              </p>
              <button type="button" className={dangerIconButtonClass} onClick={() => handleDelete(rule)} aria-label={`Delete rule for ${rule.pattern}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
