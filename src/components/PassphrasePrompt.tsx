import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';

type Props = {
  message: string,
  onSubmit: (passphrase: string) => Promise<void>,
  onLogout: () => void,
};

// Shown when the Drive copy is encrypted and this device doesn't have the key yet.
export default function PassphrasePrompt({ message, onSubmit, onLogout }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [isWorking, setIsWorking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsWorking(true);
    try {
      await onSubmit(passphrase);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-3 text-gray-900 font-semibold">
          <Lock className="h-5 w-5 text-primary-600" />
          Encrypted Drive copy
        </div>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="Passphrase"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4"
        />
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={!passphrase || isWorking}
            className="flex-1 px-4 py-2 rounded-lg bg-primary-600 text-white font-medium disabled:opacity-50"
          >
            {isWorking ? 'Unlocking…' : 'Unlock'}
          </button>
          <button type="button" onClick={onLogout} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700">
            Logout
          </button>
        </div>
      </form>
    </div>
  );
}
