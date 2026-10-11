import { useState } from 'react';
import { FileSpreadsheet, Trash2 } from 'lucide-react';
import { deleteCsvProfile, getCsvProfiles } from '../../csvImporter.js';
import { Empty, ErrorNote, Loading, Section } from '../planning/ui';
import { dangerIconButtonClass, errorMessage, useDbData, useMutation } from '../planning/shared';
import type { Db } from '../planning/shared';

type Profile = { id: number; name: string; headers?: string[] };

const loadProfiles = (db: Db) => getCsvProfiles(db) as Promise<Profile[]>;

export default function CsvProfilesSection() {
  const { data: profiles, isLoading, error: loadError } = useDbData(loadProfiles, [] as Profile[]);
  const mutate = useMutation();
  const [error, setError] = useState('');

  const handleDelete = async (profile: Profile) => {
    if (!window.confirm(`Delete the saved format "${profile.name}"? Files in this format will ask for the column mapping again.`)) return;
    setError('');
    try {
      await mutate((db) => deleteCsvProfile(db, profile.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete that format.'));
    }
  };

  return (
    <Section icon={FileSpreadsheet} title="Saved CSV formats" description="Column mappings remembered from earlier imports.">
      <ErrorNote message={loadError || error} />
      {isLoading && profiles.length === 0 ? (
        <Loading />
      ) : profiles.length === 0 ? (
        <Empty>No saved formats. One is saved when you map the columns of a new kind of CSV.</Empty>
      ) : (
        <ul className="divide-y divide-gray-100">
          {profiles.map((profile) => (
            <li key={profile.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{profile.name}</p>
                {Array.isArray(profile.headers) && profile.headers.length > 0 && (
                  <p className="text-xs text-gray-500 truncate" title={profile.headers.join(', ')}>{profile.headers.join(', ')}</p>
                )}
              </div>
              <button type="button" className={dangerIconButtonClass} onClick={() => handleDelete(profile)} aria-label={`Delete ${profile.name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
