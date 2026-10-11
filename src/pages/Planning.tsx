import BudgetsSection from '../components/planning/BudgetsSection';
import RecurringSection from '../components/planning/RecurringSection';
import SavingsRateSection from '../components/planning/SavingsRateSection';
import NetWorthSection from '../components/planning/NetWorthSection';
import { PageHeader } from '../components/planning/ui';

export default function Planning() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 min-w-0">
      <PageHeader title="Planning" description="Budgets, subscriptions, savings and net worth." />
      <BudgetsSection />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <SavingsRateSection />
        <RecurringSection />
      </div>
      <NetWorthSection />
    </div>
  );
}
