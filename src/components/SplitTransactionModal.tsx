import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

type Transaction = {
  id: number;
  date: string;
  description: string;
  amount: number;
  account: string;
  category: string;
};

type SplitLine = {
  description: string;
  category: string;
  amount: number;
};

type SplitTransactionModalProps = {
  isOpen: boolean;
  transaction: Transaction | null;
  onClose: () => void;
  onSubmit: (payload: { splits: SplitLine[] }) => Promise<void>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function SplitTransactionModal({
  isOpen,
  transaction,
  onClose,
  onSubmit,
}: SplitTransactionModalProps) {
  const [lines, setLines] = useState<SplitLine[]>([]);
  const [autoBalance, setAutoBalance] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !transaction) return;

    const half = round2(transaction.amount / 2);
    const secondHalf = round2(transaction.amount - half);

    setLines([
      {
        description: transaction.description,
        category: transaction.category,
        amount: half,
      },
      {
        description: transaction.description,
        category: transaction.category,
        amount: secondHalf,
      },
    ]);
    setAutoBalance(true);
    setError(null);
    setIsSubmitting(false);
  }, [isOpen, transaction]);

  const sumAmount = useMemo(
    () => round2(lines.reduce((acc, line) => acc + (Number.isFinite(line.amount) ? line.amount : 0), 0)),
    [lines],
  );

  const targetAmount = transaction ? round2(transaction.amount) : 0;
  const remaining = round2(targetAmount - sumAmount);

  if (!isOpen || !transaction) return null;

  const rebalanceToTarget = (nextLines: SplitLine[], editedIndex?: number) => {
    if (!autoBalance || nextLines.length < 2) {
      return nextLines;
    }

    const defaultBalanceIndex = nextLines.length - 1;
    const balanceIndex = editedIndex === defaultBalanceIndex ? nextLines.length - 2 : defaultBalanceIndex;

    if (balanceIndex < 0) {
      return nextLines;
    }

    const fixedSum = nextLines.reduce((acc, line, index) => {
      if (index === balanceIndex) return acc;
      return acc + (Number.isFinite(line.amount) ? line.amount : 0);
    }, 0);

    const balancedAmount = round2(targetAmount - fixedSum);
    return nextLines.map((line, index) =>
      index === balanceIndex ? { ...line, amount: balancedAmount } : line,
    );
  };

  const updateLine = (index: number, next: Partial<SplitLine>) => {
    setLines((prev) => {
      const nextLines = prev.map((line, i) => (i === index ? { ...line, ...next } : line));

      if (next.amount === undefined) {
        return nextLines;
      }

      return rebalanceToTarget(nextLines, index);
    });
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        description: transaction.description,
        category: transaction.category,
        amount: 0,
      },
    ]);
  };

  const removeLine = (index: number) => {
    setLines((prev) => rebalanceToTarget(prev.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lines.length < 2) {
      setError('Add at least two split lines.');
      return;
    }

    const hasInvalid = lines.some((line) => {
      if (!line.description.trim() || !line.category.trim()) return true;
      if (!Number.isFinite(line.amount) || Math.abs(line.amount) < 0.005) return true;
      return false;
    });
    if (hasInvalid) {
      setError('Each line needs description, category, and a non-zero amount.');
      return;
    }

    if (Math.abs(remaining) > 0.01) {
      setError(`Split amounts must sum to ${targetAmount.toFixed(2)}.`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onSubmit({ splits: lines });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to split transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Split Transaction</h2>
            <p className="text-sm text-gray-500 mt-1">
              {transaction.date} | {transaction.description} | ${Math.abs(transaction.amount).toFixed(2)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <form id="split-transaction-form" onSubmit={handleSubmit} className="space-y-4">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end p-3 border border-gray-200 rounded-lg bg-gray-50/30">
                <div className="md:col-span-5">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <input
                    type="text"
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    required
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <input
                    type="text"
                    value={line.category}
                    onChange={(e) => updateLine(index, { category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                  <input
                    type="number"
                    value={line.amount}
                    onChange={(e) => updateLine(index, { amount: parseFloat(e.target.value) || 0 })}
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    required
                  />
                </div>
                <div className="md:col-span-1 flex md:justify-end">
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    disabled={lines.length <= 2}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                    title="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Line
            </button>

            <div className="p-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 flex flex-col gap-1">
              <div>Original amount: <span className="font-semibold">{targetAmount.toFixed(2)}</span></div>
              <div>Split total: <span className="font-semibold">{sumAmount.toFixed(2)}</span></div>
              <div className={Math.abs(remaining) <= 0.01 ? 'text-emerald-700' : 'text-amber-700'}>
                Remaining: <span className="font-semibold">{remaining.toFixed(2)}</span>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={autoBalance}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setAutoBalance(enabled);

                  if (enabled) {
                    setLines((prev) => rebalanceToTarget(prev));
                  }
                }}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Auto-balance one line to keep totals matching
            </label>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="split-transaction-form"
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-70 flex items-center"
          >
            {isSubmitting ? (
              <><div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>Saving...</>
            ) : 'Save Split'}
          </button>
        </div>
      </div>
    </div>
  );
}
